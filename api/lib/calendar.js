/**
 * Google Calendar Booking via Google Apps Script (GAS) webhook
 *
 * Setup:
 * 1. Create a Google Apps Script at script.google.com
 * 2. Paste the template from setup/gas-calendar.js
 * 3. Deploy as Web App → "Anyone" can access
 * 4. Set env var GOOGLE_APPS_SCRIPT_URL to the deployment URL
 *
 * The GAS creates a Google Calendar event and returns:
 * { success: true, eventId: "...", eventLink: "https://..." }
 */

const https = require('https');

/**
 * Create a booking on Google Calendar via GAS webhook
 * @param {object} params
 * @param {string} params.name         - Customer name
 * @param {string} params.phone        - Phone number
 * @param {string} params.courseType   - e.g. "Savelife CPR", "BLS", "อบรมองค์กร"
 * @param {string} params.dateStr      - e.g. "2026-04-15"
 * @param {string} params.timeStr      - e.g. "09:00"
 * @param {string} [params.note]       - Extra notes
 * @param {string} [params.platform]   - "messenger" | "line"
 * @returns {Promise<{ success: boolean, eventLink?: string, message?: string }>}
 */
async function createBooking({ name, phone, courseType, dateStr, timeStr, note, platform }) {
  const gasUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
  if (!gasUrl) {
    console.warn('[Calendar] GOOGLE_APPS_SCRIPT_URL ไม่ได้ตั้งค่า');
    return { success: false, message: 'ระบบจองยังไม่พร้อม กรุณาแอดไลน์ @jiacpr เพื่อจองด้วยตนเองค่ะ' };
  }

  const params = new URLSearchParams({
    action: 'createBooking',
    name: name || '',
    phone: phone || '',
    courseType: courseType || '',
    date: dateStr || '',
    time: timeStr || '',
    note: note || '',
    platform: platform || 'bot',
  });

  return new Promise((resolve) => {
    const url = new URL(gasUrl);
    const path = url.pathname + '?' + params.toString();

    const req = https.request(
      {
        hostname: url.hostname,
        path,
        method: 'GET',
      },
      (res) => {
        let data = '';
        // GAS may redirect (302) — follow manually if needed
        if (res.statusCode === 302 && res.headers.location) {
          const loc = new URL(res.headers.location);
          https.get(loc.href, (res2) => {
            let d2 = '';
            res2.on('data', (c) => (d2 += c));
            res2.on('end', () => {
              try { resolve(JSON.parse(d2)); } catch { resolve({ success: true }); }
            });
          }).on('error', () => resolve({ success: true }));
          return;
        }
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve({ success: true }); }
        });
      }
    );
    req.on('error', (err) => {
      console.error('[Calendar] GAS request error:', err.message);
      resolve({ success: false, message: 'ระบบจองขัดข้อง กรุณาทักทีมผ่าน LINE @jiacpr ค่ะ' });
    });
    req.end();
  });
}

/**
 * Parse date/time intent from Thai text
 * Returns { dateStr, timeStr } or null if cannot determine
 * Examples: "เสาร์นี้" "พรุ่งนี้เช้า" "15 เมษา ตอน 9 โมง"
 */
function parseDateTimeFromText(text) {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 6=Sat

  // Simple keyword detection
  let date = null;
  if (/พรุ่งนี้/.test(text)) {
    date = new Date(now);
    date.setDate(date.getDate() + 1);
  } else if (/เสาร์นี้|วันเสาร์/.test(text)) {
    date = new Date(now);
    date.setDate(date.getDate() + ((6 - day + 7) % 7 || 7));
  } else if (/อาทิตย์นี้|วันอาทิตย์/.test(text)) {
    date = new Date(now);
    date.setDate(date.getDate() + ((0 - day + 7) % 7 || 7));
  } else if (/สัปดาห์หน้า/.test(text)) {
    date = new Date(now);
    date.setDate(date.getDate() + 7);
  }

  if (!date) return null;

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;

  // Time detection
  let timeStr = '09:00'; // default morning
  if (/บ่าย|13|14|15|16/.test(text)) timeStr = '13:00';
  else if (/เย็น|17|18/.test(text)) timeStr = '17:00';
  else if (/10\s*โมง/.test(text)) timeStr = '10:00';

  return { dateStr, timeStr };
}

module.exports = { createBooking, parseDateTimeFromText };
