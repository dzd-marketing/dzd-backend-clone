const cron = require('node-cron');
const db = require('../config/db');

let io = null;

// ─── HELPER: Mask user name ──────────────────────────────────
function maskUserName(name) {
  if (!name || name.length < 5) return name || 'Someone';
  
  const first = name.slice(0, 3);
  const last = name.slice(-2);
  const stars = '*'.repeat(Math.min(name.length - 5, 4));
  
  return `${first}${stars}${last}`;
}

// ─── HELPER: Random item from array ──────────────────────────
function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── HELPER: Random number between min-max ───────────────────
function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ─── INIT FUNCTION ────────────────────────────────────────────
function initFakeNotifications(socketIo) {
  io = socketIo;
  console.log('🎭 Fake notifications cron started (every 15s)');
}

// ─── POPULAR SERVICES (fake names) ───────────────────────────
const POPULAR_SERVICES = [
  'TikTok Followers',
  'TikTok Likes',
  'Instagram Followers',
  'Instagram Likes',
  'Channel React',
  'YouTube Views',
  'Facebook Page Likes',
  'WhatsApp Boost',
  'Telegram Members',
  'Twitter Followers',
];

// ─── DEPOSIT AMOUNTS (LKR) ───────────────────────────────────
const DEPOSIT_AMOUNTS = [500, 1000, 12800, 2000, 2500, 3000, 4000, 5000, 7500, 10000];

// ─── CRON: Run every 15 seconds ──────────────────────────────
cron.schedule('*/25 * * * * *', async () => {
  if (!io) return;
  
  try {
    // Real users ලාගෙන් random කෙනෙක් ගන්න
    const [users] = await db.query(
      `SELECT full_name, username, uid FROM users 
       WHERE full_name IS NOT NULL 
       AND full_name != '' 
       ORDER BY RAND() 
       LIMIT 1`
    );
    
    if (users.length === 0) return;
    
    const user = users[0];
    const userName = user.full_name || user.username || 'Someone';
    const maskedName = maskUserName(userName);
    
    // ─── Random: Order (60%) හෝ Deposit (40%) ────────────────
    const type = Math.random() < 0.6 ? 'order' : 'deposit';
    
    let notification;
    
    if (type === 'order') {
      const service = randomItem(POPULAR_SERVICES);
      
      notification = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'order',
        title: `${maskedName} Purchased ${service}`,
        userName: maskedName,
        userId: null,
        icon: 'cart',
        color: '#3b82f6',
        timestamp: new Date().toISOString()
      };
    } else {
      const amount = randomItem(DEPOSIT_AMOUNTS);
      
      notification = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'deposit',
        title: `${maskedName} Deposited ${amount} LKR`,
        userName: maskedName,
        userId: null,
        icon: 'wallet',
        color: '#10b981',
        amount: amount,
        currency: 'LKR',
        timestamp: new Date().toISOString()
      };
    }
    
    io.emit('live_notification', notification);
    
  } catch (error) {
    console.error('❌ [Fake] Error:', error.message);
  }
});

module.exports = { initFakeNotifications };
