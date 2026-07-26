const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const authenticateToken = require('../middleware/auth');
const adminAuthController = require('../controllers/adminAuthController');

// Apply authentication and admin middleware
router.use(authenticateToken);
router.use(adminAuthController.adminMiddleware);

// Admin routes
router.get('/users', adminController.getAllUsers);
router.get('/users/search', adminController.searchUsers);
router.get('/users/:uid', adminController.getUserById);
router.patch('/users/:uid/status', adminController.updateUserStatus);
router.get('/stats', adminController.getUserStats);

module.exports = router;
