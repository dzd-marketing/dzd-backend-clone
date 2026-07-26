const db = require('../config/db');

// Get all refund history for a user
exports.getUserRefundHistory = async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Get all orders that have refunded_amount > 0 for this user
    const [refunds] = await db.query(
      `SELECT 
        order_id,
        refunded_amount as amount,
        status,
        created_at as order_date,
        updated_at as refund_processed_at,
        service_name,
        charge as original_charge
      FROM orders 
      WHERE user_id = ? AND refunded_amount > 0
      ORDER BY updated_at DESC`,
      [userId]
    );
    
    // Calculate total refunded amount
    const [totalResult] = await db.query(
      `SELECT COALESCE(SUM(refunded_amount), 0) as total_refunded
      FROM orders 
      WHERE user_id = ? AND refunded_amount > 0`,
      [userId]
    );
    
    res.json({
      success: true,
      refunds: refunds,
      total_refunded: totalResult[0]?.total_refunded || 0
    });
  } catch (error) {
    console.error('Error fetching refund history:', error);
    res.status(500).json({ error: 'Failed to fetch refund history' });
  }
};

// Get refund details for a specific order
exports.getOrderRefundDetails = async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const [orders] = await db.query(
      `SELECT 
        order_id,
        user_id,
        refunded_amount,
        status,
        charge as original_charge,
        created_at,
        updated_at as refund_processed_at,
        service_name,
        link
      FROM orders 
      WHERE order_id = ?`,
      [orderId]
    );
    
    if (orders.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    const order = orders[0];
    
    res.json({
      success: true,
      hasRefund: order.refunded_amount > 0,
      refund: order.refunded_amount > 0 ? {
        order_id: order.order_id,
        refund_amount: order.refunded_amount,
        original_amount: order.original_charge,
        status: order.status,
        refund_date: order.refund_processed_at,
        service_name: order.service_name
      } : null
    });
  } catch (error) {
    console.error('Error fetching order refund details:', error);
    res.status(500).json({ error: 'Failed to fetch refund details' });
  }
};

// Process a refund (Admin only)
exports.processRefund = async (req, res) => {
  const connection = await db.getConnection();
  
  try {
    const { 
      order_id, 
      user_id, 
      refund_amount, 
      reason,
      processed_by 
    } = req.body;
    
    if (!order_id || !user_id || !refund_amount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    await connection.beginTransaction();
    
    // Check if order exists and get current refunded_amount
    const [orders] = await connection.query(
      `SELECT refunded_amount, charge FROM orders WHERE order_id = ? AND user_id = ?`,
      [order_id, user_id]
    );
    
    if (orders.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Order not found' });
    }
    
    const currentRefunded = parseFloat(orders[0].refunded_amount) || 0;
    const originalCharge = parseFloat(orders[0].charge);
    const newRefundedAmount = currentRefunded + parseFloat(refund_amount);
    
    if (newRefundedAmount > originalCharge) {
      await connection.rollback();
      return res.status(400).json({ error: 'Refund amount exceeds order charge' });
    }
    
    // Update order with refunded_amount
    await connection.query(
      `UPDATE orders 
       SET refunded_amount = ?, 
           status = CASE 
             WHEN ? >= charge THEN 'fully_refunded'
             WHEN ? > 0 THEN 'partially_refunded'
             ELSE status
           END,
           updated_at = NOW()
       WHERE order_id = ?`,
      [newRefundedAmount, newRefundedAmount, refund_amount, order_id]
    );
    
    // Optionally create a separate refund_logs table (if you want detailed history)
    // For now, we'll just use the orders table
    
    await connection.commit();
    
    res.json({
      success: true,
      message: 'Refund processed successfully',
      refund_amount: refund_amount,
      total_refunded: newRefundedAmount
    });
    
  } catch (error) {
    await connection.rollback();
    console.error('Error processing refund:', error);
    res.status(500).json({ error: 'Failed to process refund' });
  } finally {
    connection.release();
  }
};

// Get refund summary for dashboard
exports.getRefundSummary = async (req, res) => {
  try {
    const { userId } = req.params;
    
    const [summary] = await db.query(
      `SELECT 
        COUNT(*) as total_refunded_orders,
        COALESCE(SUM(refunded_amount), 0) as total_refunded_amount,
        AVG(refunded_amount) as avg_refund_amount
      FROM orders 
      WHERE user_id = ? AND refunded_amount > 0`,
      [userId]
    );
    
    const [recentRefunds] = await db.query(
      `SELECT 
        order_id,
        refunded_amount,
        service_name,
        updated_at as refund_date
      FROM orders 
      WHERE user_id = ? AND refunded_amount > 0 
      ORDER BY updated_at DESC 
      LIMIT 5`,
      [userId]
    );
    
    res.json({
      success: true,
      summary: summary[0] || { total_refunded_orders: 0, total_refunded_amount: 0, avg_refund_amount: 0 },
      recentRefunds: recentRefunds
    });
  } catch (error) {
    console.error('Error fetching refund summary:', error);
    res.status(500).json({ error: 'Failed to fetch refund summary' });
  }
};
