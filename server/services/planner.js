import { Plan, Reel, Setting, Topic, SEED_LONG, SEED_TOPICS } from '../models.js';
import { generateLongScript, generatePlanTopics, generateScript } from './gemini.js';
import { getSettings } from './settings.js';
import { enqueue } from './queue.js';
import { purgeExpired } from './retention.js';
import { config } from '../config.js';

const IST = 5.5 * 3600 * 1000;
const istNow = () => new Date(Date.now() + IST);
export const todayIST = () => istNow().toISOString().slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const hhmm = () => istNow().toISOString().slice(11, 16);
export const toDate = (date, time) => new Date(Date.parse(`${date}T${time}:00Z`) - IST); // IST wall-clock -> real Date

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Make sure every day of the next N days has its planned items (topics chosen by AI in advance). */
export async function ensurePlan() {
  const st = await getSettings();
  const start = todayIST();
  const want = [];
  // hard cap: never more than config.maxPerDay (3) videos a day, whatever is saved in Settings
  const nShort = Math.min(Number(st.shorts) || 0, config.maxPerDay);
  const nLong = Math.min(Number(st.long) || 0, config.maxPerDay - nShort);
  for (let d = 0; d < st.planDays; d++) {
    const date = addDays(start, d);
    let have = await Plan.find({ date }).sort({ slot: 1 });
    // remove surplus items that were planned earlier (e.g. an old 'long' slot) so the day never exceeds the cap
    for (const [kind, limit] of [['short', nShort], ['long', nLong]]) {
      const mine = have.filter((p) => p.kind === kind && p.status !== 'skipped');
      for (const p of mine.slice(limit).reverse()) if (p.status === 'planned') { await Plan.deleteOne({ _id: p._id }); have = have.filter((h) => String(h._id) !== String(p._id)); }
    }
    const shorts = have.filter((p) => p.kind === 'short').length;
    const longs = have.filter((p) => p.kind === 'long').length;
    for (let i = shorts; i < nShort; i++) want.push({ date, kind: 'short', slot: i, publishTime: st.shortSlots[i] || st.shortSlots.at(-1) || '12:00' });
    for (let i = longs; i < nLong; i++) want.push({ date, kind: 'long', slot: 10 + i, publishTime: st.longSlot });
  }
  if (!want.length) return 0;
  const used = [...(await Plan.find().select('topic')).map((p) => p.topic), ...(await Reel.find().sort({ createdAt: -1 }).limit(60).select('topic')).map((r) => r.topic)];
  let topics = { shorts: [], long: [] };
  try { topics = await generatePlanTopics({ shorts: want.filter((w) => w.kind === 'short').length, long: want.filter((w) => w.kind === 'long').length, avoid: used }); }
  catch (e) { console.warn('[plan] AI topics failed, using pool:', e.message); }
  for (const w of want) {
    let topic = (w.kind === 'long' ? topics.long : topics.shorts).shift();
    if (!topic) topic = pick(w.kind === 'long' ? SEED_LONG : [...SEED_TOPICS, ...(await Topic.find({ used: false }).select('text')).map((t) => t.text)]);
    await Plan.create({ ...w, topic });
  }
  return want.length;
}

export async function newTopicFor(item) {
  const used = (await Plan.find().select('topic')).map((p) => p.topic);
  const t = await generatePlanTopics({ shorts: item.kind === 'short' ? 1 : 0, long: item.kind === 'long' ? 1 : 0, avoid: used });
  return (item.kind === 'long' ? t.long[0] : t.shorts[0]) || item.topic;
}

/** Start generation for one plan item. */
export async function runPlanItem(item) {
  if (!item || item.status !== 'planned') return null;
  if ((await Plan.countDocuments({ date: item.date, status: { $in: ['generating', 'done'] } })) >= config.maxPerDay) return null; // max videos per day reached
  const when = toDate(item.date, item.publishTime || '12:00');
  // posted at the planned time; if that time has already passed it goes out as soon as the video is ready
  const reel = await Reel.create({ topic: item.topic, format: item.kind, planId: item._id, ...(item.script ? { script: item.script } : {}), scheduledFor: when.getTime() > Date.now() ? when : new Date() });
  await Plan.updateOne({ _id: item._id }, { status: 'generating', reelId: reel._id });
  enqueue(reel._id);
  return reel;
}

