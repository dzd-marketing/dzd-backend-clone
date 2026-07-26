const db = require('../config/db');

// ─── Get all orders ──────────────────────────────────────────────────────────
exports.getAllOrders = async (req, res) => {
  try {
    const [orders] = await db.query(
      `SELECT id, order_id, user_id, service_id, service_name, provider, 
              quantity, charge, currency, link, start_count, remains, status, 
              is_api_order, refunded_amount, created_at, updated_at
       FROM orders 
       ORDER BY created_at DESC`
    );
    
    res.json(orders);
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
};

// ─── Get order by ID ──────────────────────────────────────────────────────────
exports.getOrderById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const [orders] = await db.query(
      `SELECT id, order_id, user_id, service_id, service_name, provider, 
              quantity, charge, currency, link, start_count, remains, status, 
              is_api_order, refunded_amount, created_at, updated_at
       FROM orders 
       WHERE id = ?`,
      [id]
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

// ─── Get orders by user ID ──────────────────────────────────────────────────
exports.getOrdersByUserId = async (req, res) => {
  try {
    const { userId } = req.params;
    
    const [orders] = await db.query(
      `SELECT id, order_id, user_id, service_id, service_name, provider, 
              quantity, charge, currency, link, start_count, remains, status, 
              is_api_order, refunded_amount, created_at, updated_at
       FROM orders 
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [userId]
    );
    
    res.json(orders);
  } catch (error) {
    console.error('Error fetching user orders:', error);
    res.status(500).json({ error: 'Failed to fetch user orders' });
  }
};

// ─── Get order statistics ──────────────────────────────────────────────────────
exports.getOrderStats = async (req, res) => {
  try {
    const [stats] = await db.query(
      `SELECT 
        COUNT(*) as total_orders,
        SUM(charge) as total_revenue,
        SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) as completed_orders,
        SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) as pending_orders,
        SUM(CASE WHEN status = 'Processing' OR status = 'In progress' THEN 1 ELSE 0 END) as processing_orders,
        SUM(CASE WHEN status = 'Canceled' OR status = 'Failed' THEN 1 ELSE 0 END) as canceled_orders,
        SUM(CASE WHEN is_api_order = 1 THEN 1 ELSE 0 END) as api_orders
       FROM orders`
    );
    
    res.json(stats[0] || { 
      total_orders: 0, 
      total_revenue: 0, 
      completed_orders: 0, 
      pending_orders: 0, 
      processing_orders: 0, 
      canceled_orders: 0,
      api_orders: 0
    });
  } catch (error) {
    console.error('Error fetching order stats:', error);
    res.status(500).json({ error: 'Failed to fetch order statistics' });
  }
};

// ─── Get revenue by date range ──────────────────────────────────────────────
exports.getRevenueByDate = async (req, res) => {
  try {
    const { days } = req.query;
    const daysFilter = parseInt(days) || 7;
    
    const [revenue] = await db.query(
      `SELECT DATE(created_at) as date, SUM(charge) as revenue
       FROM orders 
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY DATE(created_at)
       ORDER BY date DESC`,
      [daysFilter]
    );
    
    res.json(revenue);
  } catch (error) {
    console.error('Error fetching revenue by date:', error);
    res.status(500).json({ error: 'Failed to fetch revenue data' });
  }
};

// ─── Update order status ──────────────────────────────────────────────────────
exports.updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, remains, start_count } = req.body;
    
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

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(id);

    await db.query(
      `UPDATE orders SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
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
