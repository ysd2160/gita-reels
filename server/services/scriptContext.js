// What was made recently (hooks, shlokas, formats), so every new script is different from it.
import { Plan, Reel } from '../models.js';
import { getSettings } from './settings.js';
import { MAX_SEC, MIN_SEC, formatById, pickFormat, randomTargetSec } from '../formats.js';
import { generateScript } from './scriptwriter.js';
import { scriptFromText } from './gemini.js';

/** newest first. Includes scripts already written for upcoming days (so one week never repeats itself). */
export async function recentContext({ excludePlanId = null, kind = 'short' } = {}) {
  const reels = await Reel.find({ format: kind, script: { $ne: null } }).sort({ createdAt: -1 }).limit(60).select('script createdAt').lean();
  const plans = (await Plan.find({ kind, script: { $ne: null }, status: 'planned' }).sort({ date: -1, slot: -1 }).limit(40).select('script').lean())
    .filter((p) => String(p._id) !== String(excludePlanId));
  const all = [...plans, ...reels].map((x) => x.script).filter(Boolean);
  return {
    recentHooks: all.map((s) => s.hookText || s.title).filter(Boolean),
    recentVerseIds: all.map((s) => s.verseId || s.groundingId).filter(Boolean),
    recentFormats: all.map((s) => s.formatId || (s.verseId ? 'classic' : null)).filter(Boolean),
    recentPillars: all.map((s) => s.pillar).filter(Boolean),
    recentHookStyles: all.map((s) => s.hookStyle).filter(Boolean),
  };
}

/** target length (seconds) from Settings: 'auto' = random 28-40 s */
export async function resolveTargetSec(wanted) {
  if (Number(wanted) >= MIN_SEC) return Math.min(MAX_SEC, Number(wanted));
  const st = await getSettings();
  return Number(st.reelLength) >= MIN_SEC ? Math.min(MAX_SEC, Number(st.reelLength)) : randomTargetSec();
}

/** One call that writes a short script for a topic with all the context (format, length, no repeats) */
export async function writeShortScript({ topic, formatId, targetSec, notes, excludePlanId, pillar }) {
  const st = await getSettings();
  const ctx = await recentContext({ excludePlanId });
  const fmt = formatById(formatId) || formatById(pickFormat({ recent: ctx.recentFormats, shlokPercent: st.shlokPercent }));
  return generateScript(topic, { ...ctx, formatId: fmt.id, targetSec: await resolveTargetSec(targetSec), notes, pillar, shlokPercent: st.shlokPercent });
}

/** script text pasted by the creator / found inside an imported plan: kept word for word */
export async function structureOwnScript({ text, topic }) {
  return scriptFromText(text, topic, 'short');
}
