const db = require('../config/db');

// ─── GET USER ORDERS ───
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

// ─── GET SINGLE ORDER BY ID ───
exports.getOrderById = async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const [orders] = await db.query(
      'SELECT * FROM orders WHERE order_id = ?',
      [orderId]
    );
    
    if (orders.length > 0) {
      return res.json(orders[0]);
    }
    
    const [queueOrders] = await db.query(
      'SELECT * FROM order_queue WHERE order_id = ?',
      [orderId]
    );
    
    if (queueOrders.length > 0) {
      return res.json({
        ...queueOrders[0],
        is_queue: true
      });
    }
    
    return res.status(404).json({ error: 'Order not found' });
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
};

// ─── CREATE NEW ORDER (Single Endpoint - Handles both Normal & Queue) ───
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
      apiParams,
      providerCharge
    } = req.body;

    // ✅ STEP 1: Check Provider Balance
    const [providers] = await db.query(
      'SELECT balance FROM providers WHERE name = ?',
      [provider || 'premium']
    );
    
    let providerBalance = 0;
    if (providers.length > 0) {
      providerBalance = parseFloat(providers[0].balance) || 0;
    }
    
    const orderCharge = parseFloat(charge) || 0;
    const isQueueOrder = providerBalance < orderCharge;
    
    let orderId;
    let finalStatus;
    let apiResponse = null;
    let realOrderId = null;
    
    // ✅ STEP 2: If provider has enough balance, call API directly
    if (!isQueueOrder) {
      try {
        const apiParamsObj = apiParams || {
          action: 'add',
          service: serviceId,
          link: link,
          quantity: quantity.toString()
        };
        
        const SMM_PROXY_URL = process.env.SMM_PROXY_URL || 'https://api.dzd-marketing.site/api/proxy';
        const response = await fetch(SMM_PROXY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            provider: provider || 'premium', 
            ...apiParamsObj 
          })
        });
        
        const data = await response.json();
        apiResponse = data;
        
        if (data && data.order) {
          realOrderId = data.order.toString();
          orderId = realOrderId;
          finalStatus = 'PENDING';
          
          // ✅ Deduct provider balance
          await db.query(
            'UPDATE providers SET balance = balance - ? WHERE name = ?',
            [orderCharge, provider || 'premium']
          );
        } else {
          // API failed - queue the order
          isQueueOrder = true;
          orderId = `QUEUE_${Date.now()}_${userId.slice(0, 6)}`;
          finalStatus = 'QUEUE';
        }
      } catch (error) {
        console.error('API call failed, queueing order:', error);
        isQueueOrder = true;
        orderId = `QUEUE_${Date.now()}_${userId.slice(0, 6)}`;
        finalStatus = 'QUEUE';
      }
    } else {
      // ✅ STEP 3: Provider balance insufficient - Queue the order
      orderId = `QUEUE_${Date.now()}_${userId.slice(0, 6)}`;
      finalStatus = 'QUEUE';
    }
    
    // ✅ STEP 4: Save to order_queue table
    await db.query(
      `INSERT INTO order_queue (
        order_id, user_id, service_id, service_name, provider, 
        quantity, charge, currency, link, provider_charge, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        orderId, 
        userId, 
        serviceId, 
        serviceName, 
        provider || 'premium', 
        quantity, 
        charge, 
        currency || 'LKR', 
        link,
        providerCharge || 0,
        finalStatus.toLowerCase()
      ]
    );

    // ✅ STEP 5: Save to main orders table
    const [existing] = await db.query(
      'SELECT id FROM orders WHERE order_id = ?',
      [orderId]
    );

    if (existing.length === 0) {
      await db.query(
        `INSERT INTO orders (
          order_id, user_id, service_id, service_name, provider, 
          quantity, charge, currency, link, start_count, remains, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId, 
          userId, 
          serviceId, 
          serviceName, 
          provider || 'premium', 
          quantity, 
          charge, 
          currency || 'LKR', 
          link, 
          start_count || 0, 
          remains || quantity,
          finalStatus
        ]
      );
    }

    // ✅ STEP 6: Return response
    res.status(201).json({ 
      success: true, 
      message: isQueueOrder ? 'Order queued successfully' : 'Order placed successfully',
      orderId: orderId,
      queue_order: isQueueOrder,
      real_order_id: realOrderId,
      api_response: apiResponse
    });
    
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to create order' 
    });
  }
};

// ─── UPDATE ORDER STATUS ───
exports.updateOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status, remains, start_count, refundedAmount } = req.body;

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

    updates.push('updated_at = NOW()');

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(orderId);

    // Update main orders
    await db.query(
      `UPDATE orders SET ${updates.join(', ')} WHERE order_id = ?`,
      values
    );

    // Also update queue if status is completed or failed
    if (status && (status.toLowerCase().includes('complete') || status.toLowerCase().includes('success'))) {
      await db.query(
        `UPDATE order_queue 
         SET status = 'completed',
             updated_at = NOW() 
         WHERE order_id = ?`,
        [orderId]
      );
    }

    res.json({ 
      success: true, 
      message: 'Order status updated successfully' 
    });
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({ error: 'Failed to update order status' });
  }
};

// ─── GET ORDER STATS ───
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

// ─── GET RECENT ORDERS ───
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

// ─── GET USER ORDERS WITH REFUNDS ───
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

