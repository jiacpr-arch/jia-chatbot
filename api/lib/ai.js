const Anthropic = require('@anthropic-ai/sdk');
const { SYSTEM_PROMPT } = require('./system-prompt');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// เก็บประวัติสนทนา in-memory (หายเมื่อ cold start)
// key = userId, value = { messages: [], lastActive: timestamp }
const conversationHistory = new Map();

const HISTORY_TTL_MS = 30 * 60 * 1000; // 30 นาที
const MAX_HISTORY_MESSAGES = 20; // เก็บไว้ 20 ข้อความล่าสุด

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
 * ส่งข้อความไปให้ Claude และได้รับคำตอบ
 * @param {string} userId - ID ผู้ใช้ (Messenger PSID หรือ LINE userId)
 * @param {string} userMessage - ข้อความจากผู้ใช้
 * @returns {Promise<string>} - คำตอบจาก AI
 */
async function getAIResponse(userId, userMessage) {
  const history = getHistory(userId);

  const messages = [
    ...history,
    { role: 'user', content: userMessage },
  ];

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    system: SYSTEM_PROMPT,
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
