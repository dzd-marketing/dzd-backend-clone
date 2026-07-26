const db = require('../config/db');
const dotenv = require('dotenv');
const path = require('path');

// Load .env file explicitly
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const WORKER_URL = process.env.WORKER_URL || 'https://dzd-billing-api.sitewasd2026.workers.dev';

// ─── Validate API Key ──────────────────────────────────────────────────────
const validateApiKey = async (apiKey) => {
  const [resellers] = await db.query(
    'SELECT id, uid, email, username, api_key, api_key_expires_at FROM users WHERE api_key = ? AND has_api_key = 1 AND is_reseller = 1 AND status = "active"',
    [apiKey]
  );
  
  if (resellers.length === 0) {
    return null;
  }
  
  const reseller = resellers[0];
  
  // Check if API key is expired
  if (reseller.api_key_expires_at && new Date(reseller.api_key_expires_at) < new Date()) {
    return null;
  }
  
  return reseller;
};

// ─── Get Reseller Balance from Cloudflare ──────────────────────────────────
const getResellerBalance = async (uid) => {
  try {
    const response = await fetch(`${WORKER_URL}/get-balance?userId=${uid}`);
    if (!response.ok) {
      console.error('Balance API error:', response.status);
      return 0;
    }
    const data = await response.json();
    return parseFloat(data.total_balance || 0);
  } catch (error) {
    console.error('Error fetching balance from Cloudflare:', error);
    return 0;
  }
};

// ─── Deduct Balance from Cloudflare ────────────────────────────────────────
const deductResellerBalance = async (uid, amount, description) => {
  try {
    console.log('🔄 Deducting balance - User:', uid, 'Amount:', amount);
    
    const response = await fetch(`${WORKER_URL}/deduct-balance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: uid,
        amount,
        description
      })
    });
    
    if (!response.ok) {
      const responseText = await response.text();
      console.error('❌ Deduct failed with status:', response.status);
      console.error('❌ Response:', responseText);
      return false;
    }
    
    const data = await response.json();
    return data.success;
  } catch (error) {
    console.error('❌ Error deducting balance from Cloudflare:', error);
    return false;
  }
};

// ─── Get Service Details from Cache ──────────────────────────────────────
const getServiceDetails = async (serviceId) => {
  try {
    const response = await fetch('https://smm-services-cache.sitewasd2026.workers.dev/api/premium-services');
    if (!response.ok) {
      console.error('Failed to fetch services:', response.status);
      return null;
    }
    const services = await response.json();
    const service = services.find(s => s.service.toString() === serviceId.toString());
    if (!service) {
      console.error('Service not found:', serviceId);
      return null;
    }
    return {
      rate: parseFloat(service.rate) || 0,
      name: service.name || `Service #${serviceId}`
    };
  } catch (error) {
    console.error('Error fetching service details:', error);
    return null;
  }
};

