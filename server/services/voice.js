import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { config } from '../config.js';
import { fade, findLineEdges, lineWeight, normalize, sliceSec, toWav, trimSilence, voicedBounds, parseWav } from './audio.js';
import { speakBatch, edgeLine, ttsSignature, edgeAllowed, lastTtsError } from './tts.js';
import { CHANT_HOLD, GAP_LINE, GAP_SPEECH, LEAD_IN, TAIL, wordTimings } from './timeline.js';
import { getShloks } from './shape.js';
import { stopIf } from './control.js';

const endPunct = (s) => (/[।?!.…]$/.test(s.trim()) ? s.trim() : `${s.trim()}।`);
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
const exists = (f) => fs.access(f).then(() => true, () => false);
const REQ_LIMIT = 2200; // chars per TTS request (Sarvam allows 2500)

async function chantClip(verse, dir) {
  if (!config.tts.chant) return null;
  const cacheDir = path.join(config.paths.storage, 'cache', 'chant');
  await fs.mkdir(cacheDir, { recursive: true });
  const file = path.join(cacheDir, `${verse.id}_${sha(ttsSignature())}.wav`);
  if (!(await exists(file))) {
    const r = await speakBatch(verse.sanskrit.replace(/\n/g, ' '), { chant: true });
    if (!r) return null;
    const pcm = fade(normalize(trimSilence(r.pcm, r.rate, { padStart: 0.05, padEnd: 0.25 }), 0.9), r.rate, 25);
    await fs.writeFile(file, toWav(pcm, r.rate));
  }
  const { pcm, rate } = parseWav(await fs.readFile(file));
  const out = path.join(dir, `chant_${verse.id}.wav`);
  await fs.copyFile(file, out);
  return { file: out, duration: pcm.length / rate };
}

/**
 * script -> audio files + exact timeline. Works for shorts (1 chant) and long videos (many chants).
 * Returns { audio, lines:[{start,end,words}], shloks:[{verseId,from,to}], durationSec, provider, chanted }
 */
export async function buildVoice(script, dir, { signal } = {}) {
  await fs.mkdir(dir, { recursive: true });
  const N = script.lines.length;
  const shloks = getShloks(script);
  const afterMap = new Map(shloks.map((s) => [s.afterLine, s.verse]));

  // blocks end at each chant point; requests pack consecutive blocks (TTS text limit)
  const blocks = [];
  let first = 0;
  for (const s of shloks) { blocks.push({ first, last: s.afterLine }); first = s.afterLine + 1; }
  if (first <= N - 1) blocks.push({ first, last: N - 1 });
  const chars = (b) => script.lines.slice(b.first, b.last + 1).reduce((a, l) => a + l.speak.length + 2, 0);
  const reqs = [];
  for (const b of blocks) {
    const cur = reqs[reqs.length - 1];
    if (cur && cur.chars + chars(b) <= REQ_LIMIT) { cur.blocks.push(b); cur.chars += chars(b); } else reqs.push({ blocks: [b], chars: chars(b) });
  }

  const chunks = [];
  let provider = 'edge';
  for (const [ri, req] of reqs.entries()) {
    stopIf(signal); // Pause works between voice requests too
    const f0 = req.blocks[0].first, f1 = req.blocks.at(-1).last;
    const reqLines = script.lines.slice(f0, f1 + 1);
    const r = await speakBatch(reqLines.map((l) => endPunct(l.speak)).join(' '));
    if (r) {
      provider = r.provider;
      const pcm = normalize(r.pcm);
      const edges = findLineEdges(pcm, r.rate, reqLines.map((l) => lineWeight(l.speak)));
      for (const [bi, b] of req.blocks.entries()) {
        const from = bi === 0 ? Math.max(0, edges[0] - 0.1) : edges[b.first - f0];
        const to = b.last === f1 ? edges[f1 - f0 + 1] + 0.2 : edges[b.last - f0 + 1];
        let clip = sliceSec(pcm, r.rate, from, to);
        const bd = voicedBounds(clip, r.rate);
        const o = Math.max(0, bd.start - 0.04);
        clip = fade(clip.slice(Math.floor(o * r.rate), Math.floor((bd.end + 0.1) * r.rate)), r.rate);
        const file = path.join(dir, `r${ri}b${bi}.wav`);
        await fs.writeFile(file, toWav(clip, r.rate));
        const origin = from + o;
        const starts = [];
        for (let i = b.first; i <= b.last; i++) starts.push(i === b.first ? Math.max(0, edges[i - f0] - origin) : edges[i - f0] + 0.07 - origin);
        starts.push(clip.length / r.rate);
        chunks.push({ file, dur: clip.length / r.rate, rate: r.speed, edges: starts, first: b.first, last: b.last });
      }
    } else {
      if (!edgeAllowed()) throw new Error(`Voice generate nahi hui (${lastTtsError() || 'koi voice provider configured nahi'}). Thodi der baad dobara try karo ya Settings mein voice check karo.`);
      for (let i = f0; i <= f1; i++) { // edge-tts (opt-in): each line its own clip
        const file = path.join(dir, `l${i}.mp3`);
        const d = await edgeLine(script.lines[i].speak, file);
        chunks.push({ file, dur: d, rate: config.tts.speed, edges: [0, d], first: i, last: i, perLine: true });
      }
    }
  }

  const chants = new Map();
  for (const s of shloks) {
    stopIf(signal);
    try { const c = await chantClip(s.verse, dir); if (c) chants.set(s.afterLine, { ...c, verse: s.verse }); } catch (e) { console.warn(`[chant] ${s.verse.id} skipped: ${e.message}`); }
  }

  // ---- timeline
  let t = LEAD_IN;
  const audio = [];
  const lines = new Array(N);
  const shokWin = [];
  for (const c of chunks) {
    const eff = c.dur / c.rate;
    audio.push({ file: c.file, start: +t.toFixed(3), duration: +eff.toFixed(3), rate: c.rate });
    for (let k = 0; k < c.edges.length - 1; k++) {
      lines[c.first + k] = { start: +(t + c.edges[k] / c.rate).toFixed(3), end: +(t + c.edges[k + 1] / c.rate).toFixed(3) };
    }
    t += eff;
    const chant = chants.get(c.last);
    if (chant) {
      t += GAP_SPEECH;
      audio.push({ file: chant.file, start: +t.toFixed(3), duration: +chant.duration.toFixed(3), rate: 1 });
      shokWin.push({ verseId: chant.verse.id, from: +t.toFixed(3), to: +(t + chant.duration + CHANT_HOLD).toFixed(3) });
      t += chant.duration + CHANT_HOLD;
    } else t += c.perLine ? GAP_LINE : GAP_SPEECH;
  }
  const durationSec = +(t + TAIL - GAP_LINE).toFixed(2);
  for (let i = 0; i < N; i++) {
    if (lines[i + 1] && lines[i].end > lines[i + 1].start) lines[i].end = lines[i + 1].start;
    lines[i].words = wordTimings(script.lines[i].show, lines[i].start, lines[i].end);
  }
  // no chant (failed/disabled): show the verse card over the lines that follow the chant point
  for (const s of shloks) {
    if (!shokWin.find((w) => w.verseId === s.verse.id)) {
      shokWin.push({ verseId: s.verse.id, from: lines[s.afterLine].start, to: lines[Math.min(s.afterLine + 1, N - 1)].end });
    }
  }
  shokWin.sort((a, b) => a.from - b.from);
  return { audio, lines, shloks: shokWin, durationSec, provider, chanted: chants.size > 0 };
}
