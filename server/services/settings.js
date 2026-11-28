import { Setting } from '../models.js';
import { decrypt, encrypt } from '../crypto.js';

export const DEFAULTS = {
  automation: false, // true = the daily plan is generated automatically at generateAt
  generateAt: '06:00', // IST - daily generation starts here
  shorts: 3,
  long: 1, // 1 long video (up to ~5 min, YouTube only) a day
  shortSlots: ['07:30', '13:00', '20:30'], // IST publish times for the shorts
  longSlot: '18:00',
  longMinutes: 5, // length of the long video: 5 | 7 | 10 minutes (= number of chapters)
  planDays: 7,
  reelLength: 'auto', // auto | 30 | 45 | 60 | 90 | 120 (seconds) - target length of every short
  shlokPercent: 0, // shlok is switched off: every video is a story
  aiScripts: true, // false = the software's own AI never writes a script: only scripts YOU paste (Script Pack / own scripts) are made into videos
  prewriteScripts: true, // write today's scripts in advance so the Home page shows them
  keepHours: 24, // all files (images, audio, video) of a reel are deleted this many hours after generation
  autoApprove: true, // true = ready videos are approved automatically (set false to review each video first)
  autoPublish: true, // true = approved videos are uploaded automatically at their publish time
  youtube: true,
  instagram: true,
  youtubePrivacy: 'public', // public | unlisted | private
  voiceGemini: '', // picked in Settings; empty = .env value
  voiceSarvam: '',
  voiceEleven: '',
};

export async function getSettings() {
  const rows = await Setting.find();
  const out = { ...DEFAULTS };
  for (const r of rows) if (r.key in DEFAULTS) out[r.key] = r.value;
  return out;
}
export async function saveSettings(patch) {
  for (const k of Object.keys(patch)) if (k in DEFAULTS) await Setting.updateOne({ key: k }, { key: k, value: patch[k] }, { upsert: true });
  return getSettings();
}
// ---- per-user secrets (YouTube refresh token, Instagram token). Stored encrypted (AES-256-GCM, key from storage/.session_secret / SESSION_SECRET).
// Old plain-text values (single-user installs) are still readable and get encrypted the next time they are saved.
export async function getSecret(key) {
  const v = (await Setting.findOne({ key: `secret:${key}` }))?.value;
  if (v == null || v === '') return null;
  if (typeof v === 'string' && v.startsWith('enc1:')) {
    try { return decrypt(v); } catch { return null; } // key changed / corrupt = treated as "not connected"
  }
  return v;
}
export const setSecret = (key, value) => Setting.updateOne({ key: `secret:${key}` }, { key: `secret:${key}`, value: encrypt(value) }, { upsert: true });
export const deleteSecret = (key) => Setting.deleteOne({ key: `secret:${key}` });
