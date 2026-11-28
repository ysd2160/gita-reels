import 'dotenv/config';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { envKeys, parseList, registerKeys } from './services/keypool.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
const bool = (v, d) => (v === undefined || v === '' ? d : v === 'true');
const list = (v, d) => (v || d).split(',').map((s) => s.trim()).filter(Boolean);
const env = process.env;

// ---- API keys: every provider may have several keys (comma list or _2.._9); they rotate when one hits its limit ----
const cfPairs = [
  ...parseList(env.CLOUDFLARE_ACCOUNTS), // acc1:token1,acc2:token2
  // CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN may also hold comma separated lists (same order): they are paired up
  ...(() => { const ids = parseList(env.CLOUDFLARE_ACCOUNT_ID), toks = parseList(env.CLOUDFLARE_API_TOKEN); return ids.map((id, i) => (toks[i] ? `${id}:${toks[i]}` : null)).filter(Boolean); })(),
  ...[2, 3, 4, 5, 6, 7, 8, 9].filter((i) => env[`CLOUDFLARE_ACCOUNT_ID_${i}`] && env[`CLOUDFLARE_API_TOKEN_${i}`]).map((i) => `${env[`CLOUDFLARE_ACCOUNT_ID_${i}`]}:${env[`CLOUDFLARE_API_TOKEN_${i}`]}`),
];
const K = {
  gemini: envKeys(env, 'GEMINI_API_KEY'), sarvam: envKeys(env, 'SARVAM_API_KEY'), elevenlabs: envKeys(env, 'ELEVENLABS_API_KEY'),
  google: envKeys(env, 'GOOGLE_TTS_API_KEY'), pexels: envKeys(env, 'PEXELS_API_KEY'), pixabay: envKeys(env, 'PIXABAY_API_KEY'),
  pollinations: envKeys(env, 'POLLINATIONS_KEY'), cloudflare: [...new Set(cfPairs)],
};
for (const [n, k] of Object.entries(K)) registerKeys(n, n === 'pollinations' && !k.length ? [''] : k); // pollinations also works without a key

