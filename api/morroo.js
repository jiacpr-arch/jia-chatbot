/**
 * Webhook handler สำหรับ morroo.com
 *
 * POST /api/morroo
 * {
 *   "userId": "user123",
 *   "message": "ข้อความจากลูกค้า",
 *   "displayName": "ชื่อลูกค้า"
 * }
 */

const https = require('https');
const { getAIResponse, checkHandoff } = require('./lib/ai');
const { triggerHandoff } = require('./lib/handoff');
const { leadStore } = require('./lib/lead-store');
const { schedulePostCourseFollowUp, onUserReply } = require('./lib/follow-up');

const MORROO_TOKEN = process.env.MORROO_TOKEN || '';
const MORROO_CALLBACK_URL = process.env.MORROO_CALLBACK_URL || '';

function verifyToken(req) {
  if (!MORROO_TOKEN) return true;
  const token = req.headers['x-morroo-token'] || req.headers['authorization']?.replace('Bearer ', '') || req.body?.token;
  return token === MORROO_TOKEN;
}

function sendCallback(userId, text) {
  if (!MORROO_CALLBACK_URL) return Promise.resolve();
  return new Promise((resolve) => {
    const payload = JSON.stringify({ userId, message: text });
    const url = new URL(MORROO_CALLBACK_URL);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      res.on('data', () => {});
      res.on('end', () => { console.log('[Morroo] Callback sent:', res.statusCode); resolve(); });
    });
    req.on('error', (e) => { console.error('[Morroo] Callback error:', e.message); resolve(); });
    req.write(payload);
    req.end();
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  if (!verifyToken(req)) {
    console.warn('[Morroo] Invalid token');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const body = req.body || {};
    const userId = body.userId || body.user_id || body.senderId || body.from;
    const text = body.message || body.text || body.content;
    const customerName = body.displayName || body.name || body.username || 'ลูกค้า';

    if (!userId || !text) {
      console.warn('[Morroo] Missing userId or message:', body);
      return res.status(200).json({ message: '' });
    }

    console.log(`[Morroo] ${userId}: ${text}`);

    const lead = leadStore.get(userId);
    if (!lead) leadStore.update(userId, { name: customerName });

    onUserReply(userId);
    const aiResponse = await getAIResponse(userId, text, lead?.level || null);
    const { hasHandoff, type, cleanText } = checkHandoff(aiResponse);

    const postCourseMatch = aiResponse.match(/\[INTENT:POST_COURSE\]/);
    const finalText = cleanText.replace(/\[INTENT:POST_COURSE\]/g, '').trim();

    if (postCourseMatch) {
      leadStore.update(userId, { level: 'post_course' });
      schedulePostCourseFollowUp(userId, MORROO_TOKEN, 'morroo').catch(console.error);
    }

    if (hasHandoff) {
      triggerHandoff({ customerName, platform: 'Morroo', question: text, handoffType: type }).catch(console.error);
    }

    await sendCallback(userId, finalText);
    return res.status(200).json({ message: finalText, text: finalText, reply: finalText });

  } catch (err) {
    console.error('[Morroo] Error:', err.message || err);
    return res.status(200).json({ message: 'ขออภัยค่ะ เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้งนะคะ' });
  }
};
