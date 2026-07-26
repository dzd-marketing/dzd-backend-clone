const db = require('../config/db');

// ─── Get all users ────────────────────────────────────────────────────────────
exports.getAllUsers = async (req, res) => {
  try {
    const [users] = await db.query(
      `SELECT uid, email, username, full_name, photo_url, onboarded, is_reseller, 
              status, created_at, last_login, provider, whatsapp_country, 
              whatsapp_name, whatsapp_number
       FROM users 
       ORDER BY created_at DESC`
    );
    
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
};

// ─── Get user by ID ────────────────────────────────────────────────────────────
exports.getUserById = async (req, res) => {
  try {
    const { uid } = req.params;
    
    const [users] = await db.query(
      `SELECT uid, email, username, full_name, photo_url, onboarded, is_reseller, 
              status, created_at, last_login, provider, whatsapp_country, 
              whatsapp_name, whatsapp_number
       FROM users 
       WHERE uid = ?`,
      [uid]
    );
    
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(users[0]);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
};

// ─── Search users ────────────────────────────────────────────────────────────
exports.searchUsers = async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Search query is required' });
    }
    
    const [users] = await db.query(
      `SELECT uid, email, username, full_name, photo_url, onboarded, is_reseller, 
              status, created_at, last_login, provider, whatsapp_country, 
              whatsapp_name, whatsapp_number
       FROM users 
       WHERE email LIKE ? OR username LIKE ? OR full_name LIKE ? OR whatsapp_number LIKE ?
       ORDER BY created_at DESC`,
      [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`]
    );
    
    res.json(users);
  } catch (error) {
    console.error('Error searching users:', error);
    res.status(500).json({ error: 'Failed to search users' });
  }
};

// ─── Update user status ──────────────────────────────────────────────────────
exports.updateUserStatus = async (req, res) => {
  try {
    const { uid } = req.params;
    const { status } = req.body;
    
    if (!['active', 'suspended', 'deleted'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    
    await db.query(
      'UPDATE users SET status = ? WHERE uid = ?',
      [status, uid]
    );
    
    res.json({ 
      success: true, 
      message: 'User status updated successfully' 
    });
  } catch (error) {
    console.error('Error updating user status:', error);
    res.status(500).json({ error: 'Failed to update user status' });
  }
};

// ─── Get user statistics ──────────────────────────────────────────────────────
exports.getUserStats = async (req, res) => {
  try {
    const [stats] = await db.query(
      `SELECT 
        COUNT(*) as total_users,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_users,
        SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) as suspended_users,
        SUM(CASE WHEN status = 'deleted' THEN 1 ELSE 0 END) as deleted_users,
        SUM(CASE WHEN whatsapp_number IS NOT NULL AND whatsapp_number != '' THEN 1 ELSE 0 END) as whatsapp_users,
        SUM(CASE WHEN is_reseller = 1 THEN 1 ELSE 0 END) as reseller_users
       FROM users`
    );
    
    res.json(stats[0] || { 
      total_users: 0, 
      active_users: 0, 
      suspended_users: 0, 
      deleted_users: 0,
      whatsapp_users: 0,
      reseller_users: 0
    });
  } catch (error) {
    console.error('Error fetching user stats:', error);
    res.status(500).json({ error: 'Failed to fetch user statistics' });
  }
};
