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
  sequence_type TEXT DEFAULT 'prospect',  -- 'prospect' | 'post_course'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migration: เพิ่ม sequence_type และ platform ถ้ายังไม่มี
ALTER TABLE chatbot_followups ADD COLUMN IF NOT EXISTS sequence_type TEXT DEFAULT 'prospect';
ALTER TABLE chatbot_followups ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'messenger'; -- 'messenger' | 'line'

-- Index สำหรับ query follow-ups ที่ active
CREATE INDEX IF NOT EXISTS idx_followups_active ON chatbot_followups (status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_followups_psid ON chatbot_followups (psid);

-- ตาราง referrals (ระบบชวนเพื่อน)
CREATE TABLE IF NOT EXISTS chatbot_referrals (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  platform TEXT DEFAULT 'messenger',  -- 'messenger' | 'line'
  user_name TEXT,
  code TEXT NOT NULL UNIQUE,           -- e.g. JIA12345
  referral_count INTEGER DEFAULT 0,   -- จำนวนคนที่ชวนมาได้
  discount_baht INTEGER DEFAULT 0,    -- เครดิตสะสม (฿50 ต่อคน)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ตาราง referral_uses (บันทึกการใช้โค้ด)
CREATE TABLE IF NOT EXISTS chatbot_referral_uses (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL,
  referrer_id TEXT NOT NULL,
  new_user_id TEXT NOT NULL,
  platform TEXT,
  referrer_reward INTEGER DEFAULT 50,
  new_user_discount INTEGER DEFAULT 100,
  used_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referrals_user ON chatbot_referrals (user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_code ON chatbot_referrals (code);
CREATE INDEX IF NOT EXISTS idx_referral_uses_code ON chatbot_referral_uses (code);

-- ตาราง A/B Tests
CREATE TABLE IF NOT EXISTS chatbot_ab_tests (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT DEFAULT 'messenger',
  variant TEXT NOT NULL,            -- 'A' หรือ 'B'
  converted BOOLEAN DEFAULT FALSE,
  converted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, platform)         -- 1 record per user/platform
);

CREATE INDEX IF NOT EXISTS idx_ab_variant ON chatbot_ab_tests (variant);
CREATE INDEX IF NOT EXISTS idx_ab_converted ON chatbot_ab_tests (converted);
