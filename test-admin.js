const mysql = require('mysql2');
const bcrypt = require('bcryptjs');

const db = mysql.createConnection({
  host: 'localhost',
  user: 'dzd-user',
  password: '12345',
  database: 'dzd_marketing'
});

const email = 'admin@dzd-marketing.site';
const password = 'admin123';

db.execute(
  'SELECT id, email, password_hash FROM admins WHERE email = ?',
  [email],
  (err, results) => {
    if (err) {
      console.error('Error:', err);
      return;
    }
    if (results.length === 0) {
      console.log('❌ Admin not found');
      return;
    }
    const admin = results[0];
    console.log('✅ Admin found:', admin.email);
    console.log('🔑 Stored hash:', admin.password_hash);
    
    const isValid = bcrypt.compareSync(password, admin.password_hash);
    console.log('✅ Password valid:', isValid);
    
    db.end();
  }
);
