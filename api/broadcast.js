const https = require('https');

const BROADCAST_SECRET = process.env.BROADCAST_SECRET || '';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tpoiyykbgsgnrdwzgzvn.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';

// Same page token mapping as messenger.js
const PAGE_TOKENS = {
  '115768024942069': process.env.FB_PAGE_ACCESS_TOKEN_JIA_CPR,
  '1032110679988495': process.env.FB_PAGE_ACCESS_TOKEN_JIA_TRAINING,
};

// Default FB page token (JIA CPR main page)
const FB_DEFAULT_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN_JIA_CPR;

// --- Helpers ---

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// --- Supabase: query leads ---

async function queryLeads({ platform, leadLevel, studentType }) {
  if (!SUPABASE_KEY) {
    throw new Error('SUPABASE_SERVICE_KEY not configured');
  }

  const url = new URL(`${SUPABASE_URL}/rest/v1/chatbot_leads`);

  // Only leads with a psid
  url.searchParams.set('psid', 'not.is.null');

  // Filter by platform (db stores 'Messenger' or 'LINE' or source like 'messenger_bot'/'line_bot')
  if (platform && platform !== 'all') {
    if (platform === 'messenger') {
      url.searchParams.set('source', 'eq.messenger_bot');
    } else if (platform === 'line') {
      url.searchParams.set('source', 'eq.line_bot');
    }
  }

  // Filter by lead_level
  if (leadLevel && leadLevel !== 'all') {
    url.searchParams.set('lead_level', `eq.${leadLevel}`);
  }

  // Filter by student type (stored in lead_type as 'student' with source context)
  if (studentType) {
    url.searchParams.set('lead_type', 'eq.student');
  }

  // Select only needed fields, deduplicate by psid
  url.searchParams.set('select', 'psid,source,name,lead_type,lead_level');
  url.searchParams.set('order', 'created_at.desc');

  const res = await httpsRequest({
    hostname: new URL(SUPABASE_URL).hostname,
    path: `${url.pathname}?${url.searchParams.toString()}`,
    method: 'GET',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
  });

  if (res.statusCode !== 200) {
    throw new Error(`Supabase query failed: ${res.statusCode} ${res.body.slice(0, 200)}`);
  }

  const rows = JSON.parse(res.body);

  // Deduplicate by psid (keep most recent entry per psid)
  const seen = new Map();
  for (const row of rows) {
    if (row.psid && !seen.has(row.psid)) {
      seen.set(row.psid, row);
    }
  }

  return [...seen.values()];
}

// --- Facebook Messenger: send broadcast message ---

async function sendMessengerBroadcast(psid, text, pageToken) {
  const payload = JSON.stringify({
    messaging_type: 'MESSAGE_TAG',
    tag: 'CONFIRMED_EVENT_UPDATE',
    recipient: { id: psid },
    message: { text: text.slice(0, 2000) },
  });

  const res = await httpsRequest({
    hostname: 'graph.facebook.com',
    path: `/v21.0/me/messages?access_token=${encodeURIComponent(pageToken)}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  }, payload);

  return res.statusCode === 200;
}

// --- LINE: send push message ---

async function sendLinePush(userId, text) {
  const payload = JSON.stringify({
    to: userId,
    messages: [{ type: 'text', text: text.slice(0, 5000) }],
  });

  const res = await httpsRequest({
    hostname: 'api.line.me',
    path: '/v2/bot/message/push',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
    },
  }, payload);

  return res.statusCode === 200;
}

// --- Main handler ---

module.exports = async (req, res) => {
  // Only accept POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Verify Bearer token
  if (!BROADCAST_SECRET) {
    return res.status(500).json({ error: 'BROADCAST_SECRET not configured' });
  }

  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (token !== BROADCAST_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Parse body
  const { message, platform = 'all', leadLevel = 'all', studentType = null } = req.body || {};

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'message is required and must be a non-empty string' });
  }

  try {
    // Query leads from Supabase
    const leads = await queryLeads({ platform, leadLevel, studentType });

    if (leads.length === 0) {
      return res.status(200).json({ sent: 0, failed: 0, total: 0, note: 'No matching leads found' });
    }

    let sent = 0;
    let failed = 0;

    for (const lead of leads) {
      try {
        const isLine = lead.source === 'line_bot';
        const isMessenger = lead.source === 'messenger_bot';

        let success = false;

        if (isLine && (platform === 'all' || platform === 'line')) {
          if (LINE_CHANNEL_ACCESS_TOKEN) {
            success = await sendLinePush(lead.psid, message);
          }
        } else if (isMessenger && (platform === 'all' || platform === 'messenger')) {
          const pageToken = FB_DEFAULT_TOKEN;
          if (pageToken) {
            success = await sendMessengerBroadcast(lead.psid, message, pageToken);
          }
        }

        if (success) {
          sent++;
        } else {
          failed++;
        }
      } catch (err) {
        console.error(`[Broadcast] Failed for ${lead.psid}:`, err.message);
        failed++;
      }

      // Rate limiting: 1 message per second
      await delay(1000);
    }

    console.log(`[Broadcast] Done: sent=${sent}, failed=${failed}, total=${leads.length}`);
    return res.status(200).json({ sent, failed, total: leads.length });
  } catch (err) {
    console.error('[Broadcast] Error:', err.message || err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
