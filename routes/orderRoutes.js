const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const refundController = require('../controllers/refundController');

router.get('/user/:userId', orderController.getUserOrders);
router.get('/:orderId', orderController.getOrderById);
router.post('/', orderController.createOrder);
router.patch('/:orderId/status', orderController.updateOrderStatus);
router.get('/stats/:userId', orderController.getOrderStats);
router.get('/recent/:userId', orderController.getRecentOrders);
router.get('/admin/api-orders', orderController.getApiOrders);
router.get('/admin/api-orders/stats', orderController.getApiOrderStats);

// New routes with refund info
router.get('/user/:userId/with-refunds', orderController.getUserOrdersWithRefunds);
router.get('/user/:userId/total-refunded', orderController.getUserTotalRefunded);

// Refund routes
router.get('/refunds/user/:userId', refundController.getUserRefundHistory);
router.get('/refunds/order/:orderId', refundController.getOrderRefundDetails);
router.get('/refunds/summary/:userId', refundController.getRefundSummary);
router.post('/refunds/process', refundController.processRefund);

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

module.exports = router;
