const admin = require('firebase-admin');
const mysql = require('mysql2');
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

// Helper function to convert Firestore timestamp to MySQL datetime
function toMySQLDate(timestamp) {
  if (!timestamp) return null;
  
  try {
    // If it's a Firestore timestamp
    if (timestamp && timestamp.toDate) {
      const date = timestamp.toDate();
      return date.toISOString().slice(0, 19).replace('T', ' ');
    }
    
    // If it's a string
    if (typeof timestamp === 'string') {
      const date = new Date(timestamp);
      if (!isNaN(date.getTime())) {
        return date.toISOString().slice(0, 19).replace('T', ' ');
      }
    }
    
    return null;
  } catch (error) {
    console.error('Date conversion error:', error);
    return null;
  }
}

async function migrateOrders() {
  console.log('Starting Firestore orders to MySQL migration...');
  
  try {
    // Get all orders from Firestore
    const ordersSnapshot = await db.collection('orders').get();
    
    if (ordersSnapshot.empty) {
      console.log('No orders found in Firestore');
      return;
    }
    
    let migratedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    for (const doc of ordersSnapshot.docs) {
      const orderData = doc.data();
      const docId = doc.id;
      
      console.log(`Processing order: ${docId}`);
      
      // Check if order already exists in MySQL
      const [existing] = await promisePool.query(
        'SELECT id FROM orders WHERE order_id = ?',
        [orderData.orderId]
      );
      
      if (existing.length > 0) {
        console.log(`Order ${orderData.orderId} already exists in MySQL, skipping...`);
        skippedCount++;
        continue;
      }
      
      // Prepare order data
      const orderId = orderData.orderId || 0;
      const userId = orderData.userId || '';
      const serviceId = orderData.serviceId || '';
      const serviceName = orderData.serviceName || '';
      const provider = orderData.provider || '';
      const quantity = orderData.quantity || 0;
      const charge = parseFloat(orderData.charge) || 0.00;
      const currency = orderData.currency || 'USD';
      const link = orderData.link || '';
      const startCount = orderData.start_count || '';
      const remains = orderData.remains || '';
      const status = orderData.status || 'Pending';
      
      // Convert dates
      const createdAt = toMySQLDate(orderData.createdAt);
      const updatedAt = toMySQLDate(orderData.updatedAt);
      
      // Insert into MySQL
      await promisePool.query(
        `INSERT INTO orders (order_id, user_id, service_id, service_name, provider, quantity, charge, currency, link, start_count, remains, status, created_at, updated_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [orderId, userId, serviceId, serviceName, provider, quantity, charge, currency, link, startCount, remains, status, createdAt, updatedAt]
      );
      
      migratedCount++;
      console.log(`✅ Migrated order: ${orderId} for user: ${userId}`);
    }
    
    console.log('\n=== Migration Complete ===');
    console.log(`Total orders in Firestore: ${ordersSnapshot.size}`);
    console.log(`Migrated: ${migratedCount}`);
    console.log(`Skipped (already exist): ${skippedCount}`);
    console.log(`Errors: ${errorCount}`);
    
    // Close connections
    await promisePool.end();
    process.exit(0);
    
  } catch (error) {
    console.error('Migration error:', error);
    process.exit(1);
  }
}

migrateOrders();
