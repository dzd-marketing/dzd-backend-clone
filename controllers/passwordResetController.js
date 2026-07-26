const db = require('../config/db');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const dotenv = require('dotenv');
const path = require('path');

// Load .env file directly in this controller
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Get credentials from env
const emailUser = process.env.ZOHO_EMAIL_RESET_USER;
const emailPass = process.env.ZOHO_EMAIL_RESET_PASS;

// Debug: log the credentials
console.log('Controller - Email User:', emailUser);
console.log('Controller - Email Pass:', emailPass ? '✓ Loaded' : '✗ Not loaded');

// Create transporter for Zoho Mail
const transporter = nodemailer.createTransport({
  host: 'smtp.zoho.com',
  port: 465,
  secure: true,
  auth: {
    user: emailUser,
    pass: emailPass,
  },
  tls: {
    rejectUnauthorized: false
  }
});

// Generate 6-digit code
function generateResetCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Send reset code
exports.sendResetCode = async (req, res) => {
  try {
    const { email } = req.body;

    const [users] = await db.query(
      'SELECT id, email, full_name FROM users WHERE email = ? AND status = "active"',
      [email]
    );

    if (users.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'No account found with this email address' 
      });
    }

    const user = users[0];
    const resetCode = generateResetCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await db.query(
      `INSERT INTO password_resets (user_id, email, code, expires_at, used) 
       VALUES (?, ?, ?, ?, ?)`,
      [user.id, email, resetCode, expiresAt, false]
    );

    console.log(`Sending email to: ${email} with code: ${resetCode}`);
    console.log(`Using credentials: ${emailUser} / ${emailPass ? '✓' : '✗'}`);

    // Send email
    const info = await transporter.sendMail({
      from: `"DzD Marketing" <${emailUser}>`,
      to: email,
      subject: 'Your password reset code for DzD Marketing',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.5; color: #24292e; background-color: #ffffff; }
            .container { max-width: 600px; margin: 0 auto; padding: 32px 24px; }
            .header { margin-bottom: 32px; text-align: center; }
            .logo { display: flex; align-items: center; gap: 8px; margin-bottom: 24px; justify-content: center; }
            .logo-icon { width: 32px; height: 32px; background: linear-gradient(135deg, #2563eb, #7c3aed); border-radius: 8px; display: flex; align-items: center; justify-content: center; }
            .logo-icon span { color: white; font-weight: bold; font-size: 18px; }
            .logo-text { font-size: 18px; font-weight: 600; color: #1f2937; }
            .logo-text span { color: #2563eb; }
            .title { font-size: 20px; font-weight: 600; color: #1f2937; margin-bottom: 8px; }
            .subtitle { font-size: 14px; color: #6b7280; margin-bottom: 32px; }
            .code-container { background-color: #f6f8fa; border: 1px solid #e1e4e8; border-radius: 12px; padding: 32px; margin-bottom: 32px; text-align: center; }
            .code-label { font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 16px; }
            .reset-code { font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', monospace; font-size: 42px; font-weight: 600; letter-spacing: 8px; color: #1f2937; margin-bottom: 16px; }
            .code-footer { font-size: 13px; color: #6b7280; }
            .warning-box { background-color: #fff8c5; border: 1px solid #f9d71c; border-radius: 12px; padding: 20px; margin-bottom: 32px; }
            .warning-title { font-size: 14px; font-weight: 600; color: #735f0d; margin-bottom: 8px; }
            .warning-text { font-size: 13px; color: #735f0d; margin-bottom: 8px; }
            .footer { text-align: center; margin-top: 32px; }
            .footer-text { font-size: 12px; color: #6b7280; margin-bottom: 8px; }
            .footer-links { font-size: 12px; }
            .footer-links a { color: #2563eb; text-decoration: none; margin: 0 8px; }
            .footer-links a:hover { text-decoration: underline; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div style="margin-bottom: 24px;">
                <div style="display: inline-block; background: linear-gradient(135deg, #2563eb, #3b82f6); border-radius: 12px; padding: 12px 24px; box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.2);">
                  <span style="color: white; font-size: 28px; font-weight: 800; letter-spacing: 2px;">DZD-MARKETING</span>
                </div>
              </div>
              <h1 style="font-size: 24px; font-weight: 600; color: #1f2937; margin-bottom: 8px;">Please verify your identity</h1>
              <p style="font-size: 16px; color: #6b7280; margin-bottom: 32px;">Here is your password reset authentication code:</p>
            </div>
            
            <div class="code-container">
              <div class="code-label">Authentication code</div>
              <div class="reset-code">${resetCode}</div>
              <div class="code-footer">
                This code is valid for <strong>15 minutes</strong> and can only be used once.
              </div>
            </div>
            
            <div class="warning-box">
              <div class="warning-title">⚠️ Important security notice</div>
              <div class="warning-text">
                Please don't share this code with anyone. We will never ask for it via phone, email, or any other communication channel.
              </div>
            </div>
            
            <div style="margin-bottom: 32px;">
              <p style="font-size: 13px; color: #6b7280; margin-bottom: 4px;">
                Requested from: <span style="color: #1f2937; font-weight: 500;">${email}</span>
              </p>
              <p style="font-size: 13px; color: #6b7280;">
                Time: <span style="color: #1f2937; font-weight: 500;">${new Date().toLocaleString('en-US', { 
                  hour: 'numeric', 
                  minute: 'numeric',
                  hour12: true,
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric'
                })}</span>
              </p>
            </div>
            
            <div class="divider"></div>
            
            <div class="footer">
              <p class="footer-text">
                You're receiving this email because a password reset code was requested for your DzD Marketing account.
              </p>
              <p class="footer-text" style="margin-bottom: 16px;">
                If this wasn't you, please ignore this email or <a href="https://www.dzd-marketing.site/Contact" style="color: #2563eb; text-decoration: none;">contact support</a> immediately.
              </p>
              <div class="footer-links">
                <a href="https://www.dzd-marketing.site/about-us">About-Us</a>
                <span style="color: #e1e4e8;">•</span>
                <a href="https://www.dzd-marketing.site/support">Support</a>
                <span style="color: #e1e4e8;">•</span>
                <a href="https://www.dzd-marketing.site/Contact">Contact</a>
              </div>
              <p class="footer-text" style="margin-top: 24px;">
                © ${new Date().getFullYear()} DzD Marketing. All rights reserved.
              </p>
              <p class="footer-text" style="font-size: 11px;">
                Colombo, Sri Lanka
              </p>
            </div>
          </div>
        </body>
        </html>
      `
    });

    return res.status(200).json({ 
      success: true, 
      message: 'Reset code sent successfully',
      userId: user.id
    });

  } catch (error) {
    console.error('Send reset code error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
};

// Verify reset code
exports.verifyResetCode = async (req, res) => {
  try {
    const { email, code } = req.body;

    const [resetRecords] = await db.query(
      `SELECT * FROM password_resets 
       WHERE email = ? AND code = ? AND used = false AND expires_at > NOW()`,
      [email, code]
    );

    if (resetRecords.length === 0) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid or expired code' 
      });
    }

    return res.status(200).json({ 
      success: true,
      message: 'Code verified successfully' 
    });

  } catch (error) {
    console.error('Verify reset code error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
};

// Update password
exports.updatePassword = async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;

    const [resetRecords] = await db.query(
      `SELECT * FROM password_resets 
       WHERE email = ? AND code = ? AND used = false AND expires_at > NOW()`,
      [email, code]
    );

    if (resetRecords.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid or expired code' 
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await db.query(
      'UPDATE users SET password_hash = ? WHERE email = ?',
      [hashedPassword, email]
    );

    await db.query(
      'UPDATE password_resets SET used = true WHERE id = ?',
      [resetRecords[0].id]
    );

    return res.status(200).json({ 
      success: true, 
      message: 'Password updated successfully' 
    });

  } catch (error) {
    console.error('Update password error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
};
