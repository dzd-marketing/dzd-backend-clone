const admin = require('firebase-admin');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const serviceAccount = require('./firebase-service-account.json');

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// MySQL connection
const mysqlPool = mysql.createPool({
  host: 'localhost',
  user: 'dzd-user',
  password: '12345',
  database: 'dzd_marketing',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

const promisePool = mysqlPool.promise();

// Helper function to convert ISO date to MySQL datetime format
function toMySQLDate(isoDate) {
  if (!isoDate) return null;
  
  try {
    const date = new Date(isoDate);
    if (isNaN(date.getTime())) return null;
    
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  } catch (error) {
    console.error('Date conversion error:', error);
    return null;
  }
}

async function migrateUsers() {
  console.log('Starting Firestore to MySQL migration (with WhatsApp data)...');
  
  try {
    // Get all users from Firestore
    const usersSnapshot = await db.collection('users').get();
    
    if (usersSnapshot.empty) {
      console.log('No users found in Firestore');
      return;
    }
    
    let newUsersCount = 0;
    let updatedUsersCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    for (const doc of usersSnapshot.docs) {
      const userData = doc.data();
      const uid = doc.id;
      
      console.log(`Processing user: ${userData.email || uid}`);
      
      // Prepare WhatsApp data
      const whatsappCountry = userData.whatsappCountry || null;
      const whatsappName = userData.whatsappName || null;
      const whatsappNumber = userData.whatsappNumber || null;
      
      // Check if user already exists in MySQL by email or uid
      const [existing] = await promisePool.query(
        'SELECT id FROM users WHERE email = ? OR uid = ?',
        [userData.email || '', uid]
      );
      
      if (existing.length > 0) {
        // User exists - update WhatsApp fields
        const userId = existing[0].id;
        
        // Check if WhatsApp fields need updating
        const [currentData] = await promisePool.query(
          'SELECT whatsapp_country, whatsapp_name, whatsapp_number FROM users WHERE id = ?',
          [userId]
        );
        
        const currentWhatsApp = currentData[0];
        
        // Only update if there's WhatsApp data in Firestore
        if (whatsappNumber) {
          await promisePool.query(
            `UPDATE users SET whatsapp_country = ?, whatsapp_name = ?, whatsapp_number = ? WHERE id = ?`,
            [whatsappCountry, whatsappName, whatsappNumber, userId]
          );
          updatedUsersCount++;
          console.log(`  ✅ Updated WhatsApp for user: ${userData.email || uid}`);
        } else {
          skippedCount++;
          console.log(`  ⏭️ No WhatsApp data for user: ${userData.email || uid}`);
        }
        continue;
      }
      
      // --- NEW USER (only if not existing) ---
      
      // Generate a random password for Firestore users
      const randomPassword = require('crypto').randomBytes(16).toString('hex');
      const hashedPassword = await bcrypt.hash(randomPassword, 10);
      
      // Prepare user data
      const fullName = userData.fullName || userData.name || userData.displayName || userData.email?.split('@')[0] || '';
      const username = userData.username || userData.email?.split('@')[0] || `user_${uid.slice(0, 6)}`;
      const email = userData.email || '';
      const onboarded = userData.onboarded || false;
      const photoURL = userData.photoURL || userData.photoUrl || null;
      const provider = userData.provider || 'email';
      
      // Convert dates to MySQL format
      const createdAt = toMySQLDate(userData.createdAt || userData.created_at || new Date().toISOString());
      const lastLogin = toMySQLDate(userData.lastLogin || userData.lastLoginAt || null);
      
      // Insert into MySQL
      await promisePool.query(
        `INSERT INTO users (uid, email, username, full_name, password_hash, photo_url, provider, onboarded, created_at, last_login, whatsapp_country, whatsapp_name, whatsapp_number) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [uid, email, username, fullName, hashedPassword, photoURL, provider, onboarded ? 1 : 0, createdAt, lastLogin, whatsappCountry, whatsappName, whatsappNumber]
      );
      
      newUsersCount++;
      console.log(`  ✅ New user created: ${email || uid}`);
    }
    
    console.log('\n=== Migration Complete ===');
    console.log(`Total users in Firestore: ${usersSnapshot.size}`);
    console.log(`New users added: ${newUsersCount}`);
    console.log(`Users updated with WhatsApp data: ${updatedUsersCount}`);
    console.log(`Users skipped (no WhatsApp data): ${skippedCount}`);
    console.log(`Errors: ${errorCount}`);
    
    // Close connections
    await promisePool.end();
    process.exit(0);
    
  } catch (error) {
    console.error('Migration error:', error);
    process.exit(1);
  }
}

migrateUsers();
