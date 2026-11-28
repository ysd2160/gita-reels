import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { toWav } from './audio.js';

// Procedural spiritual ambience (tanpura-style drone + soft singing-bowl hits + reverb).
// Royalty-free by construction, unique per reel. Used when assets/music is empty.
const RATE = 32000;
const TAU = Math.PI * 2;

function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function reverb(x, wet = 0.32) {
  const combs = [0.0297, 0.0371, 0.0411, 0.0437].map((d) => ({ buf: new Float32Array(Math.floor(d * RATE)), i: 0 }));
  const aps = [0.005, 0.0017].map((d) => ({ buf: new Float32Array(Math.floor(d * RATE)), i: 0 }));
  const out = new Float32Array(x.length);
  for (let n = 0; n < x.length; n++) {
    let s = 0;
    for (const c of combs) { const y = c.buf[c.i]; c.buf[c.i] = x[n] + y * 0.8; c.i = (c.i + 1) % c.buf.length; s += y; }
    s /= combs.length;
    for (const a of aps) { const y = a.buf[a.i]; const v = s + y * 0.5; a.buf[a.i] = v; a.i = (a.i + 1) % a.buf.length; s = y - v * 0.5; }
    out[n] = x[n] * (1 - wet) + s * wet * 2.2;
  }
  return out;
}

/** events: [{t, kind:'bowl'|'swell'}] in seconds (hook start, shlok start...) */
export function synthAmbient(durationSec, { seed = 1, events = [] } = {}) {
  const N = Math.floor(durationSec * RATE);
  const r = rng(seed);
  const x = new Float32Array(N);
  const sa = [130.81, 146.83, 155.56, 164.81][Math.floor(r() * 4)]; // C3..E3
  const pa = sa * 1.5;

  // 1) drone: Sa + Pa + low Sa, rich harmonics, slow tremolo
  const voices = [[sa, 0.5], [pa, 0.32], [sa * 2, 0.24], [sa / 2, 0.3]];
  for (const [f, g] of voices) {
    const detune = 1 + (r() - 0.5) * 0.004;
    const trem = 0.06 + r() * 0.08, ph = r() * TAU;
    for (let h = 1; h <= 7; h++) {
      const a = (g / (h * 1.15)) * 0.22, w = TAU * f * h * detune / RATE;
      for (let n = 0; n < N; n++) x[n] += a * Math.sin(w * n) * (0.8 + 0.2 * Math.sin(TAU * trem * n / RATE + ph));
    }
  }

  // 2) tanpura-like plucks: Pa, Sa, Sa, low Sa, repeating
  const pattern = [[pa, 0], [sa * 2, 0.9], [sa * 2, 1.8], [sa, 2.7]];
  const cycle = 3.7;
  for (let c0 = 0.4; c0 < durationSec; c0 += cycle) {
    for (const [f, off] of pattern) {
      const start = Math.floor((c0 + off) * RATE);
      const len = Math.min(N - start, Math.floor(3.2 * RATE));
      for (let h = 1; h <= 9; h++) {
        const a = 0.085 / Math.pow(h, 1.05), w = TAU * f * h / RATE, d = 1.7 / (1 + 0.22 * h);
        for (let n = 0; n < len; n++) { const t = n / RATE; x[start + n] += a * Math.sin(w * n) * Math.exp(-t / d) * Math.min(1, t * 400); }
      }
    }
  }

  // 3) singing-bowl hits (inharmonic partials, long decay) on events + a few random ones
  const hits = events.map((e) => ({ t: e.t, g: e.kind === 'swell' ? 0.2 : 0.34 }));
  for (let t = 6 + r() * 4; t < durationSec - 3; t += 8 + r() * 6) hits.push({ t, g: 0.16 });
  const bowlBase = [293.66, 349.23, 440, 392][Math.floor(r() * 4)];
  for (const hItem of hits) {
    const start = Math.floor(hItem.t * RATE);
    const len = Math.min(N - start, Math.floor(6 * RATE));
    if (len <= 0) continue;
    [[1, 1], [2.76, 0.5], [5.4, 0.22], [8.93, 0.1]].forEach(([ratio, amp], k) => {
      const w = TAU * bowlBase * ratio / RATE, d = 3.2 / (1 + 0.55 * k);
      for (let n = 0; n < len; n++) { const t = n / RATE; x[start + n] += hItem.g * amp * 0.5 * Math.sin(w * n) * Math.exp(-t / d) * Math.min(1, t * 200); }
    });
  }

  const y = reverb(x);
  let peak = 1e-6;
  for (let n = 0; n < N; n++) peak = Math.max(peak, Math.abs(y[n]));
  const out = new Int16Array(N);
  const fin = RATE * 0.8, fout = RATE * 1.6;
  for (let n = 0; n < N; n++) {
    const env = Math.min(1, n / fin, (N - n) / fout);
    out[n] = Math.round((y[n] / peak) * 0.6 * 32767 * Math.max(0, env));
  }
  return out;
}

/** Pick music for a reel: your own file (assets/music) or generated ambience. Returns file path (inside outDir) / URL part. */
export async function makeMusic(durationSec, outDir, events, seed, mood = '') {
  if (config.music.mode === 'off') return null;
  if (config.music.mode !== 'synth') {
    // mood folders: assets/music/epic, assets/music/devotional ... (a Script Pack says which mood). No mood folder / no mood = any file in assets/music.
    const safe = String(mood || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const lookIn = async (sub) => {
      const dir = path.join(config.paths.assets, 'music', sub);
      const files = (await fs.readdir(dir).catch(() => [])).filter((f) => /\.(mp3|wav|m4a)$/i.test(f));
      return files.length ? { url: `${config.baseUrl}/assets/music/${sub ? `${sub}/` : ''}${encodeURIComponent(files[Math.floor(Math.random() * files.length)])}`, generated: false } : null;
    };
    const hit = (safe && (await lookIn(safe))) || (await lookIn(''));
    if (hit) return hit;
  }
  await fs.mkdir(outDir, { recursive: true });
  const file = path.join(outDir, 'music.wav');
  await fs.writeFile(file, toWav(synthAmbient(durationSec, { seed, events }), RATE));
  return { file, generated: true };
}
