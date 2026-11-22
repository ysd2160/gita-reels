import mongoose from 'mongoose';
import { Plan, Reel, Setting, Topic, SEED_LONG, SEED_TOPICS } from '../models.js';
import { extractWeekPlan, generateLongScript, generatePlanTopics, generateWeekTopics, scriptFromText } from './gemini.js';
import { FORMATS, formatById, pickFormat, pickPillar } from '../formats.js';
import { recentContext, structureOwnScript, writeShortScript } from './scriptContext.js';
import { getSettings } from './settings.js';
import { computeRetimes } from './retime.js';
import { enqueue } from './queue.js';
import { purgeExpired } from './retention.js';
import { config } from '../config.js';

const IST = 5.5 * 3600 * 1000;
const istNow = () => new Date(Date.now() + IST);
export const todayIST = () => istNow().toISOString().slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const hhmm = () => istNow().toISOString().slice(11, 16);
export const toDate = (date, time) => new Date(Date.parse(`${date}T${time}:00Z`) - IST); // IST wall-clock -> real Date

// daily hard cap: never below 4, so "3 reels + 1 long video" always fits even if an old .env still says MAX_PER_DAY=3
const DAY_CAP = Math.max(config.maxPerDay, 4);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ---- days whose plan the creator deleted: ensurePlan() must NOT fill them up again ----
const CLEARED = 'plan:clearedDays';
export async function clearedDays() {
  const v = (await Setting.findOne({ key: CLEARED }))?.value;
  return Array.isArray(v) ? v.filter((d) => d >= todayIST()) : [];
}
const setCleared = (list) => Setting.updateOne({ key: CLEARED }, { key: CLEARED, value: [...new Set(list)].sort() }, { upsert: true });

// ---- single plan items the creator deleted: remembered per day + kind so ensurePlan() does not create a replacement ----
const REMOVED = 'plan:removedItems';
async function removedItems() {
  const v = (await Setting.findOne({ key: REMOVED }))?.value;
  return Array.isArray(v) ? v.filter((r) => r?.date >= todayIST()) : [];
}
const setRemoved = (list) => Setting.updateOne({ key: REMOVED }, { key: REMOVED, value: list }, { upsert: true });
export async function resetCleared() { await setCleared([]); await setRemoved([]); }

/** Delete ONE planned / skipped item. A video that is generating or already made is never touched. */
export async function deleteItem(id) {
  if (!mongoose.isValidObjectId(id)) return { deleted: 0, note: 'Plan item nahi mila' };
  const it = await Plan.findById(id);
  if (!it) return { deleted: 0, note: 'Plan item nahi mila (pehle hi delete ho chuka hoga)' };
  if (!['planned', 'skipped'].includes(it.status) || it.reelId) return { deleted: 0, note: 'Ye video ban rahi / ban chuki hai, plan se delete nahi hogi. Videos tab se delete karo.' };
  await Plan.deleteOne({ _id: it._id });
  await setRemoved([...(await removedItems()), { date: it.date, kind: it.kind }]);
  return { deleted: 1 };
}

/** Delete the plan of one day. Only items that were not started yet (planned / skipped) go; videos already generating or made stay. */
export async function deleteDayPlan(date) {
  const r = await Plan.deleteMany({ date, status: { $in: ['planned', 'skipped'] }, reelId: null });
  await setCleared([...(await clearedDays()), date]);
  return { deleted: r.deletedCount || 0, kept: await Plan.countDocuments({ date }) };
}
/** Bring a deleted day back: it is planned again by the AI, exactly like a new day. */
export async function restoreDayPlan(date) {
  await setCleared((await clearedDays()).filter((d) => d !== date));
  await setRemoved((await removedItems()).filter((r) => r.date !== date));
  return ensurePlan();
}

/** Settings -> publish times changed: move every upcoming plan item and every not-yet-uploaded video to the new times. */
export async function retimeUpcoming() {
  const st = await getSettings();
  const items = await Plan.find({ date: { $gte: todayIST() }, status: { $in: ['planned', 'generating', 'done'] } });
  const reels = await Reel.find({ planId: { $in: items.map((i) => i._id) }, status: { $ne: 'failed' } }).select('planId status scheduledFor publish');
  const { plans, reels: rs, locked } = computeRetimes(items, new Map(reels.map((r) => [String(r.planId), r])), st, { toDate });
  for (const p of plans) await Plan.updateOne({ _id: p.id }, { publishTime: p.time });
  for (const r of rs) await Reel.updateOne({ _id: r.id }, { scheduledFor: r.scheduledFor });
  return { plans: plans.length, reels: rs.length, locked };
}

