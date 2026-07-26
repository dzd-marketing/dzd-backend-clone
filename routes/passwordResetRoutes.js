const express = require('express');
const router = express.Router();
const passwordResetController = require('../controllers/passwordResetController');

// Password reset routes
router.post('/send-reset-code', passwordResetController.sendResetCode);
router.post('/verify-reset-code', passwordResetController.verifyResetCode);
router.post('/update-password', passwordResetController.updatePassword);

module.exports = router;
