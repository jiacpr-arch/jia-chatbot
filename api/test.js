const { getAIResponse, checkHandoff } = require('./lib/ai');

module.exports = async (req, res) => {
  try {
    const keyPreview = (process.env.ANTHROPIC_API_KEY || '').slice(0, 15) + '...';
    const cprToken = process.env.FB_PAGE_ACCESS_TOKEN_JIA_CPR || '';
    const trainingToken = process.env.FB_PAGE_ACCESS_TOKEN_JIA_TRAINING || '';

    // Test AI call exactly like messenger.js does
    const start = Date.now();
    const aiResponse = await getAIResponse('TEST_DEBUG', 'สวัสดีครับ อยากสอบถามคอร์ส CPR');
    const elapsed = Date.now() - start;

    const { hasHandoff, type, cleanText } = checkHandoff(aiResponse);

    res.json({
      status: 'ok',
      ai_response: cleanText.slice(0, 300),
      ai_time_ms: elapsed,
      hasHandoff,
      handoffType: type,
      key_preview: keyPreview,
      has_cpr_token: cprToken.length > 0,
      cpr_token_length: cprToken.length,
      has_training_token: trainingToken.length > 0,
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
      type: err.constructor.name,
      stack: (err.stack || '').split('\n').slice(0, 5),
    });
  }
};
