import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { Plan, Reel, Topic } from './models.js';
import { enqueue, enqueueRender, pauseReel, queueLength, queueState, resumeReel } from './services/queue.js';
import { keyStats } from './services/keypool.js';
import { bulkCreate, createReel, refillTopics } from './services/batch.js';
import { chatAssistant, generateLongScript, romanToSpeak, scriptFromText, toApiShape, validateScript } from './services/gemini.js';
import { writeShortScript } from './services/scriptContext.js';
import { FORMATS } from './formats.js';
import { VERSES } from './verses.js';
import { batchProviders, setVoiceOverrides, speakBatch, lastTtsError } from './services/tts.js';
import { toWav } from './services/audio.js';
import { ART_STYLES, buildPrompt, generateImage, imageProvidersAvailable } from './services/images.js';
import { getSettings, saveSettings } from './services/settings.js';
import { clearedDays, deleteDayPlan, deleteItem, ensurePlan, importOwnScripts, importWeekPlan, isScriptBusy, newTopicFor, planWeekWithAI, prewriteScripts, resetCleared, restoreDayPlan, retimeUpcoming, runDay, runPlanItem, todayIST } from './services/planner.js';
import { fixTime, normalizeSlots } from './services/retime.js';
import { approveReel } from './services/reelActions.js';
import { integrationStatus, platformStatus, publishReel } from './services/publisher.js';
import { youtubeAuthUrl, youtubeConfigured, youtubeExchange } from './uploaders/youtube.js';

