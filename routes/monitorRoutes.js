const express = require('express');
const router = express.Router();
const monitor = require('../scripts/monitor');
const authenticateToken = require('../middleware/auth');

// Get system stats (requires authentication)
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const stats = await monitor.getSystemStats();
    res.json(stats);
  } catch (error) {
    console.error('Error getting system stats:', error);
    res.status(500).json({ error: 'Failed to get system stats' });
  }
});

// Get CPU usage
router.get('/cpu', authenticateToken, async (req, res) => {
  try {
    const cpu = await monitor.getCpuUsage();
    res.json(cpu);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get CPU usage' });
  }
});

// Get memory usage
router.get('/memory', authenticateToken, async (req, res) => {
  try {
    const memory = monitor.getMemoryUsage();
    res.json(memory);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get memory usage' });
  }
});

// Get storage usage
router.get('/storage', authenticateToken, async (req, res) => {
  try {
    const storage = await monitor.getStorageUsage();
    res.json(storage);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get storage usage' });
  }
});

// Get bandwidth usage
router.get('/bandwidth', authenticateToken, async (req, res) => {
  try {
    const bandwidth = await monitor.getBandwidthUsage();
    res.json(bandwidth);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get bandwidth usage' });
  }
});

// Get uptime
router.get('/uptime', authenticateToken, async (req, res) => {
  try {
    const uptime = monitor.getUptime();
    res.json(uptime);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get uptime' });
  }
});

module.exports = router;
