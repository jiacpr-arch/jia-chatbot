-- Supabase schema for JIA Chatbot

-- ตาราง leads (ถ้ายังไม่มี)
CREATE TABLE IF NOT EXISTS chatbot_leads (
  id BIGSERIAL PRIMARY KEY,
  name TEXT,
  psid TEXT,
  platform TEXT DEFAULT 'Messenger',
  lead_type TEXT,
  lead_level TEXT,
  timing TEXT,
  corp_size TEXT,
  message TEXT,
  source TEXT DEFAULT 'messenger_bot',
  email TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ตาราง follow-ups (ใหม่)
CREATE TABLE IF NOT EXISTS chatbot_followups (
  id BIGSERIAL PRIMARY KEY,
  psid TEXT NOT NULL,
  page_token TEXT NOT NULL,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  next_index INTEGER DEFAULT 0,
  last_interaction TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index สำหรับ query follow-ups ที่ active
CREATE INDEX IF NOT EXISTS idx_followups_active ON chatbot_followups (status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_followups_psid ON chatbot_followups (psid);
