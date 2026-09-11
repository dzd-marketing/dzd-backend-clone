const express = require('express');
const router = express.Router();
const slPackageController = require('../controllers/slPackageController');

// GET /api/sl-packages  → Sri Lankan audience price list (public, no auth)
router.get('/', slPackageController.getPackages);

module.exports = router;
