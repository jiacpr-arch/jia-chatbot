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

// ส่งข้อความกลับผ่าน Send API (returns Promise)
function sendMessage(recipientId, text, pageToken) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      recipient: { id: recipientId },
      message: { text: text.slice(0, 2000) },
    });

    const req = https.request({
      hostname: 'graph.facebook.com',
      path: `/v19.0/me/messages?access_token=${encodeURIComponent(pageToken)}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        console.log(`[Messenger] Send API response (${res.statusCode}):`, data.slice(0, 200));
        resolve(data);
      });
    });
    req.on('error', (err) => {
      console.error('[Messenger] Send error:', err.message);
      reject(err);
    });
    req.write(payload);
    req.end();
  });
}

// แสดง typing indicator
function sendTypingOn(recipientId, pageToken) {
  const body = JSON.stringify({
    recipient: { id: recipientId },
    sender_action: 'typing_on',
  });
  const req = https.request({
    hostname: 'graph.facebook.com',
    path: `/v19.0/me/messages?access_token=${encodeURIComponent(pageToken)}`,
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
        path: `/v19.0/${psid}?fields=name&access_token=${encodeURIComponent(pageToken)}`,
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

// Shared log for debugging
global._webhookLog = global._webhookLog || [];

module.exports = async (req, res) => {
  global._webhookLog.push({
    time: new Date().toISOString(),
    method: req.method,
    url: req.url,
    body: req.method === 'POST' ? JSON.stringify(req.body).slice(0, 300) : undefined,
  });
  if (global._webhookLog.length > 20) global._webhookLog.shift();

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
    // TODO: เพิ่ม raw body signature verification ในอนาคต

    const body = req.body;
    console.log('[Messenger] Received:', JSON.stringify(body).slice(0, 500));

    if (body.object !== 'page') return res.status(200).send('OK');

    // ประมวลผล event ให้เสร็จก่อนตอบ Facebook (Vercel จะ kill function หลัง res.send)
    try {
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
          console.log(`[Messenger] Message from ${psid}: ${messageText}`);

          sendTypingOn(psid, pageToken);

          const [aiResponse, customerName] = await Promise.all([
            getAIResponse(psid, messageText),
            getUserName(psid, pageToken),
          ]);

          console.log(`[Messenger] AI response: ${aiResponse.slice(0, 200)}`);

          const { hasHandoff, type, cleanText } = checkHandoff(aiResponse);

          await sendMessage(psid, cleanText, pageToken);

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
    } catch (err) {
      console.error('[Messenger] Error processing:', err.message || err);
    }

    return res.status(200).send('EVENT_RECEIVED');
  }
};
