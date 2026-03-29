const https = require('https');
const { logLeadToSheet } = require('./lib/sheets');
const { triggerHandoff } = require('./lib/handoff');

const FB_VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN || 'jia_chatbot_verify_2026';

const PAGE_TOKENS = {
  '115768024942069': process.env.FB_PAGE_ACCESS_TOKEN_JIA_CPR,
  '1032110679988495': process.env.FB_PAGE_ACCESS_TOKEN_JIA_TRAINING,
};

// ดึงข้อมูล lead จาก Facebook Lead Retrieval API
function getLeadData(leadgenId, pageToken) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'graph.facebook.com',
      path: `/v19.0/${leadgenId}?access_token=${encodeURIComponent(pageToken)}`,
      method: 'GET',
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ส่งข้อความหา lead ผ่าน Messenger (ถ้ามี PSID)
function sendMessage(psid, text, pageToken) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      recipient: { id: psid },
      message: { text: text.slice(0, 2000) },
    });
    const req = https.request({
      hostname: 'graph.facebook.com',
      path: `/v19.0/me/messages?access_token=${encodeURIComponent(pageToken)}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        console.log('[Leadgen] Send result:', res.statusCode, d.slice(0, 200));
        resolve(d);
      });
    });
    req.on('error', (e) => { console.error('[Leadgen] Send error:', e.message); resolve(null); });
    req.write(payload);
    req.end();
  });
}

// Parse lead field data
function parseFields(fieldData) {
  const result = {};
  for (const field of fieldData || []) {
    const key = field.name?.toLowerCase();
    if (key === 'full_name' || key === 'ชื่อ-นามสกุล' || key === 'ชื่อ') result.name = field.values?.[0];
    if (key === 'email' || key === 'อีเมล') result.email = field.values?.[0];
    if (key === 'phone_number' || key === 'เบอร์โทร' || key === 'เบอร์โทรศัพท์') result.phone = field.values?.[0];
  }
  return result;
}

module.exports = async (req, res) => {
  // GET — webhook verification (same as messenger)
  if (req.method === 'GET') {
    const rawUrl = req.url || '';
    const qs = rawUrl.includes('?') ? rawUrl.split('?')[1] : '';
    const params = new URLSearchParams(qs);
    const mode = params.get('hub.mode') || req.query?.['hub.mode'];
    const token = params.get('hub.verify_token') || req.query?.['hub.verify_token'];
    const challenge = params.get('hub.challenge') || req.query?.['hub.challenge'];
    if (mode === 'subscribe' && token === FB_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  // POST — receive leadgen events
  if (req.method === 'POST') {
    const body = req.body;
    console.log('[Leadgen] Received:', JSON.stringify(body).slice(0, 500));

    if (body.object !== 'page') return res.status(200).send('OK');

    try {
      for (const entry of body.entry || []) {
        const pageId = entry.id;
        const pageToken = PAGE_TOKENS[pageId];
        if (!pageToken) continue;

        for (const change of entry.changes || []) {
          if (change.field !== 'leadgen') continue;

          const leadgenId = change.value?.leadgen_id;
          if (!leadgenId) continue;

          console.log(`[Leadgen] New lead: ${leadgenId}`);

          // Fetch full lead data
          const leadData = await getLeadData(leadgenId, pageToken);
          if (!leadData || leadData.error) {
            console.error('[Leadgen] Failed to fetch lead:', leadData?.error?.message);
            continue;
          }

          const fields = parseFields(leadData.field_data);
          console.log('[Leadgen] Lead info:', JSON.stringify(fields));

          // Log to Google Sheets
          await logLeadToSheet({
            name: fields.name || 'Lead Ads',
            psid: leadgenId,
            platform: 'Facebook Lead Ads',
            type: 'lead_ad',
            level: 'warm',
            message: `Lead Ad form: ${fields.name || ''} / ${fields.phone || ''} / ${fields.email || ''}`,
            source: 'facebook_lead_ads',
            email: fields.email || '',
            phone: fields.phone || '',
          });

          // Alert team immediately
          await triggerHandoff({
            customerName: fields.name || 'Lead Ads',
            platform: 'Facebook Lead Ads',
            question: `📋 New Lead Ad!\nชื่อ: ${fields.name || '-'}\nโทร: ${fields.phone || '-'}\nอีเมล: ${fields.email || '-'}`,
            handoffType: 'HOT_LEAD',
          });
        }
      }
    } catch (err) {
      console.error('[Leadgen] Error:', err.message || err);
    }

    return res.status(200).send('EVENT_RECEIVED');
  }
};
