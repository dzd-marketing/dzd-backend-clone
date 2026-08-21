const db = require('../config/db');

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

// ─── CREATE NEW ORDER ─────────────────────────────────────────────
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
      apiParams
    } = req.body;

    if (!userId || !serviceId || !quantity || !link) {
      return res.status(400).json({
        success: false,
        error: 'Missing required order details'
      });
    }

    // Temporary ID for queued orders
    const tempOrderId = `QUEUE_${Date.now()}_${String(userId).slice(0, 6)}`;

    // Check duplicate temporary ID
    const [existing] = await db.query(
      'SELECT id FROM orders WHERE order_id = ?',
      [tempOrderId]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Order already exists'
      });
    }

    // API parameters
    const apiParamsObj = apiParams || {
      action: 'add',
      service: serviceId,
      link,
      quantity: String(quantity)
    };

    const SMM_PROXY_URL =
      process.env.SMM_PROXY_URL ||
      'https://api.dzd-marketing.site/api/proxy';

    let finalOrderId = null;
    let finalStatus = 'queue';
    let apiError = null;

    // ─── SEND ORDER TO PROVIDER ──────────────────────────────────
    try {
      const response = await fetch(SMM_PROXY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          provider: provider || 'premium',
          ...apiParamsObj
        })
      });

      const data = await response.json();

      console.log('Provider response:', data);

      // Provider success
      if (data?.order) {
        finalOrderId =
          typeof data.order === 'object'
            ? String(data.order.id)
            : String(data.order);

        finalStatus = 'pending';
      }

      // Provider insufficient balance
      else if (
        data?.error &&
        String(data.error).toLowerCase().includes('not enough funds')
      ) {
        console.log(
          `Provider balance insufficient. Queueing order for user ${userId}`
        );

        apiError = data.error;

        finalOrderId = tempOrderId;
        finalStatus = 'queue';
      }

      // Other provider error
      else if (data?.error) {
        apiError = data.error;

        return res.status(400).json({
          success: false,
          error: data.error
        });
      }

      // Unknown response
      else {
        return res.status(502).json({
          success: false,
          error: 'Invalid response from provider'
        });
      }

    } catch (apiErr) {
      console.error('Provider API error:', apiErr);

      // Network/provider temporarily unavailable
      apiError = apiErr.message || 'Provider API unavailable';

      finalOrderId = tempOrderId;
      finalStatus = 'queue';
    }

    // ─── SAVE ORDER ──────────────────────────────────────────────
    await db.query(
      `INSERT INTO orders (
        order_id,
        user_id,
        service_id,
        service_name,
        provider,
        quantity,
        charge,
        currency,
        link,
        start_count,
        remains,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        finalOrderId,
        userId,
        serviceId,
        serviceName || `Service #${serviceId}`,
        provider || 'premium',
        quantity,
        charge || 0,
        currency || 'LKR',
        link,
        start_count || 0,
        remains || quantity,
        finalStatus
      ]
    );

    // ─── SUCCESS RESPONSE ───────────────────────────────────────
    if (finalStatus === 'pending') {
      return res.status(201).json({
        success: true,
        queued: false,
        message: 'Order placed successfully',
        orderId: finalOrderId,
        status: 'pending'
      });
    }

    // ─── QUEUED RESPONSE ────────────────────────────────────────
    return res.status(201).json({
      success: true,
      queued: true,
      message: 'Order queued',
      orderId: finalOrderId,
      status: 'queue'
    });

  } catch (error) {
    console.error('Create order error:', error);

    return res.status(500).json({
      success: false,
      error: 'Failed to create order'
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
