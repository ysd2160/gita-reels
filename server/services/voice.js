import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { config } from '../config.js';
import { fade, findLineEdges, lineVoiceDetail, lineWeight, normalize, sliceSec, toWav, trimSilence, voicedBounds, parseWav } from './audio.js';
import { speakBatch, edgeLine, ttsSignature, edgeAllowed, lastTtsError } from './tts.js';
import { CHANT_HOLD, GAP_LINE, GAP_SPEECH, LEAD_IN, TAIL, CAP_LEAD, wordTimings, wordTimingsRuns } from './timeline.js';
import { getShloks } from './shape.js';
import { stopIf } from './control.js';

const endPunct = (s) => (/[।?!.…]$/.test(s.trim()) ? s.trim() : `${s.trim()}।`);
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
const exists = (f) => fs.access(f).then(() => true, () => false);
const REQ_LIMIT = 1300; // chars per TTS request: a long script is voiced in small parts (more reliable than one giant request)
const CACHE_DAYS = 4;

/** Cut a long block of lines into pieces of ~REQ_LIMIT chars, preferably at chapter starts, never inside a line. */
function splitBlock(b, script) {
  const len = (i) => script.lines[i].speak.length + 2;
  const starts = new Set((script.sections || []).map((s) => s.startLine));
  const pieces = [];
  let cur = { first: b.first, last: b.first - 1, chars: 0 };
  for (let i = b.first; i <= b.last; i++) {
    const over = cur.chars + len(i) > REQ_LIMIT;
    const chapter = starts.has(i) && cur.chars > REQ_LIMIT * 0.45;
    if (cur.last >= cur.first && (over || chapter)) { pieces.push(cur); cur = { first: i, last: i - 1, chars: 0 }; }
    cur.last = i; cur.chars += len(i);
  }
  pieces.push(cur);
  if (pieces.length > 1 && pieces.at(-1).chars < 250 && pieces.at(-2).chars + pieces.at(-1).chars <= REQ_LIMIT * 1.3) { // a tiny tail joins the part before it
    const tail = pieces.pop();
    pieces.at(-1).last = tail.last; pieces.at(-1).chars += tail.chars;
  }
  return pieces.map((p) => ({ first: p.first, last: p.last }));
}

/** every finished part is saved: if the video fails / is paused later, finished parts are NOT generated (or paid) again */
async function cachedSpeak(text) {
  const base = path.join(config.paths.storage, 'cache', 'tts');
  await fs.mkdir(base, { recursive: true });
  const key = sha(`${ttsSignature()}|${text}`);
  const wav = path.join(base, `${key}.wav`), meta = path.join(base, `${key}.json`);
  if ((await exists(wav)) && (await exists(meta))) {
    try {
      const m = JSON.parse(await fs.readFile(meta, 'utf8'));
      const { pcm, rate } = parseWav(await fs.readFile(wav));
      return { pcm, rate, speed: m.speed, provider: m.provider };
    } catch { /* regenerate */ }
  }
  const r = await speakBatch(text);
  if (r) {
    await fs.writeFile(wav, toWav(r.pcm, r.rate));
    await fs.writeFile(meta, JSON.stringify({ speed: r.speed, provider: r.provider }));
  }
  return r;
}
async function sweepCache() {
  const base = path.join(config.paths.storage, 'cache', 'tts');
  try {
    for (const f of await fs.readdir(base)) {
      const p = path.join(base, f);
      if (Date.now() - (await fs.stat(p)).mtimeMs > CACHE_DAYS * 86400e3) await fs.rm(p, { force: true });
    }
  } catch { /* no cache yet */ }
}

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
  sweepCache().catch(() => {});
  const N = script.lines.length;
  const shloks = getShloks(script);
  const afterMap = new Map(shloks.map((s) => [s.afterLine, s.verse]));

  // blocks end at each chant point; requests pack consecutive blocks (TTS text limit)
  const blocks = [];
  let first = 0;
  for (const s of shloks) { blocks.push({ first, last: s.afterLine }); first = s.afterLine + 1; }
  if (first <= N - 1) blocks.push({ first, last: N - 1 });
  const parts = blocks.flatMap((b) => splitBlock(b, script)); // a long script (no chants) becomes several small parts
  blocks.length = 0; blocks.push(...parts);
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
    if (reqs.length > 1) console.log(`[voice] part ${ri + 1}/${reqs.length} (${req.chars} chars)`);
    const r = await cachedSpeak(reqLines.map((l) => endPunct(l.speak)).join(' '));
    if (r) {
      provider = r.provider;
      const pcm = normalize(r.pcm);
      const edges = findLineEdges(pcm, r.rate, reqLines.map((l) => lineWeight(l.speak)));
      const detail = lineVoiceDetail(pcm, r.rate, edges); // real voice onset / voiced runs per line (caption sync)
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
        const cdur = clip.length / r.rate;
        const marks = [];
        for (let i = b.first; i <= b.last; i++) {
          const d = detail[i - f0];
          marks.push({ on: Math.min(cdur, Math.max(0, d.on - origin)), runs: d.runs.map(([x, y]) => [Math.min(cdur, Math.max(0, x - origin)), Math.min(cdur, Math.max(0, y - origin))]) });
        }
        chunks.push({ file, dur: cdur, rate: r.speed, edges: starts, marks, first: b.first, last: b.last });
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
      const m = c.marks?.[k];
      if (m) { // caption starts with the voice itself; ends when the next line's voice begins
        const nextOn = c.marks[k + 1] ? c.marks[k + 1].on : c.edges[k + 1];
        lines[c.first + k] = {
          start: +(t + Math.max(0, m.on - CAP_LEAD) / c.rate).toFixed(3),
          end: +(t + Math.max(m.on, nextOn - CAP_LEAD) / c.rate).toFixed(3),
          runs: m.runs.map(([x, y]) => [t + x / c.rate, t + y / c.rate]),
        };
      } else lines[c.first + k] = { start: +(t + c.edges[k] / c.rate).toFixed(3), end: +(t + c.edges[k + 1] / c.rate).toFixed(3) };
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
    lines[i].words = lines[i].runs ? wordTimingsRuns(script.lines[i].show, lines[i].start, lines[i].end, lines[i].runs) : wordTimings(script.lines[i].show, lines[i].start, lines[i].end);
    delete lines[i].runs;
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