export const config = {
  port: num(env.PORT, 4000),
  host: env.HOST || '127.0.0.1', // 127.0.0.1 = only nginx / SSH tunnel can reach it (safe on AWS)
  publicUrl: (env.PUBLIC_URL || '').replace(/\/$/, ''), // e.g. https://reels.yourdomain.com (needed for YouTube connect on a server)
  // multi-user login (email + password, cookie session). First user = admin (or ADMIN_EMAIL). See MULTIUSER.md
  auth: {
    secret: env.SESSION_SECRET || '', // empty = a random secret is created once in storage/.session_secret
    allowSignup: bool(env.ALLOW_SIGNUP, true), // false = nobody can sign up (admin account must exist already)
    signupCode: env.SIGNUP_CODE || '', // if set, new users must type this code to sign up
    adminEmail: (env.ADMIN_EMAIL || '').trim().toLowerCase(), // this email becomes admin when it signs up
    sessionDays: num(env.SESSION_DAYS, 30),
  },
  maxPerDay: num(env.MAX_PER_DAY, 4), // hard cap: never plan/make more than this many videos a day
  mongoUri: env.MONGODB_URI || 'mongodb://127.0.0.1:27017/gita_reels',
  channelName: env.CHANNEL_NAME || '',
  youtube: { clientId: env.YOUTUBE_CLIENT_ID || '', clientSecret: env.YOUTUBE_CLIENT_SECRET || '' },
  instagram: { userId: env.IG_USER_ID || '', token: env.IG_ACCESS_TOKEN || '' },

  gemini: {
    key: K.gemini[0] || '',
    model: env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
    // optional stronger model used ONLY for writing scripts (quality matters most there); empty = same as GEMINI_MODEL
    scriptModel: env.GEMINI_SCRIPT_MODEL || '',
  },

  // ---- voice: providers are tried in this order; ones without a key are skipped ----
  // free + commercial-safe: gemini | paid (leave keys empty until you have them): sarvam, elevenlabs, google
  // edge = unofficial Microsoft endpoint (robotic, NOT monetization-safe) -> only used if you add it yourself
  tts: {
    providers: list(env.TTS_PROVIDERS, 'sarvam,elevenlabs,google,gemini'),
    chant: bool(env.CHANT_SHLOK, true),
    speed: num(env.VOICE_SPEED, 1.0), // playbackRate for gemini/elevenlabs/google/edge (sarvam uses native pace)
    gemini: {
      model: env.GEMINI_TTS_MODEL || 'gemini-3.1-flash-tts-preview',
      voice: env.GEMINI_TTS_VOICE || 'Charon',
      style: env.TTS_STYLE || 'Narrate the following in natural spoken Hinglish (Hindi with English words), like a calm, warm storyteller talking to one friend late at night. Sound human and emotional, not like an announcer or a robot: soft emphasis on key words, small natural pauses at commas and full stops, easy conversational pace',
      chantStyle: 'Chant this Sanskrit shloka slowly in a deep, resonant, devotional voice, with a gentle melodic cadence and a pause at the end of each line',
    },
    sarvam: {
      key: K.sarvam[0] || '',
      model: env.SARVAM_MODEL || 'bulbul:v3',
      speaker: env.SARVAM_SPEAKER || 'shubh',
      chantSpeaker: env.SARVAM_CHANT_SPEAKER || '',
      pace: num(env.SARVAM_PACE, 1.05),
    },
    elevenlabs: { key: K.elevenlabs[0] || '', voiceId: env.ELEVENLABS_VOICE_ID || '', model: env.ELEVENLABS_MODEL || 'eleven_multilingual_v2' },
    google: { key: K.google[0] || '', voice: env.GOOGLE_TTS_VOICE || 'hi-IN-Chirp3-HD-Charon' },
    edge: {
      python: env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3'),
      voice: env.EDGE_VOICE || 'hi-IN-MadhurNeural',
      rate: env.EDGE_RATE || '+8%',
      pitch: env.EDGE_PITCH || '-2Hz',
    },
  },

  // ---- visuals: AI images (animated in the video) first, stock footage as fallback ----
  images: {
    providers: list(env.IMAGE_PROVIDERS, 'cloudflare,gemini,pollinations'),
    concurrency: num(env.IMAGE_CONCURRENCY, 3),
    cloudflare: { account: K.cloudflare[0]?.split(':')[0] || '', token: K.cloudflare[0]?.split(':').slice(1).join(':') || '' },
    geminiModel: env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image',
    pollinationsKey: K.pollinations[0] || '',
  },
  pexels: { key: K.pexels[0] || '' },
  pixabay: { key: K.pixabay[0] || '' },

  music: { mode: env.MUSIC_MODE || 'auto', volume: num(env.MUSIC_VOLUME, 0.22) }, // auto | synth | off

  // when generated audio/images/clips are deleted: approve (default: videos stay editable until approved) | render | never
  // 'retention' (default): nothing is deleted at approve/render, ALL files of a reel (images, audio, video) are deleted KEEP_HOURS after generation.
  // 'approve' / 'render' = old behaviour (temp files deleted right at approve / render)
  cleanup: env.CLEAN_MODE || 'retention',
  draftDays: num(env.KEEP_DRAFT_DAYS, 3),
  retention: { hours: num(env.KEEP_HOURS, 24), maxHours: num(env.KEEP_MAX_HOURS, 72), unpostedDays: num(env.KEEP_UNPOSTED_DAYS, 30) }, // a video that is NOT posted yet keeps its edit files for unpostedDays
  cron: { enabled: env.ENABLE_CRON === 'true', expr: env.CRON_GENERATE || '0 2 * * *', perDay: num(env.REELS_PER_DAY, 2) },
  windows: env.POST_WINDOWS || '06:30-08:00,21:00-22:30',

  queue: { jobMinutes: num(env.JOB_TIMEOUT_MIN, 40), jobMinutesLong: num(env.JOB_TIMEOUT_MIN_LONG, 150) }, // one video at a time; a stuck one is stopped after this long
  render: {
    concurrency: num(env.RENDER_CONCURRENCY, Math.max(1, Math.floor(os.cpus().length / 3))),
    concurrencyLong: num(env.RENDER_CONCURRENCY_LONG, 1), // the 5-minute video is rendered with ONE browser tab (low RAM)
    longScale: num(env.LONG_RENDER_SCALE, 2 / 3), // long video = 1280x720 (2/3 of 1920x1080); set 1 for full HD if your PC has 16 GB+ RAM
    preset: env.X264_PRESET || 'veryfast',
    crf: num(env.RENDER_CRF, 22),
  },

  paths: {
    storage: path.join(ROOT, 'storage'),
    assets: path.join(ROOT, 'assets'),
    public: path.join(ROOT, 'public'),
  },
};
config.baseUrl = `http://127.0.0.1:${config.port}`;
