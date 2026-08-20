const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');

// ============================================
// ✅ MAIN ORDER ROUTES
// ============================================

// ✅ Single endpoint for ALL orders (Handles both Normal & Queue)
router.post('/', orderController.createOrder);

// Get user orders
router.get('/user/:userId', orderController.getUserOrders);

// Get single order
router.get('/:orderId', orderController.getOrderById);

// Update order status
router.patch('/:orderId/status', orderController.updateOrderStatus);

// Order stats
router.get('/stats/:userId', orderController.getOrderStats);

// Recent orders
router.get('/recent/:userId', orderController.getRecentOrders);

// Orders with refunds
router.get('/user/:userId/with-refunds', orderController.getUserOrdersWithRefunds);

// Total refunded
router.get('/user/:userId/total-refunded', orderController.getUserTotalRefunded);

// ============================================
// ✅ ADMIN ROUTES
// ============================================

router.get('/admin/api-orders', orderController.getApiOrders);
router.get('/admin/api-orders/stats', orderController.getApiOrderStats);

router.get('/admin/orders', async (req, res) => {
  try {
    const db = require('../config/db');
    const [orders] = await db.query(`
      SELECT 
        o.*,
        u.full_name,
        u.email,
        u.username
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.uid
      ORDER BY o.created_at DESC
    `);
    res.json(orders);
  } catch (error) {
    console.error('Error fetching admin orders:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// ============================================
// ✅ QUEUE MANAGEMENT ROUTES (For Cron-Job)
// ============================================

// Get all queue orders
router.get('/queue-orders', orderController.getQueueOrders);

// Send queue order to API
router.post('/send-queue-order/:orderId', orderController.sendQueueOrderToApi);

module.exports = router;
