const Anthropic = require('@anthropic-ai/sdk');
const { SYSTEM_PROMPT } = require('./system-prompt');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// เก็บประวัติสนทนา in-memory (หายเมื่อ cold start)
// key = userId, value = { messages: [], lastActive: timestamp }
const conversationHistory = new Map();

const HISTORY_TTL_MS = 30 * 60 * 1000; // 30 นาที
const MAX_HISTORY_MESSAGES = 20; // เก็บไว้ 20 ข้อความล่าสุด

const MODEL_HAIKU = 'claude-haiku-4-5-20251001';
const MODEL_SONNET = 'claude-sonnet-4-6-20250520';

// จำนวนข้อความขั้นต่ำที่จะสลับไป Sonnet (ลูกค้าคุยจริงจัง)
const SONNET_THRESHOLD_MESSAGES = 3;

function getHistory(userId) {
  const record = conversationHistory.get(userId);
  if (!record) return [];
  // ลบถ้าหมดอายุ
  if (Date.now() - record.lastActive > HISTORY_TTL_MS) {
    conversationHistory.delete(userId);
    return [];
  }
  return record.messages;
}

function saveHistory(userId, messages) {
  conversationHistory.set(userId, {
    messages: messages.slice(-MAX_HISTORY_MESSAGES),
    lastActive: Date.now(),
  });
}

/**
 * เลือกโมเดลตามความจริงจังของลูกค้า
 * - คุยเกิน 3 ข้อความ → Sonnet (ปิดการขาย)
 * - lead level เป็น hot/warm → Sonnet
 * - นอกนั้น → Haiku (เร็ว ถูก)
 */
function chooseModel(history, leadLevel) {
  const userMessageCount = history.filter((m) => m.role === 'user').length;

  if (userMessageCount >= SONNET_THRESHOLD_MESSAGES) return MODEL_SONNET;
  if (leadLevel === 'hot' || leadLevel === 'warm') return MODEL_SONNET;

  return MODEL_HAIKU;
}

/**
 * ส่งข้อความไปให้ Claude และได้รับคำตอบ
 * @param {string} userId - ID ผู้ใช้ (Messenger PSID หรือ LINE userId)
 * @param {string} userMessage - ข้อความจากผู้ใช้
 * @param {string|null} leadLevel - ระดับ lead (hot/warm/cold/null)
 * @returns {Promise<string>} - คำตอบจาก AI
 */
async function getAIResponse(userId, userMessage, leadLevel, customSystemPrompt = null) {
  const history = getHistory(userId);

  const messages = [
    ...history,
    { role: 'user', content: userMessage },
  ];

  const model = chooseModel(history, leadLevel);
  console.log(`[AI] ${userId}: using ${model === MODEL_SONNET ? 'Sonnet (closing)' : 'Haiku (fast)'}`);

  const response = await client.messages.create({
    model,
    max_tokens: model === MODEL_SONNET ? 700 : 500,
    system: customSystemPrompt || SYSTEM_PROMPT,
    messages,
  });

  const assistantMessage = response.content[0].text;

  // บันทึกประวัติ (ไม่เก็บแท็ก HANDOFF ใน history)
  const cleanMessage = assistantMessage.replace(/\[HANDOFF:[A-Z_]+\]/g, '').trim();
  saveHistory(userId, [
    ...messages,
    { role: 'assistant', content: cleanMessage },
  ]);

  return assistantMessage;
}

/**
 * ตรวจว่ามี handoff signal ไหม
 * @param {string} text
 * @returns {{ hasHandoff: boolean, type: string|null, cleanText: string }}
 */
function checkHandoff(text) {
  const match = text.match(/\[HANDOFF:([A-Z_]+)\]/);
  if (!match) return { hasHandoff: false, type: null, cleanText: text };
  return {
    hasHandoff: true,
    type: match[1],
    cleanText: text.replace(/\[HANDOFF:[A-Z_]+\]/g, '').trim(),
  };
}

module.exports = { getAIResponse, checkHandoff };
