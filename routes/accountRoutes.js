const express = require('express');
const router = express.Router();
const accountController = require('../controllers/accountController');
const authenticateToken = require('../middleware/auth');

// All account routes require authentication
router.use(authenticateToken);

router.get('/profile', accountController.getProfile);
router.put('/profile', accountController.updateProfile);
router.post('/change-password', accountController.changePassword);
router.post('/photo', accountController.uploadPhoto);
router.get('/api-key', accountController.getApiKey);
router.post('/api-key/generate', accountController.generateApiKey);
router.delete('/api-key/revoke', accountController.revokeApiKey);

module.exports = router;