/** Make sure every day of the next N days has its planned items (topics chosen by AI in advance). */
export async function ensurePlan({ brief = '' } = {}) {
  const st = await getSettings();
  const start = todayIST();
  const want = [];
  const cleared = new Set(await clearedDays());
  const removed = await removedItems();
  // hard cap: never more than DAY_CAP videos a day, whatever is saved in Settings
  const nShort = Math.min(Number(st.shorts) || 0, DAY_CAP);
  const nLong = Math.min(Number(st.long) || 0, DAY_CAP - nShort);
  for (let d = 0; d < st.planDays; d++) {
    const date = addDays(start, d);
    if (cleared.has(date)) continue; // creator deleted this day's plan
    let have = await Plan.find({ date }).sort({ slot: 1 });
    // remove surplus items that were planned earlier (e.g. an old 'long' slot) so the day never exceeds the cap
    // items the creator deleted one by one are not created again
    const tShort = Math.max(0, nShort - removed.filter((r) => r.date === date && r.kind === 'short').length);
    const tLong = Math.max(0, nLong - removed.filter((r) => r.date === date && r.kind === 'long').length);
    for (const [kind, limit] of [['short', tShort], ['long', tLong]]) {
      const mine = have.filter((p) => p.kind === kind && p.status !== 'skipped');
      for (const p of mine.slice(limit).reverse()) if (p.status === 'planned' && !p.sourceText && !p.script) { await Plan.deleteOne({ _id: p._id }); have = have.filter((h) => String(h._id) !== String(p._id)); }
    }
    const shorts = have.filter((p) => p.kind === 'short').length;
    const longs = have.filter((p) => p.kind === 'long').length;
    for (let i = shorts; i < tShort; i++) want.push({ date, kind: 'short', slot: i, publishTime: st.shortSlots[i] || st.shortSlots.at(-1) || '12:00' });
    for (let i = longs; i < tLong; i++) want.push({ date, kind: 'long', slot: 10 + i, publishTime: st.longSlot });
  }
  if (!want.length) return 0;
  const used = [...(await Plan.find().select('topic')).map((p) => p.topic), ...(await Reel.find().sort({ createdAt: -1 }).limit(60).select('topic')).map((r) => r.topic)];
  // every short gets a FORMAT (modern story / Mahabharat story / twist / dialogue ...): never the same one twice in a day, recent ones are avoided
  const ctx0 = await recentContext();
  const recentFormats = ctx0.recentFormats;
  const recentPillars = [...ctx0.recentPillars];
  const shorts = want.filter((w) => w.kind === 'short');
  for (const w of shorts) {
    const sameDay = [...(await Plan.find({ date: w.date, kind: 'short' }).select('formatId')).map((p) => p.formatId), ...shorts.filter((x) => x.date === w.date && x.formatId).map((x) => x.formatId)].filter(Boolean);
    w.formatId = pickFormat({ recent: [...recentFormats], sameDay });
    recentFormats.unshift(w.formatId);
    w.pillar = pickPillar(recentPillars); // the channel talks about 3 pillars only; the least recently used one is next
    recentPillars.unshift(w.pillar);
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
  if (item.kind === 'short') {
    const pillar = item.pillar || pickPillar((await recentContext()).recentPillars);
    const t = await generateWeekTopics({ slots: [{ formatId: item.formatId || 'modern_story', pillar }], avoid: used });
    if (t[0]) { await Plan.updateOne({ _id: item._id }, { pillar }); return t[0]; }
  }
  const t = await generatePlanTopics({ shorts: item.kind === 'short' ? 1 : 0, long: item.kind === 'long' ? 1 : 0, avoid: used });
  return (item.kind === 'long' ? t.long[0] : t.shorts[0]) || item.topic;
}

/** Start generation for one plan item. */
export async function runPlanItem(item) {
  if (!item || item.status !== 'planned') return null;
  // already made (or being made) for this plan item: never make it twice
  const made = await Reel.findOne({ planId: item._id, status: { $ne: 'failed' } }).select('status');
  if (made) {
    await Plan.updateOne({ _id: item._id }, { status: ['ready', 'approved', 'published', 'rejected'].includes(made.status) ? 'done' : 'generating', reelId: made._id });
    console.log(`[plan] "${item.topic}" pehle se bani hui hai (${made.status}), skip`);
    return null;
  }
  if ((await Plan.countDocuments({ date: item.date, status: { $in: ['generating', 'done'] } })) >= DAY_CAP) return null; // max videos per day reached
  const when = toDate(item.date, item.publishTime || '12:00');
  // posted at the planned time; if that time has already passed it goes out as soon as the video is ready
  const reel = await Reel.create({ topic: item.topic, format: item.kind, planId: item._id, formatId: item.formatId, targetSec: item.targetSec, notes: item.notes, pillar: item.pillar || item.script?.pillar || '', hookStyle: item.script?.hookStyle || '', ...(item.script ? { script: item.script } : {}), scheduledFor: when.getTime() > Date.now() ? when : new Date() });
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
    script = item.sourceText ? await scriptFromText(item.sourceText, item.topic, 'long') : await generateLongScript(item.topic, recent, item.notes, (await getSettings()).longMinutes);
  } else if (item.sourceText) script = await structureOwnScript({ text: item.sourceText, topic: item.topic }); // creator's own script from the plan: kept word for word
  else script = await writeShortScript({ topic: item.topic, formatId: item.formatId, targetSec: item.targetSec, notes: item.notes, excludePlanId: item._id, pillar: item.pillar });
  return script;
}
async function generateAndSave(item) {
  const script = await writeScriptForItem(item);
  return Plan.findOneAndUpdate({ _id: item._id, status: 'planned', script: null }, { script, ...(script.formatId ? { formatId: script.formatId } : {}), ...(script.pillar && !item.pillar ? { pillar: script.pillar } : {}) }, { new: true }); // never overwrites a script you wrote
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
  await resetCleared(); // asking the AI for a fresh week also brings deleted days back
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
  return applyPlanItems(items, startDate);
}

