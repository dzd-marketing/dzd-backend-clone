const db = require('../config/db');

// ================================================================
// ===== ADD ORDER TO QUEUE =====
// ================================================================
async function addOrderToQueue(orderData) {
    try {
        const {
            order_id,
            user_id,
            service_id,
            service_name,
            link,
            quantity,
            charge,
            provider_charge,
            provider = 'premium',
            currency = 'LKR'
        } = orderData;

        console.log(`📥 Adding order ${order_id} to queue...`);

        // Check if already in queue
        const [existing] = await db.query(
            'SELECT id FROM order_queue WHERE order_id = ?',
            [order_id]
        );

        if (existing.length > 0) {
            console.log(`⚠️ Order ${order_id} already in queue`);
            return { success: false, message: 'Order already in queue' };
        }

        await db.query(
            `INSERT INTO order_queue 
             (order_id, user_id, service_id, service_name, link, quantity, charge, provider_charge, provider, currency, status, created_at) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW())`,
            [order_id, user_id, service_id, service_name, link, quantity, charge, provider_charge, provider, currency]
        );

        console.log(`✅ Order ${order_id} added to queue successfully`);
        return { success: true };

    } catch (error) {
        console.error('❌ Error adding order to queue:', error);
        return { success: false, message: error.message };
    }
}

