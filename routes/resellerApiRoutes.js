const express = require('express');
const router = express.Router();
const resellerApiController = require('../controllers/resellerApiController');

// Public API routes (no authentication required, uses API key)
router.get('/services', resellerApiController.getServices);
router.get('/add', resellerApiController.addOrder);
router.get('/status', resellerApiController.orderStatus);
router.get('/refill', resellerApiController.createRefill);
router.get('/balance', resellerApiController.getBalance);

module.exports = router;
