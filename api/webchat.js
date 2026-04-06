const { getAIResponse, checkHandoff } = require('./lib/ai');
const { triggerHandoff } = require('./lib/handoff');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/**
 * GET  /api/webchat → serves a minimal test page that loads the chat widget
 * POST /api/webchat → handles chat messages from the widget
 */
module.exports = async function handler(req, res) {
  // --- CORS preflight ---
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    return res.end();
  }

  // --- GET: serve a demo page that loads the widget ---
  if (req.method === 'GET') {
    const host = req.headers.host || 'localhost:3000';
    const protocol = host.startsWith('localhost') ? 'http' : 'https';
    const widgetUrl = `${protocol}://${host}/chat-widget.js`;

    const html = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>JIA CPR Chatbot — Web Widget Demo</title>
  <style>
    body { font-family: sans-serif; margin: 0; padding: 40px; background: #f7f7f7; color: #333; }
    h1 { color: #1a365d; }
    p { max-width: 600px; line-height: 1.6; }
    code { background: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>JIA CPR Chatbot Widget Demo</h1>
  <p>The chat widget should appear in the bottom-right corner of this page.</p>
  <p>To embed on your own site, add this script tag:</p>
  <p><code>&lt;script src="${widgetUrl}"&gt;&lt;/script&gt;</code></p>
  <script src="${widgetUrl}"></script>
</body>
</html>`;

    Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  }

  // --- POST: handle chat message ---
  if (req.method === 'POST') {
    Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    try {
      const { userId, message } = req.body || {};

      if (!userId || !message) {
        return res.status(400).json({ error: 'userId and message are required' });
      }

      // Get AI response
      const aiResponse = await getAIResponse(userId, message, null);

      // Check for handoff
      const { hasHandoff, type, cleanText } = checkHandoff(aiResponse);

      // Detect and strip [INTENT:POST_COURSE]
      const finalText = cleanText.replace(/\[INTENT:POST_COURSE\]/g, '').trim();

      // Trigger handoff notification if needed
      if (hasHandoff) {
        triggerHandoff({
          customerName: `WebChat:${userId.slice(0, 8)}`,
          platform: 'Web Chat',
          question: message,
          handoffType: type,
        }).catch(console.error);
      }

      return res.status(200).json({ reply: finalText });
    } catch (err) {
      console.error('[WebChat] Error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  // --- Other methods ---
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
  return res.status(405).json({ error: 'Method not allowed' });
};
