/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  SRI LANKAN AUDIENCE SERVICES · controller
 *
 *  Public  → GET  /api/sl-packages                 (used by the website)
 *  Admin   →      /api/admin/sl-packages/*         (used by dzd-admin-v2)
 *
 *  Tables are created + seeded automatically on first use (see ensureSchema),
 *  so no manual migration is required. `sql/sl_packages.sql` contains the same
 *  schema if you prefer to run it by hand.
 *
 *  Orders / payments are NOT handled here: the website opens WhatsApp
 *  (+94 75 394 8303) with the package details pre-filled and the deal is
 *  closed manually on WhatsApp.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const db = require('../config/db');
const { DEFAULT_SETTINGS, DEFAULT_CATEGORIES } = require('../config/slPackageSeed');

// ─── Helpers ─────────────────────────────────────────────────────────────────
const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);

const cleanStr = (v, max = 255) =>
  v === undefined || v === null ? null : String(v).trim().slice(0, max) || null;

const cleanSlug = (v, fallback) => {
  const slug = String(v || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback;
};

/**
 * Accepts 4990 | "4990" | "4,990" | "Rs. 4,990/=" | "LKR 1490" | "1490/-" | "4.99"
 * (admins paste prices straight out of their WhatsApp price list, so be forgiving)
 */
const cleanPrice = v => {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null;

  let s = String(v).trim();
  if (!s) return null;

  // strip currency noise: "/=" , "=/" , "/-" , "-/" , "Rs." , "LKR" , "$" , "රු."
  s = s
    .replace(/\/\s*=|=\s*\/|\/\s*-|-\s*\//g, '')
    .replace(/(rs\.?|lkr|usd|eur|gbp|\$|£|€|රු\.?)/gi, '')
    .replace(/\s+/g, '');

  if (!s) return null;

  // thousands / decimal separators
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');                                  // 1,490  | 1,490.50
  else if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');          // 1.490,50
  else s = s.replace(/,/g, '.');                                                                       // 4,99 → 4.99

  const n = parseFloat(s.replace(/[^0-9.]/g, ''));
  if (isNaN(n) || n < 0 || /^-/.test(s)) return null;
  return Math.round(n * 100) / 100;
};

const cleanInt = (v, def = 0) => {
  const n = parseInt(v, 10);
  return isNaN(n) ? def : n;
};

const cleanBool = (v, def = 1) => {
  if (v === undefined || v === null || v === '') return def;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const s = String(v).toLowerCase().trim();
  if (['1', 'true', 'yes', 'on', 'active'].includes(s)) return 1;
  if (['0', 'false', 'no', 'off', 'inactive'].includes(s)) return 0;
  return def;
};

/** features arrive as an array (from the admin UI) or a JSON/comma string */
const normalizeFeatures = v => {
  if (v === undefined || v === null || v === '') return null;
  let list = v;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      list = Array.isArray(parsed) ? parsed : v.split('\n');
    } catch {
      list = v.includes('|') ? v.split('|') : v.split('\n');
    }
  }
  const arr = (Array.isArray(list) ? list : [list])
    .map(f => String(f).trim())
    .filter(Boolean)
    .slice(0, 20);
  return arr.length ? JSON.stringify(arr) : null;
};

const parseFeatures = v => {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return String(v).split('|').map(s => s.trim()).filter(Boolean);
  }
};

const PLATFORMS = ['facebook', 'tiktok', 'instagram', 'youtube', 'whatsapp', 'twitter', 'telegram', 'other'];
const ACCENTS = ['blue', 'emerald', 'violet', 'pink', 'amber', 'slate'];

// ─── Schema + seed ───────────────────────────────────────────────────────────
let schemaPromise = null;

