const nodemailer = require('nodemailer');

// Your credentials from .env
const user = 'noreply@dzd-marketing.site';
const pass = 'aUeZ3gJN3QcF'; // Your actual password

const transporter = nodemailer.createTransport({
  host: 'smtp.zoho.com',
  port: 465,
  secure: true,
  auth: { user, pass },
  tls: { rejectUnauthorized: false }
});

transporter.verify((error, success) => {
  if (error) {
    console.error('❌ Authentication failed:', error);
  } else {
    console.log('✅ Authentication successful!');
  }
});
