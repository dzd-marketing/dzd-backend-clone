const db = require('../config/db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const dotenv = require('dotenv');
const path = require('path');

// Load .env file explicitly
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const JWT_SECRET = process.env.JWT_SECRET;

const DEFAULT_AVATAR = 'https://res.cloudinary.com/dbn1nlna6/image/upload/v1779656836/man_xkxvar.png';

// ── Get user profile ─────────────────────────────────────────────────────────
exports.getProfile = async (req, res) => {
  try {
    const { uid } = req.user;

    const [users] = await db.query(
      'SELECT uid, email, username, full_name, photo_url, onboarded, is_reseller, has_api_key, api_key, api_key_created_at, api_key_expires_at, created_at FROM users WHERE uid = ?',
      [uid]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];
    res.json({
      uid: user.uid,
      email: user.email,
      username: user.username,
      fullName: user.full_name,
      photoURL: user.photo_url || DEFAULT_AVATAR,
      onboarded: user.onboarded === 1,
      isReseller: user.is_reseller === 1,
      hasApiKey: user.has_api_key === 1,
      apiKey: user.api_key,
      apiKeyCreatedAt: user.api_key_created_at,
      apiKeyExpiresAt: user.api_key_expires_at,
      createdAt: user.created_at
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// ── Update profile ──────────────────────────────────────────────────────────
exports.updateProfile = async (req, res) => {
  try {
    const { uid } = req.user;
    const { fullName, username, newPassword } = req.body;

    const updates = [];
    const values = [];

    if (fullName !== undefined) {
      updates.push('full_name = ?');
      values.push(fullName);
    }
    if (username !== undefined) {
      const [existing] = await db.query(
        'SELECT id FROM users WHERE username = ? AND uid != ?',
        [username, uid]
      );
      if (existing.length > 0) {
        return res.status(400).json({ error: 'Username already taken' });
      }
      updates.push('username = ?');
      values.push(username);
    }
    if (newPassword !== undefined && newPassword.length > 0) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(newPassword, salt);
      updates.push('password_hash = ?');
      values.push(hashedPassword);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(uid);

    await db.query(
      `UPDATE users SET ${updates.join(', ')} WHERE uid = ?`,
      values
    );

    res.json({ 
      success: true, 
      message: 'Profile updated successfully' 
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// ── Upload profile photo ────────────────────────────────────────────────────
exports.uploadPhoto = async (req, res) => {
  // Disable photo uploads
  return res.status(403).json({ error: 'Profile photo uploads are disabled' });
};

// ── Generate API key ──────────────────────────────────────────────────────
exports.generateApiKey = async (req, res) => {
  try {
    const { uid } = req.user;

    const [users] = await db.query(
      'SELECT has_api_key FROM users WHERE uid = ?',
      [uid]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (users[0].has_api_key === 1) {
      return res.status(400).json({ error: 'API key already exists' });
    }

    const apiKey = crypto.randomBytes(8).toString('hex');
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

    await db.query(
      'UPDATE users SET api_key = ?, api_key_created_at = NOW(), api_key_expires_at = ?, has_api_key = 1, is_reseller = 1 WHERE uid = ?',
      [apiKey, expiresAt, uid]
    );

    res.json({
      success: true,
      message: 'API key generated successfully',
      apiKey,
      expiresAt: expiresAt.toISOString(),
      createdAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Generate API key error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// ── Get API key ────────────────────────────────────────────────────────────
exports.getApiKey = async (req, res) => {
  try {
    const { uid } = req.user;

    const [users] = await db.query(
      'SELECT api_key, api_key_created_at, api_key_expires_at FROM users WHERE uid = ? AND has_api_key = 1',
      [uid]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'No API key found' });
    }

    res.json({
      apiKey: users[0].api_key,
      createdAt: users[0].api_key_created_at,
      expiresAt: users[0].api_key_expires_at
    });
  } catch (error) {
    console.error('Get API key error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// ── Change Password ────────────────────────────────────────────────────────
exports.changePassword = async (req, res) => {
  try {
    const { uid } = req.user;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Get user's current password hash
    const [users] = await db.query(
      'SELECT password_hash FROM users WHERE uid = ?',
      [uid]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password
    const isValid = await bcrypt.compare(currentPassword, users[0].password_hash);
    if (!isValid) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Update password
    await db.query(
      'UPDATE users SET password_hash = ? WHERE uid = ?',
      [hashedPassword, uid]
    );

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// ── Revoke API key ─────────────────────────────────────────────────────────
exports.revokeApiKey = async (req, res) => {
  try {
    const { uid } = req.user;

    await db.query(
      'UPDATE users SET api_key = NULL, api_key_created_at = NULL, api_key_expires_at = NULL, has_api_key = 0, is_reseller = 0 WHERE uid = ?',
      [uid]
    );

    res.json({
      success: true,
      message: 'API key revoked successfully'
    });
  } catch (error) {
    console.error('Revoke API key error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};