async function createTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS sl_package_categories (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      slug VARCHAR(80) NOT NULL,
      title VARCHAR(191) NOT NULL,
      emoji VARCHAR(24) DEFAULT NULL,
      platform VARCHAR(32) NOT NULL DEFAULT 'facebook',
      accent VARCHAR(32) NOT NULL DEFAULT 'blue',
      tagline VARCHAR(255) DEFAULT NULL,
      note VARCHAR(500) DEFAULT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_sl_cat_slug (slug),
      KEY idx_sl_cat_order (sort_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS sl_packages (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      category_id INT UNSIGNED NOT NULL,
      title VARCHAR(191) NOT NULL,
      price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      old_price DECIMAL(10,2) DEFAULT NULL,
      badge VARCHAR(48) DEFAULT NULL,
      features TEXT,
      note VARCHAR(500) DEFAULT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_sl_pkg_cat (category_id),
      KEY idx_sl_pkg_order (sort_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS sl_package_settings (
      setting_key VARCHAR(64) NOT NULL,
      setting_value TEXT,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (setting_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function seedSettings() {
  for (const key of SETTING_KEYS) {
    await db.query(
      `INSERT INTO sl_package_settings (setting_key, setting_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_key = setting_key`,
      [key, DEFAULT_SETTINGS[key]]
    );
  }
}

async function seedCategories() {
  for (const cat of DEFAULT_CATEGORIES) {
    const [result] = await db.query(
      `INSERT INTO sl_package_categories
         (slug, title, emoji, platform, accent, tagline, note, sort_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [cat.slug, cat.title, cat.emoji || null, cat.platform, cat.accent || 'blue',
       cat.tagline || null, cat.note || null, cleanInt(cat.sort_order, 0)]
    );
    const categoryId = result.insertId;

    for (const pkg of cat.packages || []) {
      await db.query(
        `INSERT INTO sl_packages
           (category_id, title, price, old_price, badge, features, note, sort_order, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [categoryId, pkg.title, cleanPrice(pkg.price) ?? 0, pkg.old_price ?? null,
         pkg.badge || null, normalizeFeatures(pkg.features), pkg.note || null,
         cleanInt(pkg.sort_order, 0)]
      );
    }
  }
}

/** Creates tables + seeds defaults the first time the API is hit. */
async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await createTables();
      await seedSettings();
      const [rows] = await db.query('SELECT COUNT(*) AS total FROM sl_package_categories');
      if (!rows[0] || Number(rows[0].total) === 0) {
        await seedCategories();
        console.log('🇱🇰 SL packages: default categories seeded');
      }
    })().catch(err => {
      schemaPromise = null; // allow a retry on the next request
      throw err;
    });
  }
  return schemaPromise;
}

async function readSettings() {
  const [rows] = await db.query('SELECT setting_key, setting_value, updated_at FROM sl_package_settings');
  const settings = { ...DEFAULT_SETTINGS };
  let updatedAt = null;
  rows.forEach(r => {
    settings[r.setting_key] = r.setting_value;
    if (r.updated_at && (!updatedAt || r.updated_at > updatedAt)) updatedAt = r.updated_at;
  });
  settings.page_active = cleanBool(settings.page_active, 1);
  settings.updated_at = updatedAt;
  return settings;
}

async function readCategories({ includeInactive = false } = {}) {
  const [cats] = await db.query(
    `SELECT id, slug, title, emoji, platform, accent, tagline, note, sort_order, is_active, created_at, updated_at
     FROM sl_package_categories
     ${includeInactive ? '' : 'WHERE is_active = 1'}
     ORDER BY sort_order ASC, id ASC`
  );

  const [pkgs] = await db.query(
    `SELECT id, category_id, title, price, old_price, badge, features, note, sort_order, is_active, created_at, updated_at
     FROM sl_packages
     ${includeInactive ? '' : 'WHERE is_active = 1'}
     ORDER BY sort_order ASC, id ASC`
  );

  return cats.map(c => ({
    ...c,
    packages: pkgs
      .filter(p => Number(p.category_id) === Number(c.id))
      .map(p => ({ ...p, features: parseFeatures(p.features) })),
  }));
}

// ─── PUBLIC ──────────────────────────────────────────────────────────────────
/** GET /api/sl-packages — what the website renders */
exports.getPackages = async (req, res) => {
  try {
    await ensureSchema();
    const settings = await readSettings();
    const categories = await readCategories({ includeInactive: false });

    res.json({
      success: true,
      data: { settings, categories },
      meta: {
        total_categories: categories.length,
        total_packages: categories.reduce((n, c) => n + c.packages.length, 0),
        cached_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('❌ SL packages fetch error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to load Sri Lankan audience packages' });
  }
};

// ─── ADMIN · read ────────────────────────────────────────────────────────────
/** GET /api/admin/sl-packages — everything, including hidden rows */
exports.adminGetAll = async (req, res) => {
  try {
    await ensureSchema();
    const [settings, categories] = [await readSettings(), await readCategories({ includeInactive: true })];
    res.json({ success: true, data: { settings, categories } });
  } catch (error) {
    console.error('❌ SL admin fetch error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to load SL packages' });
  }
};

// ─── ADMIN · categories ──────────────────────────────────────────────────────
exports.createCategory = async (req, res) => {
  try {
    await ensureSchema();
    const title = cleanStr(req.body.title, 191);
    if (!title) return res.status(400).json({ success: false, error: 'Category title is required' });

    const [maxRow] = await db.query('SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM sl_package_categories');
    const slug = cleanSlug(req.body.slug, title.toLowerCase().replace(/\s+/g, '-'));

    const [result] = await db.query(
      `INSERT INTO sl_package_categories
         (slug, title, emoji, platform, accent, tagline, note, sort_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        slug,
        title,
        cleanStr(req.body.emoji, 24),
        PLATFORMS.includes(String(req.body.platform).toLowerCase()) ? String(req.body.platform).toLowerCase() : 'facebook',
        ACCENTS.includes(String(req.body.accent).toLowerCase()) ? String(req.body.accent).toLowerCase() : 'blue',
        cleanStr(req.body.tagline, 255),
        cleanStr(req.body.note, 500),
        req.body.sort_order !== undefined ? cleanInt(req.body.sort_order) : Number(maxRow[0].max_order) + 1,
        cleanBool(req.body.is_active, 1),
      ]
    );

    const [rows] = await db.query('SELECT * FROM sl_package_categories WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, message: 'Category created', data: rows[0] });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ success: false, error: 'That category slug already exists' });
    console.error('❌ SL create category error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to create category' });
  }
};

exports.updateCategory = async (req, res) => {
  try {
    await ensureSchema();
    const id = cleanInt(req.params.id, 0);
    const [existing] = await db.query('SELECT * FROM sl_package_categories WHERE id = ?', [id]);
    if (!existing.length) return res.status(404).json({ success: false, error: 'Category not found' });

    const row = existing[0];
    const b = req.body || {};
    const platform = b.platform !== undefined
      ? (PLATFORMS.includes(String(b.platform).toLowerCase()) ? String(b.platform).toLowerCase() : row.platform)
      : row.platform;
    const accent = b.accent !== undefined
      ? (ACCENTS.includes(String(b.accent).toLowerCase()) ? String(b.accent).toLowerCase() : row.accent)
      : row.accent;

    await db.query(
      `UPDATE sl_package_categories SET
         slug = ?, title = ?, emoji = ?, platform = ?, accent = ?, tagline = ?, note = ?, sort_order = ?, is_active = ?
       WHERE id = ?`,
      [
        b.slug !== undefined ? cleanSlug(b.slug, row.slug) : row.slug,
        b.title !== undefined ? cleanStr(b.title, 191) || row.title : row.title,
        b.emoji !== undefined ? cleanStr(b.emoji, 24) : row.emoji,
        platform,
        accent,
        b.tagline !== undefined ? cleanStr(b.tagline, 255) : row.tagline,
        b.note !== undefined ? cleanStr(b.note, 500) : row.note,
        b.sort_order !== undefined ? cleanInt(b.sort_order, row.sort_order) : row.sort_order,
        b.is_active !== undefined ? cleanBool(b.is_active, row.is_active) : row.is_active,
        id,
      ]
    );

    const [rows] = await db.query('SELECT * FROM sl_package_categories WHERE id = ?', [id]);
    res.json({ success: true, message: 'Category updated', data: rows[0] });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ success: false, error: 'That category slug already exists' });
    console.error('❌ SL update category error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to update category' });
  }
};

exports.deleteCategory = async (req, res) => {
  try {
    await ensureSchema();
    const id = cleanInt(req.params.id, 0);
    const [existing] = await db.query('SELECT id FROM sl_package_categories WHERE id = ?', [id]);
    if (!existing.length) return res.status(404).json({ success: false, error: 'Category not found' });

    await db.query('DELETE FROM sl_packages WHERE category_id = ?', [id]);
    await db.query('DELETE FROM sl_package_categories WHERE id = ?', [id]);
    res.json({ success: true, message: 'Category and its packages deleted' });
  } catch (error) {
    console.error('❌ SL delete category error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to delete category' });
  }
};

// ─── ADMIN · packages ────────────────────────────────────────────────────────
exports.createPackage = async (req, res) => {
  try {
    await ensureSchema();
    const b = req.body || {};
    const categoryId = cleanInt(b.category_id, 0);
    const title = cleanStr(b.title, 191);
    const price = cleanPrice(b.price);

    if (!categoryId) return res.status(400).json({ success: false, error: 'category_id is required' });
    if (!title) return res.status(400).json({ success: false, error: 'Package title is required' });
    if (price === null) return res.status(400).json({ success: false, error: 'A valid price is required' });

    const [cats] = await db.query('SELECT id FROM sl_package_categories WHERE id = ?', [categoryId]);
    if (!cats.length) return res.status(404).json({ success: false, error: 'Category not found' });

    const [maxRow] = await db.query(
      'SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM sl_packages WHERE category_id = ?',
      [categoryId]
    );

    const [result] = await db.query(
      `INSERT INTO sl_packages
         (category_id, title, price, old_price, badge, features, note, sort_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        categoryId,
        title,
        price,
        cleanPrice(b.old_price),
        cleanStr(b.badge, 48),
        normalizeFeatures(b.features),
        cleanStr(b.note, 500),
        b.sort_order !== undefined ? cleanInt(b.sort_order) : Number(maxRow[0].max_order) + 1,
        cleanBool(b.is_active, 1),
      ]
    );

    const [rows] = await db.query('SELECT * FROM sl_packages WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, message: 'Package created', data: { ...rows[0], features: parseFeatures(rows[0].features) } });
  } catch (error) {
    console.error('❌ SL create package error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to create package' });
  }
};

exports.updatePackage = async (req, res) => {
  try {
    await ensureSchema();
    const id = cleanInt(req.params.id, 0);
    const [existing] = await db.query('SELECT * FROM sl_packages WHERE id = ?', [id]);
    if (!existing.length) return res.status(404).json({ success: false, error: 'Package not found' });

    const row = existing[0];
    const b = req.body || {};
    const price = b.price !== undefined ? cleanPrice(b.price) : Number(row.price);
    if (price === null) return res.status(400).json({ success: false, error: 'A valid price is required' });

    const categoryId = b.category_id !== undefined ? cleanInt(b.category_id, row.category_id) : row.category_id;
    if (categoryId !== Number(row.category_id)) {
      const [cats] = await db.query('SELECT id FROM sl_package_categories WHERE id = ?', [categoryId]);
      if (!cats.length) return res.status(404).json({ success: false, error: 'Target category not found' });
    }

    await db.query(
      `UPDATE sl_packages SET
         category_id = ?, title = ?, price = ?, old_price = ?, badge = ?, features = ?, note = ?, sort_order = ?, is_active = ?
       WHERE id = ?`,
      [
        categoryId,
        b.title !== undefined ? cleanStr(b.title, 191) || row.title : row.title,
        price,
        b.old_price !== undefined ? cleanPrice(b.old_price) : row.old_price,
        b.badge !== undefined ? cleanStr(b.badge, 48) : row.badge,
        b.features !== undefined ? normalizeFeatures(b.features) : row.features,
        b.note !== undefined ? cleanStr(b.note, 500) : row.note,
        b.sort_order !== undefined ? cleanInt(b.sort_order, row.sort_order) : row.sort_order,
        b.is_active !== undefined ? cleanBool(b.is_active, row.is_active) : row.is_active,
        id,
      ]
    );

    const [rows] = await db.query('SELECT * FROM sl_packages WHERE id = ?', [id]);
    res.json({ success: true, message: 'Package updated', data: { ...rows[0], features: parseFeatures(rows[0].features) } });
  } catch (error) {
    console.error('❌ SL update package error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to update package' });
  }
};

exports.deletePackage = async (req, res) => {
  try {
    await ensureSchema();
    const id = cleanInt(req.params.id, 0);
    const [existing] = await db.query('SELECT id FROM sl_packages WHERE id = ?', [id]);
    if (!existing.length) return res.status(404).json({ success: false, error: 'Package not found' });

    await db.query('DELETE FROM sl_packages WHERE id = ?', [id]);
    res.json({ success: true, message: 'Package deleted' });
  } catch (error) {
    console.error('❌ SL delete package error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to delete package' });
  }
};

/** PATCH .../:type/:id/move  { direction: 'up' | 'down' } — reorders rows */
exports.moveRow = async (req, res) => {
  try {
    await ensureSchema();
    const { type } = req.params; // 'categories' | 'packages'
    const id = cleanInt(req.params.id, 0);
    const direction = String(req.body?.direction || 'up').toLowerCase();
    const table = type === 'packages' ? 'sl_packages' : 'sl_package_categories';

    const [rows] = await db.query(`SELECT * FROM ${table} WHERE id = ?`, [id]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'Row not found' });
    const row = rows[0];

    const scope = table === 'sl_packages' ? 'AND category_id = ?' : '';
    const params = table === 'sl_packages' ? [row.sort_order, row.category_id] : [row.sort_order];

    const [neighbour] = await db.query(
      `SELECT * FROM ${table}
       WHERE sort_order ${direction === 'down' ? '>' : '<'} ? ${scope}
       ORDER BY sort_order ${direction === 'down' ? 'ASC' : 'DESC'} LIMIT 1`,
      params
    );

    if (!neighbour.length)
      return res.json({ success: true, message: 'Already at the edge — nothing to move' });

    const other = neighbour[0];
    let aOrder = Number(other.sort_order);
    let bOrder = Number(row.sort_order);
    if (aOrder === bOrder) {
      // sort_order ties → nudge the neighbour so the swap is visible
      aOrder = direction === 'down' ? bOrder + 1 : Math.max(0, bOrder - 1);
    }

    await db.query(`UPDATE ${table} SET sort_order = ? WHERE id = ?`, [aOrder, row.id]);
    await db.query(`UPDATE ${table} SET sort_order = ? WHERE id = ?`, [bOrder, other.id]);

    res.json({ success: true, message: 'Order updated' });
  } catch (error) {
    console.error('❌ SL move error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to reorder' });
  }
};