/** items = [{ day, date, kind, topic, formatId, notes, scriptText }] -> Plan rows (+ background structuring of the pasted scripts) */
async function applyPlanItems(items, startDate = todayIST()) {
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
    await setCleared((await clearedDays()).filter((d) => d !== date)); // an imported plan for this day replaces the deletion
    await setRemoved((await removedItems()).filter((r) => r.date !== date));
    if (list.some((x) => x.kind !== 'long')) await Plan.deleteMany({ date, kind: 'short', status: 'planned', reelId: null }); // replace what was only planned
    if (list.some((x) => x.kind === 'long')) await Plan.deleteMany({ date, kind: 'long', status: 'planned', reelId: null });
    const kept = await Plan.find({ date }).sort({ slot: 1 }); // already generating / done / skipped stay
    const room = Math.max(0, DAY_CAP - kept.filter((k) => k.status !== 'skipped').length);
    const take = [...list.filter((x) => x.kind !== 'long'), ...list.filter((x) => x.kind === 'long').slice(0, 1)].slice(0, room); skipped += list.length - take.length; // at most 1 long video a day
    const sameDay = kept.map((k) => k.formatId).filter(Boolean);
    const recent = (await recentContext()).recentFormats;
    let slot = kept.filter((k) => k.kind === 'short').reduce((m, k) => Math.max(m, k.slot ?? -1), -1) + 1;
    for (const it of take) {
      if (it.kind === 'long') { // the 5-minute story video: YouTube only
        created.push(await Plan.create({ date, kind: 'long', slot: 10, publishTime: st.longSlot, topic: it.topic, notes: it.notes || '', sourceText: it.scriptText || '' }));
        continue;
      }
      const formatId = it.formatId && formatById(it.formatId) ? it.formatId : pickFormat({ recent, sameDay });
      sameDay.push(formatId); recent.unshift(formatId);
      created.push(await Plan.create({
        date, kind: 'short', slot, publishTime: st.shortSlots[slot] || st.shortSlots.at(-1) || '12:00',
        topic: it.topic, formatId, notes: it.notes || '', sourceText: it.scriptText || '',
      }));
      slot++;
    }
  }
  const queued = await prewriteScripts([...byDate.keys()]);
  return { created: created.length, skipped, days: maxDay, scriptsQueued: queued, items: created.map((c) => ({ date: c.date, topic: c.topic, formatId: c.formatId, ownScript: !!c.sourceText, kind: c.kind })) };
}

