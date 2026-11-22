import { storyboard } from './storyboard.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { Reel } from '../models.js';
import { MAX_SEC } from '../formats.js';
import { getSettings } from './settings.js';
import { verseById } from '../verses.js';
import { ensureVoiceText, generateLongScript } from './gemini.js';
import { writeShortScript } from './scriptContext.js';
import { buildVoice } from './voice.js';
import { ART_STYLES, buildPrompt, generateImage, imageProvidersAvailable, mapLimit } from './images.js';
import { findLocal, findStock } from './visuals.js';
import { makeMusic } from './music.js';
import { renderReel } from './render.js';
import { nextSlot } from './scheduler.js';
import { DEFAULT_LAYOUT, VARIANTS as FORMAT_VARIANTS, VARIANT_LAYOUT } from './shape.js';
import { PausedError, isTimeout, stopIf } from './control.js';

const exists = (f) => fs.access(f).then(() => true, () => false);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const OVERLAP = 0.24;
const MIN_SCENE = 2.2; // shorts: no picture stays shorter than ~2 s ...
const MAX_SCENE = 4.0; // ... or longer than 4 s
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

export function pickStyle(prev, format = 'short') {
  const art = pick(ART_STYLES.filter((a) => a.id !== prev?.artStyle));
  return {
    variant: format === 'short' ? pick(FORMAT_VARIANTS.filter((v) => v !== prev?.variant)) : 'classic', // video format: a different layout each time
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

/** Scenes follow the narration. Shorts: one picture per line (short lines are joined), 2-4 s each. Long: lines grouped to ~5.5-8 s. Long scenes are split. */
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
    // shorts: a new picture every 2-4 seconds, following the script. A very short line joins the next one, a long line is split.
    let g = null;
    lines.forEach((l, i) => {
      const start = i === 0 ? 0 : l.start;
      if (!g) g = { start, first: i, last: i };
      g.last = i;
      const end = i < lines.length - 1 ? lines[i + 1].start : durationSec;
      if (end - g.start >= MIN_SCENE) { groups.push({ ...g, end }); g = null; }
    });
    if (g) { if (groups.length) groups[groups.length - 1].end = durationSec; else groups.push({ ...g, end: durationSec }); }
  }
  const maxLen = format === 'long' ? 8 : MAX_SCENE;
  const scenes = [];
  for (const g of groups) {
    const parts = Math.max(1, Math.ceil((g.end - g.start) / maxLen));
    const step = (g.end - g.start) / parts;
    for (let k = 0; k < parts; k++) scenes.push({ start: +(g.start + k * step).toFixed(3), end: +(g.start + (k + 1) * step).toFixed(3), line: g.first, last: g.last, part: k });
  }
  return scenes;
}