// ─── MAIN ENTRY POINT - All API calls go through this ─────────────────────
exports.handleRequest = async (req, res) => {
  try {
    const { key, action } = req.query;
    
    // Validate API key
    const reseller = await validateApiKey(key);
    if (!reseller) {
      return res.status(401).json({ error: 'Invalid or expired API key' });
    }
    
    // Route based on action
    switch (action) {
      case 'balance':
        return await getBalanceHandler(req, res, reseller);
      case 'services':
        return await getServicesHandler(req, res);
      case 'add':
        return await addOrderHandler(req, res, reseller);
      case 'status':
        return await orderStatusHandler(req, res, reseller);
      case 'refill':
        return await createRefillHandler(req, res, reseller);
      default:
        return res.status(400).json({ 
          error: 'Invalid action',
          available_actions: ['balance', 'services', 'add', 'status', 'refill']
        });
    }
  } catch (error) {
    console.error('API Handler error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── BALANCE Handler ──────────────────────────────────────────────────────
const getBalanceHandler = async (req, res, reseller) => {
  try {
    const balance = await getResellerBalance(reseller.uid);
    res.json({
      balance,
      currency: 'LKR'
    });
  } catch (error) {
    console.error('Get balance error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── SERVICES Handler ─────────────────────────────────────────────────────
const getServicesHandler = async (req, res) => {
  try {
    const response = await fetch('https://smm-services-cache.sitewasd2026.workers.dev/api/premium-services');
    if (!response.ok) {
      return res.status(502).json({ error: 'Failed to fetch services' });
    }
    
    const services = await response.json();
    res.json(services);
  } catch (error) {
    console.error('Get services error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── ADD ORDER Handler ────────────────────────────────────────────────────
const addOrderHandler = async (req, res, reseller) => {
  try {
    const { service, link, quantity, runs, interval, comments, usernames, hashtag, username, answer_number, groups, min, max, posts, old_posts, delay, expiry } = req.query;
    
    if (!service || !link) {
      return res.status(400).json({ error: 'Service ID and link are required' });
    }
    
    // Get service details
    const serviceDetails = await getServiceDetails(service);
    if (serviceDetails === null) {
      return res.status(404).json({ error: 'Service not found' });
    }
    
    // Calculate quantity
    const qty = parseInt(quantity) || 0;
    if (qty < 1) {
      return res.status(400).json({ error: 'Quantity must be at least 1' });
    }
    
    // Calculate website charge in LKR (service rate × quantity / 1000)
    const websiteCharge = (qty / 1000) * serviceDetails.rate;
    
    // Check balance
    const balance = await getResellerBalance(reseller.uid);
    if (balance < websiteCharge) {
      return res.status(400).json({ error: `Insufficient balance. You need LKR ${websiteCharge.toFixed(2)} but have LKR ${balance.toFixed(2)}` });
    }
    
    // Build params for SMM API
    const params = {
      action: 'add',
      service,
      link,
      quantity: quantity || '0',
      runs: runs || '',
      interval: interval || '',
      comments: comments || '',
      usernames: usernames || '',
      hashtag: hashtag || '',
      username: username || '',
      answer_number: answer_number || '',
      groups: groups || '',
      min: min || '',
      max: max || '',
      posts: posts || '',
      old_posts: old_posts || '',
      delay: delay || '',
      expiry: expiry || ''
    };
    
    // Call SMM API through proxy
    const proxyResponse = await fetch('https://api.dzd-marketing.site/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'premium', ...params })
    });
    
    const data = await proxyResponse.json();
    
    if (data && data.order) {
      // Deduct balance from Cloudflare
      const deducted = await deductResellerBalance(
        reseller.uid, 
        websiteCharge, 
        `Order #${data.order} - ${serviceDetails.name}`
      );
      
      if (!deducted) {
        return res.status(500).json({ error: 'Failed to deduct balance' });
      }
      
      // Save order to database
      await db.query(
        `INSERT INTO orders (order_id, user_id, service_id, service_name, provider, quantity, charge, provider_charge, link, status, remains, currency, is_api_order) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, 'LKR', ?)`,
        [data.order, reseller.uid, service, serviceDetails.name, 'premium', qty, websiteCharge, 0, link, qty, 1]
      );
      
      res.json({ order: data.order });
    } else {
      res.status(400).json(data);
    }
  } catch (error) {
    console.error('Add order error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── ORDER STATUS Handler ─────────────────────────────────────────────────
const orderStatusHandler = async (req, res, reseller) => {
  try {
    const { order, orders } = req.query;
    
    // Handle single order
    if (order) {
      const [orderData] = await db.query(
        `SELECT charge, start_count, status, remains, currency 
         FROM orders WHERE order_id = ? AND user_id = ?`,
        [order, reseller.uid]
      );
      
      if (orderData.length === 0) {
        return res.status(404).json({ error: 'Order not found' });
      }
      
      const orderInfo = orderData[0];
      return res.json({
        charge: parseFloat(orderInfo.charge || 0).toFixed(5),
        start_count: orderInfo.start_count || '0',
        status: orderInfo.status || 'Pending',
        remains: orderInfo.remains || '0',
        currency: orderInfo.currency || 'LKR'
      });
    }
    
    // Handle multiple orders (bulk)
    if (orders) {
      const orderIds = orders.split(',');
      if (orderIds.length > 100) {
        return res.status(400).json({ error: 'Maximum 100 order IDs per request' });
      }
      
      const results = {};
      
      for (const orderId of orderIds) {
        const [orderData] = await db.query(
          `SELECT charge, start_count, status, remains, currency 
           FROM orders WHERE order_id = ? AND user_id = ?`,
          [orderId, reseller.uid]
        );
        
        if (orderData.length === 0) {
          results[orderId] = { error: 'Order not found' };
          continue;
        }
        
        const orderInfo = orderData[0];
        results[orderId] = {
          charge: parseFloat(orderInfo.charge || 0).toFixed(5),
          start_count: orderInfo.start_count || '0',
          status: orderInfo.status || 'Pending',
          remains: orderInfo.remains || '0',
          currency: orderInfo.currency || 'LKR'
        };
      }
      
      return res.json(results);
    }
    
    res.status(400).json({ error: 'Invalid request' });
  } catch (error) {
    console.error('Order status error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── REFILL Handler ────────────────────────────────────────────────────────
const createRefillHandler = async (req, res, reseller) => {
  try {
    const { order, orders } = req.query;
    
    // Handle single order
    if (order) {
      // Verify order belongs to this reseller
      const [orderCheck] = await db.query(
        'SELECT order_id FROM orders WHERE order_id = ? AND user_id = ?',
        [order, reseller.uid]
      );
      
      if (orderCheck.length === 0) {
        return res.status(404).json({ error: 'Order not found' });
      }
      
      const params = {
        action: 'refill',
        order: order
      };
      
      const proxyResponse = await fetch('https://api.dzd-marketing.site/api/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'premium', ...params })
      });
      
      const data = await proxyResponse.json();
      return res.json(data);
    }
    
    // Handle multiple orders
    if (orders) {
      const orderIds = orders.split(',');
      if (orderIds.length > 100) {
        return res.status(400).json({ error: 'Maximum 100 order IDs per request' });
      }
      
      const results = [];
      
      for (const orderId of orderIds) {
        // Verify order belongs to this reseller
        const [orderCheck] = await db.query(
          'SELECT order_id FROM orders WHERE order_id = ? AND user_id = ?',
          [orderId, reseller.uid]
        );
        
        if (orderCheck.length === 0) {
          results.push({ order: orderId, error: 'Order not found' });
          continue;
        }
        
        const params = {
          action: 'refill',
          order: orderId
        };
        
        const proxyResponse = await fetch('https://api.dzd-marketing.site/api/proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: 'premium', ...params })
        });
        
        const data = await proxyResponse.json();
        results.push({ order: orderId, ...data });
      }
      
      return res.json(results);
    }
    
    res.status(400).json({ error: 'Invalid request' });
  } catch (error) {
    console.error('Create refill error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};
