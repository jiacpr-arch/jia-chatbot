const https = require('https');

const HANDOFF_TYPE_LABELS = {
  UNKNOWN: 'คำถามที่ไม่มีในระบบ',
  CORPORATE_QUOTE: 'อบรมองค์กร / ใบเสนอราคา',
  PRICE_NEGOTIATION: 'เจรจาราคาพิเศษ',
  COMPLAINT: 'ร้องเรียน / ไม่พอใจ',
  PAYMENT: 'การชำระเงิน / สลิป',
  HUMAN_REQUEST: 'ลูกค้าขอคุยกับคน',
  SCHEDULE: 'ถามรอบเรียนเฉพาะเจาะจง',
};

/**
 * แจ้งเตือนทีมงานผ่าน LINE Group Push Message
 */
async function notifyLineGroup({ customerName, platform, question, handoffType }) {
  const groupId = process.env.LINE_ALERT_GROUP_ID;
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!groupId || !token) {
    console.warn('[Handoff] LINE_ALERT_GROUP_ID หรือ LINE_CHANNEL_ACCESS_TOKEN ไม่ได้ตั้งค่า');
    return;
  }

  const typeLabel = HANDOFF_TYPE_LABELS[handoffType] || handoffType;
  const now = new Date().toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    dateStyle: 'short',
    timeStyle: 'short',
  });

  const message = `🔔 แจ้งเตือน Handoff\n\n👤 ลูกค้า: ${customerName}\n📱 ช่องทาง: ${platform}\n🏷️ ประเภท: ${typeLabel}\n💬 คำถาม: ${question}\n🕐 เวลา: ${now}\n\n👉 กรุณาติดต่อกลับด้วยนะคะ`;

  const body = JSON.stringify({
    to: groupId,
    messages: [{ type: 'text', text: message }],
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.line.me',
        path: '/v2/bot/message/push',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode === 200) {
            console.log('[Handoff] LINE Group แจ้งเตือนสำเร็จ');
            resolve();
          } else {
            console.error('[Handoff] LINE Group error:', res.statusCode, data);
            resolve(); // ไม่ throw เพื่อไม่ให้ระบบหลักพัง
          }
        });
      }
    );
    req.on('error', (err) => {
      console.error('[Handoff] LINE request error:', err.message);
      resolve();
    });
    req.write(body);
    req.end();
  });
}

/**
 * บันทึก handoff ลง Google Sheet (optional)
 */
async function logToSheet({ customerName, platform, question, handoffType }) {
  const sheetUrl = process.env.HANDOFF_SHEET_URL;
  if (!sheetUrl) return;

  const typeLabel = HANDOFF_TYPE_LABELS[handoffType] || handoffType;
  const params = new URLSearchParams({
    customer: customerName,
    platform,
    type: typeLabel,
    question,
    timestamp: new Date().toISOString(),
  });

  const url = new URL(sheetUrl + '?' + params.toString());

  return new Promise((resolve) => {
    const req = https.request(
      { hostname: url.hostname, path: url.pathname + url.search, method: 'GET' },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => {
          console.log('[Handoff] Sheet log status:', res.statusCode);
          resolve();
        });
      }
    );
    req.on('error', (err) => {
      console.error('[Handoff] Sheet log error:', err.message);
      resolve();
    });
    req.end();
  });
}

/**
 * เรียกใช้ทั้ง LINE notify + Sheet log พร้อมกัน
 */
async function triggerHandoff(params) {
  await Promise.all([notifyLineGroup(params), logToSheet(params)]);
}

module.exports = { triggerHandoff };