async function attachVisuals(scenes, script, style, id, usedIds, shloks, { signal, persist = () => {} } = {}) {
  const art = ART_STYLES.find((a) => a.id === style.artStyle) || ART_STYLES[0];
  const dir = gen(id);
  const motions = ['in', 'out', 'left', 'right', 'up'];
  const hasAI = imageProvidersAvailable().length > 0;

  await mapLimit(scenes, config.images.concurrency, async (sc, i) => {
    if (signal?.aborted) return; // paused: remaining scenes are done after Resume
    if (sc.type && sc.type !== 'none') return; // already finished before a pause / restart
    const line = script.lines[sc.line];
    const need = sc.end - sc.start + OVERLAP + 0.4;
    const mid = (sc.start + sc.end) / 2;
    const sacred = shloks.some((s) => mid >= s.from && mid <= s.to);
    let v = null;
    if (hasAI) {
      let scene = sacred ? pick(SACRED) : (sc.prompt || line.image);
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
    persist(); // every finished scene is saved, so a pause / crash never loses it
  });
  stopIf(signal);
  let last = '';
  scenes.forEach((sc) => { sc.motion = pick(motions.filter((m) => m !== last)); last = sc.motion; });
  persist();
  return scenes;
}

// a saved scene is only reusable if its file still exists
async function sceneFileOk(sc) {
  const m = /\/media\/(.+)$/.exec(sc.url || '');
  return m ? exists(path.join(config.paths.storage, decodeURIComponent(m[1]))) : true;
}

/**
 * STAGE 1: script -> voice -> visuals -> music. Saves the editable `project` and hands over to rendering.
 * Every finished step is saved in reel.work, so Pause / a crash / a restart continues from the same step, not from zero.
 */
export async function prepareReel(id, { signal } = {}) {
  const reel = await Reel.findById(id);
  if (!reel) return false;
  const format = reel.format || 'short';
  const log = (m) => console.log(`[${format} ${String(id).slice(-6)}] ${m}`);
  const work = reel.work || {};
  try {
    stopIf(signal);
    await set(reel, { status: reel.script ? 'voice' : 'scripting', progress: Math.max(reel.progress || 0, 3), error: null, project: null, pausedStage: null });
    if (!reel.script) {
      const recent = (await Reel.find({ script: { $ne: null }, format }).sort({ createdAt: -1 }).limit(15).select('script'))
        .map((r) => r.script?.hookText || r.script?.title).filter(Boolean);
      log(format === 'long' ? 'long script (outline + parts)...' : 'script (2-pass)...');
      await set(reel, { script: format === 'long' ? await generateLongScript(reel.topic, recent, '', (await getSettings()).longMinutes) : await writeShortScript({ topic: reel.topic, formatId: reel.formatId, targetSec: reel.targetSec, notes: reel.notes, pillar: reel.pillar }), progress: 12 });
    }
    stopIf(signal);
    const script = { ...reel.script, format };
    // tag every video (pillar + hook style), so we can later see which kind of video works
    if (format === 'short' && ((script.pillar && script.pillar !== reel.pillar) || (script.hookStyle && script.hookStyle !== reel.hookStyle))) await set(reel, { pillar: script.pillar || reel.pillar || '', hookStyle: script.hookStyle || reel.hookStyle || '' });
    // creators write Hinglish only; the narrator gets Hindi-in-Devanagari + English-in-Latin (much more natural for TTS)
    if (await ensureVoiceText(script)) await set(reel, { script, progress: 15 });

    // ---- voice (saved: a resumed video does not pay for the voice again)
    let voice = work.voice;
    if (voice && !(await Promise.all(voice.audio.map((a) => exists(a.file)))).every(Boolean)) voice = null;
    if (voice) log('voice: pehle ka kaam use ho raha hai (resume)');
    else {
      stopIf(signal);
      await set(reel, { status: 'voice', progress: Math.max(reel.progress || 0, 18) });
      await fs.rm(audioDir(id), { recursive: true, force: true });
      log('voice...');
      voice = await buildVoice(script, audioDir(id), { signal });
      await Reel.updateOne({ _id: id }, { $set: { 'work.voice': voice } });
      log(`voice ok via ${voice.provider}${voice.chanted ? ' + chants' : ''}, ${voice.durationSec}s (${script.formatId || 'classic'}${script.verseId ? '' : ', no shlok'})`);
    }
    if (format === 'short' && (voice.durationSec > MAX_SEC + 3 || voice.durationSec < 25)) log(`WARNING: ${voice.durationSec}s is outside the 30-${MAX_SEC} s range. Edit the script (shorter/longer) and press New look.`);

    // ---- visuals (every finished scene is saved)
    stopIf(signal);
    await set(reel, { status: 'visuals', progress: Math.max(reel.progress || 0, 38), durationSec: voice.durationSec });
    let style = work.style;
    if (!style) {
      style = reel.style?.artStyle ? reel.style : pickStyle((await Reel.findOne({ _id: { $ne: id }, style: { $ne: null } }).sort({ createdAt: -1 }))?.style, format);
      await Reel.updateOne({ _id: id }, { $set: { 'work.style': style } });
    }
    const usedIds = new Set((await Reel.find({ _id: { $ne: id } }).sort({ createdAt: -1 }).limit(12).select('visualIds')).flatMap((r) => r.visualIds || []));
    const scenes = Array.isArray(work.scenes) && work.scenes.length ? work.scenes : planScenes(voice.lines, voice.durationSec, format);
    if (!work.scenes?.length) { await storyboard(scenes, script, { log }); await Reel.updateOne({ _id: id }, { $set: { 'work.scenes': scenes } }); } // prompts saved: a resume does not ask again
    for (const sc of scenes) if (sc.type && sc.type !== 'none' && !(await sceneFileOk(sc))) { sc.type = undefined; sc.url = ''; }
    const resumedScenes = scenes.filter((s) => s.type && s.type !== 'none').length;
    if (resumedScenes) log(`visuals: ${resumedScenes}/${scenes.length} scenes pehle se ready (resume)`);
    let chain = Promise.resolve();
    const persist = () => {
      chain = chain.then(() => Reel.updateOne({ _id: id }, { $set: { 'work.scenes': scenes, progress: 38 + Math.round((24 * scenes.filter((s) => s.type).length) / Math.max(1, scenes.length)) } })).catch(() => {});
    };
    await attachVisuals(scenes, script, style, id, usedIds, voice.shloks, { signal, persist });
    await chain;
    log(`visuals: ${scenes.filter((s) => s.type !== 'none').length}/${scenes.length} scenes (${imageProvidersAvailable().join(',') || 'no AI provider'})`);

    stopIf(signal);
    await set(reel, { progress: 62 });
    const seed = Math.floor(Math.random() * 100000);
    const music = await makeMusic(voice.durationSec, audioDir(id), [{ t: 0.1, kind: 'bowl' }, ...voice.shloks.map((s) => ({ t: s.from, kind: 'swell' }))], seed);

    const audioUrl = (f) => `${config.baseUrl}/media/audio/${id}/${path.basename(f)}`;
    const project = {
      format,
      durationSec: voice.durationSec,
      style,
      accent: '', textColor: '',
      layout: { ...DEFAULT_LAYOUT[format], ...(format === 'short' ? { capY: pick([0.54, 0.59, 0.62]) } : {}), ...(format === 'short' ? VARIANT_LAYOUT[style.variant] || {} : {}) },
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
    if (e instanceof PausedError) {
      if (e.timeout) { await set(reel, { status: 'failed', error: 'Timeout: video bahut der se atki thi' }); return false; }
      await set(reel, { status: 'paused', pausedStage: reel.status, error: null });
      log(`paused at ${reel.pausedStage}`);
      return false;
    }
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

/** STAGE 2: Remotion render (CPU heavy). Also used after edits in the editor. A paused render restarts from frame 0. */
export async function renderStage(id, { signal } = {}) {
  const reel = await Reel.findById(id);
  if (!reel?.project) return false;
  const log = (m) => console.log(`[${reel.format} ${String(id).slice(-6)}] ${m}`);
  try {
    stopIf(signal);
    await set(reel, { status: 'rendering', progress: 68, error: null, pausedStage: null });
    await fs.mkdir(path.join(config.paths.storage, 'videos'), { recursive: true });
    const videoFile = `${id}.mp4`;
    let lastSaved = 0;
    log('rendering...');
    await renderReel(reel.project, path.join(config.paths.storage, 'videos', videoFile), (p) => {
      const pct = 68 + Math.round(p * 30);
      if (pct - lastSaved >= 3) { lastSaved = pct; Reel.updateOne({ _id: id }, { progress: pct }).catch(() => {}); }
    }, signal);
    const scheduledFor = reel.scheduledFor || (await nextSlot());
    await set(reel, { status: 'ready', progress: 100, videoFile, scheduledFor, durationSec: reel.project.durationSec, genAt: new Date(), purgedAt: null, work: null });
    if (config.cleanup === 'render') { await cleanupAssets(reel); log('temp files deleted'); }
    log('ready');
    return true;
  } catch (e) {
    if (signal?.aborted || e instanceof PausedError) {
      if (isTimeout(signal)) { await set(reel, { status: 'failed', error: 'Timeout: render bahut der se atka tha' }); return false; }
      await set(reel, { status: 'paused', pausedStage: 'render_wait', progress: 66, error: null });
      log('paused (render dobara shuru se chalega, baaki sab saved hai)');
      return false;
    }
    console.error(`[reel ${id}] RENDER FAILED:`, e);
    await set(reel, { status: 'failed', error: String(e.message || e).slice(0, 500) });
    return false;
  }
}
