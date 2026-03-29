const crypto = require('crypto');
const https = require('https');
const { getAIResponse, checkHandoff } = require('./lib/ai');
const { triggerHandoff } = require('./lib/handoff');
const { leadStore } = require('./lib/lead-store');
const { logLeadToSheet } = require('./lib/sheets');

const FB_VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN || 'jia_chatbot_verify_2026';
const FB_APP_SECRET = process.env.FB_APP_SECRET;

// Map page ID → access token
const PAGE_TOKENS = {
  '115768024942069': process.env.FB_PAGE_ACCESS_TOKEN_JIA_CPR,
  '1032110679988495': process.env.FB_PAGE_ACCESS_TOKEN_JIA_TRAINING,
};

// --- Facebook Send API helpers ---

function fbSend(payload, pageToken) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: 'graph.facebook.com',
      path: `/v19.0/me/messages?access_token=${encodeURIComponent(pageToken)}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode !== 200) console.error('[FB Send]', res.statusCode, data.slice(0, 200));
        resolve(data);
      });
    });
    req.on('error', (err) => { console.error('[FB Send Error]', err.message); reject(err); });
    req.write(body);
    req.end();
  });
}

function sendText(psid, text, pageToken) {
  return fbSend({
    recipient: { id: psid },
    message: { text: text.slice(0, 2000) },
  }, pageToken);
}

function sendQuickReply(psid, text, buttons, pageToken) {
  return fbSend({
    recipient: { id: psid },
    message: {
      text: text.slice(0, 2000),
      quick_replies: buttons.map((b) => ({
        content_type: 'text',
        title: b.slice(0, 20),
        payload: b.toUpperCase().replace(/\s+/g, '_').slice(0, 1000),
      })),
    },
  }, pageToken);
}

function sendTypingOn(psid, pageToken) {
  fbSend({ recipient: { id: psid }, sender_action: 'typing_on' }, pageToken).catch(() => {});
}

function getUserName(psid, pageToken) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'graph.facebook.com',
      path: `/v19.0/${psid}?fields=name&access_token=${encodeURIComponent(pageToken)}`,
      method: 'GET',
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data).name || 'ลูกค้า'); } catch { resolve('ลูกค้า'); }
      });
    });
    req.on('error', () => resolve('ลูกค้า'));
    req.end();
  });
}

// --- Quick Reply Flow (structured buttons) ---

const WELCOME_BUTTONS = ['อบรม CPR บุคคลทั่วไป', 'จัดอบรมในองค์กร', 'ซื้อ/เช่า AED', 'อื่นๆ'];
const TIMING_BUTTONS = ['สัปดาห์นี้', 'สัปดาห์หน้า', 'เดือนหน้า', 'ยังไม่แน่ใจ'];
const CORPORATE_SIZE_BUTTONS = ['ไม่เกิน 7 คน', '10-15 คน', '15 คนขึ้นไป'];
const AED_BUTTONS = ['ให้โทรกลับ', 'ดูเว็บก่อน'];
const YES_NO_BUTTONS = ['สนใจจอง', 'ขอข้อมูลเพิ่ม', 'ไว้ก่อน'];

// Check if message matches a quick reply button flow
function matchButton(text) {
  const t = text.trim();

  // Welcome buttons
  if (t === 'อบรม CPR บุคคลทั่วไป') return 'CPR_INDIVIDUAL';
  if (t === 'จัดอบรมในองค์กร') return 'CORPORATE';
  if (t === 'ซื้อ/เช่า AED') return 'AED';

  // Timing buttons
  if (t === 'สัปดาห์นี้' || t === 'สัปดาห์หน้า') return 'HOT_LEAD';
  if (t === 'เดือนหน้า') return 'WARM_LEAD';
  if (t === 'ยังไม่แน่ใจ') return 'COLD_LEAD';

  // Corporate size
  if (t === 'ไม่เกิน 7 คน') return 'CORP_MINI';
  if (t === '10-15 คน') return 'CORP_STANDARD';
  if (t === '15 คนขึ้นไป') return 'CORP_LARGE';

  // AED
  if (t === 'ให้โทรกลับ') return 'AED_CALLBACK';
  if (t === 'ดูเว็บก่อน') return 'AED_WEB';

  // Closing
  if (t === 'สนใจจอง') return 'WANT_BOOKING';
  if (t === 'ขอข้อมูลเพิ่ม') return 'WANT_INFO';
  if (t === 'ไว้ก่อน') return 'NOT_NOW';

  return null;
}

// Handle structured button flows — returns true if handled
async function handleButtonFlow(psid, text, pageToken, customerName) {
  const action = matchButton(text);
  if (!action) return false;

  const lead = leadStore.get(psid);

  switch (action) {
    case 'CPR_INDIVIDUAL':
      leadStore.update(psid, { type: 'individual', name: customerName });
      await sendQuickReply(psid,
        `คอร์ส Savelife ฿500/ท่าน ฝึกปฏิบัติจริง 3-4 ชม. ได้ใบ cert 2 ปีค่ะ ✅\nGoogle 5.0⭐ จาก 85+ รีวิว\nสถานที่: The Street รัชดา (MRT ศูนย์วัฒนธรรม ทางออก 4)\n\nสนใจเรียนช่วงไหนคะ?`,
        TIMING_BUTTONS, pageToken);
      return true;

    case 'CORPORATE':
      leadStore.update(psid, { type: 'corporate', name: customerName });
      await sendQuickReply(psid,
        `รับจัดอบรม CPR/AED ในองค์กรค่ะ 🏢\nทีมวิทยากรไปสอนถึงที่ สะดวกมากค่ะ\n\nจำนวนผู้เข้าอบรมประมาณกี่คนคะ?`,
        CORPORATE_SIZE_BUTTONS, pageToken);
      return true;

    case 'AED':
      leadStore.update(psid, { type: 'aed', name: customerName });
      await sendQuickReply(psid,
        `เรามีบริการขายและเช่า AED ค่ะ\n- เช่า AED เริ่มต้น ฿690\n- ขาย AED ราคาพิเศษสำหรับองค์กร\n\nดูรายละเอียดได้ที่ jia1669.com หรือให้ทีมโทรกลับแนะนำรุ่นที่เหมาะกับองค์กรคะ?`,
        AED_BUTTONS, pageToken);
      return true;

    case 'HOT_LEAD':
      leadStore.update(psid, { level: 'hot', timing: text });
      logLeadToSheet({ name: customerName, psid, type: lead?.type || 'individual', level: 'hot', timing: text, source: 'messenger_bot' }).catch(console.error);
      await sendText(psid,
        `เยี่ยมเลยค่ะ! 🎉\n\nจองคอร์สได้เลย:\n👉 แอดไลน์ @jiacpr (ตอบเร็ว จองง่าย)\n👉 โทร 088-558-8078\n👉 เว็บ www.jiacpr.com\n\n💡 เรียนออนไลน์ฟรีก่อนที่ jiacpr.com/online แล้วมาเรียน hands-on ลดเหลือ ฿400 ค่ะ!\n\nมีคำถามเพิ่มเติมพิมพ์ถามได้เลยนะคะ`,
        pageToken);
      // Alert team for hot lead
      triggerHandoff({ customerName, platform: 'Facebook Messenger', question: `🔥 HOT LEAD — สนใจ${text} (CPR บุคคลทั่วไป)`, handoffType: 'HOT_LEAD' }).catch(console.error);
      return true;

    case 'WARM_LEAD':
      leadStore.update(psid, { level: 'warm', timing: text });
      await sendQuickReply(psid,
        `ไม่มีปัญหาค่ะ! 😊\nเดี๋ยวน้องเจียส่งข้อมูลคอร์สและโปรโมชั่นให้ทางนี้นะคะ\n\n💡 ระหว่างนี้ลองเรียนออนไลน์ฟรีก่อนได้ที่ jiacpr.com/online ค่ะ เรียนจบได้คูปองลด ฿100 ด้วย!\n\nพร้อมเมื่อไหร์ทักมาได้เลยค่ะ`,
        YES_NO_BUTTONS, pageToken);
      return true;

    case 'COLD_LEAD':
      leadStore.update(psid, { level: 'cold', timing: 'ยังไม่แน่ใจ' });
      await sendText(psid,
        `ไม่เป็นไรค่ะ! 🙏\n\n💡 แนะนำลองเรียนออนไลน์ฟรีก่อนได้ที่ jiacpr.com/online ค่ะ\nมี 6 บทเรียน เรียนจบได้ใบ cert ออนไลน์ + คูปองลด ฿100 สำหรับคอร์ส hands-on\n\nหรือเพิ่มเพื่อน LINE @jiacpr ไว้ก่อนก็ได้ค่ะ จะได้ไม่พลาดโปร 😊`,
        pageToken);
      return true;

    case 'CORP_MINI':
      leadStore.update(psid, { level: 'hot', corpSize: '≤7' });
      await sendQuickReply(psid,
        `แพ็กเกจ Mini ฿7,000/session สูงสุด 7 คนค่ะ\nทีมวิทยากรไปสอนถึงที่ ไม่ต้องเดินทาง!\n\nสนใจจองเลยไหมคะ?`,
        YES_NO_BUTTONS, pageToken);
      return true;

    case 'CORP_STANDARD':
      leadStore.update(psid, { level: 'hot', corpSize: '10-15' });
      await sendQuickReply(psid,
        `แพ็กเกจ Standard ฿20,000/session รองรับ 10-15 คนค่ะ\nได้ใบ cert ทุกคน + ฝึกปฏิบัติจริง!\n\nสนใจจองเลยไหมคะ?`,
        YES_NO_BUTTONS, pageToken);
      return true;

    case 'CORP_LARGE':
      leadStore.update(psid, { level: 'hot', corpSize: '15+' });
      logLeadToSheet({ name: customerName, psid, type: 'corporate', level: 'hot', corpSize: '15+', source: 'messenger_bot' }).catch(console.error);
      await sendText(psid,
        `รับทราบค่ะ! สำหรับ 15 คนขึ้นไปทีมงานจะจัดแพ็กเกจพิเศษให้ค่ะ\nขอส่งต่อให้ทีมติดต่อกลับเพื่อเสนอราคาที่เหมาะสมนะคะ 🙏`,
        pageToken);
      triggerHandoff({ customerName, platform: 'Facebook Messenger', question: `🏢 อบรมองค์กร 15+ คน`, handoffType: 'CORPORATE_QUOTE' }).catch(console.error);
      return true;

    case 'AED_CALLBACK':
      leadStore.update(psid, { level: 'hot' });
      logLeadToSheet({ name: customerName, psid, type: 'aed', level: 'hot', message: 'ขอให้โทรกลับ AED', source: 'messenger_bot' }).catch(console.error);
      await sendText(psid,
        `รับทราบค่ะ! ทีมงานจะโทรกลับภายใน 1 ชม. นะคะ 📞\nขอบคุณที่สนใจค่ะ 🙏`,
        pageToken);
      triggerHandoff({ customerName, platform: 'Facebook Messenger', question: '📞 ขอให้โทรกลับเรื่อง AED', handoffType: 'AED_CALLBACK' }).catch(console.error);
      return true;

    case 'AED_WEB':
      leadStore.update(psid, { level: 'warm' });
      await sendText(psid,
        `ดูรายละเอียด AED ทุกรุ่นได้ที่ 👉 jia1669.com ค่ะ\nถ้ามีคำถามหรือต้องการคำแนะนำ ทักมาได้เลยนะคะ! 😊`,
        pageToken);
      return true;

    case 'WANT_BOOKING':
      leadStore.update(psid, { level: 'hot' });
      logLeadToSheet({ name: customerName, psid, type: lead?.type || 'individual', level: 'hot', message: 'สนใจจอง', source: 'messenger_bot' }).catch(console.error);
      await sendText(psid,
        `เยี่ยมเลยค่ะ! 🎉 จองได้เลย:\n\n👉 แอดไลน์ @jiacpr (แนะนำ — ตอบเร็ว จองง่าย)\n👉 โทร 088-558-8078\n👉 เว็บ www.jiacpr.com\n\nทีมงานพร้อมช่วยดูแลค่ะ!`,
        pageToken);
      triggerHandoff({ customerName, platform: 'Facebook Messenger', question: `✅ สนใจจอง (${lead?.type || 'ทั่วไป'})`, handoffType: 'HOT_LEAD' }).catch(console.error);
      return true;

    case 'WANT_INFO':
      // Fall through to AI for more info
      return false;

    case 'NOT_NOW':
      leadStore.update(psid, { level: 'cold' });
      await sendText(psid,
        `ได้เลยค่ะ! ถ้าพร้อมเมื่อไหร่ทักมาได้ตลอดนะคะ 🙏\n\n💡 เพิ่มเพื่อน LINE @jiacpr ไว้ก่อนก็ได้ค่ะ จะได้ไม่พลาดโปร!\n📚 หรือลองเรียนออนไลน์ฟรีที่ jiacpr.com/online ค่ะ`,
        pageToken);
      return true;

    default:
      return false;
  }
}

// --- Main webhook handler ---

module.exports = async (req, res) => {
  // GET — webhook verification
  if (req.method === 'GET') {
    const rawUrl = req.url || '';
    const qs = rawUrl.includes('?') ? rawUrl.split('?')[1] : '';
    const params = new URLSearchParams(qs);
    const mode = params.get('hub.mode') || (req.query && req.query['hub.mode']);
    const token = params.get('hub.verify_token') || (req.query && req.query['hub.verify_token']);
    const challenge = params.get('hub.challenge') || (req.query && req.query['hub.challenge']);
    if (mode === 'subscribe' && token === FB_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  // POST — receive messages
  if (req.method === 'POST') {
    const body = req.body;
    if (body.object !== 'page') return res.status(200).send('OK');

    try {
      for (const entry of body.entry || []) {
        const pageId = entry.id;
        const pageToken = PAGE_TOKENS[pageId];
        if (!pageToken) {
          console.warn('[Messenger] ไม่มี token สำหรับ page:', pageId);
          continue;
        }

        for (const event of entry.messaging || []) {
          // Handle postbacks (button clicks)
          const postbackPayload = event.postback?.payload;
          const messageText = event.message?.text;
          const text = messageText || postbackPayload;
          if (!text) continue;

          const psid = event.sender.id;
          console.log(`[Messenger] ${psid}: ${text}`);

          sendTypingOn(psid, pageToken);
          const customerName = await getUserName(psid, pageToken);

          // First-time user → send welcome with quick replies
          const lead = leadStore.get(psid);
          if (!lead && !matchButton(text)) {
            leadStore.update(psid, { name: customerName, firstMessage: text });
            await sendQuickReply(psid,
              `สวัสดีค่ะ! ยินดีต้อนรับสู่ JIA TRAINER CENTER 🙏\nน้องเจียพร้อมช่วยดูแลค่ะ\n\nคุณสนใจเรื่องไหนคะ?`,
              WELCOME_BUTTONS, pageToken);
            continue;
          }

          // Try structured button flow first
          const handled = await handleButtonFlow(psid, text, pageToken, customerName);
          if (handled) continue;

          // Fall through to AI for free-text conversation
          const aiResponse = await getAIResponse(psid, text);
          const { hasHandoff, type, cleanText } = checkHandoff(aiResponse);

          await sendText(psid, cleanText, pageToken);

          if (hasHandoff) {
            triggerHandoff({
              customerName,
              platform: 'Facebook Messenger',
              question: text,
              handoffType: type,
            }).catch(console.error);
          }
        }
      }
    } catch (err) {
      console.error('[Messenger] Error:', err.message || err);
    }

    return res.status(200).send('EVENT_RECEIVED');
  }
};
