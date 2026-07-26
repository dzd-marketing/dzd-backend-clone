const express = require('express');
const router = express.Router();
const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

// Admin login - no middleware
router.post('/login-new', async (req, res) => {
  console.log('🔥 New admin login route hit!');
  
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const [admins] = await db.query(
    'SELECT id, email, password_hash, full_name, role, status FROM admins WHERE email = ? AND status = "active"',
    [email]
  );

  if (admins.length === 0) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const admin = admins[0];
  const isValidPassword = await bcrypt.compare(password, admin.password_hash);
  if (!isValidPassword) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  await db.query('UPDATE admins SET last_login = NOW() WHERE id = ?', [admin.id]);

  const token = jwt.sign(
    { id: admin.id, email: admin.email, role: admin.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    success: true,
    token,
    user: {
      id: admin.id,
      email: admin.email,
      fullName: admin.full_name,
      role: admin.role
    }
  });
});

module.exports = router;
