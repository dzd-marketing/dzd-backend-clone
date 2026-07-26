const express = require('express');
const router = express.Router();
const resellerApiController = require('../controllers/resellerApiController');

// ─── MAIN ENTRY POINT ──────────────────────────────────────────────────────
// All API calls go through this single endpoint
router.get('/', resellerApiController.handleRequest);

// ─── OLD ROUTES (keep for backward compatibility) ────────────────────────
router.get('/services', resellerApiController.getServices);
router.get('/add', resellerApiController.addOrder);
router.get('/status', resellerApiController.orderStatus);
router.get('/refill', resellerApiController.createRefill);
router.get('/balance', resellerApiController.getBalance);

module.exports = router;
