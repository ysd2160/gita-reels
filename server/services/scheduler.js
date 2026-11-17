import { config } from '../config.js';
import { Reel } from '../models.js';

const IST = 5.5 * 3600 * 1000; // India has no DST
const toMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const windows = () =>
  config.windows.split(',').map((w) => {
    const [a, b] = w.trim().split('-');
    return { s: toMin(a), e: toMin(b) };
  });

/** Next free posting slot (random minute inside the next unused window), returned as a Date. */
export async function nextSlot() {
  const now = Date.now();
  const earliest = now + 60 * 60 * 1000;
  const taken = (await Reel.find({ scheduledFor: { $gte: new Date(now) } }).select('scheduledFor'))
    .map((r) => r.scheduledFor.getTime());
  const nowIst = new Date(now + IST);
  for (let day = 0; day < 60; day++) {
    const base = Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate() + day);
    for (const w of windows()) {
      const start = base + w.s * 60000 - IST;
      const end = base + w.e * 60000 - IST;
      if (end <= earliest) continue;
      if (taken.some((t) => t >= start && t <= end)) continue;
      const from = Math.max(start, earliest);
      return new Date(from + Math.floor(Math.random() * (end - from)));
    }
  }
  return null;
}
