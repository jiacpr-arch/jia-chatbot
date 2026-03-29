const https = require('https');

function fbGet(path, token) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'graph.facebook.com',
      path: `/v19.0/${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`,
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

module.exports = async (req, res) => {
  try {
    const cprToken = process.env.FB_PAGE_ACCESS_TOKEN_JIA_CPR || '';
    const trainingToken = process.env.FB_PAGE_ACCESS_TOKEN_JIA_TRAINING || '';

    // Check subscribed apps for Jia CPR page
    const subs = await fbGet('115768024942069/subscribed_apps', cprToken);

    // Check page info
    const pageInfo = await fbGet('me?fields=id,name', cprToken);

    // Try to subscribe the app (POST via GET won't work, but let's check status)
    res.json({
      page_info: pageInfo,
      subscriptions: subs,
      cpr_token_preview: cprToken.slice(0, 20) + '...',
      cpr_token_length: cprToken.length,
      training_token_length: trainingToken.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
