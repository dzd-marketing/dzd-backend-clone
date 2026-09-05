const db = require('../config/db');
const PROVIDER_BALANCE_API = 'https://smmcheep.com/api/v2?key=e785f9e49139b1f3e6a5a1d98a09506c&action=balance';
const EXCHANGE_API = 'https://v6.exchangerate-api.com/v6/be291495375008a1e603a49a/latest/USD';

async function getProviderBalanceUSD() {
  try {
    const response = await fetch(PROVIDER_BALANCE_API);
    const data = await response.json();
    
    if (data && data.balance) {
      const balance = parseFloat(data.balance) || 0;
      console.log(`💰 Provider balance: $${balance.toFixed(4)} USD`);
      return balance;
    }
    throw new Error('Failed to get provider balance');
  } catch (error) {
    console.error('❌ Provider balance error:', error.message);
    return 0;
  }
}

// Get USD to LKR exchange rate
async function getExchangeRate() {
  try {
    const response = await fetch(EXCHANGE_API);
    const data = await response.json();
    
    if (data.result === 'success' && data.conversion_rates?.LKR) {
      const rate = parseFloat(data.conversion_rates.LKR);
      console.log(`💱 Exchange rate: 1 USD = ${rate} LKR`);
      return rate;
    }
    throw new Error('Failed to get exchange rate');
  } catch (error) {
    console.error('❌ Exchange rate error:', error.message);
    // Return cached rate or default
    return 330; // Default fallback
  }
}

// ─── CANCEL QUEUE ORDER WITH REFUND ──────────────────────────────────────
exports.cancelQueueOrder = async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    const { orderId } = req.params;
    const { withRefund = true } = req.query; // Default: refund enabled
    
    // ─── STEP 1: Get order from orders table (status = 'queue') ──────
    const [queueOrders] = await connection.query(
      `SELECT * FROM orders WHERE order_id = ? AND status = 'queue'`,
      [orderId]
    );
    
    if (queueOrders.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Queue order not found' 
      });
    }
    
    const queueOrder = queueOrders[0];
    const userId = queueOrder.user_id;
    const charge = parseFloat(queueOrder.charge || 0);
    
    // ─── STEP 2: Start transaction ──────────────────────────────────────
    await connection.beginTransaction();
    
    // ─── STEP 3: Update order status to CANCELED ──────────────────────
    await connection.query(
      `UPDATE orders 
       SET status = 'Canceled',
           updated_at = NOW()
       WHERE order_id = ? AND status = 'queue'`,
      [orderId]
    );
    
    // ─── STEP 4: If refund enabled, process refund ────────────────────
    let refundProcessed = false;
    let refundAmount = 0;
    
    if (withRefund === true || withRefund === 'true') {
      refundAmount = charge;
      
      // ✅ 4a: Update order with refunded_amount
      await connection.query(
        `UPDATE orders 
         SET refunded_amount = ?,
             status = 'fully_refunded',
             updated_at = NOW()
         WHERE order_id = ? AND user_id = ?`,
        [charge, orderId, userId]
      );
      
      // ✅ 4b: Add refund amount to user's balance (wallet)
      // First check if user exists
      const [userCheck] = await connection.query(
        `SELECT id FROM users WHERE uid = ?`,
        [userId]
      );
      
      if (userCheck.length > 0) {
        // Update user balance (assuming you have a balance column)
        await connection.query(
          `UPDATE users 
           SET balance = COALESCE(balance, 0) + ?
           WHERE uid = ?`,
          [charge, userId]
        );
      }
      
      refundProcessed = true;
    }
    
    // ─── STEP 5: Commit transaction ────────────────────────────────────
    await connection.commit();
    
    console.log(`🗑️ Queue order ${orderId} canceled${refundProcessed ? ` and refunded LKR ${refundAmount.toFixed(2)} to user ${userId}` : ''}`);
    
    res.json({
      success: true,
      message: `Queue order ${orderId} canceled successfully${refundProcessed ? ` and refunded LKR ${refundAmount.toFixed(2)} to user's wallet` : ''}`,
      data: {
        order_id: orderId,
        user_id: userId,
        charge: charge,
        refunded: refundProcessed,
        refund_amount: refundProcessed ? refundAmount : 0,
        status: refundProcessed ? 'fully_refunded' : 'Canceled'
      }
    });
    
  } catch (error) {
    await connection.rollback();
    console.error('Error canceling queue order:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to cancel queue order' 
    });
  } finally {
    connection.release();
  }
};


