const crypto = require('crypto');
const https = require('https');
const { getAIResponse, checkHandoff } = require('./lib/ai');
const { triggerHandoff } = require('./lib/handoff');

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

// ตรวจ signature จาก LINE
function verifySignature(rawBody, signature) {
  if (!LINE_CHANNEL_SECRET || !signature) return false;
  const expected = crypto
    .createHmac('sha256', LINE_CHANNEL_SECRET)
    .update(rawBody)
    .digest('base64');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// ส่ง Reply Message
function replyMessage(replyToken, text) {
  const body = JSON.stringify({
    replyToken,
    messages: [{ type: 'text', text: text.slice(0, 5000) }], // LINE limit 5000 chars
  });

  const req = https.request({
    hostname: 'api.line.me',
    path: '/v2/bot/message/reply',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
    },
  });
  req.on('error', (err) => console.error('[LINE] Reply error:', err.message));
  req.write(body);
  req.end();
}

// ดึงชื่อผู้ใช้จาก LINE Profile
function getUserProfile(userId) {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.line.me',
        path: `/v2/bot/profile/${userId}`,
        method: 'GET',
        headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.displayName || 'ลูกค้า');
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
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  // ตรวจ signature
  const signature = req.headers['x-line-signature'];
  const rawBody = JSON.stringify(req.body);
  if (LINE_CHANNEL_SECRET && !verifySignature(rawBody, signature)) {
    console.warn('[LINE] Invalid signature');
    return res.status(401).send('Unauthorized');
  }

  res.status(200).send('OK'); // ตอบ LINE ทันที

  for (const event of req.body.events || []) {
    // Follow event — ส่งข้อความต้อนรับ
    if (event.type === 'follow') {
      replyMessage(
        event.replyToken,
        'สวัสดีค่ะ ยินดีต้อนรับสู่ JIA TRAINER CENTER 🎉\n\nน้องเจียพร้อมให้บริการค่ะ สามารถถามเรื่องหลักสูตร CPR/AED ราคา หรือการอบรมได้เลยนะคะ 😊'
      );
      continue;
    }

    // Message event — ประมวลผลเฉพาะข้อความ text
    if (event.type !== 'message' || event.message.type !== 'text') continue;

    const userId = event.source.userId;
    const messageText = event.message.text;
    const replyToken = event.replyToken;

    const [aiResponse, customerName] = await Promise.all([
      getAIResponse(userId, messageText),
      getUserProfile(userId),
    ]);

    const { hasHandoff, type, cleanText } = checkHandoff(aiResponse);

    replyMessage(replyToken, cleanText);

    if (hasHandoff) {
      triggerHandoff({
        customerName,
        platform: 'LINE OA',
        question: messageText,
        handoffType: type,
      }).catch(console.error);
    }
  }
};
