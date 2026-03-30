const https = require('https');

// In-memory log of recent requests to /api/messenger
// This helps verify if Facebook is actually sending webhooks
global._webhookLog = global._webhookLog || [];

function fbGet(path, token) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'graph.facebook.com',
      path: `/v21.0/${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`,
      method: 'GET',
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function fbPost(path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = `${body}&access_token=${encodeURIComponent(token)}`;
    const req = https.request({
      hostname: 'graph.facebook.com',
      path: `/v21.0/${path}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// Supabase helpers
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tpoiyykbgsgnrdwzgzvn.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

function supabaseRequest(method, path, body) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : '';
    const url = new URL(`${SUPABASE_URL}${path}`);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': method === 'POST' ? 'return=minimal,resolution=merge-duplicates' : '',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', (e) => resolve({ status: 0, data: e.message }));
    if (payload) req.write(payload);
    req.end();
  });
}

// Fetch all conversations from a Facebook page (paginated)
async function fetchAllConversations(pageId, pageToken) {
  const conversations = [];
  let url = `${pageId}/conversations?fields=participants,updated_time,message_count&limit=100`;

  while (url) {
    const result = await fbGet(url, pageToken);
    if (result.error) {
      console.error('[Conversations] API error:', result.error.message);
      break;
    }
    if (result.data) conversations.push(...result.data);
    // Next page
    if (result.paging?.next) {
      // Extract path after graph.facebook.com/v19.0/
      const nextUrl = new URL(result.paging.next);
      url = nextUrl.pathname.replace('/v19.0/', '') + nextUrl.search;
      // Remove access_token from url since fbGet adds it
      url = url.replace(/[&?]access_token=[^&]+/, '');
    } else {
      url = null;
    }
  }
  return conversations;
}

module.exports = async (req, res) => {
  const cprToken = process.env.FB_PAGE_ACCESS_TOKEN_JIA_CPR || '';
  const trainingToken = process.env.FB_PAGE_ACCESS_TOKEN_JIA_TRAINING || '';
  const action = req.query?.action;

  // === ACTION: Pull all past conversations and store in Supabase ===
  if (action === 'conversations') {
    const results = { jia_cpr: [], jia_training: [], saved: 0, errors: [] };
    const now = new Date();

    const pages = [
      { id: '115768024942069', name: 'Jia CPR', token: cprToken },
      { id: '1032110679988495', name: 'Jia Training', token: trainingToken },
    ];

    for (const page of pages) {
      if (!page.token) {
        results.errors.push(`No token for ${page.name}`);
        continue;
      }

      console.log(`[Conversations] Fetching from ${page.name}...`);
      const convos = await fetchAllConversations(page.id, page.token);
      console.log(`[Conversations] Got ${convos.length} conversations from ${page.name}`);

      for (const convo of convos) {
        // Find participant that isn't the page itself
        const participant = (convo.participants?.data || []).find(p => p.id !== page.id);
        if (!participant) continue;

        const updatedAt = new Date(convo.updated_time);
        const hoursAgo = (now - updatedAt) / (1000 * 60 * 60);
        const withinWindow = hoursAgo <= 24;

        const lead = {
          psid: participant.id,
          name: participant.name || null,
          platform: 'Messenger',
          source: `fb_history_${page.name.toLowerCase().replace(/\s+/g, '_')}`,
          message: `Conversation from ${page.name} (${convo.message_count || '?'} msgs, last: ${convo.updated_time})`,
          lead_type: null,
          lead_level: withinWindow ? 'warm' : 'cold',
          timing: withinWindow ? 'within_24hr' : `${Math.round(hoursAgo)}hr_ago`,
        };

        const entry = {
          page_id: page.id,
          page_name: page.name,
          psid: participant.id,
          name: participant.name,
          updated_time: convo.updated_time,
          hours_ago: Math.round(hoursAgo),
          within_24hr: withinWindow,
          message_count: convo.message_count,
        };

        if (page.id === '115768024942069') results.jia_cpr.push(entry);
        else results.jia_training.push(entry);

        // Save to Supabase (check existing first, then insert if new)
        if (SUPABASE_KEY) {
          const check = await supabaseRequest('GET', `/rest/v1/chatbot_leads?psid=eq.${participant.id}&select=id&limit=1`);
          if (check.data && Array.isArray(check.data) && check.data.length > 0) {
            // Already exists, skip
          } else {
            const insertResult = await supabaseRequest('POST', '/rest/v1/chatbot_leads', lead);
            if (insertResult.status === 201) results.saved++;
          }
        }
      }
    }

    return res.json({
      action: 'conversations',
      total_jia_cpr: results.jia_cpr.length,
      total_jia_training: results.jia_training.length,
      within_24hr: [...results.jia_cpr, ...results.jia_training].filter(c => c.within_24hr).length,
      saved_to_supabase: results.saved,
      errors: results.errors,
      conversations: {
        jia_cpr: results.jia_cpr.slice(0, 50),
        jia_training: results.jia_training.slice(0, 50),
      },
    });
  }

  // === ACTION: Send follow-up to all contacts within 24hr window ===
  if (action === 'followup-all') {
    const results = { sent: 0, failed: 0, skipped: 0, details: [] };

    const pages = [
      { id: '115768024942069', name: 'Jia CPR', token: cprToken },
      { id: '1032110679988495', name: 'Jia Training', token: trainingToken },
    ];

    const followUpText = `สวัสดีค่ะ! 🙏 น้องเจียจาก JIA TRAINER CENTER ค่ะ\n\nขอบคุณที่เคยสนใจเรื่อง CPR/AED นะคะ ✨\n\nตอนนี้มีโปรพิเศษค่ะ:\n🎓 คอร์ส Savelife CPR+AED ฝึกปฏิบัติจริง ฿500/ท่าน\n📚 เรียนออนไลน์ฟรีก่อนที่ jiacpr.com/online\n🏢 จัดอบรมในองค์กร เริ่มต้น ฿7,000\n\nสนใจสอบถามเพิ่มเติมทักมาได้เลยค่ะ! 😊\n👉 แอดไลน์ @jiacpr`;

    for (const page of pages) {
      if (!page.token) continue;

      const convos = await fetchAllConversations(page.id, page.token);
      const now = new Date();

      for (const convo of convos) {
        const participant = (convo.participants?.data || []).find(p => p.id !== page.id);
        if (!participant) continue;

        const hoursAgo = (now - new Date(convo.updated_time)) / (1000 * 60 * 60);
        if (hoursAgo > 24) {
          results.skipped++;
          continue;
        }

        // Send follow-up message
        const sendResult = await new Promise((resolve) => {
          const payload = JSON.stringify({
            recipient: { id: participant.id },
            message: { text: followUpText },
          });
          const r = https.request({
            hostname: 'graph.facebook.com',
            path: `/v19.0/me/messages?access_token=${encodeURIComponent(page.token)}`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
          }, (resp) => {
            let data = '';
            resp.on('data', (c) => (data += c));
            resp.on('end', () => {
              try { resolve(JSON.parse(data)); } catch { resolve(data); }
            });
          });
          r.on('error', (e) => resolve({ error: e.message }));
          r.write(payload);
          r.end();
        });

        if (sendResult.message_id) {
          results.sent++;
          results.details.push({ psid: participant.id, name: participant.name, status: 'sent' });
        } else {
          results.failed++;
          results.details.push({ psid: participant.id, name: participant.name, status: 'failed', error: sendResult.error?.message || 'unknown' });
        }
      }
    }

    return res.json({
      action: 'followup-all',
      sent: results.sent,
      failed: results.failed,
      skipped_outside_24hr: results.skipped,
      details: results.details,
    });
  }

  // If ?send=PSID, try to send a test message directly
  const sendTo = req.query?.send;
  if (sendTo) {
    const result = await new Promise((resolve, reject) => {
      const payload = JSON.stringify({
        messaging_type: 'RESPONSE',
        recipient: { id: sendTo },
        message: { text: 'ทดสอบจาก JIA Chatbot 🤖' },
      });
      const r = https.request({
        hostname: 'graph.facebook.com',
        path: `/v21.0/me/messages?access_token=${encodeURIComponent(cprToken)}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      }, (resp) => {
        let data = '';
        resp.on('data', (chunk) => (data += chunk));
        resp.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve(data); }
        });
      });
      r.on('error', reject);
      r.write(payload);
      r.end();
    });
    return res.json({ send_result: result });
  }

  // If ?subscribe=1, subscribe pages to webhook
  if (req.query?.subscribe) {
    const trainingToken = process.env.FB_PAGE_ACCESS_TOKEN_JIA_TRAINING || '';
    const results = {};

    // Subscribe Jia CPR
    results.jia_cpr = await fbPost('115768024942069/subscribed_apps',
      'subscribed_fields=messages,messaging_postbacks', cprToken);

    // Subscribe Jia Training
    results.jia_training = await fbPost('1032110679988495/subscribed_apps',
      'subscribed_fields=messages,messaging_postbacks', trainingToken);

    return res.json({ subscribe_results: results });
  }

  try {
    const pageInfo = await fbGet('me?fields=id,name', cprToken);

    res.json({
      page_info: pageInfo,
      webhook_log: global._webhookLog.slice(-10),
      env_check: {
        has_anthropic_key: !!(process.env.ANTHROPIC_API_KEY || '').match(/^sk-ant-/),
        has_cpr_token: cprToken.length > 0 && cprToken.startsWith('EAA'),
        has_training_token: (process.env.FB_PAGE_ACCESS_TOKEN_JIA_TRAINING || '').startsWith('EAA'),
        has_app_secret: !!(process.env.FB_APP_SECRET || ''),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
