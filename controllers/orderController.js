const db = require('../config/db');

// ─── CREATE QUEUE ORDER (User balance deducted, provider not yet) ───
exports.createQueueOrder = async (req, res) => {
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
      providerCharge
    } = req.body;

    // Generate temporary order ID
    const tempOrderId = `QUEUE_${Date.now()}_${userId.slice(0, 6)}`;

    // ✅ Insert into order_queue table
    const [result] = await db.query(
      `INSERT INTO order_queue (
        order_id, user_id, service_id, service_name, provider, 
        quantity, charge, currency, link, provider_charge, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        tempOrderId, 
        userId, 
        serviceId, 
        serviceName, 
        provider || 'premium', 
        quantity, 
        charge, 
        currency || 'LKR', 
        link,
        providerCharge || 0,
        'queue'  // Status = 'queue'
      ]
    );

    // ✅ Also insert into main orders table with QUEUE status (so user can see it)
    const [existing] = await db.query(
      'SELECT id FROM orders WHERE order_id = ?',
      [tempOrderId]
    );

    if (existing.length === 0) {
      await db.query(
        `INSERT INTO orders (
          order_id, user_id, service_id, service_name, provider, 
          quantity, charge, currency, link, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tempOrderId, 
          userId, 
          serviceId, 
          serviceName, 
          provider || 'premium', 
          quantity, 
          charge, 
          currency || 'LKR', 
          link,
          'queue'  // Status = 'queue'
        ]
      );
    }

    res.status(201).json({ 
      success: true, 
      message: 'Order queued successfully',
      orderId: tempOrderId
    });
  } catch (error) {
    console.error('Error creating queue order:', error);
    res.status(500).json({ error: 'Failed to create queue order' });
  }
};

// ─── DELETE QUEUE ORDER (Rollback) ───
exports.deleteQueueOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    
    // Delete from queue table
    const [queueResult] = await db.query(
      'DELETE FROM order_queue WHERE order_id = ?',
      [orderId]
    );
    
    // Delete from main orders
    const [orderResult] = await db.query(
      'DELETE FROM orders WHERE order_id = ? AND status = "queue"',
      [orderId]
    );
    
    if (queueResult.affectedRows === 0 && orderResult.affectedRows === 0) {
      return res.status(404).json({ error: 'Queue order not found' });
    }
    
    res.json({ success: true, message: 'Queue order deleted successfully' });
  } catch (error) {
    console.error('Error deleting queue order:', error);
    res.status(500).json({ error: 'Failed to delete queue order' });
  }
};

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

// ─── SEND QUEUE ORDER TO API (Called by Cron-Job) ───
exports.sendQueueOrderToApi = async (req, res) => {
  try {
    const { orderId } = req.params;
    
    // Get order from queue table
    const [queueOrders] = await db.query(
      'SELECT * FROM order_queue WHERE order_id = ? AND status = "queue"',
      [orderId]
    );
    
    if (queueOrders.length === 0) {
      return res.status(404).json({ error: 'Queue order not found' });
    }
    
    const order = queueOrders[0];
    
    // ✅ Check provider balance from providers table
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
    
    // ✅ Build API params from order data
    const apiParams = {
      action: 'add',
      service: order.service_id,
      link: order.link,
      quantity: order.quantity.toString()
    };
    
    // Call the actual API
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
      // ✅ Success - Get real order ID
      const realOrderId = data.order;
      
      // ✅ Update queue order to 'pending'
      await db.query(
        `UPDATE order_queue 
         SET status = 'pending',
             order_id = ?,
             updated_at = NOW() 
         WHERE order_id = ?`,
        [realOrderId, orderId]
      );
      
      // ✅ Update main orders table with real ID
      await db.query(
        `UPDATE orders 
         SET order_id = ?,
             status = 'pending' 
         WHERE order_id = ? AND status = 'queue'`,
        [realOrderId, orderId]
      );
      
      // ✅ Deduct from provider balance
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
      // ❌ API Error
      if (data.error.includes('Not enough funds') || data.error.includes('balance')) {
        // Keep as QUEUE - will retry later
        // ✅ Update updated_at so we know it was retried
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
        // Other error - mark as 'failed'
        await db.query(
          `UPDATE order_queue 
           SET status = 'failed',
               updated_at = NOW() 
           WHERE order_id = ?`,
          [orderId]
        );
        
        // Update main orders
        await db.query(
          `UPDATE orders 
           SET status = 'failed' 
           WHERE order_id = ?`,
          [orderId]
        );
        
        // ✅ Refund user
        await refundUser(order.user_id, order.charge, `Refund for failed order #${orderId}`);
        
        res.json({
          success: false,
          error: data.error,
          retryable: false,
          message: 'Order failed, user refunded'
        });
      }
    } else {
      // Unknown response - keep as QUEUE
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

// ─── UPDATE ORDER STATUS (Main orders) ───
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

    await db.query(
      `UPDATE orders SET ${updates.join(', ')} WHERE order_id = ?`,
      values
    );

    // ✅ Also update queue if status is completed or failed
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

// ─── GET SINGLE ORDER BY ID (Check both tables) ───
exports.getOrderById = async (req, res) => {
  try {
    const { orderId } = req.params;
    
    // Check main orders first
    const [orders] = await db.query(
      'SELECT * FROM orders WHERE order_id = ?',
      [orderId]
    );
    
    if (orders.length > 0) {
      return res.json(orders[0]);
    }
    
    // Check queue table
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

// ─── CREATE NEW ORDER (Regular - Not Queue) ───
exports.createOrder = async (req, res) => {
  try {
    const { 
      userId, 
      orderId, 
      serviceId, 
      serviceName, 
      provider, 
      quantity, 
      charge, 
      currency, 
      link, 
      start_count, 
      remains, 
      status 
    } = req.body;

    // Check if order already exists
    const [existing] = await db.query(
      'SELECT id FROM orders WHERE order_id = ?',
      [orderId]
    );

    if (existing.length > 0) {
      return res.status(400).json({ error: 'Order already exists' });
    }

    await db.query(
      `INSERT INTO orders (order_id, user_id, service_id, service_name, provider, quantity, charge, currency, link, start_count, remains, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [orderId, userId, serviceId, serviceName, provider, quantity, charge, currency, link, start_count, remains, status]
    );

    res.status(201).json({ 
      success: true, 
      message: 'Order created successfully',
      orderId
    });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ error: 'Failed to create order' });
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
