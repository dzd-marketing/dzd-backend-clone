const cron = require('node-cron');
const db = require('../config/db');

// ─── CONFIG ─────────────────────────────────────────────────────────────────
const PROVIDER_BALANCE_API = 'https://smmcheep.com/api/v2?key=e785f9e49139b1f3e6a5a1d98a09506c&action=balance';
const SMM_PROXY_URL = process.env.SMM_PROXY_URL || 'https://api.dzd-marketing.site/api/proxy';

// ─── HELPERS ─────────────────────────────────────────────────────────────────

// Get provider balance from external API
async function getProviderBalance() {
  try {
    const response = await fetch(PROVIDER_BALANCE_API);
    const data = await response.json();
    
    if (data && data.balance) {
      const balance = parseFloat(data.balance) || 0;
      console.log(`💰 Provider balance: $${balance.toFixed(4)} USD`);
      return balance;
    }
    throw new Error('Failed to get provider balance');
  } catch (error) {
    console.error('❌ Provider balance error:', error.message);
    return 0;
  }
}

// ─── PROCESS QUEUE ORDERS ──────────────────────────────────────────────────

async function processQueueOrders() {
  console.log('🔄 [Cron] Processing queue orders...', new Date().toISOString());
  
  try {
    // ─── STEP 1: Get provider balance from external API ──────────────
    const providerBalanceUSD = await getProviderBalance();
    
    if (providerBalanceUSD <= 0) {
      console.log('⚠️ Provider balance is zero or negative. Skipping queue processing.');
      return;
    }
    
    console.log(`💰 Provider balance: $${providerBalanceUSD.toFixed(4)} USD`);
    
    // ─── STEP 2: Get QUEUE orders ──────────────────────────────────
    const [queueOrders] = await db.query(
      `SELECT * FROM orders 
       WHERE status = 'queue' 
       ORDER BY created_at ASC 
       LIMIT 10`
    );
    
    if (queueOrders.length === 0) {
      console.log('✅ No queue orders to process');
      return;
    }
    
    console.log(`📦 Found ${queueOrders.length} queue orders to process`);
    
    // ─── STEP 3: Process each order ──────────────────────────────────
    let processedCount = 0;
    let remainingBalance = providerBalanceUSD;
    
    for (const order of queueOrders) {
      // Order charge is in LKR - need to check if we have enough USD
      // We need the exchange rate to convert LKR to USD
      // Since we don't have exchange rate, we check if balance > 0 and try to send
      // The API will reject if balance is insufficient
      
      console.log(`\n📋 Order #${order.orderId}: LKR ${parseFloat(order.charge || 0).toFixed(2)}`);
      console.log(`💰 Remaining balance: $${remainingBalance.toFixed(4)} USD`);
      
      // ─── STEP 4: Build API params ──────────────────────────────────
      const apiParams = {
        action: 'add',
        service: order.service_id,
        link: order.link,
        quantity: order.quantity.toString()
      };
      
      console.log(`📤 Sending order to API...`);
      
      try {
        // ─── STEP 5: Call Provider API ──────────────────────────────
        const response = await fetch(SMM_PROXY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: order.provider || 'premium',
            ...apiParams
          })
        });
        
        const data = await response.json();
        console.log(`📥 API Response:`, JSON.stringify(data));
        
        // ─── STEP 6: Handle API Response ─────────────────────────────
        if (data && data.order) {
          // ✅ SUCCESS - Update order with real ID
          const realOrderId = data.order;
          
          await db.query(
            `UPDATE orders 
             SET order_id = ?,
                 status = 'pending',
                 updated_at = NOW() 
             WHERE order_id = ? AND status = 'queue'`,
            [realOrderId, order.orderId]
          );
          
          processedCount++;
          console.log(`✅ Order ${order.orderId} processed. New ID: ${realOrderId}`);
          
          // Note: Provider balance is deducted automatically by the provider
          // We don't need to update it manually
          
        } else if (data?.error) {
          // ❌ API ERROR
          const errorMsg = data.error.toLowerCase();
          
          if (errorMsg.includes('not enough funds') || errorMsg.includes('balance')) {
            // Balance error - keep as QUEUE, will retry later
            await db.query(
              `UPDATE orders 
               SET updated_at = NOW() 
               WHERE order_id = ?`,
              [order.orderId]
            );
            console.log(`⏳ Order ${order.orderId} - Insufficient balance, will retry later`);
            
            // Stop processing - no more balance
            break;
            
          } else {
            // Other error - mark as FAILED
            await db.query(
              `UPDATE orders 
               SET status = 'failed',
                   updated_at = NOW() 
               WHERE order_id = ?`,
              [order.orderId]
            );
            console.log(`❌ Order ${order.orderId} failed: ${data.error}`);
          }
          
        } else {
          // Unknown response
          await db.query(
            `UPDATE orders 
             SET updated_at = NOW() 
             WHERE order_id = ?`,
            [order.orderId]
          );
          console.log(`⚠️ Order ${order.orderId} - Unknown API response`);
        }
        
      } catch (error) {
        console.error(`❌ Error processing order ${order.orderId}:`, error.message);
        // Keep as QUEUE, will retry later
        await db.query(
          `UPDATE orders 
           SET updated_at = NOW() 
           WHERE order_id = ?`,
          [order.orderId]
        );
      }
    }
    
    console.log(`✅ [Cron] Processed ${processedCount} queue orders`);
    
  } catch (error) {
    console.error('❌ [Cron] Error:', error.message);
  }
}

// ─── SCHEDULE CRON JOB ────────────────────────────────────────────────────

// Run every 10 minutes
cron.schedule('*/10 * * * *', () => {
  processQueueOrders();
});

console.log('⏰ Queue processor cron job started (runs every 10 minutes)');

// ─── EXPORT FOR MANUAL EXECUTION ─────────────────────────────────────────

module.exports = { processQueueOrders };
