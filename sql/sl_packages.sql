-- ═══════════════════════════════════════════════════════════════════════════
--  DZD MARKETING · SRI LANKAN AUDIENCE SERVICES
--  MySQL schema for the "SL Audience" dashboard page + admin panel editor.
--
--  NOTE: you normally do NOT need to run this file — the backend creates and
--  seeds these tables automatically on boot / first request
--  (controllers/slPackageController.js → ensureSchema()).
--  Run it manually only if you prefer explicit migrations.
-- ═══════════════════════════════════════════════════════════════════════════

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sl_packages (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  category_id INT UNSIGNED NOT NULL,
  title VARCHAR(191) NOT NULL,
  price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  old_price DECIMAL(10,2) DEFAULT NULL,
  badge VARCHAR(48) DEFAULT NULL,
  features TEXT,                              -- JSON array, e.g. ["100% Sri Lankan audience"]
  note VARCHAR(500) DEFAULT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sl_pkg_cat (category_id),
  KEY idx_sl_pkg_order (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sl_package_settings (
  setting_key VARCHAR(64) NOT NULL,
  setting_value TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Default settings ────────────────────────────────────────────────────────
INSERT INTO sl_package_settings (setting_key, setting_value) VALUES
  ('page_title',      'Sri Lanka Audience Services'),
  ('page_subtitle',   '100% real Sri Lankan audience for Facebook & TikTok. Pick a package — payment and delivery are handled on WhatsApp.'),
  ('whatsapp_number', '94753948303'),
  ('whatsapp_label',  '+94 75 394 8303'),
  ('currency_symbol', 'Rs.'),
  ('notice',          'ඔයාගේ package එක තෝරලා BUY ඔබන්න — WhatsApp එකෙන් order එක confirm කරන්න. Payments & delivery 100% manual, safe.'),
  ('page_active',     '1')
ON DUPLICATE KEY UPDATE setting_key = setting_key;

-- ─── Default categories ──────────────────────────────────────────────────────
INSERT INTO sl_package_categories (slug, title, emoji, platform, accent, tagline, note, sort_order) VALUES
  ('fb-sl-followers',        'Facebook Sri Lanka Followers',            '🇱🇰', 'facebook', 'blue',    '100% Sri Lankan profiles · Real audience',        'Page link එක WhatsApp එකේ යවන්න — followers gradual විදිහට එකතු වෙනවා.', 1),
  ('fb-monetize-followers',  'FB Followers · Monetize Audience',        '💸', 'facebook', 'emerald', 'Monetization friendly audience (N/W/B)',          'Facebook monetization කරන pages සඳහා නිර්දේශිතයි.',                       2),
  ('fb-monetization-views',  'Facebook Monetization Views Promotion',   '📈', 'facebook', 'violet',  'ප්‍රොමොශන් · Boost video views & watch time',      'Video link එක WhatsApp එකේ යවන්න.',                                        3),
  ('tiktok-sl-packages',     'TikTok Packages Sri Lanka',               '💨', 'tiktok',   'slate',   'Guess Likes + Views · බහින් නෑ 💨',                 '100% Sri Lanka Views 🇱🇰 — හැම package එකකම FREE views එක්ක.',              4),
  ('fb-likes-comments',      'Facebook Likes & Comments',               '🔥', 'facebook', 'pink',    'Sri Lankan engagement for your posts',           'Post link එක WhatsApp එකේ යවන්න.',                                          5)
ON DUPLICATE KEY UPDATE title = VALUES(title);

-- ─── Default packages ────────────────────────────────────────────────────────
INSERT INTO sl_packages (category_id, title, price, badge, features, sort_order)
SELECT c.id, v.title, v.price, v.badge, v.features, v.sort_order
FROM (
  SELECT 'fb-sl-followers' AS slug, '500 Followers' AS title, 990.00 AS price, 'STARTER' AS badge,
         '["100% Sri Lankan audience","Gradual safe delivery","No password needed"]' AS features, 1 AS sort_order
  UNION ALL SELECT 'fb-sl-followers','1K Followers',1490.00,'POPULAR','["100% Sri Lankan audience","Gradual safe delivery","No password needed"]',2
  UNION ALL SELECT 'fb-sl-followers','2K Followers',1890.00,NULL,'["100% Sri Lankan audience","Gradual safe delivery","No password needed"]',3
  UNION ALL SELECT 'fb-sl-followers','5K Followers',2990.00,'BEST VALUE','["100% Sri Lankan audience","Priority start","No password needed"]',4

  UNION ALL SELECT 'fb-monetize-followers','2K Followers',950.00,NULL,'["Monetization-safe audience","N / W / B profiles","No password needed"]',1
  UNION ALL SELECT 'fb-monetize-followers','3K Followers',1690.00,NULL,'["Monetization-safe audience","N / W / B profiles","No password needed"]',2
  UNION ALL SELECT 'fb-monetize-followers','5K Followers',1990.00,'POPULAR','["Monetization-safe audience","N / W / B profiles","Helps unlock in-stream ads"]',3
  UNION ALL SELECT 'fb-monetize-followers','10K Followers',3890.00,'BEST VALUE','["Monetization-safe audience","N / W / B profiles","Helps unlock in-stream ads"]',4

  UNION ALL SELECT 'fb-monetization-views','15K Views',1490.00,NULL,'["Fast start","Monetization-safe views","Works on public videos"]',1
  UNION ALL SELECT 'fb-monetization-views','55K Views',2750.00,NULL,'["Fast start","Monetization-safe views","Works on public videos"]',2
  UNION ALL SELECT 'fb-monetization-views','75K Views',3490.00,'POPULAR','["Fast start","Monetization-safe views","Watch-time boost"]',3
  UNION ALL SELECT 'fb-monetization-views','150K Views',4890.00,NULL,'["Fast start","Monetization-safe views","Watch-time boost"]',4
  UNION ALL SELECT 'fb-monetization-views','300K Views',9590.00,'BEST VALUE','["Priority start","Monetization-safe views","Watch-time boost"]',5

  UNION ALL SELECT 'tiktok-sl-packages','550 Likes',1499.00,NULL,'["1,000 Views FREE 🥳","Guess likes","100% Sri Lanka views"]',1
  UNION ALL SELECT 'tiktok-sl-packages','750 Likes',1690.00,NULL,'["3,000 Views FREE 🥳","Guess likes","100% Sri Lanka views"]',2
  UNION ALL SELECT 'tiktok-sl-packages','950 Likes',1790.00,'POPULAR','["6,000 Views FREE 🥳","Guess likes","100% Sri Lanka views"]',3
  UNION ALL SELECT 'tiktok-sl-packages','1K Likes',2990.00,'BEST VALUE','["12,000 Views FREE 🥳","Guess likes","100% Sri Lanka views"]',4

  UNION ALL SELECT 'fb-likes-comments','200 Comments',1900.00,'HOT','["100% Sri Lankan commenters","Custom or random comments","Safe delivery"]',1
  UNION ALL SELECT 'fb-likes-comments','500 Post Likes',1800.00,NULL,'["Sri Lankan profiles","Fast start","No password needed"]',2
) v
JOIN sl_package_categories c ON c.slug = v.slug
WHERE NOT EXISTS (
  SELECT 1 FROM sl_packages p WHERE p.category_id = c.id AND p.title = v.title
);