const rel = (project) => JSON.parse(JSON.stringify(project).split(config.baseUrl).join('')); // browser uses same-origin URLs
const abs = (project) => JSON.parse(JSON.stringify(project).replace(/"(\/(?:media|assets)\/)/g, `"${config.baseUrl}$1`));
const ytRedirect = () => `${config.publicUrl || `http://localhost:${config.port}`}/oauth/youtube/callback`;
const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && !req.headers['x-forwarded-for']; // the renderer on this machine / SSH tunnel; nginx always adds x-forwarded-for

export function createApp() {
  const app = express();
  app.use(cors());
  // dashboard password (set DASHBOARD_USER + DASHBOARD_PASS). The local renderer (no x-forwarded-for) is let through.
  if (config.auth.user && config.auth.pass) {
    const want = 'Basic ' + Buffer.from(`${config.auth.user}:${config.auth.pass}`).toString('base64');
    app.use((req, res, next) => {
      if (isLocal(req) || req.headers.authorization === want) return next();
      res.set('WWW-Authenticate', 'Basic realm="Reels Studio"').status(401).send('Login required');
    });
  }
  app.get('/healthz', (_req, res) => res.send('ok'));
  app.use(express.json({ limit: '30mb' })); // plan PDFs arrive as base64
  app.use('/media', express.static(config.paths.storage));
  app.use('/assets', express.static(config.paths.assets));
  app.use(express.static(config.paths.public));
  const wrap = (fn) => (req, res) => fn(req, res).catch((e) => { console.error(e); res.status(500).json({ error: e.message }); });

  // ------------------------------------------------ status / settings / integrations
  app.get('/api/status', wrap(async (_req, res) => {
    const st = await getSettings();
    res.json({
      voice: batchProviders(), voiceName: { gemini: config.tts.gemini.voice, sarvam: config.tts.sarvam.speaker, elevenlabs: config.tts.elevenlabs.voiceId, google: config.tts.google.voice }, chant: config.tts.chant, images: imageProvidersAvailable(),
      stock: [config.pexels.key && 'pexels', config.pixabay.key && 'pixabay'].filter(Boolean),
      music: config.music.mode, cleanup: config.cleanup, automation: st.automation, autoPublish: st.autoPublish, integrations: await integrationStatus(), keys: keyStats(),
    });
  }));
  app.get('/api/settings', wrap(async (_req, res) => res.json(await getSettings())));
  app.put('/api/settings', wrap(async (req, res) => {
    const body = { ...(req.body || {}) };
    // publish times must be real HH:MM times (a typo like "7pm" would break the schedule)
    if (body.shortSlots !== undefined) {
      body.shortSlots = normalizeSlots(body.shortSlots);
      if (!body.shortSlots) return res.status(400).json({ error: 'Reels ka publish time galat hai. Aise likho: 07:30, 13:00, 20:30' });
    }
    if (body.longSlot !== undefined) {
      body.longSlot = fixTime(body.longSlot);
      if (!body.longSlot) return res.status(400).json({ error: 'Long video ka time galat hai. Aise likho: 18:00' });
    }
    const before = await getSettings();
    const s = await saveSettings(body);
    setVoiceOverrides(s);
    // new publish times also move the plan that already exists and the videos that are made but not uploaded yet
    const changed = JSON.stringify(before.shortSlots) !== JSON.stringify(s.shortSlots) || before.longSlot !== s.longSlot;
    res.json({ ...s, retimed: changed ? await retimeUpcoming() : null });
  }));
  app.get('/api/verses', (_req, res) => res.json(VERSES.map(({ id, ref, themes }) => ({ id, ref, themes }))));
  app.get('/api/formats', (_req, res) => res.json(FORMATS.map(({ id, label, shlok, desc }) => ({ id, label, shlok, desc }))));
  app.get('/api/art-styles', (_req, res) => res.json(ART_STYLES.map(({ id, template }) => ({ id, template }))));

  app.get('/oauth/youtube', (req, res) => {
    if (!youtubeConfigured()) return res.status(400).send('.env mein YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET daalo');
    res.redirect(youtubeAuthUrl(ytRedirect()));
  });
  app.get('/oauth/youtube/callback', wrap(async (req, res) => {
    await youtubeExchange(String(req.query.code || ''), ytRedirect());
    res.send('<h3>YouTube connected. You can close this tab.</h3><script>setTimeout(()=>location="/",1200)</script>');
  }));

  // ------------------------------------------------ reels
  app.get('/api/reels', wrap(async (_req, res) => {
    const reels = await Reel.find().select('-project').sort({ createdAt: -1 }).limit(120).lean();
    const editable = new Set((await Reel.find({ project: { $ne: null } }).select('_id').lean()).map((r) => String(r._id)));
    const [st, integ] = await Promise.all([getSettings(), integrationStatus()]);
    res.json({ queue: queueLength(), ...queueState(), reels: reels.map((r) => ({ ...r, editable: editable.has(String(r._id)), platforms: platformStatus(r, st, integ) })) });
  }));
  app.post('/api/reels', wrap(async (req, res) => {
    const topic = String(req.body.topic || '').trim();
    if (!topic) return res.status(400).json({ error: 'topic required' });
    res.json(await createReel(topic, { format: req.body.format === 'long' ? 'long' : 'short' }));
  }));
  // "make video" from a script that was written in the assistant chat
  app.post('/api/reels/from-script', wrap(async (req, res) => {
    const script = validateScript(toApiShape(req.body.script));
    res.json(await createReel(String(req.body.topic || script.hookText).slice(0, 120), { script }));
  }));
  // ---- one video at a time: stop a video (keeps what it made) and continue it later from the same step
  app.get('/api/queue', wrap(async (_req, res) => res.json(queueState())));
  app.post('/api/reels/:id/pause', wrap(async (req, res) => {
    const r = await pauseReel(req.params.id);
    res.json(r ? { ok: true, state: r } : { error: 'ye video abhi chal nahi rahi / line mein nahi hai' });
  }));
  app.post('/api/reels/:id/resume', wrap(async (req, res) => {
    const r = await resumeReel(req.params.id, { now: req.query.now === '1' });
    res.json(r ? { ok: true, ...r } : { error: 'resume nahi ho sakti (video paused nahi hai)' });
  }));
  app.post('/api/reels/:id/approve', wrap(async (req, res) => res.json(await approveReel(req.params.id))));
  app.post('/api/reels/:id/reject', wrap(async (req, res) => res.json(await Reel.findByIdAndUpdate(req.params.id, { status: 'rejected' }, { new: true }))));
  // Upload overview: every finished video, where it goes (YouTube / Instagram) and what happened
  app.get('/api/uploads', wrap(async (_req, res) => {
    const [st, integ] = await Promise.all([getSettings(), integrationStatus()]);
    const reels = await Reel.find({ status: { $in: ['ready', 'approved', 'published'] } }).select('-project').sort({ scheduledFor: -1, createdAt: -1 }).limit(60).lean();
    const items = reels.map((r) => ({
      _id: r._id, topic: r.topic, hook: r.script?.hookText || r.script?.title || '', format: r.format, status: r.status,
      scheduledFor: r.scheduledFor, platforms: platformStatus(r, st, integ), videoFile: r.videoFile, purged: !!r.purgedAt,
    }));
    const all = items.flatMap((i) => Object.values(i.platforms)).filter((p) => p.state !== 'na');
    const count = (s) => all.filter((p) => p.state === s).length;
    res.json({ summary: { done: count('done'), pending: count('pending') + count('uploading'), waiting: count('waiting'), error: count('error'), off: count('off') }, items });
  }));
  app.post('/api/reels/:id/publish', wrap(async (req, res) => res.json(await publishReel(req.params.id, { now: true }))));
  app.post('/api/reels/:id/regenerate', wrap(async (req, res) => {
    const reel = await Reel.findById(req.params.id);
    if (!reel) return res.status(404).json({ error: 'not found' });
    const patch = { status: 'queued', progress: 0, error: null, videoFile: null, style: null, visualIds: [], project: null, work: null, pausedStage: null };
    if (req.query.mode !== 'render') patch.script = null;
    await Reel.updateOne({ _id: reel._id }, patch);
    enqueue(reel._id);
    res.json({ ok: true });
  }));
  app.put('/api/reels/:id/script', wrap(async (req, res) => {
    const reel = await Reel.findById(req.params.id);
    if (!reel) return res.status(404).json({ error: 'not found' });
    const draft = req.body.script;
    const script = reel.format === 'long' ? { ...reel.script, ...draft } : validateScript(toApiShape(draft));
    await Reel.updateOne({ _id: reel._id }, { script, status: 'queued', progress: 0, error: null, videoFile: null, visualIds: [], project: null, work: null, pausedStage: null });
    enqueue(reel._id);
    res.json({ ok: true, script });
  }));
  app.delete('/api/reels/:id', wrap(async (req, res) => {
    const reel = await Reel.findByIdAndDelete(req.params.id);
    if (reel) {
      await fs.rm(path.join(config.paths.storage, 'videos', `${reel._id}.mp4`), { force: true });
      await fs.rm(path.join(config.paths.storage, 'audio', String(reel._id)), { recursive: true, force: true });
      await fs.rm(path.join(config.paths.storage, 'gen', String(reel._id)), { recursive: true, force: true });
      await Plan.updateMany({ reelId: reel._id }, { status: 'planned', reelId: null });
    }
    res.json({ ok: true });
  }));

  // ------------------------------------------------ video editor (project = every editable thing in the video)
  app.get('/api/reels/:id/project', wrap(async (req, res) => {
    const reel = await Reel.findById(req.params.id).select('project topic status format');
    if (!reel) return res.status(404).json({ error: 'not found' });
    if (!reel.project) return res.status(410).json({ error: 'Is video ki temp files delete ho chuki hain (approve/old draft). "New look" se dobara banao.' });
    res.json({ id: reel._id, topic: reel.topic, status: reel.status, project: rel(reel.project) });
  }));
  app.put('/api/reels/:id/project', wrap(async (req, res) => {
    const p = req.body.project;
    if (!p || !Array.isArray(p.scenes) || !Array.isArray(p.lines)) return res.status(400).json({ error: 'invalid project' });
    const project = abs(p);
    await Reel.updateOne({ _id: req.params.id }, { project, durationSec: project.durationSec, chapters: project.chapters });
    res.json({ ok: true });
  }));
  app.post('/api/reels/:id/render', wrap(async (req, res) => {
    const reel = await Reel.findOneAndUpdate({ _id: req.params.id, project: { $ne: null } }, { status: 'render_wait', progress: 66, error: null }, { new: true });
    if (!reel) return res.status(410).json({ error: 'project nahi mila' });
    enqueueRender(reel._id);
    res.json({ ok: true });
  }));
  app.post('/api/reels/:id/upload', express.raw({ type: '*/*', limit: '300mb' }), wrap(async (req, res) => {
    const ext = String(req.query.ext || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!['jpg', 'jpeg', 'png', 'webp', 'mp4', 'mov', 'webm', 'mp3', 'wav', 'm4a'].includes(ext)) return res.status(400).json({ error: 'file type not allowed' });
    const dir = path.join(config.paths.storage, 'gen', String(req.params.id));
    await fs.mkdir(dir, { recursive: true });
    const name = `upload_${Date.now()}.${ext}`;
    await fs.writeFile(path.join(dir, name), req.body);
    res.json({ url: `/media/gen/${req.params.id}/${name}`, kind: ['mp4', 'mov', 'webm'].includes(ext) ? 'video' : ['mp3', 'wav', 'm4a'].includes(ext) ? 'audio' : 'image' });
  }));
  app.post('/api/reels/:id/scene-image', wrap(async (req, res) => {
    const art = ART_STYLES.find((a) => a.id === req.body.artStyle) || ART_STYLES[0];
    const r = await generateImage(buildPrompt(art, String(req.body.prompt || 'misty mountains at dawn')), path.join(config.paths.storage, 'gen', String(req.params.id), `ai_${Date.now()}`));
    if (!r) return res.status(502).json({ error: 'Image generate nahi hui (provider keys check karo)' });
    res.json({ url: `/media/gen/${req.params.id}/${path.basename(r.file)}` });
  }));

  // ------------------------------------------------ voice test (Settings -> Test voice)
  app.post('/api/voice/preview', wrap(async (req, res) => {
    const [row] = await romanToSpeak([String(req.body.text || 'Raat ke do baje, phone haath mein, aur dimaag mein wahi purani *overthinking*. Tum thak chuke ho, kamzor nahi.')]);
    const r = await speakBatch(row);
    if (!r) return res.status(502).json({ error: lastTtsError() || 'koi voice provider configured nahi' });
    res.set('Content-Type', 'audio/wav').send(toWav(r.pcm, r.rate));
  }));

  // ------------------------------------------------ assistant
  app.post('/api/chat', wrap(async (req, res) => {
    let reel = req.body.reelId ? await Reel.findById(req.body.reelId) : null;
    if (!reel && req.body.planId) { // chatting about a planned (not yet produced) video
      const it = await Plan.findById(req.body.planId);
      if (it) reel = { topic: it.topic, format: it.kind, script: it.script ? { ...it.script, format: it.kind } : null };
    }
    res.json(await chatAssistant(req.body.messages || [], reel));
  }));

  // ------------------------------------------------ topics / bulk
  app.get('/api/topics', wrap(async (_req, res) => res.json(await Topic.find().sort({ createdAt: -1 }).limit(100))));
  app.post('/api/topics/generate', wrap(async (req, res) => res.json({ added: await refillTopics(Number(req.body?.count) || 20) })));
  app.post('/api/batch', wrap(async (req, res) => {
    res.json({ queued: (await bulkCreate({ topics: req.body.topics || [], ideas: Number(req.body.ideas) || 0 })).length });
  }));

  // ------------------------------------------------ content plan (what will be made next)
  app.get('/api/plan', wrap(async (_req, res) => {
    await ensurePlan();
    const items = await Plan.find({ date: { $gte: todayIST() } }).sort({ date: 1, slot: 1 });
    const reels = await Reel.find({ _id: { $in: items.map((i) => i.reelId).filter(Boolean) } })
      .select('status format progress pausedStage videoFile publish scheduledFor purgedAt error');
    const [st, integ] = await Promise.all([getSettings(), integrationStatus()]);
    const byId = Object.fromEntries(reels.map((r) => [String(r._id), { ...r.toObject(), platforms: platformStatus(r, st, integ) }]));
    res.json({ today: todayIST(), cleared: await clearedDays(), queue: queueState(), items: items.map((i) => ({ ...i.toObject(), scriptBusy: isScriptBusy(i._id), reel: byId[String(i.reelId)] || null })) });
  }));
  app.put('/api/plan/:id', wrap(async (req, res) => {
    const patch = {};
    for (const k of ['topic', 'publishTime', 'status', 'formatId', 'targetSec', 'notes']) if (req.body[k] !== undefined) patch[k] = req.body[k];
    if (req.body.script !== undefined) { // reviewed / edited script saved from the Script Studio
      const it = await Plan.findById(req.params.id);
      patch.script = req.body.script === null ? null : it.kind === 'long' ? req.body.script : validateScript(toApiShape(req.body.script));
    }
    if (patch.status && !['planned', 'skipped'].includes(patch.status)) delete patch.status;
    res.json(await Plan.findByIdAndUpdate(req.params.id, patch, { new: true }));
  }));
  // generate a script for a planned item (reviewed in the Script Studio before the video is made)
  app.post('/api/plan/:id/script', wrap(async (req, res) => {
    const item = await Plan.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'not found' });
    const formatId = req.body?.formatId || item.formatId; // "Regenerate" can switch the format
    const targetSec = req.body?.targetSec || item.targetSec;
    let script;
    if (item.kind === 'long') {
      const recent = (await Reel.find({ format: 'long' }).sort({ createdAt: -1 }).limit(15).select('script')).map((r) => r.script?.hookText || r.script?.title).filter(Boolean);
      script = await generateLongScript(item.topic, recent, '', (await getSettings()).longMinutes);
    } else script = await writeShortScript({ topic: item.topic, formatId, targetSec, notes: item.notes, excludePlanId: item._id, pillar: item.pillar });
    res.json(await Plan.findByIdAndUpdate(item._id, { script, ...(script.formatId ? { formatId: script.formatId } : {}) }, { new: true }));
  }));
  app.post('/api/plan/:id/script-from-text', wrap(async (req, res) => {
    const item = await Plan.findById(req.params.id);
    const script = await scriptFromText(req.body.text, item.topic, item.kind);
    res.json(await Plan.findByIdAndUpdate(item._id, { script }, { new: true }));
  }));
  // write the missing scripts of a day in the background (Home page: "Write scripts")
  app.post('/api/plan/day/:date/scripts', wrap(async (req, res) => res.json({ started: await prewriteScripts(req.params.date) })));

  // ------------------------------------------------ calendar: which video was posted on which day
  app.get('/api/calendar', wrap(async (req, res) => {
    const IST_MS = 5.5 * 3600e3;
    const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : todayIST().slice(0, 7);
    const [y, m] = month.split('-').map(Number);
    const from = new Date(Date.UTC(y, m - 1, 1) - IST_MS), to = new Date(Date.UTC(y, m, 1) - IST_MS);
    const nextMonth = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
    const reels = await Reel.find({ $or: [{ scheduledFor: { $gte: from, $lt: to } }, { scheduledFor: null, createdAt: { $gte: from, $lt: to } }] })
      .select('topic format status scheduledFor createdAt publish purgedAt error script.hookText script.title durationSec').sort({ scheduledFor: 1, createdAt: 1 }).lean();
    const plans = await Plan.find({ date: { $gte: `${month}-01`, $lt: `${nextMonth}-01` }, status: { $in: ['planned', 'skipped'] } }).select('topic kind date publishTime status').sort({ slot: 1 }).lean();
    const ist = (d) => new Date(+new Date(d) + IST_MS).toISOString();
    const days = {};
    const put = (date, e) => (days[date] = days[date] || []).push(e);
    for (const r of reels) {
      const when = r.scheduledFor || r.createdAt;
      const pub = r.publish || {};
      put(ist(when).slice(0, 10), {
        id: String(r._id), topic: r.topic, kind: r.format, status: r.status, time: ist(when).slice(11, 16), hook: r.script?.hookText || r.script?.title || '',
        purged: !!r.purgedAt, error: r.error || pub.error || '',
        platforms: Object.fromEntries(['youtube', 'instagram'].filter((p) => pub[p]).map((p) => [p, { state: pub[p].state, url: pub[p].url || '', error: pub[p].error || '', at: pub[p].at || null }])),
      });
    }
    const today = todayIST();
    for (const p of plans) put(p.date, { id: String(p._id), topic: p.topic, kind: p.kind, status: p.status === 'skipped' ? 'skipped' : p.date < today ? 'missed' : 'planned', time: p.publishTime || '', hook: '', planned: true, platforms: {} });
    res.json({ month, today: todayIST(), days });
  }));

  // delete one day's plan (only items not started yet) / bring it back
  const okDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d));
  app.delete('/api/plan/day/:date', wrap(async (req, res) => {
    if (!okDate(req.params.date)) return res.status(400).json({ error: 'date galat hai' });
    res.json(await deleteDayPlan(req.params.date));
  }));
  app.delete('/api/plan/:id', wrap(async (req, res) => res.json(await deleteItem(req.params.id))));
  app.post('/api/plan/day/:date/restore', wrap(async (req, res) => {
    if (!okDate(req.params.date)) return res.status(400).json({ error: 'date galat hai' });
    res.json({ created: await restoreDayPlan(req.params.date) });
  }));
  app.post('/api/plan/day/:date/run', wrap(async (req, res) => res.json({ started: await runDay(req.params.date) })));
  app.post('/api/plan/:id/suggest', wrap(async (req, res) => {
    const item = await Plan.findById(req.params.id);
    res.json(await Plan.findByIdAndUpdate(item._id, { topic: await newTopicFor(item) }, { new: true }));
  }));
  app.post('/api/plan/:id/run', wrap(async (req, res) => {
    const item = await Plan.findById(req.params.id);
    const reel = item ? await runPlanItem(item) : null;
    res.json({ started: !!reel, ...(reel ? {} : { note: 'Ye video pehle se bani hui / ban rahi hai, ya aaj ki limit poori ho chuki hai' }) });
  }));
  app.post('/api/plan/run-today', wrap(async (_req, res) => res.json({ started: await runDay(todayIST()) })));
  app.post('/api/plan/reset', wrap(async (_req, res) => {
    await Plan.deleteMany({ date: { $gte: todayIST() }, status: 'planned' });
    await resetCleared();
    res.json({ created: await ensurePlan() });
  }));
  // AI plans the whole week (mixed formats) and writes all the scripts in the background. Optional brief = "is hafte karma aur anger par".
  app.post('/api/plan/week/ai', wrap(async (req, res) => res.json(await planWeekWithAI({ brief: String(req.body?.brief || '').slice(0, 1500) }))));
  // The creator's own scripts, plain text, 1 day up to a month: { text, startDate? }  (nothing is rewritten by AI; see parseOwnScripts for the format)
  app.post('/api/plan/scripts/import', wrap(async (req, res) => {
    const text = String(req.body?.text || '');
    if (!text.trim()) return res.status(400).json({ error: 'Scripts ka text paste karo' });
    if (text.length > 600000) return res.status(400).json({ error: 'Text bahut bada hai (max ~6 lakh akshar). Do hisson mein daalo.' });
    const start = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.startDate || '')) ? req.body.startDate : todayIST();
    res.json(await importOwnScripts({ text, startDate: start }));
  }));
  // Weekly plan from a PDF / image / text: { text?, file?: { name, mime, data(base64) }, startDate?, brief? }
  app.post('/api/plan/week/import', wrap(async (req, res) => {
    const { text = '', file = null, startDate, brief = '' } = req.body || {};
    if (!String(text).trim() && !file?.data) return res.status(400).json({ error: 'Plan ka text paste karo ya PDF/image/txt file chuno' });
    const mime = file ? String(file.mime || '').toLowerCase() : '';
    if (file && !['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain', 'text/markdown', 'text/csv'].includes(mime)) return res.status(400).json({ error: 'Sirf PDF, image (png/jpg/webp) ya txt file chalegi. Word/Excel ho to text copy karke paste karo.' });
    const start = /^\d{4}-\d{2}-\d{2}$/.test(String(startDate || '')) ? startDate : todayIST();
    // plain text files are sent as text (cheaper, exact)
    const asText = file && mime.startsWith('text/') ? Buffer.from(file.data, 'base64').toString('utf8') : '';
    res.json(await importWeekPlan({ text: [text, asText].filter(Boolean).join('\n\n'), file: file && !asText ? { mime, data: file.data } : null, startDate: start, brief: String(brief).slice(0, 1500) }));
  }));

  return app;
}
