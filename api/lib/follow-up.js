/**
 * Follow-up sequence สำหรับ lead ที่ยังไม่ตอบ
 *
 * Vercel Cron จะเรียก /api/cron/follow-up ทุก 1 ชม.
 * ตรวจสอบ lead ทั้งหมดว่าถึงเวลาส่ง follow-up หรือยัง
 *
 * หมายเหตุ: Facebook 24-hour rule
 * - ข้อความ +1ชม. และ +24ชม. → ส่งได้ (อยู่ใน 24hr window)
 * - ข้อความ +3วัน และ +7วัน → ต้องใช้ Message Tag: CONFIRMED_EVENT_UPDATE
 *   หรือ OTN (ยังไม่ implement ใน version นี้)
 */

const FOLLOW_UP_SEQUENCE = [
  {
    delayMs: 1 * 60 * 60 * 1000, // +1 ชั่วโมง
    tag: null, // ภายใน 24hr window
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

// In-memory follow-up queue (resets on cold start)
// For production: use Redis/database
const followUpQueue = new Map();

function scheduleFollowUp(psid, pageToken) {
  followUpQueue.set(psid, {
    psid,
    pageToken,
    startedAt: Date.now(),
    nextIndex: 0,        // ข้อความถัดไปที่จะส่ง
    lastInteraction: Date.now(),
  });
  console.log(`[FollowUp] Scheduled for ${psid}`);
}

function cancelFollowUp(psid) {
  if (followUpQueue.has(psid)) {
    followUpQueue.delete(psid);
    console.log(`[FollowUp] Cancelled for ${psid}`);
  }
}

// เมื่อ lead ตอบกลับ → reset timer
function onUserReply(psid) {
  const entry = followUpQueue.get(psid);
  if (entry) {
    entry.lastInteraction = Date.now();
    console.log(`[FollowUp] Reset timer for ${psid}`);
  }
}

// เรียกจาก cron — return ข้อความที่ต้องส่ง
function getReadyMessages() {
  const now = Date.now();
  const toSend = [];

  for (const [psid, entry] of followUpQueue.entries()) {
    if (entry.nextIndex >= FOLLOW_UP_SEQUENCE.length) {
      followUpQueue.delete(psid); // จบ sequence แล้ว
      continue;
    }

    const step = FOLLOW_UP_SEQUENCE[entry.nextIndex];
    const timeSinceStart = now - entry.startedAt;
    const timeSinceLastReply = now - entry.lastInteraction;

    // ถ้า lead ตอบกลับภายใน 2 ชม. → ข้ามไม่ส่ง follow-up
    if (timeSinceLastReply < 2 * 60 * 60 * 1000 && entry.nextIndex > 0) {
      continue;
    }

    // ถ้าถึงเวลาส่ง
    if (timeSinceStart >= step.delayMs) {
      toSend.push({
        psid: entry.psid,
        pageToken: entry.pageToken,
        message: step.message,
        tag: step.tag,
        index: entry.nextIndex,
      });
      entry.nextIndex++;
    }
  }

  return toSend;
}

module.exports = {
  FOLLOW_UP_SEQUENCE,
  scheduleFollowUp,
  cancelFollowUp,
  onUserReply,
  getReadyMessages,
};
