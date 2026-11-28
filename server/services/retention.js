import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import { config } from '../config.js';
import { Reel } from '../models.js';
import { getSettings } from './settings.js';
import { cleanupAssets } from './pipeline.js';
import { currentUserId } from '../context.js';

const rm = (p) => fs.rm(p, { recursive: true, force: true });
const FINISHED = ['published', 'rejected', 'failed'];

/** Delete EVERYTHING heavy of one reel: images, audio, stock clips, editor project and the mp4. The record (topic, script, post links) stays for the calendar. */
export async function purgeReelFiles(reel) {
  await cleanupAssets(reel);
  await rm(path.join(config.paths.storage, 'videos', `${reel._id}.mp4`));
  await Reel.updateOne({ _id: reel._id }, { videoFile: null, project: null, purgedAt: new Date() });
}

/**
 * Storage keeper (runs every few minutes):
 *  - published / rejected / failed reels: all files are deleted KEEP_HOURS (24h) after generation
 *  - approved / ready but still NOT posted: kept longer (KEEP_MAX_HOURS, 72h) so a video is never lost before it goes out
 *  - leftovers of deleted reels (orphan folders) older than that are removed too
 */
export async function purgeExpired({ orphans: sweepOrphans = false } = {}) {
  const st = await getSettings(); // the current user's own "keep hours"
  const hours = Number(st.keepHours) > 0 ? Number(st.keepHours) : config.retention.hours;
  const maxHours = Math.max(config.retention.maxHours, hours);
  const done = new Date(Date.now() - hours * 3600e3);
  const stale = new Date(Date.now() - maxHours * 3600e3);
  const older = (d) => ({ $or: [{ genAt: { $lt: d } }, { genAt: null, createdAt: { $lt: d } }] });

  const list = await Reel.find({
    purgedAt: null,
    'publish.busy': { $ne: true },
    $or: [{ status: { $in: FINISHED }, ...older(done) }, { status: { $in: ['ready', 'approved'] }, ...older(stale) }],
  });
  for (const r of list) await purgeReelFiles(r);
  if (!sweepOrphans) return { reels: list.length, orphans: 0 };
  return { reels: list.length, orphans: await purgeOrphans() };
}

/** Orphans = folders/files whose reel no longer exists. Must run as SYSTEM (all users' reels visible), never inside one user's context,
 *  otherwise another user's videos would look like "orphans". */
export async function purgeOrphans() {
  if (currentUserId()) return 0; // safety: never inside a user's context
  const maxHours = config.retention.maxHours;
  const stale = new Date(Date.now() - maxHours * 3600e3);
  let orphans = 0;
  for (const dir of ['videos', 'audio', 'gen']) {
    const base = path.join(config.paths.storage, dir);
    let names = [];
    try { names = await fs.readdir(base); } catch { continue; }
    const old = [];
    for (const n of names) {
      const id = n.replace(/\.mp4$/, '');
      if (!mongoose.isValidObjectId(id)) continue;
      try { if ((await fs.stat(path.join(base, n))).mtime < stale) old.push([n, id]); } catch { /* gone */ }
    }
    if (!old.length) continue;
    const alive = new Set((await Reel.find({ _id: { $in: old.map(([, id]) => id) }, purgedAt: null }).select('_id').setOptions({ allUsers: true }).lean()).map((r) => String(r._id)));
    for (const [n, id] of old) if (!alive.has(id)) { await rm(path.join(base, n)); orphans++; }
  }
  if (orphans) console.log(`[storage] removed ${orphans} orphan item(s)`);
  return orphans;
}
