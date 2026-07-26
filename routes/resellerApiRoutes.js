const express = require('express');
const router = express.Router();
const resellerApiController = require('../controllers/resellerApiController');

router
  .route('/')
  .get(resellerApiController.handleRequest)
  .post(resellerApiController.handleRequest);

// ============================================================================
// MEWA KARIMA API 
// ============================================================================

router
  .route('/services')
  .get(resellerApiController.getServices)
  .post(resellerApiController.getServices);

router
  .route('/add')
  .get(resellerApiController.addOrder)
  .post(resellerApiController.addOrder);

router
  .route('/status')
  .get(resellerApiController.orderStatus)
  .post(resellerApiController.orderStatus);

router
  .route('/refill')
  .get(resellerApiController.createRefill)
  .post(resellerApiController.createRefill);

router
  .route('/balance')
  .get(resellerApiController.getBalance)
  .post(resellerApiController.getBalance);

module.exports = router;
