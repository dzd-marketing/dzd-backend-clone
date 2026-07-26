const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const JWT_SECRET = process.env.JWT_SECRET;

// ─── Admin Login ──────────────────────────────────────────────────────────────
exports.adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const [admins] = await db.query(
      'SELECT id, email, password_hash, full_name, role, status FROM admins WHERE email = ? AND status = "active"',
      [email]
    );

    if (admins.length === 0) {
      return res.status(401).json({ 
        error: 'auth/invalid-credential',
        message: 'Invalid email or password' 
      });
    }

    const admin = admins[0];
    const isValidPassword = await bcrypt.compare(password, admin.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ 
        error: 'auth/invalid-credential',
        message: 'Invalid email or password' 
      });
    }

    await db.query(
      'UPDATE admins SET last_login = NOW() WHERE id = ?',
      [admin.id]
    );

    const token = jwt.sign(
      { id: admin.id, email: admin.email, role: admin.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      message: 'Login successful',
      user: {
        id: admin.id,
        email: admin.email,
        fullName: admin.full_name,
        role: admin.role
      },
      token
    });

  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── Get Admin Profile ────────────────────────────────────────────────────────
exports.getAdminProfile = async (req, res) => {
  try {
    const { id } = req.user;

    const [admins] = await db.query(
      'SELECT id, email, full_name, role, status, last_login, created_at FROM admins WHERE id = ? AND status = "active"',
      [id]
    );

    if (admins.length === 0) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    const admin = admins[0];
    res.json({
      id: admin.id,
      email: admin.email,
      fullName: admin.full_name,
      role: admin.role,
      status: admin.status,
      lastLogin: admin.last_login,
      createdAt: admin.created_at
    });
  } catch (error) {
    console.error('Get admin profile error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── Admin Middleware ──────────────────────────────────────────────────────────
exports.adminMiddleware = (req, res, next) => {
  const { role } = req.user;
  
  if (!role || !['super_admin', 'admin', 'moderator'].includes(role)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  next();
};
