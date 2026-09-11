const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const authenticateToken = require('../middleware/auth');
const adminAuthController = require('../controllers/adminAuthController');
const slPackageController = require('../controllers/slPackageController');

// Apply authentication and admin middleware
router.use(authenticateToken);
router.use(adminAuthController.adminMiddleware);

// Admin routes
router.get('/users', adminController.getAllUsers);
router.get('/users/search', adminController.searchUsers);
router.get('/users/:uid', adminController.getUserById);
router.patch('/users/:uid/status', adminController.updateUserStatus);
router.get('/stats', adminController.getUserStats);

// ─── Sri Lankan Audience Services (dashboard page + admin panel) ────────────
// Everything below is already behind authenticateToken + adminMiddleware.
router.get('/sl-packages', slPackageController.adminGetAll);

// categories
router.post('/sl-packages/categories', slPackageController.createCategory);
router.put('/sl-packages/categories/:id', slPackageController.updateCategory);
router.delete('/sl-packages/categories/:id', slPackageController.deleteCategory);
router.patch('/sl-packages/categories/:id/move', slPackageController.moveRow);

// packages
router.post('/sl-packages/packages', slPackageController.createPackage);
router.put('/sl-packages/packages/:id', slPackageController.updatePackage);
router.delete('/sl-packages/packages/:id', slPackageController.deletePackage);
router.patch('/sl-packages/packages/:id/move', slPackageController.moveRow);

// global settings (WhatsApp number, page title, notice, page on/off)
router.put('/sl-packages/settings', slPackageController.updateSettings);

// helpers
router.post('/sl-packages/seed', slPackageController.restoreDefaults);
router.get('/sl-packages/whatsapp-preview', slPackageController.whatsappPreview);

module.exports = router;
