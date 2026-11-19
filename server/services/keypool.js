// Rotating API keys. Every provider can have several keys (e.g. 5 Gemini keys from different Google accounts).
// When one key hits its limit the next one is used automatically; a limited key rests for a while and comes back.
const registry = new Map(); // provider -> [keys]
const cool = new Map(); // `${scope}|${key}` -> { until, strikes }
const nextIdx = new Map(); // scope -> next key to try (round robin spreads the load)

export const parseList = (...vals) => [...new Set(vals.flatMap((v) => String(v || '').split(/[\s,;]+/)).map((s) => s.trim()).filter(Boolean))];

/** GEMINI_API_KEYS=a,b,c  +  GEMINI_API_KEY=a  +  GEMINI_API_KEY_2 ... GEMINI_API_KEY_9 */
export function envKeys(env, base) {
  return parseList(env[`${base}S`], env[base], ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => env[`${base}_${i}`]));
}
export const registerKeys = (name, keys) => registry.set(name, keys);
export const keyCount = (name) => (registry.get(name) || []).filter(Boolean).length;

const DAILY = /per.?day|daily|free allocation|neurons/i;
const LADDER = [60e3, 5 * 60e3, 15 * 60e3, 3600e3, 6 * 3600e3];
function rest(e, strikes) {
  if (e.status === 401 || e.status === 403) return 6 * 3600e3; // bad / disabled key
  if (e.status === 402) return 3600e3; // payment needed
  if (DAILY.test(e.message || '')) { // daily quota: back at the next UTC midnight
    const d = new Date(); d.setUTCHours(24, 0, 5, 0);
    return Math.min(d - Date.now(), 12 * 3600e3);
  }
  return LADDER[Math.min(strikes - 1, LADDER.length - 1)];
}

/**
 * fn(key) is called with a usable key. 401/402/403/429 errors (status set on the error) rotate to the next key;
 * any other error is thrown as-is. When every key is resting an error with allLimited=true and retryInMs is thrown.
 */
export async function withKeys(name, scope, fn) {
  const keys = registry.get(name) || [];
  if (!keys.length) throw Object.assign(new Error(`${name}: koi API key nahi hai (.env dekho)`), { status: 401, allLimited: true, retry: false, retryInMs: Infinity });
  const start = nextIdx.get(scope) || 0;
  let lastErr = null;
  for (let i = 0; i < keys.length; i++) {
    const idx = (start + i) % keys.length;
    const key = keys[idx];
    const id = `${scope}|${key}`;
    if ((cool.get(id)?.until || 0) > Date.now()) continue;
    try {
      const out = await fn(key, idx);
      cool.delete(id);
      nextIdx.set(scope, (idx + 1) % keys.length);
      return out;
    } catch (e) {
      if (![401, 402, 403, 429].includes(e.status)) throw e;
      lastErr = e;
      const strikes = (cool.get(id)?.strikes || 0) + 1;
      cool.set(id, { until: Date.now() + rest(e, strikes), strikes });
      if (keys.length > 1) console.warn(`[keys] ${scope}: key ${idx + 1}/${keys.length} limit (${e.status}) -> next key`);
    }
  }
  const wait = Math.min(...keys.map((k) => cool.get(`${scope}|${k}`)?.until || 0)) - Date.now();
  throw Object.assign(
    new Error(lastErr ? `${name}: saari ${keys.length} key(s) ki limit khatam. ${String(lastErr.message).slice(0, 160)}` : `${name}: saari keys abhi limit mein hain`),
    { status: 429, allLimited: true, retry: false, retryInMs: Math.max(0, wait) },
  );
}

/** for the dashboard: how many keys each provider has and how many are resting right now */
export function keyStats() {
  const now = Date.now(), out = {};
  for (const [name, keys] of registry) {
    const real = keys.filter(Boolean);
    if (!real.length) continue;
    const limited = new Map();
    for (const [id, c] of cool) {
      const key = id.slice(id.indexOf('|') + 1);
      if (real.includes(key) && c.until > now) limited.set(key, Math.max(limited.get(key) || 0, c.until));
    }
    out[name] = { total: real.length, limited: limited.size, resetInSec: limited.size ? Math.round((Math.min(...limited.values()) - now) / 1000) : 0 };
  }
  return out;
}
