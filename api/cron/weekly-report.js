/**
 * Weekly Stats Report — ส่งรายงานสรุปทุกวันจันทร์ 9 AM UTC (16:00 Bangkok)
 *
 * ข้อมูลที่ส่ง:
 * - Leads สัปดาห์นี้ (ทั้งหมด + hot)
 * - สถิติ A/B test (variant ไหน convert ดีกว่า)
 * - Top referrers สัปดาห์นี้
 * - Follow-up pending
 */

const https = require('https');
const { getABStats } = require('../lib/ab-test');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_GROUP = process.env.LINE_ALERT_GROUP_ID;
const CRON_SECRET = process.env.CRON_SECRET || '';

// ---- Supabase helper ----
function sbGet(path) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return Promise.resolve(null);
  return new Promise((resolve) => {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Prefer: 'count=exact',
          Accept: 'application/json',
        },
      },
      (res) => {
        let data = '';
        const cr = res.headers['content-range'] || '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          const total = cr.match(/\/(\d+)/)?.[1];
          try {
            resolve({ rows: JSON.parse(data), total: total ? parseInt(total) : null });
          } catch {
            resolve({ rows: [], total: null });
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.end();
  });
}

// ---- LINE Push helper ----
function lineNotify(text) {
  if (!LINE_TOKEN || !LINE_GROUP) {
    console.warn('[WeeklyReport] LINE_TOKEN หรือ LINE_GROUP ไม่ได้ตั้งค่า');
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      to: LINE_GROUP,
      messages: [{ type: 'text', text: text.slice(0, 5000) }],
    });
    const req = https.request(
      {
        hostname: 'api.line.me',
        path: '/v2/bot/message/push',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          Authorization: `Bearer ${LINE_TOKEN}`,
        },
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          console.log('[WeeklyReport] LINE status:', res.statusCode);
          resolve();
        });
      }
    );
    req.on('error', (err) => { console.error('[WeeklyReport] LINE error:', err.message); resolve(); });
    req.write(payload);
    req.end();
  });
}

// ---- Build report ----
async function buildReport() {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekAgoISO = weekAgo.toISOString();

  const thaiDate = now.toLocaleDateString('th-TH', {
    timeZone: 'Asia/Bangkok',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // Fetch all data in parallel
  const [
    leadsWeek,
    hotLeadsWeek,
    allLeads,
    pendingFollowups,
    topReferrers,
    abStats,
  ] = await Promise.all([
    sbGet(`chatbot_leads?select=id&created_at=gte.${weekAgoISO}`),
    sbGet(`chatbot_leads?select=id&created_at=gte.${weekAgoISO}&lead_level=eq.hot`),
    sbGet('chatbot_leads?select=id&limit=1'),
    sbGet('chatbot_followups?select=id&status=eq.active'),
    sbGet('chatbot_referrals?select=user_name,code,referral_count&order=referral_count.desc&limit=3'),
    getABStats().catch(() => null),
  ]);

  const leadsThisWeek = leadsWeek?.total ?? leadsWeek?.rows?.length ?? 0;
  const hotThisWeek = hotLeadsWeek?.total ?? hotLeadsWeek?.rows?.length ?? 0;
  const totalAllTime = allLeads?.total ?? allLeads?.rows?.length ?? 0;
  const pendingFU = pendingFollowups?.total ?? pendingFollowups?.rows?.length ?? 0;

  // A/B winner
  let abSummary = 'ยังไม่มีข้อมูล';
  if (abStats && (abStats.A?.assigned || abStats.B?.assigned)) {
    const aRate = parseFloat(abStats.A?.rate || 0);
    const bRate = parseFloat(abStats.B?.rate || 0);
    const winner = aRate >= bRate ? `A (${abStats.A.rate})` : `B (${abStats.B.rate})`;
    abSummary = `A: ${abStats.A?.rate || '0%'} (${abStats.A?.assigned || 0} คน)\nB: ${abStats.B?.rate || '0%'} (${abStats.B?.assigned || 0} คน)\n🏆 ชนะ: Variant ${winner}`;
  }

  // Top referrers
  let referralSummary = 'ยังไม่มีข้อมูล';
  if (topReferrers?.rows?.length) {
    referralSummary = topReferrers.rows
      .map((r, i) => `${i + 1}. ${r.user_name || '?'} (${r.code}) — ${r.referral_count} คน`)
      .join('\n');
  }

  const conversionRate = leadsThisWeek > 0
    ? ((hotThisWeek / leadsThisWeek) * 100).toFixed(1) + '%'
    : '0%';

  return `📊 รายงานประจำสัปดาห์ — JIA TRAINER CENTER
📅 ${thaiDate}
${'─'.repeat(30)}

👥 Leads สัปดาห์นี้: ${leadsThisWeek} ราย
🔥 Hot Leads: ${hotThisWeek} ราย (${conversionRate})
📊 Leads ทั้งหมด: ${totalAllTime} ราย
📬 Follow-up รอส่ง: ${pendingFU} ราย

${'─'.repeat(30)}
🔬 A/B Test Welcome Message:
${abSummary}

${'─'.repeat(30)}
🎁 Top Referrers:
${referralSummary}

${'─'.repeat(30)}
💡 Tips: ถ้า Hot Lead < 10% ลอง Variant B ของ A/B test นะคะ
📞 ติดต่อ: LINE @jiacpr | 088-558-8078`;
}

// ---- Handler ----
module.exports = async (req, res) => {
  // Security
  const auth = req.headers.authorization;
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const report = await buildReport();
    console.log('[WeeklyReport]\n', report);
    await lineNotify(report);

    return res.json({
      success: true,
      reportLength: report.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[WeeklyReport] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
