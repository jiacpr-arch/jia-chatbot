const crypto = require('crypto');
const https = require('https');
const { getAIResponse, checkHandoff } = require('./lib/ai');
const { triggerHandoff } = require('./lib/handoff');
const { leadStore } = require('./lib/lead-store');
const { logLeadToSheet } = require('./lib/sheets');
const { scheduleFollowUp, schedulePostCourseFollowUp, cancelFollowUp, onUserReply } = require('./lib/follow-up');
const { getOrCreateCode, useReferralCode, extractCode } = require('./lib/referral');
const { getWelcomeMessage, recordConversion, recordImpression } = require('./lib/ab-test');

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

// ตรวจ signature จาก LINE
function verifySignature(rawBody, signature) {
  if (!LINE_CHANNEL_SECRET || !signature) return false;
  const expected = crypto
    .createHmac('sha256', LINE_CHANNEL_SECRET)
    .update(rawBody)
    .digest('base64');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// --- LINE API helpers ---

function lineRequest(path, body) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.line.me',
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode !== 200) console.error('[LINE]', path, res.statusCode, data.slice(0, 200));
        resolve(res.statusCode === 200);
      });
    });
    req.on('error', (err) => { console.error('[LINE] Request error:', err.message); resolve(false); });
    req.write(payload);
    req.end();
  });
}

function replyText(replyToken, text) {
  return lineRequest('/v2/bot/message/reply', {
    replyToken,
    messages: [{ type: 'text', text: text.slice(0, 5000) }],
  });
}

function replyQuickReply(replyToken, text, buttons) {
  const items = buttons.slice(0, 13).map((b) => ({
    type: 'action',
    action: { type: 'message', label: b.slice(0, 20), text: b },
  }));
  return lineRequest('/v2/bot/message/reply', {
    replyToken,
    messages: [{
      type: 'text',
      text: text.slice(0, 5000),
      quickReply: { items },
    }],
  });
}

function replyImage(replyToken, imageUrl) {
  return lineRequest('/v2/bot/message/reply', {
    replyToken,
    messages: [{
      type: 'image',
      originalContentUrl: imageUrl,
      previewImageUrl: imageUrl,
    }],
  });
}

function replyCarousel(replyToken, columns) {
  return lineRequest('/v2/bot/message/reply', {
    replyToken,
    messages: [{
      type: 'template',
      altText: 'แพ็กเกจ AED',
      template: {
        type: 'carousel',
        columns: columns.slice(0, 10),
      },
    }],
  });
}

