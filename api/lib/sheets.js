const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tpoiyykbgsgnrdwzgzvn.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

/**
 * บันทึก lead ลง Supabase (chatbot_leads table)
 */
async function logLeadToSheet(data) {
  if (!SUPABASE_KEY) {
    console.log('[Supabase] SUPABASE_SERVICE_KEY not set, skipping');
    return;
  }

  const row = {
    name: data.name || null,
    psid: data.psid || null,
    platform: data.platform || 'Messenger',
    lead_type: data.type || null,
    lead_level: data.level || null,
    timing: data.timing || null,
    corp_size: data.corpSize || null,
    message: data.message || null,
    source: data.source || 'messenger_bot',
    email: data.email || null,
    phone: data.phone || null,
  };

  const payload = JSON.stringify(row);
  const url = new URL(`${SUPABASE_URL}/rest/v1/chatbot_leads`);

  return new Promise((resolve) => {
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'return=minimal',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        if (res.statusCode === 201) {
          console.log('[Supabase] Lead saved:', data.name, data.level);
        } else {
          console.error('[Supabase] Error:', res.statusCode, body.slice(0, 200));
        }
        resolve();
      });
    });
    req.on('error', (err) => {
      console.error('[Supabase] Request error:', err.message);
      resolve();
    });
    req.write(payload);
    req.end();
  });
}

module.exports = { logLeadToSheet };
