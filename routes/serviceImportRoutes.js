const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { syncServices, clearServices } = require('../sync-services-dzd');

const STATUS_FILE = path.join(__dirname, '..', 'import-status.json');

// ─── Helper ──────────────────────────────────────────────────────────────────
function getStatus() {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    }
  } catch (e) {}
  return { running: false, status: 'idle', logs: [], servicesImported: 0, currentPage: 0, totalPages: 0 };
}

function saveStatus(status) {
  status.lastUpdate = new Date().toISOString();
  fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2));
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /api/service-import/status
router.get('/status', (req, res) => {
  res.json({ success: true, status: getStatus() });
});

// POST /api/service-import/start
router.post('/start', async (req, res) => {
  const status = getStatus();
  if (status.running) {
    return res.status(409).json({ success: false, error: 'Import already running' });
  }

  const { exchangeRate = 344.60, profitMargin = 0.90, startFresh = false } = req.body;

  // Update status to running
  const newStatus = {
    running: true,
    status: 'running',
    startTime: new Date().toISOString(),
    currentPage: 0,
    totalPages: 0,
    servicesImported: 0,
    servicesSkipped: 0,
    logs: [],
    exchangeRate,
    profitMargin,
    lastUpdate: new Date().toISOString()
  };
  saveStatus(newStatus);

  // Run sync in background
  setTimeout(async () => {
    try {
      const result = await syncServices(exchangeRate, profitMargin, startFresh);
      const s = getStatus();
      s.running = false;
      s.status = result.success ? 'completed' : 'error';
      saveStatus(s);
    } catch (error) {
      const s = getStatus();
      s.running = false;
      s.status = 'error';
      saveStatus(s);
    }
  }, 1000);

  res.json({ success: true, message: 'Import started', status: newStatus });
});

// POST /api/service-import/stop
router.post('/stop', (req, res) => {
  const status = getStatus();
  if (!status.running) {
    return res.status(400).json({ success: false, error: 'No import running' });
  }

  // Stop by killing the running process (if you store the child process)
  // For now, we just mark it as stopped
  status.running = false;
  status.status = 'stopped';
  saveStatus(status);

  res.json({ success: true, message: 'Import stopped' });
});

// GET /api/service-import/logs
router.get('/logs', (req, res) => {
  const status = getStatus();
  const limit = parseInt(req.query.limit) || 50;
  res.json({ success: true, logs: status.logs.slice(-limit) });
});

// POST /api/service-import/clear
router.post('/clear', async (req, res) => {
  const status = getStatus();
  if (status.running) {
    return res.status(409).json({ success: false, error: 'Cannot clear while import is running' });
  }
  try {
    await clearServices();
    res.json({ success: true, message: 'Services cleared' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
