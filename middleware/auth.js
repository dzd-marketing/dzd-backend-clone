const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this';

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  console.log('🔑 Auth header present:', !!authHeader);
  
  const token = authHeader && authHeader.split(' ')[1];
  console.log('🔑 Token extracted:', token ? '✓' : '✗');

  if (!token) {
    console.log('❌ No token provided');
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.log('❌ JWT verification error:', err.message);
      console.log('🔑 JWT_SECRET used:', JWT_SECRET.substring(0, 20) + '...');
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    console.log('✅ Token verified for user:', user.uid);
    req.user = user;
    next();
  });
};

module.exports = authenticateToken;
