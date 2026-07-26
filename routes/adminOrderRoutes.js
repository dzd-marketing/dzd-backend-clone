const express = require('express');
const router = express.Router();
const adminOrderController = require('../controllers/adminOrderController');
const authenticateToken = require('../middleware/auth');
const adminAuthController = require('../controllers/adminAuthController');

// Apply authentication and admin middleware
router.use(authenticateToken);
router.use(adminAuthController.adminMiddleware);

// Order routes
router.get('/', adminOrderController.getAllOrders);
router.get('/stats', adminOrderController.getOrderStats);
router.get('/revenue', adminOrderController.getRevenueByDate);
router.get('/user/:userId', adminOrderController.getOrdersByUserId);
router.get('/:id', adminOrderController.getOrderById);
router.patch('/:id/status', adminOrderController.updateOrderStatus);

module.exports = router;
