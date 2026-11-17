import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { parseFile } from 'music-metadata';
import { config } from '../config.js';
import { parseWav, pcmFromBase64 } from './audio.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = () => config.tts;
let lastError = '';
export const lastTtsError = () => lastError;

// voices picked in the dashboard override .env
export function setVoiceOverrides(o = {}) {
  if (o.voiceGemini) T().gemini.voice = o.voiceGemini;
  if (o.voiceSarvam) T().sarvam.speaker = o.voiceSarvam;
  if (o.voiceEleven) T().elevenlabs.voiceId = o.voiceEleven;
}

export const providerEnabled = (p) =>
  p === 'sarvam' ? !!T().sarvam.key
    : p === 'elevenlabs' ? !!(T().elevenlabs.key && T().elevenlabs.voiceId)
      : p === 'google' ? !!T().google.key
        : p === 'gemini' ? !!config.gemini.key
          : p === 'edge';
export const batchProviders = () => T().providers.filter((p) => p !== 'edge' && providerEnabled(p));
export const edgeAllowed = () => T().providers.includes('edge');
export const ttsSignature = () => `${batchProviders().join('+')}|${T().sarvam.speaker}|${T().gemini.voice}|${T().elevenlabs.voiceId}|${T().google.voice}`;

// ---------------------------------------------------------------- Sarvam (paid after free credits; best Hindi)
async function sarvam(text, { chant }) {
  const s = T().sarvam;
  if (text.length > 2400) throw new Error('Sarvam: text 2500 chars se zyada');
  const res = await fetch('https://api.sarvam.ai/text-to-speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-subscription-key': s.key },
    body: JSON.stringify({
      text, target_language_code: 'hi-IN', speaker: (chant && s.chantSpeaker) || s.speaker, model: s.model,
      pace: chant ? 0.8 : s.pace, speech_sample_rate: 24000, enable_preprocessing: true,
    }),
  });
  if (!res.ok) throw new Error(`Sarvam ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const wav = Buffer.concat(((await res.json()).audios || []).map((a) => Buffer.from(a, 'base64')));
  if (!wav.length) throw new Error('Sarvam: audio empty');
  const { pcm, rate } = parseWav(wav);
  return { pcm, rate, speed: 1 };
}

// ---------------------------------------------------------------- ElevenLabs (paid) - raw PCM output
async function elevenlabs(text) {
  const e = T().elevenlabs;
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${e.voiceId}?output_format=pcm_24000`, {
    method: 'POST', headers: { 'xi-api-key': e.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: e.model, voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true } }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const b = Buffer.from(await res.arrayBuffer());
  return { pcm: new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length - (b.length % 2))), rate: 24000, speed: T().speed };
}

// ---------------------------------------------------------------- Google Cloud TTS Chirp 3 HD (paid, free monthly tier needs billing account)
async function google(text) {
  const g = T().google;
  const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${g.key}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: { text }, voice: { languageCode: 'hi-IN', name: g.voice }, audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 24000 } }),
  });
  if (!res.ok) throw new Error(`Google TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { pcm, rate } = parseWav(Buffer.from((await res.json()).audioContent, 'base64'));
  return { pcm, rate, speed: T().speed };
}

// ---------------------------------------------------------------- Gemini TTS (FREE tier, commercial use allowed by Google's terms)
async function gemini(text, { chant }) {
  const g = T().gemini;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${g.model}:generateContent`;
  let err;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.gemini.key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${chant ? g.chantStyle : g.style}:\n\n${text}` }] }],
          generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: g.voice } } } },
        }),
      });
      if (res.status === 429 || res.status >= 500) { // free tier is rate limited: wait it out instead of falling back to a robotic voice
        err = new Error(`Gemini TTS ${res.status} (free-tier limit, waiting)`);
        await sleep(Math.min(20000 * attempt, 70000));
        continue;
      }
      if (!res.ok) throw Object.assign(new Error(`Gemini TTS ${res.status}: ${(await res.text()).slice(0, 200)}`), { fatal: true });
      const part = ((await res.json()).candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data);
      if (!part) { err = new Error('Gemini TTS: audio nahi aaya'); await sleep(2500); continue; }
      const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType || '')?.[1] || 24000);
      return { pcm: pcmFromBase64(part.inlineData.data), rate, speed: chant ? 1 : T().speed };
    } catch (e) {
      err = e;
      if (e.fatal) break;
    }
  }
  throw err;
}

const IMPL = { sarvam, elevenlabs, google, gemini };

/** Whole text in ONE request -> { pcm, rate, speed, provider } | null */
export async function speakBatch(text, { chant = false } = {}) {
  for (const p of batchProviders()) {
    try { return { ...(await IMPL[p](text, { chant })), provider: p }; } catch (e) { lastError = `${p}: ${e.message}`; console.warn(`[tts] ${p} fail: ${e.message}`); }
  }
  return null;
}

// ---------------------------------------------------------------- edge-tts (opt-in only; unofficial, not monetization-safe)
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => reject(new Error(`'${cmd}' chal nahi paya (${e.message}). pip install edge-tts`)));
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`edge-tts failed (${code}): ${err.slice(-300)}`))));
  });
}
export async function edgeLine(text, outFile) {
  const txt = outFile.replace(/\.\w+$/, '.txt');
  await fs.writeFile(txt, text, 'utf8');
  const e = T().edge;
  await run(e.python, ['-m', 'edge_tts', '--file', txt, '--voice', e.voice, `--rate=${e.rate}`, `--pitch=${e.pitch}`, '--write-media', outFile]);
  await fs.rm(txt, { force: true });
  return (await parseFile(outFile)).format.duration;
}
