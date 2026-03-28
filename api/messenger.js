const crypto = require('crypto');
const https = require('https');
const { getAIResponse, checkHandoff } = require('./lib/ai');
const { triggerHandoff } = require('./lib/handoff');

const FB_VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN || 'jia_chatbot_verify_2026';
const FB_APP_SECRET = process.env.FB_APP_SECRET;

// Map page ID → access token
const PAGE_TOKENS = {
  '115768024942069': process.env.FB_PAGE_ACCESS_TOKEN_JIA_CPR,       // Jia CPR
  '1032110679988495': process.env.FB_PAGE_ACCESS_TOKEN_JIA_TRAINING, // Jia Training Center
};

// ตรวจ signature จาก Facebook
function verifySignature(rawBody, signature) {
  if (!FB_APP_SECRET || !signature) return false;
  const expected = 'sha256=' + crypto
    .createHmac('sha256', FB_APP_SECRET)
    .update(rawBody)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// ส่งข้อความกลับผ่าน Send API
function sendMessage(recipientId, text, pageToken) {
  const body = JSON.stringify({
    recipient: { id: recipientId },
    message: { text: text.slice(0, 2000) },
  });

  const req = https.request({
    hostname: 'graph.facebook.com',
    path: `/v19.0/me/messages?access_token=${pageToken}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  req.on('error', (err) => console.error('[Messenger] Send error:', err.message));
  req.write(body);
  req.end();
}

// แสดง typing indicator
function sendTypingOn(recipientId, pageToken) {
  const body = JSON.stringify({
    recipient: { id: recipientId },
    sender_action: 'typing_on',
  });
  const req = https.request({
    hostname: 'graph.facebook.com',
    path: `/v19.0/me/messages?access_token=${pageToken}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  req.on('error', () => {});
  req.write(body);
  req.end();
}

// ดึงชื่อลูกค้าจาก Facebook Profile
function getUserName(psid, pageToken) {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'graph.facebook.com',
        path: `/v19.0/${psid}?fields=name&access_token=${pageToken}`,
        method: 'GET',
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.name || 'ลูกค้า');
          } catch {
            resolve('ลูกค้า');
          }
        });
      }
    );
    req.on('error', () => resolve('ลูกค้า'));
    req.end();
  });
}

module.exports = async (req, res) => {
  // GET — webhook verification
  if (req.method === 'GET') {
    const rawUrl = req.url || '';
    const qs = rawUrl.includes('?') ? rawUrl.split('?')[1] : '';
    const params = new URLSearchParams(qs);
    const mode = params.get('hub.mode') || (req.query && req.query['hub.mode']);
    const token = params.get('hub.verify_token') || (req.query && req.query['hub.verify_token']);
    const challenge = params.get('hub.challenge') || (req.query && req.query['hub.challenge']);
if (mode === 'subscribe' && token === FB_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  // POST — receive messages
  if (req.method === 'POST') {
    // ตรวจ signature
    const signature = req.headers['x-hub-signature-256'];
    const rawBody = JSON.stringify(req.body);
    if (FB_APP_SECRET && !verifySignature(rawBody, signature)) {
      console.warn('[Messenger] Invalid signature');
      return res.status(401).send('Unauthorized');
    }

    const body = req.body;
    if (body.object !== 'page') return res.status(200).send('OK');

    res.status(200).send('EVENT_RECEIVED'); // ตอบ Facebook ทันที

    // ประมวลผล event
    for (const entry of body.entry || []) {
      const pageId = entry.id;
      const pageToken = PAGE_TOKENS[pageId];
      if (!pageToken) {
        console.warn('[Messenger] ไม่มี token สำหรับ page:', pageId);
        continue;
      }

      for (const event of entry.messaging || []) {
        if (!event.message?.text) continue;

        const psid = event.sender.id;
        const messageText = event.message.text;

        sendTypingOn(psid, pageToken);

        const [aiResponse, customerName] = await Promise.all([
          getAIResponse(psid, messageText),
          getUserName(psid, pageToken),
        ]);

        const { hasHandoff, type, cleanText } = checkHandoff(aiResponse);

        sendMessage(psid, cleanText, pageToken);

        if (hasHandoff) {
          triggerHandoff({
            customerName,
            platform: 'Facebook Messenger',
            question: messageText,
            handoffType: type,
          }).catch(console.error);
        }
      }
    }
  }
};