exports.runQueueManually = async (req, res) => {
  try {
    console.log('🔄 [Manual] Processing queue orders...', new Date().toISOString());
    
    // ─── STEP 1: Get exchange rate ──────────────────────────────────
    const exchangeRate = await getExchangeRate();
    
    // ─── STEP 2: Get provider balance (USD) and convert to LKR ──────
    const providerBalanceUSD = await getProviderBalanceUSD();
    
    if (providerBalanceUSD <= 0) {
      return res.json({
        success: false,
        message: 'Provider balance is zero or negative. Cannot process queue.',
        provider_balance_usd: providerBalanceUSD
      });
    }
    
    const providerBalanceLKR = providerBalanceUSD * exchangeRate;
    
    // ─── STEP 3: Get QUEUE orders ──────────────────────────────────
    const [queueOrders] = await db.query(
      `SELECT * FROM order_queue 
       WHERE status = 'pending' 
       ORDER BY created_at ASC 
       LIMIT 20`
    );
    
    if (queueOrders.length === 0) {
      return res.json({
        success: true,
        message: 'No queue orders to process',
        processed: 0,
        queue_count: 0
      });
    }
    
    console.log(`📦 Found ${queueOrders.length} queue orders to process`);
    
    // ─── STEP 4: Process each order ──────────────────────────────────
    let processedCount = 0;
    let failedCount = 0;
    let remainingBalanceLKR = providerBalanceLKR;
    let remainingBalanceUSD = providerBalanceUSD;
    const results = [];
    
    for (const order of queueOrders) {
      const orderId = order.order_id;
      const orderChargeLKR = parseFloat(order.charge || 0);
      const orderChargeUSD = orderChargeLKR / exchangeRate;
      
      console.log(`\n📋 Order #${orderId}:`);
      console.log(`   Order Charge: LKR ${orderChargeLKR.toFixed(2)} ($${orderChargeUSD.toFixed(4)} USD)`);
      console.log(`   Remaining Balance: LKR ${remainingBalanceLKR.toFixed(2)} ($${remainingBalanceUSD.toFixed(4)} USD)`);
      
      // ─── STEP 5: Check if provider has enough balance ──────────────
      if (remainingBalanceLKR < orderChargeLKR) {
        console.log(`⚠️ Insufficient balance! Need LKR ${orderChargeLKR.toFixed(2)}, have LKR ${remainingBalanceLKR.toFixed(2)}`);
        console.log(`⏳ Order ${orderId} - Will retry later`);
        
        results.push({
          order_id: orderId,
          status: 'pending',
          reason: 'Insufficient provider balance'
        });
        
        break;
      }
      
      // ─── STEP 6: Build API params ──────────────────────────────────
      const apiParams = {
        action: 'add',
        service: order.service_id,
        link: order.link,
        quantity: order.quantity.toString()
      };
      
      console.log(`📤 Sending order to API...`);
      
      try {
        // ─── STEP 7: Call Provider API ──────────────────────────────
        const response = await fetch('https://api.dzd-marketing.site/api/proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: order.provider || 'premium',
            ...apiParams
          })
        });
        
        const data = await response.json();
        console.log(`📥 API Response:`, JSON.stringify(data));
        
        // ─── STEP 8: Handle API Response ─────────────────────────────
        if (data && data.order) {
          // ✅ SUCCESS - Move to orders table
          const realOrderId = data.order;
          
          // Insert into orders table
          await db.query(
            `INSERT INTO orders 
             (order_id, user_id, service_id, service_name, provider, quantity, charge, provider_charge, link, status, remains, currency, is_api_order) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?, ?)`,
            [realOrderId, order.user_id, order.service_id, order.service_name, order.provider, 
             order.quantity, order.charge, order.provider_charge, order.link, order.quantity, order.currency, 1]
          );
          
          // Delete from queue
          await db.query(
            `DELETE FROM order_queue WHERE order_id = ?`,
            [orderId]
          );
          
          // Deduct order charge from remaining balance
          remainingBalanceLKR -= orderChargeLKR;
          remainingBalanceUSD -= orderChargeUSD;
          
          processedCount++;
          console.log(`✅ Order ${orderId} processed successfully!`);
          console.log(`   New Order ID: ${realOrderId}`);
          
          results.push({
            order_id: orderId,
            new_order_id: realOrderId,
            status: 'completed',
            charge_usd: orderChargeUSD.toFixed(4),
            charge_lkr: orderChargeLKR.toFixed(2)
          });
          
        } else if (data?.error) {
          // ❌ API ERROR
          const errorMsg = data.error.toLowerCase();
          
          if (errorMsg.includes('not enough funds') || errorMsg.includes('balance')) {
            // Balance error - keep in queue
            results.push({
              order_id: orderId,
              status: 'pending',
              reason: 'Provider balance insufficient - will retry later'
            });
            
            // Stop processing - no more balance
            break;
            
          } else {
            // Other error - mark as failed in queue
            await db.query(
              `UPDATE order_queue 
               SET status = 'failed',
                   error_message = ?,
                   updated_at = NOW() 
               WHERE order_id = ?`,
              [data.error, orderId]
            );
            
            failedCount++;
            results.push({
              order_id: orderId,
              status: 'failed',
              reason: data.error
            });
          }
          
        } else {
          // Unknown response - keep in queue
          results.push({
            order_id: orderId,
            status: 'pending',
            reason: 'Unknown API response - will retry'
          });
        }
        
      } catch (error) {
        console.error(`❌ Error processing order ${orderId}:`, error.message);
        results.push({
          order_id: orderId,
          status: 'error',
          reason: error.message
        });
      }
    }
    
    const response = {
      success: true,
      message: 'Queue processing completed',
      processed: processedCount,
      failed: failedCount,
      remaining_in_queue: queueOrders.length - processedCount - failedCount,
      provider_balance: {
        usd: remainingBalanceUSD.toFixed(4),
        lkr: remainingBalanceLKR.toFixed(2)
      },
      results: results
    };
    
    console.log(`✅ [Manual] Processed ${processedCount} queue orders`);
    res.json(response);
    
  } catch (error) {
    console.error('❌ [Manual] Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Get all orders for a user
exports.getUserOrders = async (req, res) => {
  try {
    const { userId } = req.params;
    
    const [orders] = await db.query(
      `SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC`,
      [userId]
    );
    
    res.json(orders);
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
};

// Get single order by ID
exports.getOrderById = async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const [orders] = await db.query(
      `SELECT * FROM orders WHERE order_id = ?`,
      [orderId]
    );
    
    if (orders.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    res.json(orders[0]);
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
};

// ─── CREATE NEW ORDER (Single Function - Handles Normal + Queue) ───
exports.createOrder = async (req, res) => {
  try {
    const { 
      userId, 
      serviceId, 
      serviceName, 
      provider, 
      quantity, 
      charge, 
      currency, 
      link, 
      start_count, 
      remains, 
      status,
      apiParams 
    } = req.body;

    // ─────────────────────────────────────────────
    // STEP 1: Generate NUMERIC temporary order ID
    // ─────────────────────────────────────────────
    // Use timestamp + random number (16 digits - fits in BIGINT)
    const timestamp = Date.now(); // 13 digits
    const random = Math.floor(Math.random() * 1000); // 3 digits
    const tempOrderId = parseInt(`${timestamp}${random.toString().padStart(3, '0')}`);
    // Example: 1787293042191001 (16 digits)
    
    console.log(`📦 Generated temp order ID: ${tempOrderId}`);

    // ─────────────────────────────────────────────
    // STEP 2: Build provider API parameters
    // ─────────────────────────────────────────────
    const apiParamsObj = apiParams || {
      action: 'add',
      service: serviceId,
      link: link,
      quantity: String(quantity)
    };

    // ─────────────────────────────────────────────
    // STEP 3: Call Provider API
    // ─────────────────────────────────────────────
    const SMM_PROXY_URL = process.env.SMM_PROXY_URL || 'https://api.dzd-marketing.site/api/proxy';

    let apiSuccess = false;
    let realOrderId = null;
    let apiError = null;
    let isBalanceError = false;

    try {
      const response = await fetch(SMM_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: provider || 'premium',
          ...apiParamsObj
        })
      });

      let data;
      try {
        data = await response.json();
      } catch (jsonError) {
        apiError = 'Invalid provider API response';
        console.error('Provider returned invalid JSON:', jsonError.message);
        return res.status(502).json({
          success: false,
          error: apiError
        });
      }

      console.log('Provider API Response:', JSON.stringify(data));

      // ─── SUCCESS ───
      if (data && data.order) {
        realOrderId = parseInt(data.order); // ✅ Convert to integer
        apiSuccess = true;
      }
      // ─── ERROR ───
      else if (data && data.error) {
        apiError = String(data.error);
        console.log(`Provider API Error: ${apiError}`);
        
        // 🔥 ONLY BALANCE ERROR GOES TO QUEUE
        if (apiError.toLowerCase().includes('not enough funds on balance')) {
          isBalanceError = true;
        }
      }
      // ─── UNKNOWN ───
      else {
        apiError = 'Unknown provider API response';
      }

    } catch (error) {
      apiError = error?.message || 'Provider API request failed';
      console.error('Provider API request error:', error);
      isBalanceError = false;
    }

    // ─────────────────────────────────────────────
    // STEP 4: PROVIDER SUCCESS - Save as PENDING
    // ─────────────────────────────────────────────
    if (apiSuccess && realOrderId) {
      await db.query(
        `INSERT INTO orders (
          order_id, user_id, service_id, service_name, provider,
          quantity, charge, currency, link, start_count, remains, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          realOrderId,  // ✅ Integer
          userId,
          serviceId,
          serviceName,
          provider || 'premium',
          quantity,
          charge,
          currency || 'LKR',
          link,
          start_count ?? 0,
          remains ?? quantity,
          'pending'
        ]
      );

      return res.status(201).json({
        success: true,
        message: 'Order placed successfully',
        orderId: realOrderId,
        queue_order: false,
        status: 'pending'
      });
    }

    // ─────────────────────────────────────────────
    // STEP 5: BALANCE ERROR - Save as QUEUE
    // ─────────────────────────────────────────────
    if (isBalanceError) {
      console.log(`⚠️ Provider balance insufficient. Queueing order: ${tempOrderId}`);

      await db.query(
        `INSERT INTO orders (
          order_id, user_id, service_id, service_name, provider,
          quantity, charge, currency, link, start_count, remains, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tempOrderId,  // ✅ Integer
          userId,
          serviceId,
          serviceName,
          provider || 'premium',
          quantity,
          charge,
          currency || 'LKR',
          link,
          start_count ?? 0,
          remains ?? quantity,
          'queue'
        ]
      );

      // ❗ Don't expose provider balance error to user
      return res.status(201).json({
        success: true,
        message: 'Order queued successfully',
        orderId: tempOrderId,
        queue_order: true,
        status: 'queue'
      });
    }

    // ─────────────────────────────────────────────
    // STEP 6: OTHER ERROR - Return Error
    // ─────────────────────────────────────────────
    console.error('Provider order failed:', apiError);

    return res.status(502).json({
      success: false,
      error: apiError || 'Provider order failed'
    });

  } catch (error) {
    console.error('Error creating order:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to create order'
    });
  }
};
// Update order status
exports.updateOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status, remains, start_count, refundedAmount } = req.body;

    // Build update query dynamically
    const updates = [];
    const values = [];

    if (status !== undefined) {
      updates.push('status = ?');
      values.push(status);
    }
    if (remains !== undefined) {
      updates.push('remains = ?');
      values.push(remains);
    }
    if (start_count !== undefined) {
      updates.push('start_count = ?');
      values.push(start_count);
    }
    if (refundedAmount !== undefined) {
      updates.push('refunded_amount = ?');
      values.push(refundedAmount);
    }

    // Always update updated_at
    updates.push('updated_at = NOW()');

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(orderId);

    await db.query(
      `UPDATE orders SET ${updates.join(', ')} WHERE order_id = ?`,
      values
    );

    res.json({ 
      success: true, 
      message: 'Order status updated successfully' 
    });
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({ error: 'Failed to update order status' });
  }
};

