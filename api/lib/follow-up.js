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
    label: 'hour1',
    message: `รู้ไหมคะ? 💔 70% ของผู้ป่วยหัวใจหยุดเต้น เสียชีวิตเพราะไม่มีคนทำ CPR ได้ทัน\n\nเรียนแค่ครึ่งวันก็ช่วยชีวิตคนได้แล้วค่ะ\n\n👉 จองคอร์สได้ที่ LINE @jiacpr หรือโทร 088-558-8078`,
  },
  {
    delayMs: 24 * 60 * 60 * 1000, // +1 วัน
    tag: null,
    label: 'day1',
    message: `⭐ Google 4.9/5.0 จากลูกค้า 120+ รีวิว\n\nผู้เรียนบอกว่า "รู้สึกมั่นใจขึ้นมาก และรู้สึกว่าช่วยชีวิตคนได้จริง" ค่ะ\n\nยังสนใจจองคอร์สอยู่ไหมคะ?\n👉 LINE @jiacpr หรือโทร 088-558-8078`,
  },
  {
    delayMs: 3 * 24 * 60 * 60 * 1000, // +3 วัน
    tag: 'CONFIRMED_EVENT_UPDATE',
    label: 'day3',
    message: `สวัสดีค่ะ! น้องเจียแวะมาทักอีกทีนะคะ 🙏\n\n💡 เรียน CPR ออนไลน์ฟรีก่อนได้เลยที่ jiacpr.com/online\nเรียนจบได้ใบ cert + คูปองลด ฿100 สำหรับ hands-on ค่ะ\n\nมีคำถามอะไรพิมพ์มาได้เลยนะคะ 😊`,
  },
  {
    delayMs: 5 * 24 * 60 * 60 * 1000, // +5 วัน
    tag: 'CONFIRMED_EVENT_UPDATE',
    label: 'day5',
    message: `💛 เคยรู้ไหมคะว่า... ถ้ามี AED ในบ้านหรือออฟฟิศ โอกาสรอดชีวิตเพิ่มขึ้น 70%!\n\nเราไม่ได้แค่สอน CPR นะคะ ยังมีบริการ\n🔹 เช่า AED เริ่มต้น ฿999/วัน\n🔹 ผ่อนเป็นเจ้าของ เริ่มมัดจำ ฿15,000\n\nสนใจดูแพ็กเกจไหมคะ? ทักมาได้เลย 👉 LINE @jiacpr`,
  },
  {
    delayMs: 7 * 24 * 60 * 60 * 1000, // +7 วัน
    tag: 'CONFIRMED_EVENT_UPDATE',
    label: 'day7',
    message: `สวัสดีค่ะ! 🙏 น้องเจียส่งข้อความมาเป็นครั้งสุดท้ายนะคะ\n\nถ้าวันไหนพร้อมเรียน CPR หรือสนใจ AED ทักมาได้ตลอดเลยค่ะ\n\n📚 เรียนออนไลน์ฟรี: jiacpr.com/online\n🛒 ดู AED: jia1669.com\n📞 โทร: 088-558-8078\n💚 LINE: @jiacpr\n\nขอบคุณที่สนใจนะคะ 😊`,
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

// --- Post-course follow-up sequence (สำหรับลูกค้าที่เรียนแล้ว) ---

const POST_COURSE_SEQUENCE = [
  {
    delayMs: 3 * 24 * 60 * 60 * 1000, // +3 วันหลังเรียน
    tag: 'CONFIRMED_EVENT_UPDATE',
    label: 'post_day3',
    message: `สวัสดีค่ะ! หลังเรียน CPR แล้วเป็นยังไงบ้างคะ? 😊\n\nถ้ายังไม่มี AED ที่บ้านหรือออฟฟิศ แนะนำเลยนะคะ\n🔹 เช่า AED เริ่มต้น ฿999/วัน หรือ ฿5,999/เดือน\n🔹 ผ่อนเป็นเจ้าของ มัดจำ ฿15,000 + ฿2,500/เดือน\n\nมี AED + รู้ CPR = ช่วยชีวิตได้จริงค่ะ 💛\n👉 ดูแพ็กเกจที่ LINE @jiacpr`,
  },
  {
    delayMs: 14 * 24 * 60 * 60 * 1000, // +14 วัน
    tag: 'CONFIRMED_EVENT_UPDATE',
    label: 'post_day14',
    message: `สวัสดีค่ะ! 🙏\n\nชวนเพื่อน ครอบครัว หรือเพื่อนร่วมงานมาเรียน CPR ด้วยได้นะคะ\n💡 ยิ่งคนรอบข้างรู้ CPR ด้วย โอกาสช่วยชีวิตกันได้สูงมากค่ะ\n\nคอร์ส Savelife แค่ ฿500/ท่าน เรียนจบในครึ่งวันค่ะ\n👉 จอง LINE @jiacpr หรือโทร 088-558-8078`,
  },
  {
    delayMs: 60 * 24 * 60 * 60 * 1000, // +60 วัน
    tag: 'CONFIRMED_EVENT_UPDATE',
    label: 'post_day60',
    message: `สวัสดีค่ะ! น้องเจียแวะมาทักนะคะ 😊\n\nถ้าอยากยกระดับทักษะ มีคอร์ส BLS & ACLS สำหรับบุคลากรทางการแพทย์ด้วยนะคะ\nดูรายละเอียดได้ที่ jiacpr.com/bls ค่ะ\n\nหรือถ้าองค์กรต้องการจัดอบรม In-house ทีมวิทยากรไปสอนถึงที่ได้เลยนะคะ 🏢\n👉 สอบถาม LINE @jiacpr`,
  },
  {
    delayMs: 540 * 24 * 60 * 60 * 1000, // +18 เดือน (ใกล้หมดอายุ cert)
    tag: 'CONFIRMED_EVENT_UPDATE',
    label: 'post_day540',
    message: `สวัสดีค่ะ! 🙏 ใบประกาศนียบัตร CPR ของคุณ\nใกล้หมดอายุ 2 ปีแล้วนะคะ\n\n💡 ต่ออายุใบ cert ได้ด้วยการเรียนซ้ำ Savelife ฿500 ค่ะ\nทักษะ CPR ยิ่งฝึกบ่อย ยิ่งช่วยชีวิตได้จริงค่ะ\n\n👉 จอง LINE @jiacpr หรือโทร 088-558-8078`,
  },
];

// --- Public API ---

async function scheduleFollowUp(psid, pageToken) {
  if (!SUPABASE_KEY) {
    console.log('[FollowUp] No Supabase key, cannot persist follow-up');
    return;
  }

  // ยกเลิก sequence เดิมก่อน (ถ้ามี) แล้วสร้างใหม่
  await supabaseRequest('PATCH',
    `chatbot_followups?psid=eq.${psid}&status=eq.active`,
    { status: 'cancelled' }
  );

  const row = {
    psid,
    page_token: pageToken,
    started_at: new Date().toISOString(),
    next_index: 0,
    last_interaction: new Date().toISOString(),
    status: 'active',
    sequence_type: 'prospect',
  };

  await supabaseRequest('POST', 'chatbot_followups', row);
  console.log(`[FollowUp] Scheduled prospect sequence for ${psid}`);
}

async function schedulePostCourseFollowUp(psid, pageToken) {
  if (!SUPABASE_KEY) {
    console.log('[FollowUp] No Supabase key, cannot persist follow-up');
    return;
  }

  // ยกเลิก prospect sequence เดิม (ถ้ามี)
  await supabaseRequest('PATCH',
    `chatbot_followups?psid=eq.${psid}&status=eq.active&sequence_type=eq.prospect`,
    { status: 'cancelled' }
  );

  // ตรวจว่ามี post_course อยู่แล้วไหม (ไม่สร้างซ้ำ)
  const existing = await supabaseRequest('GET',
    `chatbot_followups?psid=eq.${psid}&status=eq.active&sequence_type=eq.post_course&select=id`
  );
  if (existing && existing.length > 0) {
    console.log(`[FollowUp] Post-course sequence already active for ${psid}`);
    return;
  }

  const row = {
    psid,
    page_token: pageToken,
    started_at: new Date().toISOString(),
    next_index: 0,
    last_interaction: new Date().toISOString(),
    status: 'active',
    sequence_type: 'post_course',
  };

  await supabaseRequest('POST', 'chatbot_followups', row);
  console.log(`[FollowUp] Scheduled post-course sequence for ${psid}`);
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
    const sequence = entry.sequence_type === 'post_course'
      ? POST_COURSE_SEQUENCE
      : FOLLOW_UP_SEQUENCE;

    if (entry.next_index >= sequence.length) {
      // จบ sequence แล้ว
      await supabaseRequest('PATCH',
        `chatbot_followups?id=eq.${entry.id}`,
        { status: 'completed' }
      );
      continue;
    }

    const step = sequence[entry.next_index];
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
  POST_COURSE_SEQUENCE,
  scheduleFollowUp,
  schedulePostCourseFollowUp,
  cancelFollowUp,
  onUserReply,
  getReadyMessages,
  markSent,
};
