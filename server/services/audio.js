// Small PCM toolbox (16-bit mono) - no ffmpeg needed.
import { syllables, pauseMarks } from './syllables.js';

export function parseWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('WAV nahi hai');
  let pos = 12, rate = 24000, ch = 1, bits = 16, data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    let size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') { ch = buf.readUInt16LE(body + 2); rate = buf.readUInt32LE(body + 4); bits = buf.readUInt16LE(body + 14); }
    if (id === 'data') { if (body + size > buf.length) size = buf.length - body; data = buf.subarray(body, body + size); break; }
    pos = body + size + (size % 2);
  }
  if (!data || bits !== 16) throw new Error('unsupported WAV (16-bit PCM chahiye)');
  const all = new Int16Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.length - (data.length % 2)));
  if (ch === 1) return { pcm: all, rate };
  const mono = new Int16Array(Math.floor(all.length / ch));
  for (let i = 0; i < mono.length; i++) { let s = 0; for (let c = 0; c < ch; c++) s += all[i * ch + c]; mono[i] = s / ch; }
  return { pcm: mono, rate };
}

export function pcmFromBase64(b64) {
  const b = Buffer.from(b64, 'base64');
  return new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length - (b.length % 2)));
}

export function toWav(pcm, rate) {
  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const win10 = (rate) => Math.max(1, Math.floor(rate * 0.01));

/** RMS per 10 ms window */
export function envelope(pcm, rate) {
  const w = win10(rate);
  const n = Math.floor(pcm.length / w);
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = i * w; k < (i + 1) * w; k++) s += pcm[k] * pcm[k];
    env[i] = Math.sqrt(s / w);
  }
  return env;
}

function voicedRange(env, thr) {
  let a = 0; while (a < env.length && env[a] <= thr) a++;
  let b = env.length - 1; while (b > a && env[b] <= thr) b--;
  return [a, b];
}

export function trimSilence(pcm, rate, { padStart = 0.04, padEnd = 0.09 } = {}) {
  const env = envelope(pcm, rate);
  const peak = Math.max(...env, 1);
  const [a, b] = voicedRange(env, peak * 0.03);
  const w = win10(rate);
  const from = Math.max(0, a * w - Math.floor(padStart * rate));
  const to = Math.min(pcm.length, (b + 1) * w + Math.floor(padEnd * rate));
  return pcm.slice(from, to);
}

export function normalize(pcm, target = 0.85) {
  let peak = 1;
  for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
  const g = (target * 32767) / peak;
  const out = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(pcm[i] * g)));
  return out;
}

export function fade(pcm, rate, ms = 12) {
  const n = Math.min(Math.floor((rate * ms) / 1000), Math.floor(pcm.length / 2));
  const out = pcm.slice();
  for (let i = 0; i < n; i++) { const g = i / n; out[i] *= g; out[out.length - 1 - i] *= g; }
  return out;
}

export function sliceSec(pcm, rate, from, to) {
  return pcm.slice(Math.max(0, Math.floor(from * rate)), Math.min(pcm.length, Math.floor(to * rate)));
}

export function resample(pcm, from, to) {
  if (from === to) return pcm;
  const n = Math.floor((pcm.length * to) / from);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * from) / to, i0 = Math.floor(x), f = x - i0;
    out[i] = pcm[i0] * (1 - f) + (pcm[Math.min(i0 + 1, pcm.length - 1)] * f);
  }
  return out;
}

/**
 * One long narration -> where does each line start/end?
 * weights[i] ~ spoken length of line i. Returns edges (seconds), length = N+1:
 * edges[0] = first sound, edges[i] = cut point between line i-1 and i (middle of a pause), edges[N] = last sound.
 */
export function findLineEdges(pcm, rate, weights) {
  const env = envelope(pcm, rate);
  const peak = Math.max(...env, 1);
  const thr = peak * 0.035;
  const [s0, e0] = voicedRange(env, thr);
  const N = weights.length;
  const total = weights.reduce((a, b) => a + b, 0);

  // candidate pauses (>= 70 ms of near-silence)
  const gaps = [];
  for (let i = s0; i <= e0;) {
    if (env[i] > thr) { i++; continue; }
    let j = i; while (j <= e0 && env[j] <= thr) j++;
    if (j - i >= 7) gaps.push({ c: (i + j) / 2, len: j - i });
    i = j;
  }

  const edges = [s0 / 100];
  let cum = 0, prev = s0;
  for (let k = 1; k < N; k++) {
    cum += weights[k - 1];
    const expected = s0 + ((e0 - s0) * cum) / total;
    const tol = Math.max(120, (e0 - s0) * 0.12);
    let best = null, bestScore = -Infinity;
    for (const g of gaps) {
      if (g.c <= prev + 30 || Math.abs(g.c - expected) > tol) continue;
      const score = g.len - 0.18 * Math.abs(g.c - expected);
      if (score > bestScore) { bestScore = score; best = g; }
    }
    let c = best ? best.c : expected;
    if (!best) { // no pause nearby -> quietest window around expected
      let m = Infinity;
      for (let i = Math.max(prev + 30, Math.floor(expected - 40)); i <= Math.min(e0, Math.floor(expected + 40)); i++) if (env[i] < m) { m = env[i]; c = i; }
    }
    prev = c;
    edges.push(c / 100);
  }
  edges.push((e0 + 1) / 100);
  return edges;
}

/** Spoken-length weight of a line (letters only). */
export const lineWeight = (s) => Math.max(2, syllables(s) + 0.5 * pauseMarks(s));

/**
 * For every line (between its cut points) find where the voice really starts / stops and the voiced runs in between.
 * Returns [{ on, off, runs:[[a,b],...] }] in seconds of the same pcm. Used so captions begin with the voice, not in the middle of the pause.
 */
export function lineVoiceDetail(pcm, rate, edges) {
  const env = envelope(pcm, rate);
  const peak = Math.max(...env, 1);
  const thr = peak * 0.035;
  const out = [];
  for (let k = 0; k < edges.length - 1; k++) {
    const a = Math.max(0, Math.floor(edges[k] * 100)), b = Math.min(env.length - 1, Math.ceil(edges[k + 1] * 100));
    let runs = [];
    for (let i = a; i <= b;) {
      if (env[i] <= thr) { i++; continue; }
      let j = i; while (j <= b && env[j] > thr) j++;
      runs.push([i, j]);
      i = j;
    }
    // short dips (< 70 ms, plosives / breaths) are not pauses: merge them, and drop tiny clicks
    const merged = [];
    for (const r of runs) {
      const last = merged[merged.length - 1];
      if (last && r[0] - last[1] < 7) last[1] = r[1]; else merged.push([...r]);
    }
    runs = merged.filter((r) => r[1] - r[0] >= 3);
    if (!runs.length) runs = [[a, Math.max(a + 1, b)]];
    out.push({ on: runs[0][0] / 100, off: runs.at(-1)[1] / 100, runs: runs.map(([x, y]) => [x / 100, y / 100]) });
  }
  return out;
}

/** seconds of first/last sound in a clip */
export function voicedBounds(pcm, rate) {
  const env = envelope(pcm, rate);
  const peak = Math.max(...env, 1);
  const [a, b] = voicedRange(env, peak * 0.035);
  return { start: a / 100, end: (b + 1) / 100 };
}
