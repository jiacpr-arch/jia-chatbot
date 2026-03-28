const crypto = require('crypto');
const https = require('https');
const { getAIResponse, checkHandoff } = require('./lib/ai');
const { triggerHandoff } = require('./lib/handoff');

const FB_VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN || 'jia_chatbot_verify_2026';
const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
const FB_APP_SECRET = process.env.FB_APP_SECRET;

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
function sendMessage(recipientId, text) {
  const body = JSON.stringify({
    recipient: { id: recipientId },
    message: { text: text.slice(0, 2000) }, // Messenger limit 2000 chars
  });

  const req = https.request({
    hostname: 'graph.facebook.com',
    path: `/v19.0/me/messages?access_token=${FB_PAGE_ACCESS_TOKEN}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  req.on('error', (err) => console.error('[Messenger] Send error:', err.message));
  req.write(body);
  req.end();
}

// แสดง typing indicator
function sendTypingOn(recipientId) {
  const body = JSON.stringify({
    recipient: { id: recipientId },
    sender_action: 'typing_on',
  });
  const req = https.request({
    hostname: 'graph.facebook.com',
    path: `/v19.0/me/messages?access_token=${FB_PAGE_ACCESS_TOKEN}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  req.on('error', () => {});
  req.write(body);
  req.end();
}

// ดึงชื่อลูกค้าจาก Facebook Profile
function getUserName(psid) {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'graph.facebook.com',
        path: `/v19.0/${psid}?fields=name&access_token=${FB_PAGE_ACCESS_TOKEN}`,
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
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === FB_VERIFY_TOKEN) {
      console.log('[Messenger] Webhook verified');
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
      for (const event of entry.messaging || []) {
        if (!event.message?.text) continue;

        const psid = event.sender.id;
        const messageText = event.message.text;

        sendTypingOn(psid);

        const [aiResponse, customerName] = await Promise.all([
          getAIResponse(psid, messageText),
          getUserName(psid),
        ]);

        const { hasHandoff, type, cleanText } = checkHandoff(aiResponse);

        sendMessage(psid, cleanText);

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
