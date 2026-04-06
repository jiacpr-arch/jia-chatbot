const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tpoiyykbgsgnrdwzgzvn.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const DASHBOARD_SECRET = process.env.DASHBOARD_SECRET || '';

// --- Auth ---

function checkAuth(req) {
  if (!DASHBOARD_SECRET) return true; // dev mode

  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ') && authHeader.slice(7) === DASHBOARD_SECRET) {
    return true;
  }

  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  if (url.searchParams.get('token') === DASHBOARD_SECRET) {
    return true;
  }

  return false;
}

// --- Supabase helpers ---

function supabaseGet(path) {
  if (!SUPABASE_KEY) {
    return Promise.resolve(null);
  }

  const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Prefer: 'count=exact',
        },
      },
      (res) => {
        let data = '';
        const contentRange = res.headers['content-range'];
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve({ data: parsed, contentRange, status: res.statusCode });
          } catch {
            resolve({ data: null, contentRange, status: res.statusCode });
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Supabase request timed out'));
    });
    req.end();
  });
}

// --- Data fetchers ---

async function getStats() {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayISO = todayStart.toISOString();

  const [todayLeads, hotToday, allTime, pendingFollowups] = await Promise.all([
    supabaseGet(`chatbot_leads?select=id&created_at=gte.${todayISO}`),
    supabaseGet(`chatbot_leads?select=id&created_at=gte.${todayISO}&lead_level=eq.hot`),
    supabaseGet('chatbot_leads?select=id&limit=1'),
    supabaseGet('chatbot_followups?select=id&status=eq.active'),
  ]);

  // Parse count from content-range header (format: "0-N/total" or "*/total")
  function parseCount(result) {
    if (!result) return 0;
    if (result.contentRange) {
      const match = result.contentRange.match(/\/(\d+)/);
      if (match) return parseInt(match[1], 10);
    }
    return Array.isArray(result.data) ? result.data.length : 0;
  }

  return {
    today: parseCount(todayLeads),
    hotToday: parseCount(hotToday),
    allTime: parseCount(allTime),
    pendingFollowups: parseCount(pendingFollowups),
  };
}

async function getLeads() {
  const result = await supabaseGet(
    'chatbot_leads?select=id,name,platform,lead_type,lead_level,timing,created_at&order=created_at.desc&limit=50'
  );
  if (!result || !Array.isArray(result.data)) return [];
  return result.data;
}

// --- HTML ---

