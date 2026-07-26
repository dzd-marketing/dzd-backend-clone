const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const authRoutes = require('./routes/authRoutes');
const passwordResetRoutes = require('./routes/passwordResetRoutes');
const orderRoutes = require('./routes/orderRoutes');
const proxyRoutes = require('./routes/proxyRoutes');
const accountRoutes = require('./routes/accountRoutes');
const resellerApiRoutes = require('./routes/resellerApiRoutes');
const statusRoutes = require('./routes/statusRoutes');
const adminRoutes = require('./routes/adminRoutes');
const adminAuthRoutes = require('./routes/adminAuthRoutes');
const serviceImportRoutes = require('./routes/serviceImportRoutes');
const servicesRoutes = require('./routes/servicesRoutes');
const adminOrderRoutes = require('./routes/adminOrderRoutes');

dotenv.config({ path: path.resolve(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3000;

// ─── MIDDLEWARE ──────────────────────────────────────────────────────────────
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// ─── DATABASE ────────────────────────────────────────────────────────────────
const db = require('./config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// ─── ADMIN LOGIN (NO AUTH REQUIRED) ────────────────────────────────────────
app.post('/api/admin/auth/login', async (req, res) => {
  console.log('🔥 Admin login hit!');
  
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
    process.env.JWT_SECRET,
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

// ─── AUTH MIDDLEWARE ─────────────────────────────────────────────────────────
const authenticateToken = require('./middleware/auth');

// ─── PROTECTED ADMIN ROUTES (require token) ────────────────────────────────
app.use('/api/admin', authenticateToken);  // ✅ This applies to all /api/admin/* routes
app.use('/api/admin', adminRoutes);        // ✅ Protected admin routes
// app.use('/api/admin/auth', adminAuthRoutes); // ❌ Remove this - it's causing issues

// ─── PUBLIC ROUTES ──────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);           // ✅ Includes /google route
app.use('/api/password-reset', passwordResetRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/proxy', proxyRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/v2', resellerApiRoutes);
app.use('/api/status', statusRoutes);
app.use('/api/service-import', serviceImportRoutes);
app.use('/api/services', servicesRoutes);
app.use('/api/admin/orders', adminOrderRoutes);

// ─── HEALTH CHECK ────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// ─── ERROR HANDLING ──────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── START SERVER ────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT} on all interfaces`);
});

// ─── GRACEFUL SHUTDOWN ──────────────────────────────────────────────────────
process.on('SIGINT', () => {
  console.log('🛑 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught exception:', err);
  process.exit(1);
});
