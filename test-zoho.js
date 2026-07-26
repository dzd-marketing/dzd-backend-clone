const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'smtp.zoho.com',
  port: 465,
  secure: true,
  auth: {
    user: 'noreply@dzd-marketing.site',
    pass: 'your-password-here', // Use the actual password from .env
  },
  tls: {
    rejectUnauthorized: false
  }
});

transporter.verify((error, success) => {
  if (error) {
    console.error('❌ Zoho SMTP connection failed:', error);
  } else {
    console.log('✅ Zoho SMTP connection successful!');
  }
});
