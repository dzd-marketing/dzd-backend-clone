const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Configuration
const CONFIG = {
  // API Key for authentication (change this!)
  API_KEY: 'dzd-import-secret-key-2026',
  // Path to the sync script
  SYNC_SCRIPT_PATH: path.join(__dirname, 'sync-services-dzd.js'),
  // Log file for tracking
  LOG_FILE: path.join(__dirname, 'service-import-logs.json'),
  // Status file
  STATUS_FILE: path.join(__dirname, 'import-status.json')
};

// --- Authentication Middleware ---
function authenticate(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  
  if (!apiKey || apiKey !== CONFIG.API_KEY) {
    return res.status(401).json({ 
      success: false, 
      error: 'Unauthorized - Invalid API Key' 
    });
  }
  
  next();
}

// --- Get Import Status ---
function getImportStatus() {
  try {
    if (fs.existsSync(CONFIG.STATUS_FILE)) {
      const data = fs.readFileSync(CONFIG.STATUS_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error reading status:', error);
  }
  
  return {
    running: false,
    startTime: null,
    currentPage: 0,
    totalPages: 0,
    servicesImported: 0,
    servicesSkipped: 0,
    status: 'idle',
    lastUpdate: null,
    logs: []
  };
}

// --- Save Import Status ---
function saveImportStatus(status) {
  status.lastUpdate = new Date().toISOString();
  fs.writeFileSync(CONFIG.STATUS_FILE, JSON.stringify(status, null, 2));
}

// --- Add Log Entry ---
function addLogEntry(message, type = 'info') {
  const status = getImportStatus();
  status.logs.push({
    timestamp: new Date().toISOString(),
    message: message,
    type: type
  });
  
  // Keep only last 100 logs
  if (status.logs.length > 100) {
    status.logs = status.logs.slice(-100);
  }
  
  saveImportStatus(status);
}

// --- Routes ---

// 1. Check import status
app.get('/api/service-import/status', authenticate, (req, res) => {
  const status = getImportStatus();
  res.json({
    success: true,
    status: status
  });
});

// 2. Start import
app.post('/api/service-import/start', authenticate, (req, res) => {
  const status = getImportStatus();
  
  if (status.running) {
    return res.status(409).json({
      success: false,
      error: 'Import already running',
      status: status
    });
  }
  
  // Get rate from request body or use default
  const { exchangeRate = 344.60, profitMargin = 0.90 } = req.body;
  
  // Update status
  status.running = true;
  status.startTime = new Date().toISOString();
  status.currentPage = 0;
  status.totalPages = 0;
  status.servicesImported = 0;
  status.servicesSkipped = 0;
  status.status = 'running';
  status.logs = [];
  saveImportStatus(status);
  
  addLogEntry('🚀 Starting service import...', 'info');
  addLogEntry(`💰 Exchange rate: ${exchangeRate} LKR/USD`, 'info');
  addLogEntry(`📈 Profit margin: ${profitMargin * 100}%`, 'info');
  
  // Run sync in background
  runSyncScript(exchangeRate, profitMargin);
  
  res.json({
    success: true,
    message: 'Import started successfully',
    status: status
  });
});

// 3. Stop import
app.post('/api/service-import/stop', authenticate, (req, res) => {
  const status = getImportStatus();
  
  if (!status.running) {
    return res.status(400).json({
      success: false,
      error: 'No import is currently running'
    });
  }
  
  // Stop the sync process
  if (global.syncProcess) {
    global.syncProcess.kill('SIGTERM');
    global.syncProcess = null;
  }
  
  status.running = false;
  status.status = 'stopped';
  saveImportStatus(status);
  addLogEntry('⏹️ Import stopped by user', 'warning');
  
  res.json({
    success: true,
    message: 'Import stopped'
  });
});

// 4. Get logs
app.get('/api/service-import/logs', authenticate, (req, res) => {
  const status = getImportStatus();
  const limit = parseInt(req.query.limit) || 50;
  
  res.json({
    success: true,
    logs: status.logs.slice(-limit)
  });
});

// 5. Clear all services (dangerous!)
app.post('/api/service-import/clear', authenticate, async (req, res) => {
  const status = getImportStatus();
  
  if (status.running) {
    return res.status(409).json({
      success: false,
      error: 'Cannot clear while import is running'
    });
  }
  
  try {
    // Run a script to clear services
    const clearScript = `
      const mysql = require('mysql2');
      require('dotenv').config();
      
      const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'dzd-user',
        password: process.env.DB_PASSWORD || '12345',
        database: process.env.DB_NAME || 'dzd_marketing',
        connectionLimit: 10
      });
      
      const promisePool = pool.promise();
      
      async function clearServices() {
        await promisePool.query('DELETE FROM services');
        console.log('✅ Services cleared');
        process.exit(0);
      }
      
      clearServices().catch(err => {
        console.error('❌ Error:', err);
        process.exit(1);
      });
    `;
    
    const tempScript = path.join(__dirname, 'temp-clear.js');
    fs.writeFileSync(tempScript, clearScript);
    
    exec(`node ${tempScript}`, (error, stdout, stderr) => {
      fs.unlinkSync(tempScript);
      
      if (error) {
        return res.status(500).json({
          success: false,
          error: `Failed to clear: ${error.message}`
        });
      }
      
      addLogEntry('🗑️ All services cleared', 'warning');
      res.json({
        success: true,
        message: 'All services cleared successfully'
      });
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// --- Background Sync Runner ---
function runSyncScript(exchangeRate, profitMargin) {
  // Create a modified version of the script with the provided parameters
  const scriptContent = fs.readFileSync(CONFIG.SYNC_SCRIPT_PATH, 'utf8');
  
  // Replace the CONFIG values
  let modifiedScript = scriptContent
    .replace(/MANUAL_EXCHANGE_RATE: \d+\.?\d*/g, `MANUAL_EXCHANGE_RATE: ${exchangeRate}`)
    .replace(/PROFIT_MARGIN: \d+\.?\d*/g, `PROFIT_MARGIN: ${profitMargin}`);
  
  // Add status update hooks
  const statusHooks = `
    // --- Status Update Hooks ---
    const statusFile = '${CONFIG.STATUS_FILE}';
    
    function updateStatus(currentPage, totalPages, servicesImported, servicesSkipped, status) {
      try {
        const fs = require('fs');
        let currentStatus = { running: true };
        if (fs.existsSync(statusFile)) {
          try {
            const data = fs.readFileSync(statusFile, 'utf8');
            currentStatus = JSON.parse(data);
          } catch (e) {}
        }
        
        currentStatus.currentPage = currentPage;
        currentStatus.totalPages = totalPages;
        currentStatus.servicesImported = servicesImported;
        currentStatus.servicesSkipped = servicesSkipped;
        currentStatus.status = status;
        currentStatus.lastUpdate = new Date().toISOString();
        
        fs.writeFileSync(statusFile, JSON.stringify(currentStatus, null, 2));
      } catch (error) {
        console.error('Error updating status:', error);
      }
    }
    
    // Override log function to update status
    const originalLog = log;
    log = function(message, type = 'INFO') {
      originalLog(message, type);
      // Update status based on log messages
      const status = getImportStatus();
      if (message.includes('Processing page')) {
        const pageMatch = message.match(/Processing page (\\d+)/);
        if (pageMatch) {
          status.currentPage = parseInt(pageMatch[1]);
        }
      }
      if (message.includes('inserted')) {
        const insertMatch = message.match(/(\\d+) services/);
        if (insertMatch) {
          status.servicesImported += parseInt(insertMatch[1]);
        }
      }
      saveImportStatus(status);
    };
    
    // Override the insertBatch function to track progress
    const originalInsertBatch = insertBatch;
    insertBatch = async function(services) {
      const result = await originalInsertBatch(services);
      const status = getImportStatus();
      status.servicesImported += result;
      saveImportStatus(status);
      return result;
    };
  `;
  
  // Insert hooks after CONFIG definition
  const configEndIndex = modifiedScript.indexOf('// ─── Utilities ───');
  modifiedScript = modifiedScript.slice(0, configEndIndex) + statusHooks + modifiedScript.slice(configEndIndex);
  
  // Create temp script
  const tempScript = path.join(__dirname, 'temp-sync.js');
  fs.writeFileSync(tempScript, modifiedScript);
  
  // Run the script
  const process = exec(`node ${tempScript}`, (error, stdout, stderr) => {
    // Clean up
    fs.unlinkSync(tempScript);
    
    const status = getImportStatus();
    status.running = false;
    
    if (error) {
      status.status = 'error';
      addLogEntry(`❌ Import failed: ${error.message}`, 'error');
      console.error('Sync error:', error);
    } else {
      status.status = 'completed';
      addLogEntry('✅ Import completed successfully!', 'success');
    }
    
    saveImportStatus(status);
    global.syncProcess = null;
  });
  
  global.syncProcess = process;
  
  // Capture stdout for real-time logs
  process.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(line => line.trim());
    for (const line of lines) {
      if (line.includes('[INFO]') || line.includes('[WARN]') || line.includes('[ERROR]')) {
        // Parse log message
        const match = line.match(/\[([^\]]+)\] \[([^\]]+)\]\s+(.+)/);
        if (match) {
          const type = match[2].toLowerCase();
          const message = match[3];
          addLogEntry(message, type);
        }
      }
    }
  });
  
  process.stderr.on('data', (data) => {
    const lines = data.toString().split('\n').filter(line => line.trim());
    for (const line of lines) {
      addLogEntry(`⚠️ ${line}`, 'warning');
    }
  });
}

// --- Start Server ---
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Service Import API running on port ${PORT}`);
  console.log(`🔑 API Key: ${CONFIG.API_KEY}`);
  console.log(`📁 Status file: ${CONFIG.STATUS_FILE}`);
  
  // Create initial status file
  if (!fs.existsSync(CONFIG.STATUS_FILE)) {
    saveImportStatus({
      running: false,
      startTime: null,
      currentPage: 0,
      totalPages: 0,
      servicesImported: 0,
      servicesSkipped: 0,
      status: 'idle',
      lastUpdate: null,
      logs: []
    });
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Shutting down...');
  if (global.syncProcess) {
    global.syncProcess.kill('SIGTERM');
  }
  process.exit(0);
});
