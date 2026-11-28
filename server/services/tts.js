import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { parseFile } from 'music-metadata';
import { config } from '../config.js';
import { parseWav, pcmFromBase64 } from './audio.js';
import { withKeys } from './keypool.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = () => config.tts;
let lastError = '';
export const lastTtsError = () => lastError;

// voices picked in the dashboard override .env. Every user picks their own: the queue calls this before each video (one video at a time),
// and it always starts from the .env values, so one user's voice never leaks into another user's video.
const BASE_VOICE = { gemini: T().gemini.voice, sarvam: T().sarvam.speaker, eleven: T().elevenlabs.voiceId };
export function setVoiceOverrides(o = {}) {
  T().gemini.voice = o.voiceGemini || BASE_VOICE.gemini;
  T().sarvam.speaker = o.voiceSarvam || BASE_VOICE.sarvam;
  T().elevenlabs.voiceId = o.voiceEleven || BASE_VOICE.eleven;
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
  const res = await withKeys('sarvam', 'tts:sarvam', async (key) => {
    const r = await fetch('https://api.sarvam.ai/text-to-speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-subscription-key': key },
      body: JSON.stringify({
        text, target_language_code: 'hi-IN', speaker: (chant && s.chantSpeaker) || s.speaker, model: s.model,
        pace: chant ? 0.8 : s.pace, speech_sample_rate: 24000, enable_preprocessing: true,
      }),
    });
    if (!r.ok) throw Object.assign(new Error(`Sarvam ${r.status}: ${(await r.text()).slice(0, 200)}`), { status: r.status });
    return r;
  });
  const wav = Buffer.concat(((await res.json()).audios || []).map((a) => Buffer.from(a, 'base64')));
  if (!wav.length) throw new Error('Sarvam: audio empty');
  const { pcm, rate } = parseWav(wav);
  return { pcm, rate, speed: 1 };
}

// ---------------------------------------------------------------- ElevenLabs (paid) - raw PCM output
async function elevenlabs(text) {
  const e = T().elevenlabs;
  const res = await withKeys('elevenlabs', 'tts:elevenlabs', async (key) => {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${e.voiceId}?output_format=pcm_24000`, {
      method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: e.model, voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true } }),
    });
    if (!r.ok) throw Object.assign(new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 200)}`), { status: r.status });
    return r;
  });
  const b = Buffer.from(await res.arrayBuffer());
  return { pcm: new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length - (b.length % 2))), rate: 24000, speed: T().speed };
}

// ---------------------------------------------------------------- Google Cloud TTS Chirp 3 HD (paid, free monthly tier needs billing account)
async function google(text) {
  const g = T().google;
  const res = await withKeys('google', 'tts:google', async (key) => {
    const r = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${key}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { text }, voice: { languageCode: 'hi-IN', name: g.voice }, audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 24000 } }),
    });
    if (!r.ok) throw Object.assign(new Error(`Google TTS ${r.status}: ${(await r.text()).slice(0, 200)}`), { status: r.status });
    return r;
  });
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
      const res = await withKeys('gemini', 'gemini:tts', async (key) => {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${chant ? g.chantStyle : g.style}:\n\n${text}` }] }],
            generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: g.voice } } } },
          }),
        });
        if (r.status === 429) throw Object.assign(new Error('Gemini TTS 429 (limit)'), { status: 429 }); // -> next key
        if (r.status >= 500) throw Object.assign(new Error(`Gemini TTS ${r.status}`), { transient: true });
        if (!r.ok) throw Object.assign(new Error(`Gemini TTS ${r.status}: ${(await r.text()).slice(0, 200)}`), { fatal: true });
        return r;
      });
      const part = ((await res.json()).candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data);
      if (!part) { err = new Error('Gemini TTS: audio nahi aaya'); await sleep(2500); continue; }
      const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType || '')?.[1] || 24000);
      return { pcm: pcmFromBase64(part.inlineData.data), rate, speed: chant ? 1 : T().speed };
    } catch (e) {
      err = e;
      if (e.fatal) break;
      if (e.allLimited) { // all keys resting: wait only if one is back within ~70 s, else let the next provider take over
        if (!(e.retryInMs <= 70000)) break;
        await sleep(e.retryInMs + 500);
      } else if (e.transient) await sleep(Math.min(20000 * attempt, 70000));
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
