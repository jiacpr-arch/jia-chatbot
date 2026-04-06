/**
 * LINE Rich Menu Setup (One-time)
 *
 * เรียกใช้ครั้งเดียวเพื่อสร้าง Rich Menu ที่จะแสดงใต้แชทของ LINE OA
 *
 * GET /api/line-richmenu?token=<DASHBOARD_SECRET>&action=create   → สร้าง menu
 * GET /api/line-richmenu?token=<DASHBOARD_SECRET>&action=delete   → ลบ menu ปัจจุบัน
 * GET /api/line-richmenu?token=<DASHBOARD_SECRET>&action=list     → แสดง menu ที่มีอยู่
 *
 * หลังสร้างแล้ว ต้องอัปโหลดรูปภาพ:
 *   curl -X POST https://api-data.line.me/v2/bot/richmenu/{richMenuId}/content \
 *     -H "Authorization: Bearer {LINE_CHANNEL_ACCESS_TOKEN}" \
 *     -H "Content-Type: image/jpeg" \
 *     --data-binary @richmenu.jpg
 *
 * ขนาดรูป: 2500x843 px (layout แนวนอน 3 ช่อง) หรือ 2500x1686 px (2 แถว 6 ช่อง)
 * สร้างรูปได้ที่ https://developers.line.biz/console/ → Rich Menu
 */

const https = require('https');

const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const DASHBOARD_SECRET = process.env.DASHBOARD_SECRET || '';

function lineApi(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const req = https.request(
      {
        hostname: 'api.line.me',
        path,
        method,
        headers: {
          Authorization: `Bearer ${LINE_TOKEN}`,
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Rich Menu structure — 3 buttons, single row (2500x843)
const RICH_MENU_BODY = {
  size: { width: 2500, height: 843 },
  selected: true,
  name: 'JIA Main Menu',
  chatBarText: '📋 เมนูหลัก',
  areas: [
    {
      bounds: { x: 0, y: 0, width: 833, height: 843 },
      action: { type: 'message', label: 'เรียน CPR', text: 'อบรม CPR บุคคลทั่วไป' },
    },
    {
      bounds: { x: 833, y: 0, width: 834, height: 843 },
      action: { type: 'message', label: 'องค์กร', text: 'จัดอบรมในองค์กร' },
    },
    {
      bounds: { x: 1667, y: 0, width: 833, height: 843 },
      action: { type: 'message', label: 'AED', text: 'ซื้อ/เช่า AED' },
    },
  ],
};

// Rich Menu structure — 6 buttons, 2 rows (2500x1686) — อีกทางเลือก
const RICH_MENU_BODY_6 = {
  size: { width: 2500, height: 1686 },
  selected: true,
  name: 'JIA Full Menu',
  chatBarText: '📋 เมนูหลัก',
  areas: [
    // Row 1
    { bounds: { x: 0, y: 0, width: 833, height: 843 }, action: { type: 'message', label: 'CPR ทั่วไป', text: 'อบรม CPR บุคคลทั่วไป' } },
    { bounds: { x: 833, y: 0, width: 834, height: 843 }, action: { type: 'message', label: 'องค์กร', text: 'จัดอบรมในองค์กร' } },
    { bounds: { x: 1667, y: 0, width: 833, height: 843 }, action: { type: 'message', label: 'นักศึกษา', text: 'นักศึกษาแพทย์/เภสัช' } },
    // Row 2
    { bounds: { x: 0, y: 843, width: 833, height: 843 }, action: { type: 'message', label: 'ซื้อ/เช่า AED', text: 'ซื้อ/เช่า AED' } },
    { bounds: { x: 833, y: 843, width: 834, height: 843 }, action: { type: 'uri', label: 'จองผ่าน LINE', uri: 'https://line.me/R/ti/p/@jiacpr' } },
    { bounds: { x: 1667, y: 843, width: 833, height: 843 }, action: { type: 'uri', label: 'โทรหาเรา', uri: 'tel:0885588078' } },
  ],
};

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.writeHead(405);
    return res.end('Method Not Allowed');
  }

  // Auth check
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const token = url.searchParams.get('token') || '';
  if (DASHBOARD_SECRET && token !== DASHBOARD_SECRET) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Unauthorized — ใส่ ?token=DASHBOARD_SECRET' }));
  }

  if (!LINE_TOKEN) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'LINE_CHANNEL_ACCESS_TOKEN ไม่ได้ตั้งค่า' }));
  }

  const action = url.searchParams.get('action') || 'create';
  const layout = url.searchParams.get('layout') || '3'; // '3' or '6'
  const menuBody = layout === '6' ? RICH_MENU_BODY_6 : RICH_MENU_BODY;

  try {
    if (action === 'list') {
      const result = await lineApi('GET', '/v2/bot/richmenu/list', null);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(result));
    }

    if (action === 'delete') {
      // Get current default rich menu
      const current = await lineApi('GET', '/v2/bot/user/all/richmenu', null);
      if (current.body?.richMenuId) {
        await lineApi('DELETE', `/v2/bot/richmenu/${current.body.richMenuId}`, null);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ deleted: current.body.richMenuId }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ message: 'ไม่มี default Rich Menu อยู่' }));
    }

    if (action === 'create') {
      // 1. Create the rich menu structure
      const created = await lineApi('POST', '/v2/bot/richmenu', menuBody);
      if (!created.body?.richMenuId) {
        throw new Error('สร้าง Rich Menu ไม่สำเร็จ: ' + JSON.stringify(created.body));
      }
      const richMenuId = created.body.richMenuId;

      // 2. Set as default for all users
      const setDefault = await lineApi('POST', `/v2/bot/user/all/richmenu/${richMenuId}`, null);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        richMenuId,
        layout: layout === '6' ? '6-button (2 rows)' : '3-button (1 row)',
        nextStep: `อัปโหลดรูป (2500x${layout === '6' ? '1686' : '843'}px) ด้วยคำสั่ง:\n` +
          `curl -X POST https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content \\\n` +
          `  -H "Authorization: Bearer ${LINE_TOKEN.slice(0, 10)}..." \\\n` +
          `  -H "Content-Type: image/jpeg" \\\n` +
          `  --data-binary @richmenu.jpg`,
        setDefaultResult: setDefault.status,
      }));
    }

    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'action ต้องเป็น create | delete | list' }));

  } catch (err) {
    console.error('[RichMenu]', err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: err.message }));
  }
};
