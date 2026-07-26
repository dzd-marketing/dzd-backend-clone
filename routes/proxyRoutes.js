const express = require('express');
const router = express.Router();
const proxyController = require('../controllers/proxyController');

router.post('/', proxyController.proxyRequest);

module.exports = router;