// ================================================================
// ===== CREATE ORDER - WITH BALANCE DEDUCT FOR QUEUED ORDERS =====
// ================================================================
exports.createOrder = async (req, res) => {
    try {
        const { 
            userId, 
            orderId, 
            serviceId, 
            serviceName, 
            provider, 
            quantity, 
            charge, 
            currency, 
            link, 
            start_count, 
            remains, 
            status 
        } = req.body;

        console.log(`📦 Creating order: ${orderId} for user ${userId}`);

        // Check if order already exists
        const [existing] = await db.query(
            'SELECT id FROM orders WHERE order_id = ?',
            [orderId]
        );

        if (existing.length > 0) {
            return res.status(400).json({ error: 'Order already exists' });
        }

        // Calculate provider charge (80% of customer charge)
        const providerCharge = parseFloat(charge) * 0.8;
        const userCharge = parseFloat(charge);

        // ===== DEDUCT USER BALANCE FIRST =====
        const [userResult] = await db.query(
            'SELECT balance FROM users WHERE id = ?',
            [userId]
        );

        if (!userResult.length) {
            return res.status(404).json({ error: 'User not found' });
        }

        const currentBalance = parseFloat(userResult[0].balance) || 0;

        if (currentBalance < userCharge) {
            return res.status(400).json({ 
                error: 'Insufficient balance',
                currentBalance: currentBalance,
                required: userCharge
            });
        }

        // Deduct balance from user
        const newBalance = currentBalance - userCharge;
        await db.query(
            'UPDATE users SET balance = ? WHERE id = ?',
            [newBalance, userId]
        );

        console.log(`💰 User balance deducted: ${currentBalance} -> ${newBalance}`);

        // ===== TRY TO PROCESS ORDER DIRECTLY =====
        console.log(`📤 Processing order directly...`);

        try {
            const params = {
                action: 'add',
                service: serviceId,
                link: link,
                quantity: quantity || '0'
            };

            console.log(`📤 Sending to provider API:`, params);

            const proxyResponse = await fetch('https://api.dzd-marketing.site/api/proxy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider: provider || 'premium', ...params })
            });

            const proxyData = await proxyResponse.json();
            console.log(`📥 Provider API response:`, proxyData);

            // ===== CHECK FOR NOT ENOUGH FUNDS ERROR =====
            if (proxyData.error) {
                const errorMsg = proxyData.error.toLowerCase();
                
                // If error is about insufficient funds, queue the order
                if (errorMsg.includes('not enough funds') || 
                    errorMsg.includes('insufficient') || 
                    errorMsg.includes('balance') ||
                    errorMsg.includes('fund')) {
                    
                    console.log(`⚠️ Provider API says: "${proxyData.error}". Adding to queue...`);
                    
                    await addOrderToQueue({
                        order_id: orderId,
                        user_id: userId,
                        service_id: serviceId,
                        service_name: serviceName,
                        link: link,
                        quantity: quantity,
                        charge: userCharge,
                        provider_charge: providerCharge,
                        provider: provider || 'premium',
                        currency: currency || 'LKR'
                    });

                    await db.query(
                        `INSERT INTO orders 
                         (order_id, user_id, service_id, service_name, provider, quantity, charge, provider_charge, currency, link, start_count, remains, status, is_api_order, is_queued) 
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [orderId, userId, serviceId, serviceName, provider || 'premium', quantity, userCharge, providerCharge, currency, link, start_count || '0', remains || quantity, 'Queued', 1, 1]
                    );

                    return res.status(201).json({
                        success: true,
                        message: 'Order queued due to insufficient provider funds. Balance deducted.',
                        orderId: orderId,
                        status: 'queued',
                        balanceAfter: newBalance
                    });
                }

                // Other errors - refund the user
                console.error(`❌ Provider API error:`, proxyData.error);
                
                await db.query(
                    'UPDATE users SET balance = ? WHERE id = ?',
                    [currentBalance, userId]
                );
                
                return res.status(400).json({
                    error: proxyData.error,
                    details: proxyData,
                    refunded: true
                });
            }

            // ===== ORDER SUCCESSFUL =====
            if (proxyData && proxyData.order) {
                const providerOrderId = proxyData.order;
                
                await db.query(
                    `INSERT INTO orders 
                     (order_id, user_id, service_id, service_name, provider, quantity, charge, provider_charge, currency, link, start_count, remains, status, is_api_order, provider_order_id) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [orderId, userId, serviceId, serviceName, provider || 'premium', quantity, userCharge, providerCharge, currency, link, start_count || '0', remains || quantity, 'Processing', 1, providerOrderId]
                );

                return res.status(201).json({
                    success: true,
                    message: 'Order created and processing',
                    orderId: orderId,
                    providerOrderId: providerOrderId,
                    status: 'processing',
                    balanceAfter: newBalance
                });
            }

            // Unexpected response - refund the user
            console.error(`❌ Unexpected API response:`, proxyData);
            
            await db.query(
                'UPDATE users SET balance = ? WHERE id = ?',
                [currentBalance, userId]
            );
            
            return res.status(400).json({
                error: 'Unexpected API response',
                details: proxyData,
                refunded: true
            });

        } catch (apiError) {
            console.error(`❌ Provider API call failed:`, apiError.message);
            
            // If API call fails, queue the order (balance already deducted)
            await addOrderToQueue({
                order_id: orderId,
                user_id: userId,
                service_id: serviceId,
                service_name: serviceName,
                link: link,
                quantity: quantity,
                charge: userCharge,
                provider_charge: providerCharge,
                provider: provider || 'premium',
                currency: currency || 'LKR'
            });

            await db.query(
                `INSERT INTO orders 
                 (order_id, user_id, service_id, service_name, provider, quantity, charge, provider_charge, currency, link, start_count, remains, status, is_api_order, is_queued) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [orderId, userId, serviceId, serviceName, provider || 'premium', quantity, userCharge, providerCharge, currency, link, start_count || '0', remains || quantity, 'Queued', 1, 1]
            );

            return res.status(201).json({
                success: true,
                message: 'Order queued due to API error. Balance deducted.',
                orderId: orderId,
                status: 'queued',
                balanceAfter: newBalance
            });
        }

    } catch (error) {
        console.error('❌ Error creating order:', error);
        res.status(500).json({ error: 'Failed to create order: ' + error.message });
    }
};

// ================================================================
// ===== PROCESS QUEUED ORDERS =====
// ================================================================
exports.processQueuedOrders = async (req, res) => {
    try {
        console.log(`🔄 Processing queued orders...`);

        const [queuedOrders] = await db.query(
            `SELECT * FROM order_queue WHERE status = 'pending' ORDER BY created_at ASC`
        );

        if (queuedOrders.length === 0) {
            return res.json({
                success: true,
                message: 'No queued orders to process',
                processed: 0
            });
        }

        console.log(`📦 Found ${queuedOrders.length} queued orders`);

        let processed = 0;
        let failed = 0;
        const results = [];

        for (const order of queuedOrders) {
            console.log(`✅ Processing order ${order.order_id}...`);

            try {
                const params = {
                    action: 'add',
                    service: order.service_id,
                    link: order.link,
                    quantity: order.quantity || '0'
                };

                console.log(`📤 Processing order ${order.order_id}:`, params);

                const proxyResponse = await fetch('https://api.dzd-marketing.site/api/proxy', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ provider: order.provider || 'premium', ...params })
                });

                const proxyData = await proxyResponse.json();
                console.log(`📥 Response for ${order.order_id}:`, proxyData);

                if (proxyData.error) {
                    const errorMsg = proxyData.error.toLowerCase();
                    
                    if (errorMsg.includes('not enough funds') || 
                        errorMsg.includes('insufficient') || 
                        errorMsg.includes('balance') ||
                        errorMsg.includes('fund')) {
                        
                        console.log(`⏳ Order ${order.order_id} still has insufficient funds. Keeping in queue.`);
                        
                        await db.query(
                            `UPDATE order_queue 
                             SET error_message = ?, last_attempt = NOW(), attempt_count = attempt_count + 1 
                             WHERE order_id = ?`,
                            [proxyData.error, order.order_id]
                        );
                        
                        results.push({
                            order_id: order.order_id,
                            status: 'pending',
                            error: proxyData.error
                        });
                        
                        break;
                    }

                    // Other errors - mark as failed
                    await db.query(
                        `UPDATE order_queue SET status = 'failed', error_message = ?, processed_at = NOW() WHERE order_id = ?`,
                        [proxyData.error, order.order_id]
                    );

                    await db.query(
                        `UPDATE orders SET status = 'Failed', updated_at = NOW() WHERE order_id = ?`,
                        [order.order_id]
                    );

                    failed++;
                    results.push({
                        order_id: order.order_id,
                        status: 'failed',
                        error: proxyData.error
                    });

                    console.log(`❌ Order ${order.order_id} failed: ${proxyData.error}`);
                    continue;
                }

                if (proxyData && proxyData.order) {
                    await db.query(
                        `UPDATE orders 
                         SET status = 'Processing', 
                             provider_order_id = ?,
                             is_queued = 0,
                             updated_at = NOW()
                         WHERE order_id = ?`,
                        [proxyData.order, order.order_id]
                    );

                    await db.query(
                        `UPDATE order_queue SET status = 'processed', processed_at = NOW() WHERE order_id = ?`,
                        [order.order_id]
                    );

                    processed++;
                    results.push({
                        order_id: order.order_id,
                        status: 'processed',
                        provider_order_id: proxyData.order
                    });

                    console.log(`✅ Order ${order.order_id} processed successfully`);
                } else {
                    await db.query(
                        `UPDATE order_queue SET status = 'failed', error_message = ?, processed_at = NOW() WHERE order_id = ?`,
                        ['Unexpected API response', order.order_id]
                    );

                    await db.query(
                        `UPDATE orders SET status = 'Failed', updated_at = NOW() WHERE order_id = ?`,
                        [order.order_id]
                    );

                    failed++;
                    results.push({
                        order_id: order.order_id,
                        status: 'failed',
                        error: 'Unexpected API response'
                    });
                }

            } catch (error) {
                console.error(`❌ Error processing order ${order.order_id}:`, error);
                
                await db.query(
                    `UPDATE order_queue SET status = 'failed', error_message = ?, processed_at = NOW() WHERE order_id = ?`,
                    [error.message, order.order_id]
                );

                await db.query(
                    `UPDATE orders SET status = 'Failed', updated_at = NOW() WHERE order_id = ?`,
                    [order.order_id]
                );

                failed++;
                results.push({
                    order_id: order.order_id,
                    status: 'failed',
                    error: error.message
                });
            }
        }

        return res.json({
            success: true,
            message: `Processed ${processed} orders, ${failed} failed`,
            processed: processed,
            failed: failed,
            results: results
        });

    } catch (error) {
        console.error('❌ Error processing queued orders:', error);
        res.status(500).json({ error: 'Failed to process queued orders: ' + error.message });
    }
};

// ================================================================
// ===== GET QUEUED ORDERS =====
// ================================================================
exports.getQueuedOrders = async (req, res) => {
    try {
        const [queuedOrders] = await db.query(
            `SELECT * FROM order_queue ORDER BY created_at ASC`
        );

        res.json({
            success: true,
            orders: queuedOrders,
            total: queuedOrders.length
        });

    } catch (error) {
        console.error('❌ Error fetching queued orders:', error);
        res.status(500).json({ error: 'Failed to fetch queued orders' });
    }
};

// ================================================================
// ===== RETRY FAILED QUEUED ORDER =====
// ================================================================
exports.retryQueuedOrder = async (req, res) => {
    try {
        const { orderId } = req.params;

        const [result] = await db.query(
            `UPDATE order_queue SET status = 'pending', error_message = NULL, last_attempt = NULL WHERE order_id = ? AND status = 'failed'`,
            [orderId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'Order not found or not in failed status'
            });
        }

        // Also reset order status in orders table
        await db.query(
            `UPDATE orders SET status = 'Queued', updated_at = NOW() WHERE order_id = ? AND status = 'Failed'`,
            [orderId]
        );

        res.json({
            success: true,
            message: `Order ${orderId} reset to pending for retry`
        });

    } catch (error) {
        console.error('❌ Error retrying order:', error);
        res.status(500).json({ error: 'Failed to retry order' });
    }
};

// ================================================================
// ===== GET USER ORDERS =====
// ================================================================
exports.getUserOrders = async (req, res) => {
    try {
        const { userId } = req.params;
        
        const [orders] = await db.query(
            `SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC`,
            [userId]
        );
        
        res.json(orders);
    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).json({ error: 'Failed to fetch orders' });
    }
};

// ================================================================
// ===== GET ORDER BY ID =====
// ================================================================
exports.getOrderById = async (req, res) => {
    try {
        const { orderId } = req.params;
        
        const [orders] = await db.query(
            `SELECT * FROM orders WHERE order_id = ?`,
            [orderId]
        );
        
        if (orders.length === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }
        
        res.json(orders[0]);
    } catch (error) {
        console.error('Error fetching order:', error);
        res.status(500).json({ error: 'Failed to fetch order' });
    }
};

// ================================================================
// ===== UPDATE ORDER STATUS =====
// ================================================================
exports.updateOrderStatus = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { status, remains, start_count, refundedAmount } = req.body;

        const updates = [];
        const values = [];

        if (status !== undefined) {
            updates.push('status = ?');
            values.push(status);
        }
        if (remains !== undefined) {
            updates.push('remains = ?');
            values.push(remains);
        }
        if (start_count !== undefined) {
            updates.push('start_count = ?');
            values.push(start_count);
        }
        if (refundedAmount !== undefined) {
            updates.push('refunded_amount = ?');
            values.push(refundedAmount);
        }

        updates.push('updated_at = NOW()');

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        values.push(orderId);

        await db.query(
            `UPDATE orders SET ${updates.join(', ')} WHERE order_id = ?`,
            values
        );

        res.json({ 
            success: true, 
            message: 'Order status updated successfully' 
        });
    } catch (error) {
        console.error('Error updating order status:', error);
        res.status(500).json({ error: 'Failed to update order status' });
    }
};

// ================================================================
// ===== GET ORDER STATS =====
// ================================================================
exports.getOrderStats = async (req, res) => {
    try {
        const { userId } = req.params;

        const [stats] = await db.query(
            `SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN LOWER(status) LIKE '%completed%' OR LOWER(status) LIKE '%success%' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN LOWER(status) LIKE '%pending%' OR LOWER(status) LIKE '%processing%' OR LOWER(status) LIKE '%progress%' THEN 1 ELSE 0 END) as active,
                SUM(CASE WHEN LOWER(status) LIKE '%queued%' THEN 1 ELSE 0 END) as queued,
                SUM(charge) as total_spent
             FROM orders WHERE user_id = ?`,
            [userId]
        );

        res.json(stats[0] || { total: 0, completed: 0, active: 0, queued: 0, total_spent: 0 });
    } catch (error) {
        console.error('Error fetching order stats:', error);
        res.status(500).json({ error: 'Failed to fetch order stats' });
    }
};

// ================================================================
// ===== GET RECENT ORDERS =====
// ================================================================
exports.getRecentOrders = async (req, res) => {
    try {
        const { userId } = req.params;

        const [orders] = await db.query(
            `SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`,
            [userId]
        );

        res.json(orders);
    } catch (error) {
        console.error('Error fetching recent orders:', error);
        res.status(500).json({ error: 'Failed to fetch recent orders' });
    }
};

// ================================================================
// ===== GET USER ORDERS WITH REFUNDS =====
// ================================================================
exports.getUserOrdersWithRefunds = async (req, res) => {
    try {
        const { userId } = req.params;
        
        const [orders] = await db.query(
            `SELECT 
                *,
                CASE 
                    WHEN refunded_amount > 0 AND refunded_amount >= charge THEN 'Fully Refunded'
                    WHEN refunded_amount > 0 AND refunded_amount < charge THEN 'Partially Refunded'
                    ELSE 'No Refund'
                END as refund_status,
                CASE 
                    WHEN refunded_amount > 0 THEN (charge - refunded_amount)
                    ELSE charge
                END as net_charge
            FROM orders 
            WHERE user_id = ? 
            ORDER BY created_at DESC`,
            [userId]
        );
        
        res.json(orders);
    } catch (error) {
        console.error('Error fetching orders with refunds:', error);
        res.status(500).json({ error: 'Failed to fetch orders' });
    }
};

// ================================================================
// ===== GET USER TOTAL REFUNDED =====
// ================================================================
exports.getUserTotalRefunded = async (req, res) => {
    try {
        const { userId } = req.params;
        
        const [result] = await db.query(
            `SELECT 
                COALESCE(SUM(refunded_amount), 0) as total_refunded,
                COUNT(CASE WHEN refunded_amount > 0 THEN 1 END) as refunded_orders_count
            FROM orders 
            WHERE user_id = ?`,
            [userId]
        );
        
        res.json({
            success: true,
            total_refunded: result[0]?.total_refunded || 0,
            refunded_orders_count: result[0]?.refunded_orders_count || 0
        });
    } catch (error) {
        console.error('Error fetching total refunded:', error);
        res.status(500).json({ error: 'Failed to fetch total refunded' });
    }
};

// ================================================================
// ===== GET API ORDERS =====
// ================================================================
exports.getApiOrders = async (req, res) => {
    try {
        const { status, limit = 100, offset = 0 } = req.query;
        
        let query = `SELECT * FROM orders WHERE is_api_order = 1`;
        const queryParams = [];
        
        if (status) {
            query += ` AND status LIKE ?`;
            queryParams.push(`%${status}%`);
        }
        
        query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
        queryParams.push(parseInt(limit), parseInt(offset));
        
        const [orders] = await db.query(query, queryParams);
        
        const [countResult] = await db.query(
            `SELECT COUNT(*) as total FROM orders WHERE is_api_order = 1${status ? ' AND status LIKE ?' : ''}`,
            status ? [`%${status}%`] : []
        );
        
        res.json({
            success: true,
            orders,
            pagination: {
                total: countResult[0].total,
                limit: parseInt(limit),
                offset: parseInt(offset)
            }
        });
    } catch (error) {
        console.error('Error fetching API orders:', error);
        res.status(500).json({ error: 'Failed to fetch API orders' });
    }
};

// ================================================================
// ===== GET API ORDER STATS =====
// ================================================================
exports.getApiOrderStats = async (req, res) => {
    try {
        const [stats] = await db.query(
            `SELECT 
                COUNT(*) as total_orders,
                SUM(charge) as total_charge,
                SUM(CASE WHEN status LIKE '%completed%' OR status LIKE '%success%' THEN 1 ELSE 0 END) as completed_orders,
                SUM(CASE WHEN status LIKE '%pending%' OR status LIKE '%processing%' OR status LIKE '%progress%' THEN 1 ELSE 0 END) as active_orders,
                SUM(CASE WHEN status LIKE '%queued%' THEN 1 ELSE 0 END) as queued_orders,
                SUM(CASE WHEN refunded_amount > 0 THEN 1 ELSE 0 END) as refunded_orders,
                SUM(refunded_amount) as total_refunded
            FROM orders WHERE is_api_order = 1`
        );
        
        res.json({
            success: true,
            stats: stats[0] || {
                total_orders: 0,
                total_charge: 0,
                completed_orders: 0,
                active_orders: 0,
                queued_orders: 0,
                refunded_orders: 0,
                total_refunded: 0
            }
        });
    } catch (error) {
        console.error('Error fetching API order stats:', error);
        res.status(500).json({ error: 'Failed to fetch API order stats' });
    }
};
