const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { OAuth2Client } = require('google-auth-library');
const dotenv = require('dotenv');
const path = require('path');

// Load .env file explicitly
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const JWT_SECRET = process.env.JWT_SECRET;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

// Initialize Google OAuth client with both client ID and secret
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, 'postmessage');

// ========== GOOGLE AUTH ==========
exports.googleAuth = async (req, res) => {
    try {
        const { idToken } = req.body;
        
        if (!idToken) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing idToken' 
            });
        }

        const { OAuth2Client } = require('google-auth-library');
        const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

        const ticket = await client.verifyIdToken({
            idToken: idToken,
            audience: process.env.GOOGLE_CLIENT_ID,
        });

        const payload = ticket.getPayload();
        const { email, name, picture, sub: googleId } = payload;

        if (!email) {
            return res.status(400).json({ 
                success: false, 
                error: 'Email not provided by Google' 
            });
        }

        // Check if user exists
        const [existingUsers] = await db.query(
            'SELECT * FROM users WHERE email = ?',
            [email]
        );

        let user;
        let isNewUser = false;

        if (existingUsers.length > 0) {
            // User exists - login
            user = existingUsers[0];
            
            if (!user.google_id) {
                await db.query(
                    'UPDATE users SET google_id = ?, provider = "google", last_login = NOW() WHERE id = ?',
                    [googleId, user.id]
                );
            } else {
                await db.query(
                    'UPDATE users SET last_login = NOW() WHERE id = ?',
                    [user.id]
                );
            }
        } else {
            // New user - create account
            isNewUser = true;
            const { v4: uuidv4 } = require('uuid');
            const uid = uuidv4();
            const username = email.split('@')[0] + '_' + Math.random().toString(36).substring(2, 6);
            const fullName = name || username;

            // ✅ භාවිතා කරන පද්ධතියට ගැළපෙන පරිදි 'N/A' ලෙස hash කිරීම
            // මෙය මගින් Database constraint එකෙන් බේරීමට හැකි වේ
            const hashedPassword = await bcrypt.hash('N/A', 10);

            // ✅ INSERT with hashed 'N/A' password
            const [result] = await db.query(
                `INSERT INTO users (uid, email, username, full_name, provider, google_id, profile_picture, onboarded, status, password_hash) 
                 VALUES (?, ?, ?, ?, 'google', ?, ?, ?, 'active', ?)`,
                [uid, email, username, fullName, googleId, picture || null, 0, hashedPassword]
            );

            user = {
                id: result.insertId,
                uid,
                email,
                username,
                full_name: fullName,
                onboarded: 0,
                is_reseller: 0
            };
        }

        const token = jwt.sign(
            { id: user.id, uid: user.uid, email: user.email, username: user.username },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            message: isNewUser ? 'Account created with Google' : 'Login successful',
            user: {
                uid: user.uid,
                email: user.email,
                username: user.username,
                fullName: user.full_name || user.fullName,
                onboarded: user.onboarded === 1,
                isReseller: user.is_reseller === 1,
                photoURL: picture || null
            },
            token,
            isNewUser
        });

    } catch (error) {
        console.error('Google Auth Error:', error.message);
        res.status(500).json({ 
            success: false, 
            error: 'Server error during Google authentication',
            details: error.message 
        });
    }
};
// Signup
exports.signup = async (req, res) => {
  try {
    const { email, username, fullName, password } = req.body;

    const [existingUsers] = await db.query(
      'SELECT id FROM users WHERE email = ? OR username = ?',
      [email, username]
    );

    if (existingUsers.length > 0) {
      return res.status(400).json({ 
        error: 'auth/email-already-in-use',
        message: 'This email or username is already registered' 
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const uid = uuidv4();

    const [result] = await db.query(
      `INSERT INTO users (uid, email, username, full_name, password_hash, onboarded, provider) 
       VALUES (?, ?, ?, ?, ?, ?, 'email')`,
      [uid, email, username, fullName, hashedPassword, false]
    );

    const token = jwt.sign(
      { id: result.insertId, uid, email, username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      user: { uid, email, username, fullName, onboarded: false },
      token
    });

  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ success: false, error: 'Server error during signup' });
  }
};

// Login
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const [users] = await db.query(
      'SELECT * FROM users WHERE email = ? AND status = "active"',
      [email]
    );

    if (users.length === 0) {
      return res.status(401).json({ 
        error: 'auth/invalid-credential',
        message: 'Invalid email or password' 
      });
    }

    const user = users[0];

    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ 
        error: 'auth/invalid-credential',
        message: 'Invalid email or password' 
      });
    }

    await db.query(
      'UPDATE users SET last_login = NOW() WHERE id = ?',
      [user.id]
    );

    const token = jwt.sign(
      { id: user.id, uid: user.uid, email: user.email, username: user.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      message: 'Login successful',
      user: {
        uid: user.uid,
        email: user.email,
        username: user.username,
        fullName: user.full_name,
        onboarded: user.onboarded === 1,
        isReseller: user.is_reseller === 1,
        hasApiKey: user.api_key ? true : false
      },
      token
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: 'Server error during login' });
  }
};

// Google OAuth Login
exports.googleLogin = async (req, res) => {
  try {
    const { code, redirect_uri } = req.body;

    // Exchange code for tokens using both client ID and secret
    const { tokens } = await googleClient.getToken({
      code,
      redirect_uri: redirect_uri || 'postmessage'
    });

    // Verify the ID token
    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const { email, name, sub: googleId, picture } = payload;

    // Check if user already exists with this email
    const [existingUsers] = await db.query(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );

    let user;
    let uid;

    if (existingUsers.length > 0) {
      // User exists - update Google ID if not set
      user = existingUsers[0];
      uid = user.uid;

      if (!user.google_id) {
        await db.query(
          'UPDATE users SET google_id = ?, provider = "google", profile_picture = ?, last_login = NOW() WHERE id = ?',
          [googleId, picture, user.id]
        );
      } else {
        await db.query(
          'UPDATE users SET last_login = NOW() WHERE id = ?',
          [user.id]
        );
      }
    } else {
      // Create new user
      uid = uuidv4();
      const username = email.split('@')[0] + '_' + Math.floor(Math.random() * 1000);

      const [result] = await db.query(
        `INSERT INTO users (uid, email, username, full_name, provider, google_id, profile_picture, onboarded, status) 
         VALUES (?, ?, ?, ?, 'google', ?, ?, true, 'active')`,
        [uid, email, username, name, googleId, picture]
      );

      user = {
        id: result.insertId,
        uid,
        email,
        username,
        full_name: name,
        onboarded: true,
        provider: 'google'
      };
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, uid: user.uid, email: user.email, username: user.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      message: 'Google login successful',
      user: {
        uid: user.uid,
        email: user.email,
        username: user.username,
        fullName: user.full_name,
        profilePicture: picture,
        onboarded: user.onboarded === 1,
        isReseller: user.is_reseller === 1,
        hasApiKey: user.api_key ? true : false,
        provider: 'google'
      },
      token
    });

  } catch (error) {
    console.error('Google login error:', error);
    res.status(500).json({
      success: false,
      error: 'Google authentication failed',
      message: error.message
    });
  }
};