function getUserProfile(userId) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.line.me',
      path: `/v2/bot/profile/${userId}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data).displayName || 'ลูกค้า'); } catch { resolve('ลูกค้า'); }
      });
    });
    req.on('error', () => resolve('ลูกค้า'));
    req.end();
  });
}

// --- Quick Reply Buttons (same as Messenger) ---

const WELCOME_BUTTONS = ['อบรม CPR บุคคลทั่วไป', 'จัดอบรมในองค์กร', 'นักศึกษาแพทย์/เภสัช', 'ซื้อ/เช่า AED'];
const TIMING_BUTTONS = ['สัปดาห์นี้', 'สัปดาห์หน้า', 'เดือนหน้า', 'ยังไม่แน่ใจ'];
const CORPORATE_SIZE_BUTTONS = ['ไม่เกิน 7 คน', '10-15 คน', '15 คนขึ้นไป'];
const STUDENT_TYPE_BUTTONS = ['นักเรียน/นักศึกษา', 'นักศึกษาแพทย์', 'นักศึกษาเภสัช'];
const AED_BUTTONS = ['ให้โทรกลับ', 'ดูเว็บก่อน'];
const YES_NO_BUTTONS = ['สนใจจอง', 'ขอข้อมูลเพิ่ม', 'ไว้ก่อน'];
const AFTER_BOOKING_BUTTONS = ['รับโค้ดชวนเพื่อน', 'ดูรอบเรียน'];

function matchButton(text) {
  const t = text.trim();
  if (t === 'อบรม CPR บุคคลทั่วไป') return 'CPR_INDIVIDUAL';
  if (t === 'จัดอบรมในองค์กร') return 'CORPORATE';
  if (t === 'นักศึกษาแพทย์/เภสัช') return 'STUDENT';
  if (t === 'ซื้อ/เช่า AED') return 'AED';
  if (t === 'นักเรียน/นักศึกษา') return 'STUDENT_GENERAL';
  if (t === 'นักศึกษาแพทย์') return 'STUDENT_MED';
  if (t === 'นักศึกษาเภสัช') return 'STUDENT_PHARM';
  if (t === 'สัปดาห์นี้' || t === 'สัปดาห์หน้า') return 'HOT_LEAD';
  if (t === 'เดือนหน้า') return 'WARM_LEAD';
  if (t === 'ยังไม่แน่ใจ') return 'COLD_LEAD';
  if (t === 'ไม่เกิน 7 คน') return 'CORP_MINI';
  if (t === '10-15 คน') return 'CORP_STANDARD';
  if (t === '15 คนขึ้นไป') return 'CORP_LARGE';
  if (t === 'ให้โทรกลับ') return 'AED_CALLBACK';
  if (t === 'ดูเว็บก่อน') return 'AED_WEB';
  if (t === 'สนใจจอง') return 'WANT_BOOKING';
  if (t === 'ขอข้อมูลเพิ่ม') return 'WANT_INFO';
  if (t === 'ไว้ก่อน') return 'NOT_NOW';
  if (t === 'รับโค้ดชวนเพื่อน') return 'GET_REFERRAL';
  if (t === 'ดูรอบเรียน') return 'VIEW_SCHEDULE';
  return null;
}

// Handle structured button flows — returns true if handled
async function handleButtonFlow(userId, text, replyToken, customerName) {
  const action = matchButton(text);
  if (!action) return false;

  const lead = leadStore.get(userId);

  switch (action) {
    case 'CPR_INDIVIDUAL':
      leadStore.update(userId, { type: 'individual', name: customerName });
      await replyQuickReply(replyToken,
        `คอร์ส Savelife ฿500/ท่าน ฝึกปฏิบัติจริง 3-4 ชม. ได้ใบ cert 2 ปีค่ะ ✅\nGoogle 4.9⭐ จาก 120+ รีวิว\nสถานที่: The Street รัชดา (MRT ศูนย์วัฒนธรรม ทางออก 4)\n\nสนใจเรียนช่วงไหนคะ?`,
        TIMING_BUTTONS);
      return true;

    case 'CORPORATE':
      leadStore.update(userId, { type: 'corporate', name: customerName });
      await replyQuickReply(replyToken,
        `รับจัดอบรม CPR/AED ในองค์กรค่ะ 🏢\nทีมวิทยากรไปสอนถึงที่ สะดวกมากค่ะ\n\nจำนวนผู้เข้าอบรมประมาณกี่คนคะ?`,
        CORPORATE_SIZE_BUTTONS);
      return true;

    case 'AED':
      leadStore.update(userId, { type: 'aed', name: customerName });
      // LINE carousel needs reply, can't mix with quick reply in same reply
      // So just use text with details instead
      await replyQuickReply(replyToken,
        `เรามีบริการขายและเช่า AED ค่ะ\n\n🔹 Safety Premium: ซื้อขาด ฿69,000\n🔹 Safety Start: ผ่อน ฿2,500/เดือน (18 เดือน)\n🔹 เช่ารายวัน: เริ่มต้น ฿999/วัน\n🔹 เช่ารายเดือน: ฿5,999/เดือน\n\nดูรายละเอียดที่ jia1669.com หรือให้ทีมโทรกลับแนะนำคะ?`,
        ['ให้โทรกลับ', 'ดูเว็บก่อน']);
      return true;

    case 'HOT_LEAD':
      leadStore.update(userId, { level: 'hot', timing: text });
      cancelFollowUp(userId);
      recordConversion(userId, 'line').catch(console.error);
      logLeadToSheet({ name: customerName, psid: userId, type: lead?.type || 'individual', level: 'hot', timing: text, source: 'line_bot' }).catch(console.error);
      await replyQuickReply(replyToken,
        `เยี่ยมเลยค่ะ! 🎉\n\nจองคอร์สได้เลย:\n👉 แอดไลน์ @jiacpr (ตอบเร็ว จองง่าย)\n👉 โทร 088-558-8078\n\n💳 ชำระผ่าน PromptPay: 088-558-8078 (฿500)\n💡 เรียนออนไลน์ฟรีก่อนที่ jiacpr.com/online แล้วมาเรียน hands-on ลดเหลือ ฿400 ค่ะ!`,
        AFTER_BOOKING_BUTTONS);
      triggerHandoff({ customerName, platform: 'LINE OA', question: `🔥 HOT LEAD — สนใจ${text}`, handoffType: 'HOT_LEAD' }).catch(console.error);
      return true;

    case 'WARM_LEAD':
      leadStore.update(userId, { level: 'warm', timing: text });
      scheduleFollowUp(userId, LINE_CHANNEL_ACCESS_TOKEN, 'line');
      await replyQuickReply(replyToken,
        `ไม่มีปัญหาค่ะ! 😊\nน้องเจียจะส่งข้อมูลและโปรโมชั่นให้ทางนี้นะคะ\n\n💡 ลองเรียนออนไลน์ฟรีก่อนได้ที่ jiacpr.com/online ค่ะ เรียนจบได้คูปองลด ฿100 ด้วย!`,
        YES_NO_BUTTONS);
      return true;

    case 'COLD_LEAD':
      leadStore.update(userId, { level: 'cold', timing: 'ยังไม่แน่ใจ' });
      scheduleFollowUp(userId, LINE_CHANNEL_ACCESS_TOKEN, 'line');
      await replyText(replyToken,
        `ไม่เป็นไรค่ะ! 🙏\n\n💡 แนะนำลองเรียนออนไลน์ฟรีก่อนได้ที่ jiacpr.com/online ค่ะ\nมี 6 บทเรียน เรียนจบได้ใบ cert ออนไลน์ + คูปองลด ฿100\n\nหรือแอดไลน์ @jiacpr ไว้ก่อนก็ได้ค่ะ จะได้ไม่พลาดโปร 😊`);
      return true;

    case 'CORP_MINI':
      leadStore.update(userId, { level: 'hot', corpSize: '≤7' });
      await replyQuickReply(replyToken,
        `แพ็กเกจ Mini ฿7,000/session สูงสุด 7 คนค่ะ\nทีมวิทยากรไปสอนถึงที่ ไม่ต้องเดินทาง!\n\nสนใจจองเลยไหมคะ?`,
        YES_NO_BUTTONS);
      return true;

    case 'CORP_STANDARD':
      leadStore.update(userId, { level: 'hot', corpSize: '10-15' });
      await replyQuickReply(replyToken,
        `แพ็กเกจ Standard ฿20,000/session รองรับ 10-15 คนค่ะ\nได้ใบ cert ทุกคน + ฝึกปฏิบัติจริง!\n\nสนใจจองเลยไหมคะ?`,
        YES_NO_BUTTONS);
      return true;

    case 'CORP_LARGE':
      leadStore.update(userId, { level: 'hot', corpSize: '15+' });
      logLeadToSheet({ name: customerName, psid: userId, type: 'corporate', level: 'hot', corpSize: '15+', source: 'line_bot' }).catch(console.error);
      await replyText(replyToken,
        `รับทราบค่ะ! สำหรับ 15 คนขึ้นไปทีมงานจะจัดแพ็กเกจพิเศษให้ค่ะ\nขอส่งต่อให้ทีมติดต่อกลับเพื่อเสนอราคาที่เหมาะสมนะคะ 🙏`);
      triggerHandoff({ customerName, platform: 'LINE OA', question: `🏢 อบรมองค์กร 15+ คน`, handoffType: 'CORPORATE_QUOTE' }).catch(console.error);
      return true;

    case 'AED_CALLBACK':
      leadStore.update(userId, { level: 'hot' });
      logLeadToSheet({ name: customerName, psid: userId, type: 'aed', level: 'hot', message: 'ขอให้โทรกลับ AED', source: 'line_bot' }).catch(console.error);
      await replyText(replyToken,
        `รับทราบค่ะ! ทีมงานจะโทรกลับภายใน 1 ชม. นะคะ 📞\nขอบคุณที่สนใจค่ะ 🙏`);
      triggerHandoff({ customerName, platform: 'LINE OA', question: '📞 ขอให้โทรกลับเรื่อง AED', handoffType: 'AED_CALLBACK' }).catch(console.error);
      return true;

    case 'STUDENT':
      leadStore.update(userId, { name: customerName });
      await replyQuickReply(replyToken,
        `ยินดีต้อนรับน้องๆ ค่ะ! 📚\nน้องเจียมีคอร์สและข้อสอบเหมาะสำหรับทุกสาขาเลยค่ะ\n\nน้องเรียนสายไหนคะ?`,
        STUDENT_TYPE_BUTTONS);
      return true;

    case 'STUDENT_GENERAL':
      leadStore.update(userId, { type: 'student', studentType: 'general', name: customerName });
      await replyQuickReply(replyToken,
        `คอร์ส Savelife เหมาะมากเลยค่ะ! ฿500 เรียน 3-4 ชม. จบในวันเดียว 🎓\nได้ใบ cert ใส่ portfolio สมัครงานได้ด้วย\n\n📚 ฝึกทำข้อสอบออนไลน์ได้ที่ roodee.me ค่ะ\n💡 หรือเรียนออนไลน์ฟรีก่อนที่ jiacpr.com/online\n\nสนใจจองเรียนช่วงไหนคะ?`,
        TIMING_BUTTONS);
      return true;

    case 'STUDENT_MED':
      leadStore.update(userId, { type: 'student', studentType: 'med', name: customerName });
      await replyQuickReply(replyToken,
        `สำหรับน้องแพทย์มีหลายคอร์สเลยค่ะ 🩺\n\n✅ BLS / ACLS — ใบ cert ใช้ขึ้นทะเบียนวิชาชีพได้\n✅ เตรียมสอบ NL / OSCE — ดูที่ jiacpr.com/nl\n📚 ฝึกทำข้อสอบได้ที่ morroo.com ค่ะ\n\nสนใจคอร์สไหนคะ? หรือจะจองเลยก็ได้ค่ะ`,
        YES_NO_BUTTONS);
      return true;

    case 'STUDENT_PHARM':
      leadStore.update(userId, { type: 'student', studentType: 'pharm', name: customerName });
      await replyQuickReply(replyToken,
        `เภสัชกรอยู่หน้าด่านแรกที่พบผู้ป่วยเลยค่ะ มี CPR ช่วยชีวิตได้จริง 💛\n\n✅ Savelife ฿500 — เริ่มต้นสำหรับทุกคน\n✅ BLS — cert ระดับบุคลากรการแพทย์\n📚 ฝึกทำข้อสอบได้ที่ pharmru.com ค่ะ\n\nสนใจจองช่วงไหนคะ?`,
        TIMING_BUTTONS);
      return true;

    case 'AED_WEB':
      leadStore.update(userId, { level: 'warm' });
      await replyText(replyToken,
        `ดูรายละเอียด AED ทุกรุ่นได้ที่ 👉 jia1669.com ค่ะ\nถ้ามีคำถามหรือต้องการคำแนะนำ ทักมาได้เลยนะคะ! 😊`);
      return true;

    case 'WANT_BOOKING':
      leadStore.update(userId, { level: 'hot' });
      cancelFollowUp(userId);
      recordConversion(userId, 'line').catch(console.error);
      logLeadToSheet({ name: customerName, psid: userId, type: lead?.type || 'individual', level: 'hot', message: 'สนใจจอง', source: 'line_bot' }).catch(console.error);
      await replyQuickReply(replyToken,
        `เยี่ยมเลยค่ะ! 🎉 จองได้เลย:\n\n👉 แอดไลน์ @jiacpr (แนะนำ — ตอบเร็ว จองง่าย)\n👉 โทร 088-558-8078\n\n💳 ชำระผ่าน PromptPay: 088-558-8078\nหรือโอนธนาคารแล้วส่งสลิปทาง LINE ได้เลยค่ะ`,
        AFTER_BOOKING_BUTTONS);
      triggerHandoff({ customerName, platform: 'LINE OA', question: `✅ สนใจจอง (${lead?.type || 'ทั่วไป'})`, handoffType: 'HOT_LEAD' }).catch(console.error);
      return true;

    case 'WANT_INFO':
      return false; // ส่งให้ AI ตอบต่อ

    case 'NOT_NOW':
      leadStore.update(userId, { level: 'cold' });
      await replyText(replyToken,
        `ได้เลยค่ะ! ถ้าพร้อมเมื่อไหร่ทักมาได้ตลอดนะคะ 🙏\n\n💡 เพิ่มเพื่อน LINE @jiacpr ไว้ก่อนก็ได้ค่ะ จะได้ไม่พลาดโปร!\n📚 หรือลองเรียนออนไลน์ฟรีที่ jiacpr.com/online ค่ะ`);
      return true;

    case 'GET_REFERRAL': {
      const { code, count, discountBaht } = await getOrCreateCode(userId, 'line', customerName);
      await replyText(replyToken,
        `โค้ดชวนเพื่อนของคุณค่ะ 🎁\n\n🔑 โค้ด: ${code}\n\nวิธีใช้:\n1. แชร์โค้ดให้เพื่อน\n2. เพื่อนทักบอทแล้วพิมพ์โค้ดนี้\n3. เพื่อนได้ส่วนลด ฿100 ค่ะ!\n4. คุณได้รับเครดิต ฿50 ทุกคนที่แนะนำ 💛\n\n📊 สถิติ: ชวนไปแล้ว ${count} คน / เครดิตรวม ฿${discountBaht}\n\n(ใช้เครดิตได้เมื่อจองคอร์สครั้งถัดไปค่ะ)`);
      return true;
    }

    case 'VIEW_SCHEDULE':
      await replyText(replyToken,
        `ดูตารางเรียนทุกรอบได้ที่ 👉 www.jiacpr.com/schedule\nหรือทักทีมผ่าน LINE @jiacpr เพื่อดูรอบที่ว่างค่ะ 📅`);
      triggerHandoff({ customerName, platform: 'LINE OA', question: '📅 ขอดูตารางเรียน', handoffType: 'SCHEDULE' }).catch(console.error);
      return true;

    default:
      return false;
  }
}

// --- Main webhook handler ---

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const signature = req.headers['x-line-signature'];
  const rawBody = JSON.stringify(req.body);
  if (LINE_CHANNEL_SECRET && !verifySignature(rawBody, signature)) {
    console.warn('[LINE] Invalid signature');
    return res.status(401).send('Unauthorized');
  }

  try {
    for (const event of req.body.events || []) {
      // Follow event — ส่งข้อความต้อนรับพร้อม Quick Reply
      if (event.type === 'follow') {
        const userId = event.source.userId;
        const customerName = await getUserProfile(userId);
        leadStore.update(userId, { name: customerName });
        const { message: welcomeMsg } = getWelcomeMessage(userId);
        recordImpression(userId, 'line').catch(console.error);
        await replyQuickReply(
          event.replyToken,
          `สวัสดีค่ะ ${customerName}!\n${welcomeMsg}`,
          WELCOME_BUTTONS
        );
        continue;
      }

      if (event.type !== 'message' || event.message.type !== 'text') continue;

      const userId = event.source.userId;
      const text = event.message.text;
      const replyToken = event.replyToken;

      console.log(`[LINE] ${userId}: ${text}`);

      const customerName = await getUserProfile(userId);
      const lead = leadStore.get(userId);

      // Admin commands
      if (ADMIN_SECRET && text.startsWith(`/admin:${ADMIN_SECRET}`)) {
        const cmd = text.slice(`/admin:${ADMIN_SECRET}`.length).trim().toLowerCase();
        const { getABStats } = require('./lib/ab-test');
        let hot = 0, warm = 0, cold = 0, total = 0;
        leadStore.forEach && leadStore.forEach((v) => {
          total++;
          if (v.level === 'hot') hot++;
          else if (v.level === 'warm') warm++;
          else cold++;
        });
        const abStats = await getABStats().catch(() => null);
        await replyText(replyToken,
          `📊 Admin Stats\n\nLeads: ${total} total\n🔥 Hot: ${hot} | 🟡 Warm: ${warm} | 🔵 Cold: ${cold}\n\nA/B Test:\nA: ${abStats?.A?.assigned||0} → ${abStats?.A?.rate||'?'}\nB: ${abStats?.B?.assigned||0} → ${abStats?.B?.rate||'?'}`
        );
        continue;
      }

      // First-time user ที่ไม่ได้กดปุ่ม → A/B welcome
      if (!lead && !matchButton(text)) {
        leadStore.update(userId, { name: customerName, firstMessage: text });
        const { message: welcomeMsg } = getWelcomeMessage(userId);
        recordImpression(userId, 'line').catch(console.error);
        await replyQuickReply(replyToken, welcomeMsg, WELCOME_BUTTONS);
        continue;
      }

      // Button flow ก่อน
      const handled = await handleButtonFlow(userId, text, replyToken, customerName);
      if (handled) continue;

      // Check for referral code in free text (e.g. "มีโค้ด JIA12345")
      const refCode = extractCode(text);
      if (refCode) {
        const result = await useReferralCode(refCode, userId, 'line');
        if (result) {
          await replyText(replyToken,
            `ยืนยันโค้ด ${refCode} แล้วค่ะ! 🎉\nคุณได้รับส่วนลด ฿100 สำหรับคอร์สแรกนะคะ\nแจ้งโค้ดนี้เมื่อจองกับทีมงานได้เลยค่ะ 💛`);
        } else {
          await replyText(replyToken,
            `ขออภัยค่ะ ไม่พบโค้ด "${refCode}" ในระบบ\nกรุณาตรวจสอบโค้ดอีกครั้งนะคะ`);
        }
        continue;
      }

      // AI สำหรับ free-text
      onUserReply(userId);
      const aiResponse = await getAIResponse(userId, text, lead?.level || null);
      const { hasHandoff, type, cleanText } = checkHandoff(aiResponse);

      // ตรวจ POST_COURSE intent
      const postCourseMatch = aiResponse.match(/\[INTENT:POST_COURSE\]/);
      const finalText = cleanText.replace(/\[INTENT:POST_COURSE\]/g, '').trim();

      await replyText(replyToken, finalText);

      if (postCourseMatch) {
        leadStore.update(userId, { level: 'post_course' });
        schedulePostCourseFollowUp(userId, LINE_CHANNEL_ACCESS_TOKEN, 'line').catch(console.error);
        console.log(`[LINE] Post-course sequence scheduled for ${userId}`);
      }

      if (hasHandoff) {
        triggerHandoff({
          customerName,
          platform: 'LINE OA',
          question: text,
          handoffType: type,
        }).catch(console.error);
      }
    }
  } catch (err) {
    console.error('[LINE] Error:', err.message || err);
  }

  return res.status(200).send('OK');
};
