// In-memory lead store (resets on cold start)
// For production, replace with database (Supabase, Redis, etc.)

const leads = new Map();
const LEAD_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 วัน

const leadStore = {
  get(psid) {
    const lead = leads.get(psid);
    if (!lead) return null;
    if (Date.now() - lead.updatedAt > LEAD_TTL_MS) {
      leads.delete(psid);
      return null;
    }
    return lead;
  },

  update(psid, data) {
    const existing = leads.get(psid) || {
      psid,
      type: null,       // individual, corporate, aed
      level: null,       // hot, warm, cold
      timing: null,      // สัปดาห์นี้, เดือนหน้า, etc.
      corpSize: null,    // ≤7, 10-15, 15+
      name: null,
      firstMessage: null,
      createdAt: Date.now(),
    };
    Object.assign(existing, data, { updatedAt: Date.now() });
    leads.set(psid, existing);
    console.log(`[Lead] ${psid}: ${existing.level || '?'} / ${existing.type || '?'}`);
    return existing;
  },

  // Get summary for logging
  summary() {
    const all = [...leads.values()];
    return {
      total: all.length,
      hot: all.filter((l) => l.level === 'hot').length,
      warm: all.filter((l) => l.level === 'warm').length,
      cold: all.filter((l) => l.level === 'cold').length,
    };
  },
};

module.exports = { leadStore };
