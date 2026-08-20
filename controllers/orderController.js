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

// Create new order
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

    const [existing] = await db.query(
      'SELECT id FROM orders WHERE order_id = ?',
      [orderId]
    );

    if (existing.length > 0) {
      return res.status(400).json({ error: 'Order already exists' });
    }

    const providerCharge = parseFloat(charge) * 0.8;

    const providerBalance = await getProviderBalanceFromAPI();

    console.log(`💰 Provider balance: LKR ${providerBalance}`);
    console.log(`📦 Order charge: LKR ${charge}, Provider cost: LKR ${providerCharge}`);

    if (providerBalance >= providerCharge) {
      console.log(`✅ Provider has balance. Processing order directly...`);

      const params = {
        action: 'add',
        service: serviceId,
        link: link,
        quantity: quantity || '0'
      };

      const proxyResponse = await fetch('https://api.dzd-marketing.site/api/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: provider || 'premium', ...params })
      });

      const proxyData = await proxyResponse.json();

      if (proxyData && proxyData.order) {
        await db.query(
          `INSERT INTO orders (order_id, user_id, service_id, service_name, provider, quantity, charge, provider_charge, currency, link, start_count, remains, status, is_api_order) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [proxyData.order, userId, serviceId, serviceName, provider || 'premium', quantity, charge, providerCharge, currency, link, start_count || '0', remains || quantity, 'Pending', 1]
        );

        return res.status(201).json({
          success: true,
          message: 'Order created successfully',
          orderId: proxyData.order,
          status: 'completed'
        });
      } else {
        if (proxyData.error && proxyData.error.includes('Not enough funds')) {
          console.log(`⚠️ API says insufficient funds. Adding to queue...`);
          await addOrderToQueue({
            order_id: orderId,
            user_id: userId,
            service_id: serviceId,
            service_name: serviceName,
            link: link,
            quantity: quantity,
            charge: charge,
            provider_charge: providerCharge,
            provider: provider || 'premium',
            currency: currency || 'LKR'
          });

          return res.status(201).json({
            success: true,
            message: 'Order queued for processing',
            orderId: orderId,
            status: 'queued'
          });
        }

        return res.status(400).json(proxyData);
      }
    } else {
      console.log(`⚠️ Provider balance insufficient. Adding to queue...`);

      await addOrderToQueue({
        order_id: orderId,
        user_id: userId,
        service_id: serviceId,
        service_name: serviceName,
        link: link,
        quantity: quantity,
        charge: charge,
        provider_charge: providerCharge,
        provider: provider || 'premium',
        currency: currency || 'LKR'
      });

      return res.status(201).json({
        success: true,
        message: 'Order queued for processing. Will be processed when provider balance is available.',
        orderId: orderId,
        status: 'queued'
      });
    }

  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
};

async function getProviderBalanceFromAPI() {
  try {
    const response = await fetch('https://api.dzd-marketing.site/api/v2/balance?key=13bc74956904c166');
    const data = await response.json();
    return data.balance || 0;
  } catch (error) {
    console.error('❌ Error fetching provider balance:', error);
    return 0;
  }
}

async function addOrderToQueue(orderData) {
  try {
    const {
      order_id,
      user_id,
      service_id,
      service_name,
      link,
      quantity,
      charge,
      provider_charge,
      provider = 'premium',
      currency = 'LKR'
    } = orderData;

    // Check if already in queue
    const [existing] = await db.query(
      'SELECT id FROM order_queue WHERE order_id = ?',
      [order_id]
    );

    if (existing.length > 0) {
      return { success: false, message: 'Order already in queue' };
    }

    await db.query(
      `INSERT INTO order_queue 
       (order_id, user_id, service_id, service_name, link, quantity, charge, provider_charge, provider, currency, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [order_id, user_id, service_id, service_name, link, quantity, charge, provider_charge, provider, currency]
    );

    console.log(`📥 Order ${order_id} added to queue`);
    return { success: true };

  } catch (error) {
    console.error('❌ Error adding order to queue:', error);
    return { success: false, message: error.message };
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
