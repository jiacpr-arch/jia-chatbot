/**
 * Referral Code System
 * Code format: JIA-XXXXX (5-digit number based on userId hash)
 * - Users earn ฿50 discount for every friend who books
 * - Referred friends get ฿100 discount on their first course
 */

const https = require('https');

// In-memory fallback (used when Supabase is not configured)
const memoryStore = new Map(); // code → { userId, platform, name, count, discount }
const codeByUser = new Map();  // userId → code

/**
 * Generate a deterministic 5-digit code from userId
 */
function generateCode(userId) {
  let hash = 5381;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) + hash) ^ userId.charCodeAt(i);
    hash |= 0; // Convert to 32-bit int
  }
  const num = Math.abs(hash) % 100000;
  return `JIA${String(num).padStart(5, '0')}`;
}

// ---- Supabase helpers ----

function supabaseGet(table, filter) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) return Promise.resolve(null);

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: new URL(url).hostname,
        path: `/rest/v1/${table}?${filter}&select=*`,
        method: 'GET',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Accept: 'application/json',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve(null); }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.end();
  });
}

function supabaseUpsert(table, body) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) return Promise.resolve(null);

  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      {
        hostname: new URL(url).hostname,
        path: `/rest/v1/${table}`,
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          Prefer: 'resolution=merge-duplicates,return=representation',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve(null); }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.write(payload);
    req.end();
  });
}

function supabasePatch(table, filter, body) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) return Promise.resolve(null);

  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      {
        hostname: new URL(url).hostname,
        path: `/rest/v1/${table}?${filter}`,
        method: 'PATCH',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve(res.statusCode < 300));
      }
    );
    req.on('error', () => resolve(false));
    req.write(payload);
    req.end();
  });
}

// ---- Public API ----

/**
 * Get or create a referral code for a user
 * @returns {{ code: string, count: number, discountBaht: number }}
 */
async function getOrCreateCode(userId, platform, name) {
  const code = generateCode(userId);

  // Try Supabase first
  const existing = await supabaseGet('chatbot_referrals', `user_id=eq.${encodeURIComponent(userId)}`);
  if (existing && existing.length > 0) {
    const r = existing[0];
    return { code: r.code, count: r.referral_count || 0, discountBaht: r.discount_baht || 0 };
  }

  // Create new record
  await supabaseUpsert('chatbot_referrals', {
    user_id: userId,
    platform,
    user_name: name || 'ลูกค้า',
    code,
    referral_count: 0,
    discount_baht: 0,
    created_at: new Date().toISOString(),
  });

  // In-memory fallback
  if (!codeByUser.has(userId)) {
    codeByUser.set(userId, code);
    memoryStore.set(code, { userId, platform, name, count: 0, discountBaht: 0 });
  }

  return { code, count: 0, discountBaht: 0 };
}

/**
 * Record that someone used a referral code (new user books a course)
 * @returns {{ referrerName: string, discountForNewUser: number } | null}
 */
async function useReferralCode(code, newUserId, platform) {
  const upperCode = code.toUpperCase();

  // Supabase lookup
  const rows = await supabaseGet('chatbot_referrals', `code=eq.${encodeURIComponent(upperCode)}`);

  let referrer = rows && rows.length > 0 ? rows[0] : null;

  // Fallback to in-memory
  if (!referrer) {
    const mem = memoryStore.get(upperCode);
    if (!mem) return null;
    referrer = { user_id: mem.userId, user_name: mem.name, referral_count: mem.count, discount_baht: mem.discountBaht };
  }

  // Don't self-refer
  if (referrer.user_id === newUserId) return null;

  const REFERRER_REWARD = 50;    // ฿50 per referral for code owner
  const NEW_USER_DISCOUNT = 100; // ฿100 for new user

  // Update referrer's stats
  await supabasePatch(
    'chatbot_referrals',
    `code=eq.${encodeURIComponent(upperCode)}`,
    {
      referral_count: (referrer.referral_count || 0) + 1,
      discount_baht: (referrer.discount_baht || 0) + REFERRER_REWARD,
    }
  );

  // Log the use
  await supabaseUpsert('chatbot_referral_uses', {
    code: upperCode,
    referrer_id: referrer.user_id,
    new_user_id: newUserId,
    platform,
    referrer_reward: REFERRER_REWARD,
    new_user_discount: NEW_USER_DISCOUNT,
    used_at: new Date().toISOString(),
  });

  // Update in-memory
  const mem = memoryStore.get(upperCode);
  if (mem) {
    mem.count += 1;
    mem.discountBaht += REFERRER_REWARD;
  }

  return { referrerName: referrer.user_name, discountForNewUser: NEW_USER_DISCOUNT };
}

/**
 * Check if text contains a referral code (JIA + 5 digits)
 * @returns {string|null} the code if found
 */
function extractCode(text) {
  const match = text.toUpperCase().match(/\bJIA\d{5}\b/);
  return match ? match[0] : null;
}

module.exports = { generateCode, getOrCreateCode, useReferralCode, extractCode };
