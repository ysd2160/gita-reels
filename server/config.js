import 'dotenv/config';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
const bool = (v, d) => (v === undefined || v === '' ? d : v === 'true');
const list = (v, d) => (v || d).split(',').map((s) => s.trim()).filter(Boolean);
const env = process.env;

export const config = {
  port: num(env.PORT, 4000),
  host: env.HOST || '127.0.0.1', // 127.0.0.1 = only nginx / SSH tunnel can reach it (safe on AWS)
  publicUrl: (env.PUBLIC_URL || '').replace(/\/$/, ''), // e.g. https://reels.yourdomain.com (needed for YouTube connect on a server)
  auth: { user: env.DASHBOARD_USER || '', pass: env.DASHBOARD_PASS || '' }, // basic-auth for the dashboard
  maxPerDay: num(env.MAX_PER_DAY, 3), // hard cap: never plan/make more than this many videos a day
  mongoUri: env.MONGODB_URI || 'mongodb://127.0.0.1:27017/gita_reels',
  channelName: env.CHANNEL_NAME || '',
  youtube: { clientId: env.YOUTUBE_CLIENT_ID || '', clientSecret: env.YOUTUBE_CLIENT_SECRET || '' },
  instagram: { userId: env.IG_USER_ID || '', token: env.IG_ACCESS_TOKEN || '' },

  gemini: {
    key: env.GEMINI_API_KEY || '',
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
      key: env.SARVAM_API_KEY || '',
      model: env.SARVAM_MODEL || 'bulbul:v3',
      speaker: env.SARVAM_SPEAKER || 'shubh',
      chantSpeaker: env.SARVAM_CHANT_SPEAKER || '',
      pace: num(env.SARVAM_PACE, 1.05),
    },
    elevenlabs: { key: env.ELEVENLABS_API_KEY || '', voiceId: env.ELEVENLABS_VOICE_ID || '', model: env.ELEVENLABS_MODEL || 'eleven_multilingual_v2' },
    google: { key: env.GOOGLE_TTS_API_KEY || '', voice: env.GOOGLE_TTS_VOICE || 'hi-IN-Chirp3-HD-Charon' },
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
    cloudflare: { account: env.CLOUDFLARE_ACCOUNT_ID || '', token: env.CLOUDFLARE_API_TOKEN || '' },
    geminiModel: env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image',
    pollinationsKey: env.POLLINATIONS_KEY || '',
  },
  pexels: { key: env.PEXELS_API_KEY || '' },
  pixabay: { key: env.PIXABAY_API_KEY || '' },

  music: { mode: env.MUSIC_MODE || 'auto', volume: num(env.MUSIC_VOLUME, 0.22) }, // auto | synth | off

  // when generated audio/images/clips are deleted: approve (default: videos stay editable until approved) | render | never
  // 'retention' (default): nothing is deleted at approve/render, ALL files of a reel (images, audio, video) are deleted KEEP_HOURS after generation.
  // 'approve' / 'render' = old behaviour (temp files deleted right at approve / render)
  cleanup: env.CLEAN_MODE || 'retention',
  draftDays: num(env.KEEP_DRAFT_DAYS, 3),
  retention: { hours: num(env.KEEP_HOURS, 24), maxHours: num(env.KEEP_MAX_HOURS, 72) },
  cron: { enabled: env.ENABLE_CRON === 'true', expr: env.CRON_GENERATE || '0 2 * * *', perDay: num(env.REELS_PER_DAY, 2) },
  windows: env.POST_WINDOWS || '06:30-08:00,21:00-22:30',

  queue: { prep: num(env.PREP_CONCURRENCY, 2) },
  render: {
    concurrency: num(env.RENDER_CONCURRENCY, Math.max(1, Math.floor(os.cpus().length / 3))),
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