// ─── GET USER TOTAL REFUNDED ───
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

// ─── GET API ORDERS (Admin) ───
exports.getApiOrders = async (req, res) => {
  try {
    const { status, limit = 100, offset = 0 } = req.query;
    
    let query = `SELECT * FROM orders WHERE is_api_order = 1`;
    const queryParams = [];
    
    if (status) {
      query += ` AND status LIKE ?`;
      queryParams.push(`%${status}%`);
    }
    
    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    queryParams.push(parseInt(limit), parseInt(offset));
    
    const [orders] = await db.query(query, queryParams);
    
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

// ─── GET API ORDER STATS (Admin) ───
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

// ─── QUEUE ROUTES ───

// ─── GET QUEUE ORDERS (For Cron-Job) ───
exports.getQueueOrders = async (req, res) => {
  try {
    const [orders] = await db.query(
      `SELECT * FROM order_queue 
       WHERE status = 'queue' 
       ORDER BY created_at ASC`
    );
    
    res.json({
      success: true,
      orders
    });
  } catch (error) {
    console.error('Error fetching queue orders:', error);
    res.status(500).json({ error: 'Failed to fetch queue orders' });
  }
};

// ─── SEND QUEUE ORDER TO API (Cron-Job) ───
exports.sendQueueOrderToApi = async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const [queueOrders] = await db.query(
      'SELECT * FROM order_queue WHERE order_id = ? AND status = "queue"',
      [orderId]
    );
    
    if (queueOrders.length === 0) {
      return res.status(404).json({ error: 'Queue order not found' });
    }
    
    const order = queueOrders[0];
    
    // Check provider balance
    const [providers] = await db.query(
      'SELECT balance FROM providers WHERE name = ?',
      [order.provider || 'premium']
    );
    
    let providerBalance = 0;
    if (providers.length > 0) {
      providerBalance = parseFloat(providers[0].balance) || 0;
    }
    
    if (providerBalance < parseFloat(order.charge)) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient provider balance',
        required: order.charge,
        available: providerBalance,
        retryable: true
      });
    }
    
    // Build API params
    const apiParams = {
      action: 'add',
      service: order.service_id,
      link: order.link,
      quantity: order.quantity.toString()
    };
    
    // Call API
    const SMM_PROXY_URL = process.env.SMM_PROXY_URL || 'https://api.dzd-marketing.site/api/proxy';
    
    const response = await fetch(SMM_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        provider: order.provider || 'premium', 
        ...apiParams 
      })
    });
    
    const data = await response.json();
    
    if (data && data.order) {
      const realOrderId = data.order;
      
      // Update queue order
      await db.query(
        `UPDATE order_queue 
         SET status = 'pending',
             order_id = ?,
             updated_at = NOW() 
         WHERE order_id = ?`,
        [realOrderId, orderId]
      );
      
      // Update main orders
      await db.query(
        `UPDATE orders 
         SET order_id = ?,
             status = 'pending' 
         WHERE order_id = ? AND status = 'queue'`,
        [realOrderId, orderId]
      );
      
      // Deduct provider balance
      await db.query(
        'UPDATE providers SET balance = balance - ? WHERE name = ?',
        [parseFloat(order.charge), order.provider || 'premium']
      );
      
      res.json({
        success: true,
        message: 'Order sent to API successfully',
        oldOrderId: orderId,
        newOrderId: realOrderId,
        apiResponse: data
      });
      
    } else if (data?.error) {
      if (data.error.includes('Not enough funds') || data.error.includes('balance')) {
        await db.query(
          `UPDATE order_queue 
           SET updated_at = NOW() 
           WHERE order_id = ?`,
          [orderId]
        );
        
        res.json({
          success: false,
          error: data.error,
          retryable: true,
          message: 'Provider balance insufficient, will retry later'
        });
      } else {
        await db.query(
          `UPDATE order_queue 
           SET status = 'failed',
               updated_at = NOW() 
           WHERE order_id = ?`,
          [orderId]
        );
        
        await db.query(
          `UPDATE orders 
           SET status = 'failed' 
           WHERE order_id = ?`,
          [orderId]
        );
        
        await refundUser(order.user_id, order.charge, `Refund for failed order #${orderId}`);
        
        res.json({
          success: false,
          error: data.error,
          retryable: false,
          message: 'Order failed, user refunded'
        });
      }
    } else {
      await db.query(
        `UPDATE order_queue 
         SET updated_at = NOW() 
         WHERE order_id = ?`,
        [orderId]
      );
      
      res.json({
        success: false,
        error: 'Unknown API response',
        retryable: true
      });
    }
  } catch (error) {
    console.error('Error sending queue order to API:', error);
    res.status(500).json({ error: 'Failed to send order to API' });
  }
};

// ─── HELPER: Refund user ───
async function refundUser(userId, amount, description) {
  try {
    const WORKER_URL = process.env.WORKER_URL || 'https://your-worker.com';
    const refundRes = await fetch(`${WORKER_URL}/add-balance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        amount: parseFloat(amount),
        description
      })
    });
    const result = await refundRes.json();
    console.log(`✅ Refunded ${amount} to user ${userId}:`, result);
    return result;
  } catch (error) {
    console.error('Refund failed:', error);
    return { success: false, error: error.message };
  }
}
