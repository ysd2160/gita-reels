import { Setting } from '../models.js';

export const DEFAULTS = {
  automation: false, // true = the daily plan is generated automatically at generateAt
  generateAt: '06:00', // IST - daily generation starts here
  shorts: 3,
  long: 1, // 1 long video (up to ~5 min, YouTube only) a day
  shortSlots: ['07:30', '13:00', '20:30'], // IST publish times for the shorts
  longSlot: '18:00',
  planDays: 7,
  reelLength: 'auto', // auto | 30 | 45 | 60 (seconds) - target length of every short
  shlokPercent: 0, // shlok is switched off: every video is a story
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
export const getSecret = async (key) => (await Setting.findOne({ key: `secret:${key}` }))?.value || null;
export const setSecret = (key, value) => Setting.updateOne({ key: `secret:${key}` }, { key: `secret:${key}`, value }, { upsert: true });
