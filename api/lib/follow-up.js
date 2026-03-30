/**
 * Follow-up sequence สำหรับ lead ที่ยังไม่ตอบ
 * เก็บ queue ลง Supabase (chatbot_followups table) เพื่อไม่ให้หายเมื่อ cold start
 *
 * Vercel Cron จะเรียก /api/cron/follow-up ทุกวัน 9 AM UTC
 *
 * หมายเหตุ: Facebook 24-hour rule
 * - ข้อความ +1ชม. และ +24ชม. → ส่งได้ (อยู่ใน 24hr window)
 * - ข้อความ +3วัน และ +7วัน → ต้องใช้ Message Tag: CONFIRMED_EVENT_UPDATE
 */

const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tpoiyykbgsgnrdwzgzvn.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

const FOLLOW_UP_SEQUENCE = [
  {
    delayMs: 1 * 60 * 60 * 1000, // +1 ชั่วโมง
    tag: null,
    message: `รู้ไหมคะ? 💔 70% ของผู้ป่วยหัวใจหยุดเต้น เสียชีวิตเพราะไม่มีคนทำ CPR ได้ทัน\n\nเรียนแค่ครึ่งวันก็ช่วยชีวิตคนได้แล้วค่ะ\n\n👉 จองคอร์สได้ที่ LINE @jiacpr หรือโทร 088-558-8078`,
  },
  {
    delayMs: 24 * 60 * 60 * 1000, // +24 ชั่วโมง
    tag: null,
    message: `⭐ ผู้เรียนของเรา 95% บอกว่า "รู้สึกมั่นใจขึ้นมาก" หลังเรียนจบ\n\nคอร์สถัดไปเปิดเร็วๆ นี้ค่ะ สนใจจองไหมคะ?\n\n👉 แอดไลน์ @jiacpr หรือโทร 088-558-8078`,
  },
  {
    delayMs: 3 * 24 * 60 * 60 * 1000, // +3 วัน
    tag: 'CONFIRMED_EVENT_UPDATE',
    message: `📣 โปรพิเศษ! จองคอร์ส CPR วันนี้\n\n💡 เรียนออนไลน์ฟรีก่อนที่ jiacpr.com/online แล้วมาเรียน hands-on ลดเหลือ ฿400 ค่ะ!\n\nชวนเพื่อนมาด้วยยิ่งคุ้ม 😊\n\n👉 จอง LINE @jiacpr`,
  },
  {
    delayMs: 7 * 24 * 60 * 60 * 1000, // +7 วัน
    tag: 'CONFIRMED_EVENT_UPDATE',
    message: `สวัสดีค่ะ! 🙏\n\nยังสนใจเรื่องอบรม CPR อยู่ไหมคะ?\n\nถ้ามีคำถามอะไร ทักมาได้เลยนะคะ\n👉 LINE @jiacpr หรือโทร 088-558-8078`,
  },
];

// --- Supabase helpers ---

function supabaseRequest(method, path, body) {
  if (!SUPABASE_KEY) {
    console.log('[FollowUp] SUPABASE_SERVICE_KEY not set, skipping');
    return Promise.resolve(null);
  }

  const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
  const payload = body ? JSON.stringify(body) : '';

  return new Promise((resolve) => {
    const headers = {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': method === 'POST' ? 'return=minimal' : '',
    };
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers,
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });
    req.on('error', (err) => {
      console.error('[FollowUp] Supabase error:', err.message);
      resolve(null);
    });
    if (payload && method !== 'GET' && method !== 'DELETE') req.write(payload);
    req.end();
  });
}

// --- Public API ---

async function scheduleFollowUp(psid, pageToken) {
  if (!SUPABASE_KEY) {
    console.log('[FollowUp] No Supabase key, cannot persist follow-up');
    return;
  }

  const row = {
    psid,
    page_token: pageToken,
    started_at: new Date().toISOString(),
    next_index: 0,
    last_interaction: new Date().toISOString(),
    status: 'active',
  };

  await supabaseRequest('POST', 'chatbot_followups', row);
  console.log(`[FollowUp] Scheduled for ${psid}`);
}

async function cancelFollowUp(psid) {
  if (!SUPABASE_KEY) return;
  await supabaseRequest('PATCH',
    `chatbot_followups?psid=eq.${psid}&status=eq.active`,
    { status: 'cancelled' }
  );
  console.log(`[FollowUp] Cancelled for ${psid}`);
}

async function onUserReply(psid) {
  if (!SUPABASE_KEY) return;
  await supabaseRequest('PATCH',
    `chatbot_followups?psid=eq.${psid}&status=eq.active`,
    { last_interaction: new Date().toISOString() }
  );
}

async function getReadyMessages() {
  if (!SUPABASE_KEY) return [];

  const rows = await supabaseRequest('GET',
    'chatbot_followups?status=eq.active&select=*'
  );

  if (!rows || !Array.isArray(rows)) return [];

  const now = Date.now();
  const toSend = [];

  for (const entry of rows) {
    if (entry.next_index >= FOLLOW_UP_SEQUENCE.length) {
      // จบ sequence แล้ว
      await supabaseRequest('PATCH',
        `chatbot_followups?id=eq.${entry.id}`,
        { status: 'completed' }
      );
      continue;
    }

    const step = FOLLOW_UP_SEQUENCE[entry.next_index];
    const timeSinceStart = now - new Date(entry.started_at).getTime();
    const timeSinceLastReply = now - new Date(entry.last_interaction).getTime();

    // ถ้า lead ตอบกลับภายใน 2 ชม. → ข้ามไม่ส่ง follow-up
    if (timeSinceLastReply < 2 * 60 * 60 * 1000 && entry.next_index > 0) {
      continue;
    }

    // ถ้าถึงเวลาส่ง
    if (timeSinceStart >= step.delayMs) {
      toSend.push({
        psid: entry.psid,
        pageToken: entry.page_token,
        message: step.message,
        tag: step.tag,
        index: entry.next_index,
        id: entry.id,
      });
    }
  }

  return toSend;
}

async function markSent(id, nextIndex) {
  await supabaseRequest('PATCH',
    `chatbot_followups?id=eq.${id}`,
    { next_index: nextIndex + 1 }
  );
}

module.exports = {
  FOLLOW_UP_SEQUENCE,
  scheduleFollowUp,
  cancelFollowUp,
  onUserReply,
  getReadyMessages,
  markSent,
};
