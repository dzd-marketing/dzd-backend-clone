// sync-services-dzd.js - Cloudflare D1 sync (no auto-start)
const fs = require('fs');
const path = require('path');

// ─── CONFIGURATION ────────────────────────────────────────────────────────────
const CONFIG = {
  SMM_API_URL: 'https://smmcheep.com/api/v2',
  SMM_API_KEY: 'e785f9e49139b1f3e6a5a1d98a09506c',

  CLOUDFLARE_ACCOUNT_ID: 'fee8ade938faaa854ef78e1d6066221f',
  CLOUDFLARE_DATABASE_ID: '0f7bff19-4155-45af-a3bc-7df1ab31fd16',
  CLOUDFLARE_API_TOKEN: 'Y5-S5le0uBm-dwYlQu3Vh7cefDQ-7tVYzz6E5CYd',

  PAGE_SIZE: 600,
  BATCH_SIZE: 10,

  STATE_FILE: path.join(__dirname, 'sync-state.json'),
  STATUS_FILE: path.join(__dirname, 'import-status.json'),

  QUALITY_KEYWORDS: ['non drop', 'nondrop', 'non-drop', '0 drop', 'zero drop', 'guaranteed', 'guarantee', 'no drop'],
  SKIP_CATEGORIES: ['slow / or not working', 'slow/or not working', 'not working'],
  SKIP_KEYWORDS: ['no refill', 'drop possible', 'may drop', 'might drop', 'low quality', 'cheap quality', 'bot', 'fake']
};

// ─── UTILITIES ────────────────────────────────────────────────────────────────
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function log(message, type = 'INFO') {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`[${timestamp}] [${type}] ${message}`);
  updateStatus(message, type);
}

// ─── STATUS TRACKING ──────────────────────────────────────────────────────────
function updateStatus(message, type = 'INFO') {
  try {
    let status = { running: false, logs: [] };
    if (fs.existsSync(CONFIG.STATUS_FILE)) {
      status = JSON.parse(fs.readFileSync(CONFIG.STATUS_FILE, 'utf8'));
    }
    status.logs.push({ timestamp: new Date().toISOString(), message, type: type.toLowerCase() });
    if (status.logs.length > 100) status.logs = status.logs.slice(-100);
    status.lastUpdate = new Date().toISOString();
    fs.writeFileSync(CONFIG.STATUS_FILE, JSON.stringify(status, null, 2));
  } catch (error) {}
}

// ─── CLOUDFLARE D1 ────────────────────────────────────────────────────────────
async function executeD1Query(sql, params = []) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CONFIG.CLOUDFLARE_ACCOUNT_ID}/d1/database/${CONFIG.CLOUDFLARE_DATABASE_ID}/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CONFIG.CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ sql, params })
  });
  const result = await res.json();
  if (!result.success) throw new Error(result.errors?.[0]?.message || 'D1 query failed');
  return result;
}

async function ensureTable() {
  await executeD1Query(`
    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_id INTEGER NOT NULL UNIQUE,
      name TEXT NOT NULL,
      type TEXT,
      category TEXT,
      rate TEXT,
      min INTEGER,
      max INTEGER,
      refill INTEGER DEFAULT 0,
      cancel INTEGER DEFAULT 0
    )
  `);
}

async function clearServices() {
  await executeD1Query('DELETE FROM services');
}