/** ---------- scripts written in advance (so the Home page can show what will be made today) ---------- */
const writing = new Set(); // plan items whose script is queued or being written
export const isScriptBusy = (id) => writing.has(String(id));
async function generateAndSave(item) {
  const recent = (await Reel.find({ format: item.kind }).sort({ createdAt: -1 }).limit(15).select('script')).map((r) => r.script?.hookText || r.script?.title).filter(Boolean);
  const script = item.kind === 'long' ? await generateLongScript(item.topic, recent) : await generateScript(item.topic, recent);
  return Plan.findOneAndUpdate({ _id: item._id, status: 'planned', script: null }, { script }, { new: true }); // never overwrites a script you wrote
}
/** fire-and-forget: writes the missing scripts of one day, one after another. Returns how many are queued. */
export async function prewriteScripts(date = todayIST()) {
  const items = (await Plan.find({ date, status: 'planned', script: null }).sort({ slot: 1 })).filter((i) => !writing.has(String(i._id)));
  const ids = items.map((i) => String(i._id));
  ids.forEach((id) => writing.add(id));
  (async () => {
    for (const id of ids) {
      try {
        const it = await Plan.findById(id);
        if (it && it.status === 'planned' && !it.script) await generateAndSave(it);
      } catch (e) { console.warn('[prewrite]', e.message); } finally { writing.delete(id); }
    }
  })();
  return ids.length;
}
export async function prepareToday() {
  const st = await getSettings();
  await ensurePlan();
  if (st.prewriteScripts) await prewriteScripts(todayIST());
}

export async function runDay(date) {
  const items = await Plan.find({ date, status: 'planned' }).sort({ slot: -1 }); // long video first (slowest), then shorts
  const made = [];
  for (const it of items) made.push(await runPlanItem(it));
  return made.filter(Boolean).length;
}
export const runToday = () => runDay(todayIST());

async function flag(key, value) {
  if (value === undefined) return (await Setting.findOne({ key }))?.value;
  await Setting.updateOne({ key }, { key, value }, { upsert: true });
}

/** every minute (IST) */
export async function tick(approveReel) {
  const st = await getSettings();

  // 1) daily generation at generateAt
  if (st.automation && hhmm() >= st.generateAt && (await flag('lastGenDate')) !== todayIST()) {
    await flag('lastGenDate', todayIST());
    await ensurePlan();
    const n = await runToday();
    console.log(`[automation] ${st.generateAt} IST: started ${n} video(s)`);
  }

  // 2) plan status follows reel status
  for (const it of await Plan.find({ status: 'generating' })) {
    const r = await Reel.findById(it.reelId).select('status');
    if (!r) await Plan.updateOne({ _id: it._id }, { status: 'planned', reelId: null });
    else if (['ready', 'approved', 'published', 'rejected'].includes(r.status)) await Plan.updateOne({ _id: it._id }, { status: 'done' });
    else if (r.status === 'failed') {
      // one failed API call must not cost a whole day: retry up to 2 times, then give the slot back
      const full = await Reel.findById(it.reelId).select('retries');
      if ((full?.retries || 0) < 2) { await Reel.updateOne({ _id: it.reelId }, { status: 'queued', progress: 0, error: null, $inc: { retries: 1 } }); enqueue(it.reelId); console.log(`[automation] retrying failed video ${String(it.reelId).slice(-6)}`); }
      else await Plan.updateOne({ _id: it._id }, { status: 'planned', reelId: null });
    }
  }

  // 3) auto-approve
  if (st.autoApprove) for (const r of await Reel.find({ status: 'ready' })) await approveReel(r._id);

  // 4) storage keeper: every file of a reel (images, audio, video) is deleted 24h after generation (see retention.js)
  if (Date.now() - lastPurge > 10 * 60 * 1000) {
    lastPurge = Date.now();
    await purgeExpired().catch((e) => console.warn('[storage]', e.message));
  }
}
let lastPurge = 0;
