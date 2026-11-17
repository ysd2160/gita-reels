import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { Reel } from '../models.js';
import { verseById } from '../verses.js';
import { ensureVoiceText, generateLongScript, generateScript } from './gemini.js';
import { buildVoice } from './voice.js';
import { ART_STYLES, buildPrompt, generateImage, imageProvidersAvailable, mapLimit } from './images.js';
import { findLocal, findStock } from './visuals.js';
import { makeMusic } from './music.js';
import { renderReel } from './render.js';
import { nextSlot } from './scheduler.js';
import { DEFAULT_LAYOUT } from './shape.js';

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const OVERLAP = 0.24;
const gen = (id) => path.join(config.paths.storage, 'gen', String(id));
const audioDir = (id) => path.join(config.paths.storage, 'audio', String(id));
const VARIANTS = ['different angle, closer detail', 'wide establishing shot', 'macro detail, shallow depth of field', 'seen from above'];
const SACRED = [
  'silhouette of Lord Krishna playing flute with a peacock feather, glowing sunset sky',
  'a single oil lamp diya flame glowing in a dark ancient temple, drifting smoke',
  'golden sun rays through a misty forest, a small figure meditating',
  'lotus flower blooming on still water at dawn, soft mist',
  'ancient temple bells and carved stone pillars in warm light',
];

export function pickStyle(prev) {
  const art = pick(ART_STYLES.filter((a) => a.id !== prev?.artStyle));
  return {
    artStyle: art.id,
    templateId: art.template,
    captionStyle: pick(['pop', 'box', 'glow'].filter((t) => t !== prev?.captionStyle)),
    shlokStyle: pick(['card', 'minimal', 'band']),
    hookStyle: pick(['big', 'band']),
    transition: pick(['fade', 'zoom', 'slide', 'flash'].filter((t) => t !== prev?.transition)),
  };
}

async function set(reel, patch) {
  Object.assign(reel, patch);
  await reel.save();
}

/** Scenes follow the narration. Shorts: one per line. Long: lines grouped to ~5.5-8 s. Long scenes are split. */
export function planScenes(lines, durationSec, format = 'short') {
  const groups = [];
  if (format === 'long') {
    let g = null;
    lines.forEach((l, i) => {
      const start = i === 0 ? 0 : l.start;
      if (!g) g = { start, first: i, last: i };
      g.last = i;
      const end = i < lines.length - 1 ? lines[i + 1].start : durationSec;
      if (end - g.start >= 5.5) { groups.push({ ...g, end }); g = null; }
    });
    if (g) groups.push({ ...g, end: durationSec });
  } else {
    lines.forEach((l, i) => groups.push({ start: i === 0 ? 0 : l.start, end: i < lines.length - 1 ? lines[i + 1].start : durationSec, first: i, last: i }));
  }
  const maxLen = format === 'long' ? 8 : 4.6;
  const scenes = [];
  for (const g of groups) {
    const parts = Math.max(1, Math.ceil((g.end - g.start) / maxLen));
    const step = (g.end - g.start) / parts;
    for (let k = 0; k < parts; k++) scenes.push({ start: +(g.start + k * step).toFixed(3), end: +(g.start + (k + 1) * step).toFixed(3), line: g.first, part: k });
  }
  return scenes;
}

async function attachVisuals(scenes, script, style, id, usedIds, shloks) {
  const art = ART_STYLES.find((a) => a.id === style.artStyle) || ART_STYLES[0];
  const dir = gen(id);
  const motions = ['in', 'out', 'left', 'right', 'up'];
  const hasAI = imageProvidersAvailable().length > 0;

  await mapLimit(scenes, config.images.concurrency, async (sc, i) => {
    const line = script.lines[sc.line];
    const need = sc.end - sc.start + OVERLAP + 0.4;
    const mid = (sc.start + sc.end) / 2;
    const sacred = shloks.some((s) => mid >= s.from && mid <= s.to);
    let v = null;
    if (hasAI) {
      let scene = sacred ? pick(SACRED) : line.image;
      if (sc.part) scene += `, ${VARIANTS[(sc.part - 1) % VARIANTS.length]}`;
      const r = await generateImage(buildPrompt(art, scene), path.join(dir, `scene${i}`));
      if (r) v = { type: 'image', url: `${config.baseUrl}/media/gen/${id}/${path.basename(r.file)}` };
    }
    if (!v && sacred) v = await findLocal('image', usedIds); // your own Krishna art, if you added some
    if (!v) { const s = await findStock(line.visual, { minDur: need, usedIds }); if (s) v = { type: s.type, url: s.url, vid: s.id, duration: s.duration }; }
    if (!v) v = await findLocal('image', usedIds);
    if (!v) { const lv = await findLocal('video', usedIds); if (lv) v = { type: 'video', url: lv.url, duration: lv.duration }; }
    sc.type = v?.type || 'none';
    sc.url = v?.url || '';
    sc.vid = v?.vid || null;
    sc.trim = v?.type === 'video' ? +Math.max(0, Math.random() * Math.max(0, (v.duration || 0) - need - 0.2)).toFixed(1) : 0;
  });
  let last = '';
  scenes.forEach((sc) => { sc.motion = pick(motions.filter((m) => m !== last)); last = sc.motion; });
  return scenes;
}

