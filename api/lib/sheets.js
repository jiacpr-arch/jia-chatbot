const https = require('https');

/**
 * บันทึก lead ลง Google Sheets ผ่าน Google Apps Script Web App
 * ตั้ง GOOGLE_SHEET_WEBHOOK_URL ใน Vercel env
 *
 * Google Apps Script ที่ต้องสร้าง:
 * 1. เปิด Google Sheet → Extensions → Apps Script
 * 2. ใส่โค้ดด้านล่าง → Deploy as Web App (Anyone can access)
 * 3. Copy URL มาใส่ใน GOOGLE_SHEET_WEBHOOK_URL
 *
 * Apps Script code:
 * function doPost(e) {
 *   var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
 *   var data = JSON.parse(e.postData.contents);
 *   sheet.appendRow([
 *     data.timestamp,
 *     data.name,
 *     data.psid,
 *     data.platform,
 *     data.type,
 *     data.level,
 *     data.timing,
 *     data.corpSize,
 *     data.message,
 *     data.source,
 *     'ใหม่'  // สถานะเริ่มต้น
 *   ]);
 *   return ContentService.createTextOutput('OK');
 * }
 */

async function logLeadToSheet(data) {
  const url = process.env.GOOGLE_SHEET_WEBHOOK_URL;
  if (!url) {
    console.log('[Sheets] GOOGLE_SHEET_WEBHOOK_URL not set, skipping');
    return;
  }

  const payload = JSON.stringify({
    timestamp: new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
    name: data.name || 'ไม่ทราบ',
    psid: data.psid || '',
    platform: data.platform || 'Messenger',
    type: data.type || '',        // individual, corporate, aed
    level: data.level || '',      // hot, warm, cold
    timing: data.timing || '',
    corpSize: data.corpSize || '',
    message: data.message || '',
    source: data.source || 'messenger_bot',
    email: data.email || '',
    phone: data.phone || '',
  });

  const parsed = new URL(url);

  return new Promise((resolve) => {
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        // Google Apps Script redirects on POST — follow redirect
        if (res.statusCode === 302 || res.statusCode === 301) {
          const redirect = res.headers.location;
          if (redirect) {
            const rUrl = new URL(redirect);
            const rReq = https.request({
              hostname: rUrl.hostname,
              path: rUrl.pathname + rUrl.search,
              method: 'GET',
            }, (rRes) => {
              rRes.on('data', () => {});
              rRes.on('end', () => {
                console.log('[Sheets] Logged (redirect):', rRes.statusCode);
                resolve();
              });
            });
            rReq.on('error', () => resolve());
            rReq.end();
            return;
          }
        }
        console.log('[Sheets] Logged:', res.statusCode);
        resolve();
      });
    });
    req.on('error', (err) => {
      console.error('[Sheets] Error:', err.message);
      resolve();
    });
    req.write(payload);
    req.end();
  });
}

module.exports = { logLeadToSheet };
