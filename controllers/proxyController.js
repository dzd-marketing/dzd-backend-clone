// No import needed for Node.js 18+ - fetch is global

exports.proxyRequest = async (req, res) => {
  try {
    const { provider, ...forwardParams } = req.body || {};
    const selectedProvider = provider || 'default';

    console.log('Proxy request received:', { provider: selectedProvider, action: forwardParams.action });

    if (selectedProvider === 'premium') {
      const PREMIUM_API_URL = process.env.PREMIUM_API_URL;
      const PREMIUM_API_KEY = process.env.PREMIUM_API_KEY;

      if (!PREMIUM_API_URL || !PREMIUM_API_KEY) {
        console.error('Premium API configuration missing');
        return res.status(500).json({ error: 'Premium API configuration missing on server' });
      }

      // For premium, we need to ensure the action is valid
      const allowedActions = ['add', 'status', 'services', 'balance'];
      if (!allowedActions.includes(forwardParams.action)) {
        return res.status(403).json({ error: 'Action not allowed for premium provider' });
      }

      const response = await fetch(PREMIUM_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          key: PREMIUM_API_KEY,
          ...forwardParams
        }).toString()
      });

      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        const data = await response.json();
        return res.status(response.status).json(data);
      } else {
        const text = await response.text();
        return res.status(response.status).send(text);
      }
    } else {
      const SMM_API_URL = process.env.SMM_API_URL;
      const SMM_API_KEY = process.env.SMM_API_KEY;

      if (!SMM_API_URL || !SMM_API_KEY) {
        console.error('SMM API configuration missing');
        return res.status(500).json({ error: 'SMM API configuration missing on server' });
      }

      // For default provider, ensure action is included
      const params = new URLSearchParams({
        key: SMM_API_KEY,
        ...forwardParams
      });
      
      // Ensure action is included for status checks
      if (forwardParams.action) {
        params.set('action', forwardParams.action);
      }

      const response = await fetch(SMM_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });

      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        const data = await response.json();
        return res.status(response.status).json(data);
      } else {
        const text = await response.text();
        return res.status(response.status).send(text);
      }
    }
  } catch (error) {
    console.error('Proxy Error:', error);
    res.status(500).json({ error: 'Internal Proxy Error', details: error.message });
  }
};
