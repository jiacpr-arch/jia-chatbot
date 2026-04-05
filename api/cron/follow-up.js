const https = require('https');
const { getReadyMessages, markSent } = require('../lib/follow-up');

const CRON_SECRET = process.env.CRON_SECRET || '';

// ส่งผ่าน Facebook Messenger (with optional message tag for outside 24hr)
function sendMessengerFollowUp(psid, text, pageToken, tag) {
  return new Promise((resolve) => {
    const msg = { messaging_type: 'RESPONSE', recipient: { id: psid }, message: { text: text.slice(0, 2000) } };
    if (tag) { msg.messaging_type = 'MESSAGE_TAG'; msg.tag = tag; }

    const payload = JSON.stringify(msg);
    const req = https.request({
      hostname: 'graph.facebook.com',
      path: `/v21.0/me/messages?access_token=${encodeURIComponent(pageToken)}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        console.log(`[FollowUp/FB] Sent to ${psid}:`, res.statusCode);
        resolve(res.statusCode === 200);
      });
    });
    req.on('error', (e) => { console.error('[FollowUp/FB] Error:', e.message); resolve(false); });
    req.write(payload);
    req.end();
  });
}

// ส่งผ่าน LINE Push API (ไม่มีข้อจำกัด 24 ชม.)
function sendLineFollowUp(userId, text, lineToken) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      to: userId,
      messages: [{ type: 'text', text: text.slice(0, 5000) }],
    });
    const req = https.request({
      hostname: 'api.line.me',
      path: '/v2/bot/message/push',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        Authorization: `Bearer ${lineToken}`,
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        console.log(`[FollowUp/LINE] Sent to ${userId}:`, res.statusCode);
        resolve(res.statusCode === 200);
      });
    });
    req.on('error', (e) => { console.error('[FollowUp/LINE] Error:', e.message); resolve(false); });
    req.write(payload);
    req.end();
  });
}

function sendFollowUp(msg) {
  if (msg.platform === 'line') {
    return sendLineFollowUp(msg.psid, msg.message, msg.pageToken);
  }
  return sendMessengerFollowUp(msg.psid, msg.message, msg.pageToken, msg.tag);
}

module.exports = async (req, res) => {
  // Security: verify cron secret
  const auth = req.headers.authorization;
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const messages = await getReadyMessages();
  console.log(`[Cron] Follow-up check: ${messages.length} messages to send`);

  let sent = 0;
  for (const msg of messages) {
    const ok = await sendFollowUp(msg);
    if (ok) {
      await markSent(msg.id, msg.index);
      sent++;
    }
  }

  return res.json({
    checked: true,
    total: messages.length,
    sent,
    timestamp: new Date().toISOString(),
  });
};
