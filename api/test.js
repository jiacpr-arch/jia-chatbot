// Quick test - call AI directly
const Anthropic = require('@anthropic-ai/sdk');
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

module.exports = async (req, res) => {
  try {
    const keyPreview = (process.env.ANTHROPIC_API_KEY || '').slice(0, 10) + '...';
    const pageToken = (process.env.FB_PAGE_ACCESS_TOKEN_JIA_CPR || '').slice(0, 10) + '...';
    
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 50,
      messages: [{ role: 'user', content: 'ตอบว่า ok' }],
    });
    
    res.json({
      status: 'ok',
      ai_response: response.content[0].text,
      key_preview: keyPreview,
      page_token_preview: pageToken,
      has_page_token_cpr: !!process.env.FB_PAGE_ACCESS_TOKEN_JIA_CPR,
      has_page_token_training: !!process.env.FB_PAGE_ACCESS_TOKEN_JIA_TRAINING,
    });
  } catch (err) {
    res.status(500).json({ error: err.message, type: err.constructor.name });
  }
};