function renderHTML(token) {
  const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
  const authHeader = token ? `'Bearer ${token}'` : "''";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>JIA Chatbot Dashboard</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #f0f4f8;
    color: #1a202c;
    min-height: 100vh;
  }

  header {
    background: #1a365d;
    color: #fff;
    padding: 1rem 1.5rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    box-shadow: 0 2px 4px rgba(0,0,0,0.15);
  }

  header h1 { font-size: 1.25rem; font-weight: 600; }

  .refresh-info {
    font-size: 0.75rem;
    opacity: 0.7;
  }

  .container {
    max-width: 1100px;
    margin: 0 auto;
    padding: 1.5rem 1rem;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .stat-card {
    background: #fff;
    border-radius: 10px;
    padding: 1.25rem;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
    text-align: center;
  }

  .stat-card .label {
    font-size: 0.8rem;
    color: #718096;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.5rem;
  }

  .stat-card .value {
    font-size: 2rem;
    font-weight: 700;
    color: #1a365d;
  }

  .stat-card.hot .value { color: #e53e3e; }

  .table-wrap {
    background: #fff;
    border-radius: 10px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
  }

  thead { background: #1a365d; color: #fff; }

  th {
    padding: 0.75rem 1rem;
    text-align: left;
    font-weight: 600;
    white-space: nowrap;
  }

  td {
    padding: 0.65rem 1rem;
    border-bottom: 1px solid #e2e8f0;
  }

  tbody tr:hover { background: #f7fafc; }

  .badge {
    display: inline-block;
    padding: 0.15rem 0.6rem;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
  }

  .badge-hot  { background: #fff5f5; color: #e53e3e; }
  .badge-warm { background: #fffaf0; color: #dd6b20; }
  .badge-cold { background: #ebf8ff; color: #3182ce; }

  .loading {
    text-align: center;
    padding: 3rem;
    color: #a0aec0;
  }

  .error-msg {
    text-align: center;
    padding: 2rem;
    color: #e53e3e;
  }

  @media (max-width: 600px) {
    .stats-grid { grid-template-columns: repeat(2, 1fr); }
    th, td { padding: 0.5rem 0.6rem; font-size: 0.8rem; }
    header h1 { font-size: 1.05rem; }
  }
</style>
</head>
<body>
<header>
  <h1>JIA Chatbot Dashboard</h1>
  <span class="refresh-info" id="refreshInfo">Auto-refresh: 60s</span>
</header>
<div class="container">
  <div class="stats-grid" id="statsGrid">
    <div class="stat-card"><div class="label">Total Leads Today</div><div class="value" id="statToday">-</div></div>
    <div class="stat-card hot"><div class="label">Hot Leads Today</div><div class="value" id="statHot">-</div></div>
    <div class="stat-card"><div class="label">Total All Time</div><div class="value" id="statAll">-</div></div>
    <div class="stat-card"><div class="label">Pending Follow-ups</div><div class="value" id="statFollowups">-</div></div>
  </div>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Platform</th>
          <th>Type</th>
          <th>Level</th>
          <th>Timing</th>
          <th>Date</th>
        </tr>
      </thead>
      <tbody id="leadsBody">
        <tr><td colspan="6" class="loading">Loading...</td></tr>
      </tbody>
    </table>
  </div>
</div>
<script>
(function() {
  var headers = {};
  var authVal = ${authHeader};
  if (authVal) headers['Authorization'] = authVal;

  function fetchJSON(url) {
    return fetch(url, { headers: headers }).then(function(r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });
  }

  function esc(s) {
    if (!s) return '-';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function badgeClass(level) {
    if (level === 'hot') return 'badge-hot';
    if (level === 'warm') return 'badge-warm';
    return 'badge-cold';
  }

  function fmtDate(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  function loadStats() {
    fetchJSON('/api/dashboard?data=stats${tokenParam}')
      .then(function(s) {
        document.getElementById('statToday').textContent = s.today;
        document.getElementById('statHot').textContent = s.hotToday;
        document.getElementById('statAll').textContent = s.allTime;
        document.getElementById('statFollowups').textContent = s.pendingFollowups;
      })
      .catch(function(e) {
        console.error('Stats error', e);
      });
  }

  function loadLeads() {
    fetchJSON('/api/dashboard?data=leads${tokenParam}')
      .then(function(leads) {
        var tbody = document.getElementById('leadsBody');
        if (!leads.length) {
          tbody.innerHTML = '<tr><td colspan="6" class="loading">No leads yet</td></tr>';
          return;
        }
        tbody.innerHTML = leads.map(function(l) {
          return '<tr>'
            + '<td>' + esc(l.name) + '</td>'
            + '<td>' + esc(l.platform) + '</td>'
            + '<td>' + esc(l.lead_type) + '</td>'
            + '<td><span class="badge ' + badgeClass(l.lead_level) + '">' + esc(l.lead_level) + '</span></td>'
            + '<td>' + esc(l.timing) + '</td>'
            + '<td>' + fmtDate(l.created_at) + '</td>'
            + '</tr>';
        }).join('');
      })
      .catch(function(e) {
        document.getElementById('leadsBody').innerHTML =
          '<tr><td colspan="6" class="error-msg">Failed to load leads</td></tr>';
        console.error('Leads error', e);
      });
  }

  function refresh() {
    loadStats();
    loadLeads();
  }

  refresh();
  setInterval(refresh, 60000);
})();
</script>
</body>
</html>`;
}

// --- Handler ---

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  if (!checkAuth(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Unauthorized' }));
  }

  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const dataParam = url.searchParams.get('data');
  const token = url.searchParams.get('token') || '';

  try {
    if (dataParam === 'stats') {
      const stats = await getStats();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(stats));
    }

    if (dataParam === 'leads') {
      const leads = await getLeads();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(leads));
    }

    // Default: serve HTML dashboard
    const html = renderHTML(token);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
    });
    return res.end(html);
  } catch (err) {
    console.error('[Dashboard] Error:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