// Get order statistics
exports.getOrderStats = async (req, res) => {
  try {
    const { userId } = req.params;

    const [stats] = await db.query(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN LOWER(status) LIKE '%completed%' OR LOWER(status) LIKE '%success%' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN LOWER(status) LIKE '%pending%' OR LOWER(status) LIKE '%processing%' OR LOWER(status) LIKE '%progress%' THEN 1 ELSE 0 END) as active,
        SUM(charge) as total_spent
       FROM orders WHERE user_id = ?`,
      [userId]
    );

    res.json(stats[0] || { total: 0, completed: 0, active: 0, total_spent: 0 });
  } catch (error) {
    console.error('Error fetching order stats:', error);
    res.status(500).json({ error: 'Failed to fetch order stats' });
  }
};

// Get recent orders (limit 5)
exports.getRecentOrders = async (req, res) => {
  try {
    const { userId } = req.params;

    const [orders] = await db.query(
      `SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`,
      [userId]
    );

    res.json(orders);
  } catch (error) {
    console.error('Error fetching recent orders:', error);
    res.status(500).json({ error: 'Failed to fetch recent orders' });
  }
};

// Get all orders with refund info for a user
exports.getUserOrdersWithRefunds = async (req, res) => {
  try {
    const { userId } = req.params;
    
    const [orders] = await db.query(
      `SELECT 
        *,
        CASE 
          WHEN refunded_amount > 0 AND refunded_amount >= charge THEN 'Fully Refunded'
          WHEN refunded_amount > 0 AND refunded_amount < charge THEN 'Partially Refunded'
          ELSE 'No Refund'
        END as refund_status,
        CASE 
          WHEN refunded_amount > 0 THEN (charge - refunded_amount)
          ELSE charge
        END as net_charge
      FROM orders 
      WHERE user_id = ? 
      ORDER BY created_at DESC`,
      [userId]
    );
    
    res.json(orders);
  } catch (error) {
    console.error('Error fetching orders with refunds:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
};

// Get total refunded amount for a user
exports.getUserTotalRefunded = async (req, res) => {
  try {
    const { userId } = req.params;
    
    const [result] = await db.query(
      `SELECT 
        COALESCE(SUM(refunded_amount), 0) as total_refunded,
        COUNT(CASE WHEN refunded_amount > 0 THEN 1 END) as refunded_orders_count
      FROM orders 
      WHERE user_id = ?`,
      [userId]
    );
    
    res.json({
      success: true,
      total_refunded: result[0]?.total_refunded || 0,
      refunded_orders_count: result[0]?.refunded_orders_count || 0
    });
  } catch (error) {
    console.error('Error fetching total refunded:', error);
    res.status(500).json({ error: 'Failed to fetch total refunded' });
  }
};

exports.getApiOrders = async (req, res) => {
  try {
    // Optional: filter by status if provided
    const { status, limit = 100, offset = 0 } = req.query;
    
    let query = `SELECT * FROM orders WHERE is_api_order = 1`;
    const queryParams = [];
    
    // Add status filter if provided
    if (status) {
      query += ` AND status LIKE ?`;
      queryParams.push(`%${status}%`);
    }
    
    // Add ordering and pagination
    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    queryParams.push(parseInt(limit), parseInt(offset));
    
    const [orders] = await db.query(query, queryParams);
    
    // Get total count for pagination
    const [countResult] = await db.query(
      `SELECT COUNT(*) as total FROM orders WHERE is_api_order = 1${status ? ' AND status LIKE ?' : ''}`,
      status ? [`%${status}%`] : []
    );
    
    res.json({
      success: true,
      orders,
      pagination: {
        total: countResult[0].total,
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });
  } catch (error) {
    console.error('Error fetching API orders:', error);
    res.status(500).json({ error: 'Failed to fetch API orders' });
  }
};

// Get API order statistics (for admin dashboard)
exports.getApiOrderStats = async (req, res) => {
  try {
    const [stats] = await db.query(
      `SELECT 
        COUNT(*) as total_orders,
        SUM(charge) as total_charge,
        SUM(CASE WHEN status LIKE '%completed%' OR status LIKE '%success%' THEN 1 ELSE 0 END) as completed_orders,
        SUM(CASE WHEN status LIKE '%pending%' OR status LIKE '%processing%' OR status LIKE '%progress%' THEN 1 ELSE 0 END) as active_orders,
        SUM(CASE WHEN refunded_amount > 0 THEN 1 ELSE 0 END) as refunded_orders,
        SUM(refunded_amount) as total_refunded
      FROM orders WHERE is_api_order = 1`
    );
    
    res.json({
      success: true,
      stats: stats[0] || {
        total_orders: 0,
        total_charge: 0,
        completed_orders: 0,
        active_orders: 0,
        refunded_orders: 0,
        total_refunded: 0
      }
    });
  } catch (error) {
    console.error('Error fetching API order stats:', error);
    res.status(500).json({ error: 'Failed to fetch API order stats' });
  }
};
