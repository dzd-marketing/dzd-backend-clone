const express = require('express');
const router = express.Router();
const orderStatusService = require('../services/orderStatusService');

// Trigger manual status update
router.post('/update-orders', async (req, res) => {
  try {
    const results = await orderStatusService.updateAllOrders();
    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update single order
router.post('/update-order/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const [orders] = await db.query('SELECT * FROM orders WHERE order_id = ?', [orderId]);
    if (orders.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    const result = await orderStatusService.updateOrderStatus(orders[0]);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