// ---------------------------------------------------------------- own scripts, plain text (no AI reads it: your words stay exactly as written)
const fmtFromText = (t) => {
  const k = String(t || '').trim().toLowerCase();
  if (!k) return null;
  const hit = FORMATS.find((f) => f.id === k || f.label.toLowerCase() === k || f.label.toLowerCase().includes(k) || k.includes(f.label.toLowerCase()));
  if (hit) return hit.id;
  if (/mahabharat|karn|epic/.test(k)) return 'epic_story';
  if (/arjun|krishna|dialog|sawaal|baat/.test(k)) return 'dialogue';
  if (/twist|ant|palat/.test(k)) return 'twist_story';
  if (/raaz|mystery|fact/.test(k)) return 'mystery';
  if (/aaj|modern|kahani|story/.test(k)) return 'modern_story';
  return null;
};
const DAY_RE = /^\s*(?:#+\s*)?(?:din|day|दिन)\s*[-:.]?\s*(\d{1,2})\s*(?:[:\-–(].*)?$/i;
const DATE_RE = /^\s*(?:#+\s*)?(?:din|day|date|तारीख)?\s*[-:]?\s*(\d{4}-\d{2}-\d{2})\s*$/i;
const ITEM_RE = /^\s*(?:#+\s*)?(reel|short|long)\s*\d*\s*:\s*(.*)$/i;
const SCRIPT_RE = /^\s*script\s*:\s*(.*)$/i;
const RULE_RE = /^\s*(?:[-=_*~]{3,})\s*$/;

/**
 * Plain-text plan with the creator's own scripts:
 *   Din 1                      (or a date 2026-11-24)
 *   Reel: topic | kahani ka type (optional) | note: ... (optional)
 *   SCRIPT:
 *   one line per sentence...
 *   LONG: topic               (5-minute video, YouTube only)
 * Returns { items, warnings }.
 */
export function parseOwnScripts(text) {
  const rows = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const items = [], warnings = [];
  let day = 1, date = null, cur = null, sawDay = false;
  const close = () => {
    if (!cur) return;
    const body = cur.lines.join('\n').trim();
    const tag = cur.date || `Din ${cur.day}`;
    cur.scriptText = body.length >= 40 ? body : null;
    if (!cur.scriptText && body) warnings.push(`${tag}, "${cur.topic}": script bahut chhoti hai (40 akshar se kam), isliye AI is topic par khud script likhega`);
    const words = body.replace(/\*/g, '').split(/\s+/).filter(Boolean).length;
    if (cur.scriptText && cur.kind === 'short' && (words < 45 || words > 320)) warnings.push(`${tag}, "${cur.topic}": ${words} words hain (~2.4 words = 1 sec; 140 words ~ 60 sec, 280 words ~ 120 sec)`);
    if (cur.scriptText && cur.kind === 'long' && words < 300) warnings.push(`${tag}, LONG "${cur.topic}": sirf ${words} words, video chhoti banegi (~2.4 words = 1 sec; 5 min ke liye ~700 words, 10 min ke liye ~1400)`);
    delete cur.lines;
    items.push(cur); cur = null;
  };
  for (const raw of rows) {
    const line = raw.trim();
    const d = DATE_RE.exec(line), n = DAY_RE.exec(line);
    if (n || d) {
      close(); sawDay = true;
      if (d) { date = d[1]; day = null; } else { day = Number(n[1]); date = null; }
      continue;
    }
    const m = ITEM_RE.exec(line);
    if (m) {
      close();
      const parts = m[2].split('|').map((x) => x.trim());
      const note = parts.slice(1).find((x) => /^note\s*:/i.test(x));
      const type = parts.slice(1).find((x) => !/^note\s*:/i.test(x));
      cur = { day, date, kind: m[1].toLowerCase() === 'long' ? 'long' : 'short', topic: (parts[0] || '').slice(0, 140), formatId: fmtFromText(type), notes: note ? note.replace(/^note\s*:/i, '').trim().slice(0, 600) : '', lines: [] };
      continue;
    }
    if (!cur) { if (line && !RULE_RE.test(line)) warnings.push(`Ye line kisi "Reel:" ke bina thi, chhod di: "${line.slice(0, 50)}"`); continue; }
    if (!line || RULE_RE.test(line) || /^\(.*\)$/.test(line)) continue; // blank, separator, or a (placeholder note in brackets)
    const sc = SCRIPT_RE.exec(line);
    if (sc) { if (sc[1].trim()) cur.lines.push(sc[1].trim()); continue; }
    cur.lines.push(line);
  }
  close();
  for (const it of items) if (!it.topic) it.topic = (it.scriptText || 'Script').split('\n')[0].replace(/\*/g, '').slice(0, 60);
  return { items: items.filter((i) => i.day || i.date), warnings, sawDay };
}

/** The creator's own scripts for 1 day up to a month: { text, startDate } */
export async function importOwnScripts({ text = '', startDate = todayIST() }) {
  const { items, warnings } = parseOwnScripts(text);
  if (!items.length) return { created: 0, skipped: 0, items: [], warnings, note: 'Koi "Reel:" ya "LONG:" line nahi mili. Template jaisa format use karo.' };
  const tooFar = items.filter((i) => i.day && i.day > 31).length;
  if (tooFar) warnings.push(`${tooFar} item "Din 31" se aage the, wo din 31 par rakhe gaye`);
  const r = await applyPlanItems(items, startDate);
  return { ...r, warnings };
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
