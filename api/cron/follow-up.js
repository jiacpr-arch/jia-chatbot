const https = require('https');
const { getReadyMessages } = require('../lib/follow-up');

const CRON_SECRET = process.env.CRON_SECRET || '';

// ส่งข้อความผ่าน Send API (with optional message tag for outside 24hr)
function sendFollowUp(psid, text, pageToken, tag) {
  return new Promise((resolve) => {
    const msg = { recipient: { id: psid }, message: { text: text.slice(0, 2000) } };
    if (tag) msg.messaging_type = 'MESSAGE_TAG';
    if (tag) msg.tag = tag;

    const payload = JSON.stringify(msg);
    const req = https.request({
      hostname: 'graph.facebook.com',
      path: `/v19.0/me/messages?access_token=${encodeURIComponent(pageToken)}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        console.log(`[FollowUp] Sent to ${psid} (step ${tag || 'normal'}):`, res.statusCode);
        resolve(res.statusCode === 200);
      });
    });
    req.on('error', (e) => { console.error('[FollowUp] Error:', e.message); resolve(false); });
    req.write(payload);
    req.end();
  });
}

module.exports = async (req, res) => {
  // Security: verify cron secret
  const auth = req.headers.authorization;
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const messages = getReadyMessages();
  console.log(`[Cron] Follow-up check: ${messages.length} messages to send`);

  let sent = 0;
  for (const msg of messages) {
    const ok = await sendFollowUp(msg.psid, msg.message, msg.pageToken, msg.tag);
    if (ok) sent++;
  }

  return res.json({
    checked: true,
    total: messages.length,
    sent,
    timestamp: new Date().toISOString(),
  });
};
