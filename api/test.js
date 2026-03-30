const https = require('https');

// In-memory log of recent requests to /api/messenger
// This helps verify if Facebook is actually sending webhooks
global._webhookLog = global._webhookLog || [];

function fbGet(path, token) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'graph.facebook.com',
      path: `/v21.0/${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`,
      method: 'GET',
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function fbPost(path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = `${body}&access_token=${encodeURIComponent(token)}`;
    const req = https.request({
      hostname: 'graph.facebook.com',
      path: `/v21.0/${path}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

module.exports = async (req, res) => {
  const cprToken = process.env.FB_PAGE_ACCESS_TOKEN_JIA_CPR || '';

  // If ?send=PSID, try to send a test message directly
  const sendTo = req.query?.send;
  if (sendTo) {
    const result = await new Promise((resolve, reject) => {
      const payload = JSON.stringify({
        messaging_type: 'RESPONSE',
        recipient: { id: sendTo },
        message: { text: 'ทดสอบจาก JIA Chatbot 🤖' },
      });
      const r = https.request({
        hostname: 'graph.facebook.com',
        path: `/v21.0/me/messages?access_token=${encodeURIComponent(cprToken)}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      }, (resp) => {
        let data = '';
        resp.on('data', (chunk) => (data += chunk));
        resp.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve(data); }
        });
      });
      r.on('error', reject);
      r.write(payload);
      r.end();
    });
    return res.json({ send_result: result });
  }

  // If ?subscribe=1, subscribe pages to webhook
  if (req.query?.subscribe) {
    const trainingToken = process.env.FB_PAGE_ACCESS_TOKEN_JIA_TRAINING || '';
    const results = {};

    // Subscribe Jia CPR
    results.jia_cpr = await fbPost('115768024942069/subscribed_apps',
      'subscribed_fields=messages,messaging_postbacks', cprToken);

    // Subscribe Jia Training
    results.jia_training = await fbPost('1032110679988495/subscribed_apps',
      'subscribed_fields=messages,messaging_postbacks', trainingToken);

    return res.json({ subscribe_results: results });
  }

  try {
    const pageInfo = await fbGet('me?fields=id,name', cprToken);

    res.json({
      page_info: pageInfo,
      webhook_log: global._webhookLog.slice(-10),
      env_check: {
        has_anthropic_key: !!(process.env.ANTHROPIC_API_KEY || '').match(/^sk-ant-/),
        has_cpr_token: cprToken.length > 0 && cprToken.startsWith('EAA'),
        has_training_token: (process.env.FB_PAGE_ACCESS_TOKEN_JIA_TRAINING || '').startsWith('EAA'),
        has_app_secret: !!(process.env.FB_APP_SECRET || ''),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
