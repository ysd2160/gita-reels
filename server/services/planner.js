import { Plan, Reel, Setting, Topic, SEED_LONG, SEED_TOPICS } from '../models.js';
import { extractWeekPlan, generateLongScript, generatePlanTopics, generateWeekTopics } from './gemini.js';
import { formatById, pickFormat } from '../formats.js';
import { recentContext, structureOwnScript, writeShortScript } from './scriptContext.js';
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
export async function ensurePlan({ brief = '' } = {}) {
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
  // every short gets a FORMAT (story / mystery / classic shlok ...): never the same one twice in a day, recent ones are avoided
  const recentFormats = (await recentContext()).recentFormats;
  const shorts = want.filter((w) => w.kind === 'short');
  for (const w of shorts) {
    const sameDay = [...(await Plan.find({ date: w.date, kind: 'short' }).select('formatId')).map((p) => p.formatId), ...shorts.filter((x) => x.date === w.date && x.formatId).map((x) => x.formatId)].filter(Boolean);
    w.formatId = pickFormat({ recent: [...recentFormats], sameDay, shlokPercent: st.shlokPercent });
    recentFormats.unshift(w.formatId);
  }
  let topics = { shorts: [], long: [] };
  try {
    topics.shorts = await generateWeekTopics({ slots: shorts, avoid: used, brief });
    if (want.some((w) => w.kind === 'long')) topics.long = (await generatePlanTopics({ shorts: 0, long: want.filter((w) => w.kind === 'long').length, avoid: used })).long;
  } catch (e) { console.warn('[plan] AI topics failed, using pool:', e.message); }
  let si = 0;
  for (const w of want) {
    let topic = w.kind === 'long' ? topics.long.shift() : topics.shorts[si++];
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
  const reel = await Reel.create({ topic: item.topic, format: item.kind, planId: item._id, formatId: item.formatId, targetSec: item.targetSec, notes: item.notes, ...(item.script ? { script: item.script } : {}), scheduledFor: when.getTime() > Date.now() ? when : new Date() });
  await Plan.updateOne({ _id: item._id }, { status: 'generating', reelId: reel._id });
  enqueue(reel._id);
  return reel;
}

/** ---------- scripts written in advance (so the Home page can show what will be made today) ---------- */
const writing = new Set(); // plan items whose script is queued or being written
export const isScriptBusy = (id) => writing.has(String(id));
export async function writeScriptForItem(item) {
  let script;
  if (item.kind === 'long') {
    const recent = (await Reel.find({ format: 'long' }).sort({ createdAt: -1 }).limit(15).select('script')).map((r) => r.script?.hookText || r.script?.title).filter(Boolean);
    script = await generateLongScript(item.topic, recent);
  } else if (item.sourceText) script = await structureOwnScript({ text: item.sourceText, topic: item.topic }); // creator's own script from the plan: kept word for word
  else script = await writeShortScript({ topic: item.topic, formatId: item.formatId, targetSec: item.targetSec, notes: item.notes, excludePlanId: item._id });
  return script;
}
async function generateAndSave(item) {
  const script = await writeScriptForItem(item);
  return Plan.findOneAndUpdate({ _id: item._id, status: 'planned', script: null }, { script, ...(script.formatId ? { formatId: script.formatId } : {}) }, { new: true }); // never overwrites a script you wrote
}
/** fire-and-forget: writes the missing scripts of one day (or several days), one after another. Returns how many are queued. */
export async function prewriteScripts(dates = todayIST()) {
  const list = Array.isArray(dates) ? dates : [dates];
  const items = (await Plan.find({ date: { $in: list }, status: 'planned', script: null }).sort({ date: 1, slot: 1 })).filter((i) => !writing.has(String(i._id)));
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

/** Weekly plan: AI creates a fresh week (mixed formats), optionally following the creator's brief. */
export async function planWeekWithAI({ brief = '', days = 7 } = {}) {
  await Plan.deleteMany({ date: { $gte: todayIST() }, status: 'planned', script: null });
  const created = await ensurePlan({ brief });
  const dates = Array.from({ length: days }, (_, d) => addDays(todayIST(), d));
  const queued = await prewriteScripts(dates);
  return { created, scriptsQueued: queued };
}

const WEEKDAYS = { monday: 1, somvar: 1, mon: 1, tuesday: 2, mangalvar: 2, tue: 2, wednesday: 3, budhvar: 3, wed: 3, thursday: 4, guruvar: 4, veervar: 4, thu: 4, friday: 5, shukravar: 5, fri: 5, saturday: 6, shanivar: 6, sat: 6, sunday: 0, ravivar: 0, itvar: 0, sun: 0 };

/**
 * Import a weekly plan from a PDF / image / text. Items are mapped to days starting at `startDate`
 * (default: today), existing not-yet-generated planned items of those days are replaced.
 */
export async function importWeekPlan({ text = '', file = null, startDate = todayIST(), brief = '' }) {
  const items = await extractWeekPlan({ text, file, brief });
  if (!items.length) return { created: 0, skipped: 0, items: [], note: 'Plan mein koi reel nahi mili. Text/PDF check karo.' };
  const st = await getSettings();
  const maxDay = Math.max(...items.map((i) => i.day || 1), 1);
  const byDate = new Map();
  let skipped = 0;
  for (const it of items) {
    const date = it.date || addDays(startDate, Math.min(Math.max((it.day || 1) - 1, 0), 30));
    const arr = byDate.get(date) || [];
    arr.push(it);
    byDate.set(date, arr);
  }
  const created = [];
  for (const [date, list] of [...byDate].sort(([a], [b]) => a.localeCompare(b))) {
    await Plan.deleteMany({ date, kind: 'short', status: 'planned', reelId: null }); // replace what was only planned
    const kept = await Plan.find({ date }).sort({ slot: 1 }); // already generating / done / skipped stay
    const room = Math.max(0, config.maxPerDay - kept.filter((k) => k.status !== 'skipped').length);
    const take = list.slice(0, room); skipped += list.length - take.length;
    const sameDay = kept.map((k) => k.formatId).filter(Boolean);
    const recent = (await recentContext()).recentFormats;
    let slot = kept.reduce((m, k) => Math.max(m, k.slot ?? -1), -1) + 1;
    for (const it of take) {
      const formatId = it.formatId && formatById(it.formatId) ? it.formatId : pickFormat({ recent, sameDay, shlokPercent: st.shlokPercent });
      sameDay.push(formatId); recent.unshift(formatId);
      created.push(await Plan.create({
        date, kind: 'short', slot, publishTime: st.shortSlots[slot] || st.shortSlots.at(-1) || '12:00',
        topic: it.topic, formatId, notes: it.notes || '', sourceText: it.scriptText || '',
      }));
      slot++;
    }
  }
  const queued = await prewriteScripts([...byDate.keys()]);
  return { created: created.length, skipped, days: maxDay, scriptsQueued: queued, items: created.map((c) => ({ date: c.date, topic: c.topic, formatId: c.formatId, ownScript: !!c.sourceText })) };
}

export async function runDay(date) {
  const items = (await Plan.find({ date, status: 'planned' })).sort((a, b) => String(a.publishTime || '').localeCompare(String(b.publishTime || ''))); // one video at a time, in publish-time order
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