// ─── SMM API ──────────────────────────────────────────────────────────────────
async function fetchServices(page) {
  const params = new URLSearchParams({
    key: CONFIG.SMM_API_KEY,
    action: 'services',
    page: page,
    limit: CONFIG.PAGE_SIZE
  });
  const res = await fetch(CONFIG.SMM_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  if (!res.ok) throw new Error(`API responded with ${res.status}`);
  const data = await res.json();
  let services = [];
  if (data && data.status === 'success' && Array.isArray(data.services)) services = data.services;
  else if (Array.isArray(data)) services = data;
  else throw new Error('No services array in API response');
  return services;
}

// ─── FILTER ────────────────────────────────────────────────────────────────────
function filterServices(services) {
  const kept = [], skipped = [];
  for (const svc of services) {
    const name = (svc.name || '').toLowerCase();
    const cat = (svc.category || '').toLowerCase();
    const badCat = CONFIG.SKIP_CATEGORIES.some(c => cat.includes(c.toLowerCase()));
    if (badCat) { skipped.push(svc); continue; }
    const hasQuality = CONFIG.QUALITY_KEYWORDS.some(kw => name.includes(kw.toLowerCase()));
    const hasSkip = CONFIG.SKIP_KEYWORDS.some(kw => name.includes(kw.toLowerCase()));
    if (hasQuality && !hasSkip) kept.push(svc);
    else skipped.push(svc);
  }
  return { kept, skipped };
}

// ─── BATCH INSERT ─────────────────────────────────────────────────────────────
async function insertBatch(services, exchangeRate, profitMargin) {
  if (!services.length) return 0;
  let inserted = 0;
  for (let i = 0; i < services.length; i += CONFIG.BATCH_SIZE) {
    const batch = services.slice(i, i + CONFIG.BATCH_SIZE);
    const values = [];
    for (const svc of batch) {
      const usd = parseFloat(String(svc.rate).replace(/,/g, ''));
      const lkr = isNaN(usd) ? '0.00' : (usd * exchangeRate * (1 + profitMargin)).toFixed(2);
      values.push(
        Number(svc.service) || 0,
        (svc.name || 'Unknown').substring(0, 255),
        (svc.type || 'Default').substring(0, 100),
        (svc.category || 'Uncategorized').substring(0, 100),
        lkr,
        parseInt(svc.min, 10) || 0,
        parseInt(svc.max, 10) || 0,
        svc.refill ? 1 : 0,
        svc.cancel ? 1 : 0
      );
    }
    const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(',');
    const sql = `INSERT OR REPLACE INTO services (service_id, name, type, category, rate, min, max, refill, cancel) VALUES ${placeholders}`;
    try {
      await executeD1Query(sql, values);
      inserted += batch.length;
    } catch (err) {
      log(`Batch insert error: ${err.message}`, 'ERROR');
    }
  }
  return inserted;
}

// ─── MAIN SYNC FUNCTION (only runs when called) ─────────────────────────────
async function syncServices(exchangeRate = 344.60, profitMargin = 0.90, startFresh = false) {
  // Set running = true in status
  const status = { running: true, status: 'running', startTime: new Date().toISOString(), currentPage: 0, totalPages: 0, servicesImported: 0, servicesSkipped: 0, logs: [], exchangeRate, profitMargin };
  fs.writeFileSync(CONFIG.STATUS_FILE, JSON.stringify(status, null, 2));

  log('🚀 Starting import...');

  await ensureTable();

  if (startFresh) {
    await clearServices();
    log('🗑️ Existing services cleared');
  }

  let page = 1;
  let totalInserted = 0;

  try {
    const services = await fetchServices(page);
    if (!services.length) {
      log('No services found on page 1');
      status.status = 'completed';
      status.running = false;
      fs.writeFileSync(CONFIG.STATUS_FILE, JSON.stringify(status, null, 2));
      return { success: true, totalInserted: 0 };
    }

    const { kept } = filterServices(services);
    const inserted = await insertBatch(kept, exchangeRate, profitMargin);
    totalInserted += inserted;

    status.currentPage = page;
    status.totalPages = 1;
    status.servicesImported = totalInserted;
    status.running = false;
    status.status = 'completed';
    fs.writeFileSync(CONFIG.STATUS_FILE, JSON.stringify(status, null, 2));

    log(`✅ Imported ${inserted} services from page 1`);
    return { success: true, totalInserted };
  } catch (error) {
    log(`❌ Import error: ${error.message}`, 'ERROR');
    status.running = false;
    status.status = 'error';
    fs.writeFileSync(CONFIG.STATUS_FILE, JSON.stringify(status, null, 2));
    return { success: false, error: error.message };
  }
}

// ─── EXPORT ONLY (no auto-run) ──────────────────────────────────────────────
module.exports = { syncServices, executeD1Query, clearServices, CONFIG };
