const cron = require('node-cron');
const db = require('../config/db');

// ─── CONFIG ─────────────────────────────────────────────────────────────────
const PROVIDER_BALANCE_API = 'https://smmcheep.com/api/v2?key=e785f9e49139b1f3e6a5a1d98a09506c&action=balance';
const EXCHANGE_API = 'https://v6.exchangerate-api.com/v6/be291495375008a1e603a49a/latest/USD';
const SMM_PROXY_URL = process.env.SMM_PROXY_URL || 'https://api.dzd-marketing.site/api/proxy';

// ─── HELPERS ─────────────────────────────────────────────────────────────────

// Get USD to LKR exchange rate
async function getExchangeRate() {
  try {
    const response = await fetch(EXCHANGE_API);
    const data = await response.json();
    
    if (data.result === 'success' && data.conversion_rates?.LKR) {
      const rate = parseFloat(data.conversion_rates.LKR);
      console.log(`💱 Exchange rate: 1 USD = ${rate} LKR`);
      return rate;
    }
    throw new Error('Failed to get exchange rate');
  } catch (error) {
    console.error('❌ Exchange rate error:', error.message);
    // Return cached rate or default
    return 330; // Default fallback
  }
}

// Get provider balance from external API (in USD)
async function getProviderBalanceUSD() {
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
    // ─── STEP 1: Get exchange rate ──────────────────────────────────
    const exchangeRate = await getExchangeRate();
    
    // ─── STEP 2: Get provider balance (USD) and convert to LKR ──────
    const providerBalanceUSD = await getProviderBalanceUSD();
    
    if (providerBalanceUSD <= 0) {
      console.log('⚠️ Provider balance is zero or negative. Skipping queue processing.');
      return;
    }
    
    const providerBalanceLKR = providerBalanceUSD * exchangeRate;
    console.log(`💰 Provider balance: $${providerBalanceUSD.toFixed(4)} USD = LKR ${providerBalanceLKR.toFixed(2)}`);
    
    // ─── STEP 3: Get QUEUE orders ──────────────────────────────────
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
    
    // ─── STEP 4: Process each order ──────────────────────────────────
    let processedCount = 0;
    let remainingBalanceLKR = providerBalanceLKR;
    let remainingBalanceUSD = providerBalanceUSD;
    
    for (const order of queueOrders) {
      const orderId = order.order_id;
      const orderChargeLKR = parseFloat(order.charge || 0);
      const orderChargeUSD = orderChargeLKR / exchangeRate;
      
      console.log(`\n📋 Order #${orderId}:`);
      console.log(`   Order Charge: LKR ${orderChargeLKR.toFixed(2)} ($${orderChargeUSD.toFixed(4)} USD)`);
      console.log(`   Remaining Balance: LKR ${remainingBalanceLKR.toFixed(2)} ($${remainingBalanceUSD.toFixed(4)} USD)`);
      
      // ─── STEP 5: Check if provider has enough balance ──────────────
      if (remainingBalanceLKR < orderChargeLKR) {
        console.log(`⚠️ Insufficient balance! Need LKR ${orderChargeLKR.toFixed(2)}, have LKR ${remainingBalanceLKR.toFixed(2)}`);
        console.log(`⏳ Order ${orderId} - Will retry later`);
        
        // Update updated_at to track retry
        await db.query(
          `UPDATE orders 
           SET updated_at = NOW() 
           WHERE order_id = ? AND status = 'queue'`,
          [orderId]
        );
        
        // Stop processing more orders (sorted by oldest first)
        break;
      }
      
      // ─── STEP 6: Build API params ──────────────────────────────────
      const apiParams = {
        action: 'add',
        service: order.service_id,
        link: order.link,
        quantity: order.quantity.toString()
      };
      
      console.log(`📤 Sending order to API...`);
      
      try {
        // ─── STEP 7: Call Provider API ──────────────────────────────
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
        
        // ─── STEP 8: Handle API Response ─────────────────────────────
        if (data && data.order) {
          // ✅ SUCCESS - Update order with real ID
          const realOrderId = data.order;
          
          await db.query(
            `UPDATE orders 
             SET order_id = ?,
                 status = 'pending',
                 provider_charge = ?,
                 updated_at = NOW() 
             WHERE order_id = ? AND status = 'queue'`,
            [realOrderId, orderChargeUSD.toFixed(4), orderId]
          );
          
          // ✅ Deduct order charge from remaining balance
          remainingBalanceLKR -= orderChargeLKR;
          remainingBalanceUSD -= orderChargeUSD;
          
          processedCount++;
          console.log(`✅ Order ${orderId} processed successfully!`);
          console.log(`   New Order ID: ${realOrderId}`);
          console.log(`   Provider Charge: $${orderChargeUSD.toFixed(4)} USD`);
          console.log(`   Remaining Balance: LKR ${remainingBalanceLKR.toFixed(2)} ($${remainingBalanceUSD.toFixed(4)} USD)`);
          
        } else if (data?.error) {
          // ❌ API ERROR
          const errorMsg = data.error.toLowerCase();
          
          if (errorMsg.includes('not enough funds') || errorMsg.includes('balance')) {
            // Balance error - keep as QUEUE, will retry later
            await db.query(
              `UPDATE orders 
               SET updated_at = NOW() 
               WHERE order_id = ? AND status = 'queue'`,
              [orderId]
            );
            console.log(`⏳ Order ${orderId} - Insufficient balance, will retry later`);
            
            // Stop processing - no more balance
            break;
            
          } else {
            // Other error - mark as FAILED
            await db.query(
              `UPDATE orders 
               SET status = 'failed',
                   updated_at = NOW() 
               WHERE order_id = ? AND status = 'queue'`,
              [orderId]
            );
            console.log(`❌ Order ${orderId} failed: ${data.error}`);
          }
          
        } else {
          // Unknown response
          await db.query(
            `UPDATE orders 
             SET updated_at = NOW() 
             WHERE order_id = ? AND status = 'queue'`,
            [orderId]
          );
          console.log(`⚠️ Order ${orderId} - Unknown API response`);
        }
        
      } catch (error) {
        console.error(`❌ Error processing order ${orderId}:`, error.message);
        // Keep as QUEUE, will retry later
        await db.query(
          `UPDATE orders 
           SET updated_at = NOW() 
           WHERE order_id = ? AND status = 'queue'`,
          [orderId]
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