/** STAGE 1: script -> voice -> visuals -> music. Saves the editable `project` and hands over to rendering. */
export async function prepareReel(id) {
  const reel = await Reel.findById(id);
  if (!reel) return false;
  const format = reel.format || 'short';
  const log = (m) => console.log(`[${format} ${String(id).slice(-6)}] ${m}`);
  try {
    await set(reel, { status: 'scripting', progress: 3, error: null, project: null });
    if (!reel.script) {
      const recent = (await Reel.find({ script: { $ne: null }, format }).sort({ createdAt: -1 }).limit(15).select('script'))
        .map((r) => r.script?.hookText || r.script?.title).filter(Boolean);
      log(format === 'long' ? 'long script (outline + parts)...' : 'script (2-pass)...');
      await set(reel, { script: format === 'long' ? await generateLongScript(reel.topic, recent) : await generateScript(reel.topic, recent), progress: 12 });
    }
    const script = { ...reel.script, format };
    // creators write Hinglish only; the narrator gets Hindi-in-Devanagari + English-in-Latin (much more natural for TTS)
    if (await ensureVoiceText(script)) await set(reel, { script, progress: 15 });

    await set(reel, { status: 'voice', progress: 18 });
    await fs.rm(audioDir(id), { recursive: true, force: true });
    log('voice...');
    const voice = await buildVoice(script, audioDir(id));
    log(`voice ok via ${voice.provider}${voice.chanted ? ' + chants' : ''}, ${voice.durationSec}s`);

    await set(reel, { status: 'visuals', progress: 38, durationSec: voice.durationSec });
    const style = reel.style?.artStyle ? reel.style : pickStyle((await Reel.findOne({ _id: { $ne: id }, style: { $ne: null } }).sort({ createdAt: -1 }))?.style);
    const usedIds = new Set((await Reel.find({ _id: { $ne: id } }).sort({ createdAt: -1 }).limit(12).select('visualIds')).flatMap((r) => r.visualIds || []));
    const scenes = await attachVisuals(planScenes(voice.lines, voice.durationSec, format), script, style, id, usedIds, voice.shloks);
    log(`visuals: ${scenes.filter((s) => s.type !== 'none').length}/${scenes.length} scenes (${imageProvidersAvailable().join(',') || 'no AI provider'})`);

    await set(reel, { progress: 62 });
    const seed = Math.floor(Math.random() * 100000);
    const music = await makeMusic(voice.durationSec, audioDir(id), [{ t: 0.1, kind: 'bowl' }, ...voice.shloks.map((s) => ({ t: s.from, kind: 'swell' }))], seed);

    const audioUrl = (f) => `${config.baseUrl}/media/audio/${id}/${path.basename(f)}`;
    const project = {
      format,
      durationSec: voice.durationSec,
      style,
      accent: '', textColor: '',
      layout: { ...DEFAULT_LAYOUT[format], ...(format === 'short' ? { capY: pick([0.54, 0.59, 0.62]) } : {}) },
      hook: script.hookText,
      lines: voice.lines,
      audio: voice.audio.map((a) => ({ url: audioUrl(a.file), start: a.start, duration: a.duration, rate: a.rate })),
      scenes,
      shloks: voice.shloks.map((w) => ({ sanskrit: verseById(w.verseId).sanskrit, reference: verseById(w.verseId).ref, from: w.from, to: w.to })),
      chapters: format === 'long' ? (script.sections || []).map((s) => ({ at: Math.max(0, +(voice.lines[s.startLine].start - 0.3).toFixed(2)), title: s.title })) : [],
      cta: script.cta,
      musicUrl: music ? (music.generated ? audioUrl(music.file) : music.url) : null,
      musicVolume: config.music.volume,
      musicOn: true,
      channel: config.channelName,
      seed,
    };
    await set(reel, { status: 'render_wait', progress: 66, style, project, chapters: project.chapters, visualIds: scenes.map((s) => s.vid).filter(Boolean) });
    return true;
  } catch (e) {
    console.error(`[reel ${id}] PREP FAILED:`, e);
    await set(reel, { status: 'failed', error: String(e.message || e).slice(0, 500) });
    return false;
  }
}

/** Remove everything generated for this reel (audio, AI images, uploads, stock clips, music). Final mp4 stays. */
export async function cleanupAssets(reel) {
  const id = String(reel._id);
  await fs.rm(audioDir(id), { recursive: true, force: true });
  await fs.rm(gen(id), { recursive: true, force: true });
  for (const vid of reel.visualIds || []) for (const ext of ['mp4', 'jpg']) await fs.rm(path.join(config.paths.storage, 'visuals', `${vid}.${ext}`), { force: true });
  await Reel.updateOne({ _id: reel._id }, { project: null });
}

/** STAGE 2: Remotion render (CPU heavy, runs one at a time). Also used after edits in the editor. */
export async function renderStage(id) {
  const reel = await Reel.findById(id);
  if (!reel?.project) return false;
  const log = (m) => console.log(`[${reel.format} ${String(id).slice(-6)}] ${m}`);
  try {
    await set(reel, { status: 'rendering', progress: 68, error: null });
    await fs.mkdir(path.join(config.paths.storage, 'videos'), { recursive: true });
    const videoFile = `${id}.mp4`;
    let lastSaved = 0;
    log('rendering...');
    await renderReel(reel.project, path.join(config.paths.storage, 'videos', videoFile), (p) => {
      const pct = 68 + Math.round(p * 30);
      if (pct - lastSaved >= 3) { lastSaved = pct; Reel.updateOne({ _id: id }, { progress: pct }).catch(() => {}); }
    });
    const scheduledFor = reel.scheduledFor || (await nextSlot());
    await set(reel, { status: 'ready', progress: 100, videoFile, scheduledFor, durationSec: reel.project.durationSec, genAt: new Date(), purgedAt: null });
    if (config.cleanup === 'render') { await cleanupAssets(reel); log('temp files deleted'); }
    log('ready');
    return true;
  } catch (e) {
    console.error(`[reel ${id}] RENDER FAILED:`, e);
    await set(reel, { status: 'failed', error: String(e.message || e).slice(0, 500) });
    return false;
  }
}