// ─── ADMIN · settings ────────────────────────────────────────────────────────
exports.updateSettings = async (req, res) => {
  try {
    await ensureSchema();
    const b = req.body || {};

    for (const key of SETTING_KEYS) {
      if (b[key] === undefined) continue;
      let value = b[key];
      if (key === 'page_active') value = String(cleanBool(value, 1));
      if (key === 'whatsapp_number') value = String(value || '').replace(/\D/g, '').slice(0, 20);
      if (key === 'currency_symbol') value = String(value || 'Rs.').trim().slice(0, 8);
      if (key === 'whatsapp_label' && !String(value || '').trim()) value = null;

      await db.query(
        `INSERT INTO sl_package_settings (setting_key, setting_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [key, value === null || value === undefined ? null : String(value).slice(0, 1000)]
      );
    }

    const settings = await readSettings();
    res.json({ success: true, message: 'Settings saved', data: { settings } });
  } catch (error) {
    console.error('❌ SL settings error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to save settings' });
  }
};

/** POST /api/admin/sl-packages/seed — wipe + restore the default price list */
exports.restoreDefaults = async (req, res) => {
  try {
    await ensureSchema();
    await db.query('DELETE FROM sl_packages');
    await db.query('DELETE FROM sl_package_categories');
    await seedCategories();
    for (const key of SETTING_KEYS) {
      await db.query(
        `INSERT INTO sl_package_settings (setting_key, setting_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [key, DEFAULT_SETTINGS[key]]
      );
    }
    res.json({ success: true, message: 'Default Sri Lankan package list restored' });
  } catch (error) {
    console.error('❌ SL seed error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to restore defaults' });
  }
};

/** GET /api/admin/sl-packages/whatsapp-preview?category=..&package=..&price=..
 *  Returns the exact WhatsApp deep link the website will open (handy for QA). */
exports.whatsappPreview = async (req, res) => {
  try {
    await ensureSchema();
    const settings = await readSettings();
    const number = String(settings.whatsapp_number || '').replace(/\D/g, '');
    const { category = '', package: pkg = '', price = '' } = req.query;
    const text = [
      '🇱🇰 *New Order — DzD Marketing*',
      '━━━━━━━━━━━━━━━━',
      `📦 Package  : ${pkg}`,
      `📂 Service  : ${category}`,
      `💰 Price    : ${settings.currency_symbol || 'Rs.'} ${price}/=`,
      '🔗 Link     : ',
      '━━━━━━━━━━━━━━━━',
      'මම මේ package එක ගන්නම් — please confirm කරන්න. 🚀',
    ].join('\n');

    res.json({
      success: true,
      data: { number, url: `https://wa.me/${number}?text=${encodeURIComponent(text)}`, message: text },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to build WhatsApp preview' });
  }
};

module.exports.ensureSchema = ensureSchema;
