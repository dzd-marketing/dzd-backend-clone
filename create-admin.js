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
const fullName = 'Admin User';
const role = 'super_admin';

// Hash password
const hash = bcrypt.hashSync(password, 10);
console.log('Generated hash:', hash);

// Insert using prepared statement
db.execute(
  'INSERT INTO admins (email, password_hash, full_name, role) VALUES (?, ?, ?, ?)',
  [email, hash, fullName, role],
  (err, result) => {
    if (err) {
      console.error('Error inserting admin:', err);
    } else {
      console.log('✅ Admin created successfully!');
    }
    db.end();
  }
);
