/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  SRI LANKAN AUDIENCE SERVICES · default seed data
 *
 *  Mirrors `DZD MARKETING WEB/sl/slPackageDefaults.ts` (the web app keeps a
 *  copy so the page still renders if the API is unreachable).
 *
 *  These rows are inserted into MySQL only when `sl_package_categories`
 *  is empty. After that everything is edited from the admin panel
 *  (dzd-admin-v2 → "SL Packages").
 * ─────────────────────────────────────────────────────────────────────────────
 */

// WhatsApp number used for "BUY" buttons (digits only, international format)
const SL_WHATSAPP_NUMBER = '94753948303'; // +94 75 394 8303

const DEFAULT_SETTINGS = {
  page_title: 'Sri Lanka Audience Services',
  page_subtitle:
    '100% real Sri Lankan audience for Facebook & TikTok. Pick a package — payment and delivery are handled on WhatsApp.',
  whatsapp_number: SL_WHATSAPP_NUMBER,
  whatsapp_label: '+94 75 394 8303',
  currency_symbol: 'Rs.',
  notice:
    'ඔයාගේ package එක තෝරලා BUY ඔබන්න — WhatsApp එකෙන් order එක confirm කරන්න. Payments & delivery 100% manual, safe.',
  page_active: '1',
};

const DEFAULT_CATEGORIES = [
  {
    slug: 'fb-sl-followers',
    title: 'Facebook Sri Lanka Followers',
    emoji: '🇱🇰',
    platform: 'facebook',
    accent: 'blue',
    tagline: '100% Sri Lankan profiles · Real audience',
    note: 'Page link එක WhatsApp එකේ යවන්න — followers gradual විදිහට එකතු වෙනවා.',
    sort_order: 1,
    packages: [
      { title: '500 Followers', price: 990, badge: 'STARTER', features: ['100% Sri Lankan audience', 'Gradual safe delivery', 'No password needed'], sort_order: 1 },
      { title: '1K Followers', price: 1490, badge: 'POPULAR', features: ['100% Sri Lankan audience', 'Gradual safe delivery', 'No password needed'], sort_order: 2 },
      { title: '2K Followers', price: 1890, badge: null, features: ['100% Sri Lankan audience', 'Gradual safe delivery', 'No password needed'], sort_order: 3 },
      { title: '5K Followers', price: 2990, badge: 'BEST VALUE', features: ['100% Sri Lankan audience', 'Priority start', 'No password needed'], sort_order: 4 },
    ],
  },
  {
    slug: 'fb-monetize-followers',
    title: 'FB Followers · Monetize Audience',
    emoji: '💸',
    platform: 'facebook',
    accent: 'emerald',
    tagline: 'Monetization friendly audience (N/W/B)',
    note: 'Facebook monetization කරන pages සඳහා නිර්දේශිතයි.',
    sort_order: 2,
    packages: [
      { title: '2K Followers', price: 950, badge: null, features: ['Monetization-safe audience', 'N / W / B profiles', 'No password needed'], sort_order: 1 },
      { title: '3K Followers', price: 1690, badge: null, features: ['Monetization-safe audience', 'N / W / B profiles', 'No password needed'], sort_order: 2 },
      { title: '5K Followers', price: 1990, badge: 'POPULAR', features: ['Monetization-safe audience', 'N / W / B profiles', 'Helps unlock in-stream ads'], sort_order: 3 },
      { title: '10K Followers', price: 3890, badge: 'BEST VALUE', features: ['Monetization-safe audience', 'N / W / B profiles', 'Helps unlock in-stream ads'], sort_order: 4 },
    ],
  },
  {
    slug: 'fb-monetization-views',
    title: 'Facebook Monetization Views Promotion',
    emoji: '📈',
    platform: 'facebook',
    accent: 'violet',
    tagline: 'ප්‍රොමොශන් · Boost video views & watch time',
    note: 'Video link එක WhatsApp එකේ යවන්න.',
    sort_order: 3,
    packages: [
      { title: '15K Views', price: 1490, badge: null, features: ['Fast start', 'Monetization-safe views', 'Works on public videos'], sort_order: 1 },
      { title: '55K Views', price: 2750, badge: null, features: ['Fast start', 'Monetization-safe views', 'Works on public videos'], sort_order: 2 },
      { title: '75K Views', price: 3490, badge: 'POPULAR', features: ['Fast start', 'Monetization-safe views', 'Watch-time boost'], sort_order: 3 },
      { title: '150K Views', price: 4890, badge: null, features: ['Fast start', 'Monetization-safe views', 'Watch-time boost'], sort_order: 4 },
      { title: '300K Views', price: 9590, badge: 'BEST VALUE', features: ['Priority start', 'Monetization-safe views', 'Watch-time boost'], sort_order: 5 },
    ],
  },
  {
    slug: 'tiktok-sl-packages',
    title: 'TikTok Packages Sri Lanka',
    emoji: '💨',
    platform: 'tiktok',
    accent: 'slate',
    tagline: 'Guess Likes + Views · බහින් නෑ 💨',
    note: '100% Sri Lanka Views 🇱🇰 — හැම package එකකම FREE views එක්ක.',
    sort_order: 4,
    packages: [
      { title: '550 Likes', price: 1499, badge: null, features: ['1,000 Views FREE 🥳', 'Guess likes', '100% Sri Lanka views'], sort_order: 1 },
      { title: '750 Likes', price: 1690, badge: null, features: ['3,000 Views FREE 🥳', 'Guess likes', '100% Sri Lanka views'], sort_order: 2 },
      { title: '950 Likes', price: 1790, badge: 'POPULAR', features: ['6,000 Views FREE 🥳', 'Guess likes', '100% Sri Lanka views'], sort_order: 3 },
      { title: '1K Likes', price: 2990, badge: 'BEST VALUE', features: ['12,000 Views FREE 🥳', 'Guess likes', '100% Sri Lanka views'], sort_order: 4 },
    ],
  },
  {
    slug: 'fb-likes-comments',
    title: 'Facebook Likes & Comments',
    emoji: '🔥',
    platform: 'facebook',
    accent: 'pink',
    tagline: 'Sri Lankan engagement for your posts',
    note: 'Post link එක WhatsApp එකේ යවන්න.',
    sort_order: 5,
    packages: [
      { title: '200 Comments', price: 1900, badge: 'HOT', features: ['100% Sri Lankan commenters', 'Custom or random comments', 'Safe delivery'], sort_order: 1 },
      { title: '500 Post Likes', price: 1800, badge: null, features: ['Sri Lankan profiles', 'Fast start', 'No password needed'], sort_order: 2 },
    ],
  },
];

module.exports = { DEFAULT_SETTINGS, DEFAULT_CATEGORIES, SL_WHATSAPP_NUMBER };
