// Publish times live in three places: Settings (the template), every planned day (Plan items) and every video that is
// already made (reel.scheduledFor). When the times in Settings change, everything that is not uploaded yet moves too.

/** "7:30" / "07.30" -> "07:30", anything else -> null */
export function fixTime(v) {
  const m = /^\s*(\d{1,2})\s*[:.]\s*(\d{2})\s*$/.exec(String(v ?? ''));
  return m && +m[1] < 24 && +m[2] < 60 ? `${String(+m[1]).padStart(2, '0')}:${m[2]}` : null;
}
/** "7:30, 13:00 20:30" (or an array) -> ["07:30","13:00","20:30"], null if any time is invalid */
export function normalizeSlots(v) {
  const arr = (Array.isArray(v) ? v : String(v ?? '').split(/[,;\s]+/)).filter(Boolean);
  const fixed = arr.map(fixTime);
  return fixed.length && !fixed.includes(null) ? fixed : null;
}

export const planTime = (item, st) => (item.kind === 'long' ? st.longSlot : st.shortSlots[item.slot] || st.shortSlots.at(-1) || '12:00');
const uploaded = (r) => r.status === 'published' || r.publish?.youtube?.state === 'done' || r.publish?.instagram?.state === 'done';

/**
 * items: upcoming Plan items, reelByPlan: Map(planId -> reel). Returns what has to change:
 * plans (new publishTime), reels (new scheduledFor) and `locked` = videos already uploaded / scheduled on a platform (cannot be moved here).
 */
export function computeRetimes(items, reelByPlan, st, { now = Date.now(), toDate }) {
  const plans = [], reels = [];
  let locked = 0;
  for (const it of items) {
    const time = planTime(it, st);
    const r = reelByPlan.get(String(it._id));
    if (r && uploaded(r)) { locked++; continue; }
    if (it.publishTime !== time) plans.push({ id: it._id, time });
    if (r) {
      const when = toDate(it.date, time);
      const target = when.getTime() > now ? when : new Date(now); // a time that has passed = goes out as soon as the video is ready
      const old = r.scheduledFor ? +new Date(r.scheduledFor) : 0;
      if ((when.getTime() > now || old > now) && Math.abs(old - target.getTime()) > 60000) reels.push({ id: r._id, scheduledFor: target });
    }
  }
  return { plans, reels, locked };
}
