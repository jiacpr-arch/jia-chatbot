/**
 * A/B Testing System for JIA Chatbot
 *
 * ทดสอบ 2 variant ของ Welcome Message:
 *   Variant A (50%): สุภาพ บอกตรงๆ
 *   Variant B (50%): เน้น Social Proof + Urgency
 *
 * Conversion: นับเมื่อ lead ถึง level 'hot' หรือกด WANT_BOOKING
 *
 * เก็บข้อมูลใน Supabase chatbot_ab_tests table (หรือ in-memory fallback)
 */

const https = require('https');

// In-memory fallback
const memory = new Map(); // userId → { variant, converted, timestamp }
const stats = { A: { assigned: 0, converted: 0 }, B: { assigned: 0, converted: 0 } };

// ---- Welcome message variants ----

const VARIANTS = {
  A: {
    welcome: `สวัสดีค่ะ! ยินดีต้อนรับสู่ JIA TRAINER CENTER 🙏\nน้องเจียพร้อมช่วยดูแลค่ะ\n\nคุณสนใจเรื่องไหนคะ?`,
    followUp1: `รู้ไหมคะ? 💔 70% ของผู้ป่วยหัวใจหยุดเต้น เสียชีวิตเพราะไม่มีคนทำ CPR ได้ทัน\n\nเรียนแค่ครึ่งวันก็ช่วยชีวิตคนได้แล้วค่ะ\n\n👉 จองคอร์สได้ที่ LINE @jiacpr หรือโทร 088-558-8078`,
  },
  B: {
    welcome: `สวัสดีค่ะ! 🌟 JIA TRAINER CENTER — ศูนย์ CPR & AED อันดับ 1 กรุงเทพฯ\n⭐ Google 4.9/5.0 จากลูกค้า 120+ รีวิว\n🎓 สอนโดยทีมแพทย์และพยาบาลมืออาชีพ\n\nวันนี้สนใจเรื่องไหนคะ?`,
    followUp1: `สวัสดีค่ะ! น้องเจียแวะมาทักอีกทีนะคะ 🙏\n\nสัปดาห์ที่ผ่านมามีลูกค้าจาก JIA TRAINER CENTER\nใช้ CPR ช่วยชีวิตได้จริงถึง 2 ราย! ❤️\n\nยังคิดอยู่ไหมคะ? รอบเรียนมีทุกสัปดาห์ค่ะ\n👉 LINE @jiacpr หรือโทร 088-558-8078`,
  },
};

// ---- Supabase helpers ----

function supabaseOp(method, path, body) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
  if (!url || !key) return Promise.resolve(null);

  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : '';
    const req = https.request(
      {
        hostname: new URL(url).hostname,
        path: `/rest/v1/${path}`,
        method,
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Prefer: method === 'POST' ? 'resolution=merge-duplicates' : '',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve(null); }
        });
      }
    );
    req.on('error', () => resolve(null));
    if (payload) req.write(payload);
    req.end();
  });
}

// ---- Public API ----

/**
 * Assign a variant to a user (deterministic: same userId always gets same variant)
 * @returns {'A'|'B'}
 */
function assignVariant(userId) {
  // Deterministic hash → no need to store assignment, reproducible
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 2 === 0 ? 'A' : 'B';
}

/**
 * Get the welcome message for a user's variant
 */
function getWelcomeMessage(userId) {
  const variant = assignVariant(userId);
  return { variant, message: VARIANTS[variant].welcome };
}

/**
 * Get follow-up message override for step 0 (hour 1)
 */
function getFollowUpVariant(userId, stepLabel) {
  if (stepLabel !== 'hour1') return null;
  const variant = assignVariant(userId);
  return VARIANTS[variant].followUp1;
}

/**
 * Record a conversion (user reached HOT_LEAD/WANT_BOOKING)
 */
async function recordConversion(userId, platform) {
  const variant = assignVariant(userId);

  // Track in memory
  if (!memory.has(userId)) {
    memory.set(userId, { variant, converted: false });
    stats[variant].assigned++;
  }
  const entry = memory.get(userId);
  if (!entry.converted) {
    entry.converted = true;
    stats[variant].converted++;
  }

  // Track in Supabase
  await supabaseOp('POST', 'chatbot_ab_tests', {
    user_id: userId,
    platform,
    variant,
    converted: true,
    converted_at: new Date().toISOString(),
  });

  console.log(`[A/B] User ${userId} variant=${variant} → converted`);
}

/**
 * Record a first impression (user was shown the welcome message)
 */
async function recordImpression(userId, platform) {
  const variant = assignVariant(userId);

  if (!memory.has(userId)) {
    memory.set(userId, { variant, converted: false });
    stats[variant].assigned++;
  }

  await supabaseOp('POST', 'chatbot_ab_tests', {
    user_id: userId,
    platform,
    variant,
    converted: false,
    created_at: new Date().toISOString(),
  });
}

/**
 * Get A/B test stats (from memory + Supabase)
 */
async function getABStats() {
  // Try Supabase for accurate stats
  const [rowsA, rowsB] = await Promise.all([
    supabaseOp('GET', 'chatbot_ab_tests?variant=eq.A&select=converted', null),
    supabaseOp('GET', 'chatbot_ab_tests?variant=eq.B&select=converted', null),
  ]);

  function computeStats(rows) {
    if (!Array.isArray(rows)) return { assigned: 0, converted: 0, rate: '0%' };
    const assigned = rows.length;
    const converted = rows.filter((r) => r.converted).length;
    const rate = assigned > 0 ? ((converted / assigned) * 100).toFixed(1) + '%' : '0%';
    return { assigned, converted, rate };
  }

  return {
    A: computeStats(rowsA),
    B: computeStats(rowsB),
    memory: stats, // fallback
  };
}

module.exports = { assignVariant, getWelcomeMessage, getFollowUpVariant, recordConversion, recordImpression, getABStats };
