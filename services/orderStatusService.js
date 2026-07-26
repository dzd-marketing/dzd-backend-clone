const db = require('../config/db');

const SMM_PROXY_URL = 'https://api.dzd-marketing.site/api/proxy';
const WORKER_URL = process.env.WORKER_URL || 'https://dzd-billing-api.sitewasd2026.workers.dev';

// ─── Check if status is terminal ──────────────────────────────────────────
const isTerminalStatus = (status) => {
  const s = status?.toLowerCase() || '';
  return s.includes('completed') || s.includes('success') || s.includes('done') ||
         s.includes('cancel') || s.includes('refund') || s.includes('error') || s.includes('failed');
};

// ─── Process refund via Cloudflare Worker ────────────────────────────────
const processRefund = async (userId, amount, description) => {
  try {
    console.log('🔄 Processing refund - User:', userId, 'Amount:', amount);
    const response = await fetch(`${WORKER_URL}/add-balance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: userId,
        amount: amount,
        description: description
      })
    });
    const data = await response.json();
    return data.success;
  } catch (error) {
    console.error('Error processing refund:', error);
    return false;
  }
};

// ─── Update orders in bulk ────────────────────────────────────────────────
const updateBulkOrders = async (orderIds) => {
  try {
    const ordersParam = orderIds.join(',');
    
    const response = await fetch(SMM_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'premium',
        action: 'status',
        orders: ordersParam
      })
    });
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error updating bulk orders:', error);
    return null;
  }
};

// ─── Update all non-terminal orders ──────────────────────────────────────
const updateAllOrders = async () => {
  try {
    console.log('🔄 Running bulk order status update with refund logic...');
    
    const [orders] = await db.query(
      `SELECT order_id, user_id, provider, status, remains, start_count, charge, provider_charge, currency, quantity 
       FROM orders 
       WHERE provider = 'premium' 
       AND status NOT IN ('Completed', 'Success', 'Canceled', 'Refunded', 'Error', 'Failed')`
    );
    
    if (orders.length === 0) {
      console.log('✅ No orders to update');
      return { updated: 0, total: 0 };
    }
    
    const results = [];
    let updatedCount = 0;
    
    for (let i = 0; i < orders.length; i += 100) {
      const chunk = orders.slice(i, i + 100);
      const orderIds = chunk.map(o => o.order_id);
      
      console.log(`🔄 Updating chunk ${Math.floor(i/100) + 1}/${Math.ceil(orders.length/100)} (${orderIds.length} orders)`);
      
      const bulkData = await updateBulkOrders(orderIds);
      
      if (bulkData) {
        for (const [orderId, orderData] of Object.entries(bulkData)) {
          if (orderData.error) {
            console.warn(`⚠️ Order ${orderId}: ${orderData.error}`);
            continue;
          }
          
          // Find the original order in our chunk
          const originalOrder = chunk.find(o => o.order_id == orderId);
          if (!originalOrder) {
            console.warn(`⚠️ Order ${orderId} not found in chunk`);
            continue;
          }
          
          const prevStatus = originalOrder.status?.toLowerCase() || '';
          const nextStatus = orderData.status?.toLowerCase() || '';
          const statusChanged = prevStatus !== nextStatus;
          
          // Prepare update data
          const updateData = {
            status: orderData.status || 'Pending',
            remains: parseInt(orderData.remains) || 0,
            start_count: orderData.start_count || '0',
            provider_charge: parseFloat(orderData.charge) || 0
          };
          
          // Check if refund is needed
          let refundAmount = 0;
          let refundDescription = '';
          
          if (statusChanged) {
            // Check for cancellation
            if (nextStatus.includes('cancel') || nextStatus.includes('failed') || nextStatus.includes('error')) {
              // Full refund based on website charge (LKR)
              refundAmount = originalOrder.charge;
              refundDescription = `Full refund for Order #${orderId} (Canceled)`;
              console.log(`💰 Full refund for Order #${orderId}: LKR ${refundAmount}`);
            }
            // Check for partial delivery
            else if (nextStatus.includes('partial') && originalOrder.quantity > 0) {
              const remains = parseInt(orderData.remains) || 0;
              // Refund based on undelivered quantity using website charge (LKR)
              refundAmount = (remains / originalOrder.quantity) * originalOrder.charge;
              refundDescription = `Partial refund for Order #${orderId} (${remains} undelivered)`;
              console.log(`💰 Partial refund for Order #${orderId}: LKR ${refundAmount} (${remains}/${originalOrder.quantity} undelivered)`);
            }
          }
          
          // Process refund if needed
          if (refundAmount > 0) {
            const refunded = await processRefund(originalOrder.user_id, refundAmount, refundDescription);
            if (refunded) {
              console.log(`✅ Refund processed successfully for Order #${orderId}`);
              // Mark that refund was processed
              updateData.refunded_amount = refundAmount;
            } else {
              console.error(`❌ Failed to process refund for Order #${orderId}`);
            }
          }
          
          // Update the order in the database
          const queryParams = [
            updateData.status,
            updateData.remains,
            updateData.start_count,
            updateData.provider_charge,
            updateData.refunded_amount || 0,
            parseInt(orderId)
          ];
          
          await db.query(
            'UPDATE orders SET status = ?, remains = ?, start_count = ?, provider_charge = ?, refunded_amount = ?, updated_at = NOW() WHERE order_id = ?',
            queryParams
          );
          
          updatedCount++;
          results.push({ 
            order_id: parseInt(orderId), 
            status: updateData.status,
            refunded: refundAmount > 0,
            refundAmount: refundAmount
          });
        }
      }
      
      if (i + 100 < orders.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    console.log(`✅ Updated ${updatedCount} orders successfully`);
    console.log(`💰 Total refunded: LKR ${results.filter(r => r.refunded).reduce((sum, r) => sum + r.refundAmount, 0).toFixed(2)}`);
    return { updated: updatedCount, total: orders.length };
  } catch (error) {
    console.error('Error updating orders:', error);
    throw error;
  }
};

module.exports = {
  updateAllOrders,
  updateBulkOrders
};
