/**
 * Webhook handler สำหรับ roodee.me
 *
 * รูปแบบที่คาดว่าได้รับ (ปรับตาม docs จริงทีหลัง):
 * POST /api/roodee
 * {
 *   "userId": "user123",
 *   "message": "ข้อความจากลูกค้า",
 *   "displayName": "ชื่อลูกค้า"  // optional
 * }
 *
 * ตอบกลับในรูปแบบ:
 * { "message": "คำตอบจาก bot" }
 */

const https = require('https');
const { getAIResponse, checkHandoff } = require('./lib/ai');
const { triggerHandoff } = require('./lib/handoff');
const { leadStore } = require('./lib/lead-store');
const { logLeadToSheet } = require('./lib/sheets');
const { scheduleFollowUp, schedulePostCourseFollowUp, cancelFollowUp, onUserReply } = require('./lib/follow-up');

const ROODEE_TOKEN = process.env.ROODEE_TOKEN || '';
// ถ้า roodee.me ต้องการ callback URL แทนการตอบใน response body
const ROODEE_CALLBACK_URL = process.env.ROODEE_CALLBACK_URL || '';

function verifyToken(req) {
  if (!ROODEE_TOKEN) return true; // ถ้าไม่ตั้งค่า token ให้ผ่านได้ (dev mode)
  const token = req.headers['x-roodee-token'] || req.headers['authorization']?.replace('Bearer ', '') || req.body?.token;
  return token === ROODEE_TOKEN;
}

// ส่งข้อความกลับผ่าน callback URL (ถ้ามี)
function sendCallback(userId, text) {
  if (!ROODEE_CALLBACK_URL) return Promise.resolve();
  return new Promise((resolve) => {
    const payload = JSON.stringify({ userId, message: text });
    const url = new URL(ROODEE_CALLBACK_URL);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      res.on('data', () => {});
      res.on('end', () => { console.log('[Roodee] Callback sent:', res.statusCode); resolve(); });
    });
    req.on('error', (e) => { console.error('[Roodee] Callback error:', e.message); resolve(); });
    req.write(payload);
    req.end();
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  if (!verifyToken(req)) {
    console.warn('[Roodee] Invalid token');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // รองรับหลายรูปแบบ field name ที่แพลตฟอร์มอาจส่งมา
    const body = req.body || {};
    const userId = body.userId || body.user_id || body.senderId || body.from;
    const text = body.message || body.text || body.content;
    const customerName = body.displayName || body.name || body.username || 'ลูกค้า';

    if (!userId || !text) {
      console.warn('[Roodee] Missing userId or message:', body);
      return res.status(200).json({ message: '' });
    }

    console.log(`[Roodee] ${userId}: ${text}`);

    const lead = leadStore.get(userId);
    if (!lead) leadStore.update(userId, { name: customerName });

    onUserReply(userId);
    const aiResponse = await getAIResponse(userId, text, lead?.level || null);
    const { hasHandoff, type, cleanText } = checkHandoff(aiResponse);

    // ตรวจ POST_COURSE intent
    const postCourseMatch = aiResponse.match(/\[INTENT:POST_COURSE\]/);
    const finalText = cleanText.replace(/\[INTENT:POST_COURSE\]/g, '').trim();

    if (postCourseMatch) {
      leadStore.update(userId, { level: 'post_course' });
      schedulePostCourseFollowUp(userId, ROODEE_TOKEN, 'roodee').catch(console.error);
    }

    if (hasHandoff) {
      triggerHandoff({ customerName, platform: 'Roodee', question: text, handoffType: type }).catch(console.error);
    }

    // ส่งกลับทั้ง response body และ callback (ถ้ามี)
    await sendCallback(userId, finalText);
    return res.status(200).json({ message: finalText, text: finalText, reply: finalText });

  } catch (err) {
    console.error('[Roodee] Error:', err.message || err);
    return res.status(200).json({ message: 'ขออภัยค่ะ เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้งนะคะ' });
  }
};
