import { config } from '../config.js';
import { Reel } from '../models.js';
import { prepareReel, renderStage } from './pipeline.js';
import { isTimeout } from './control.js';

// ONE video at a time (script -> voice -> images -> music -> render), then the next one in line.
// A running video can be paused (it keeps everything it already made) and resumed later from the same step.
const waiting = []; // [{ id, stage: 'prep' | 'render' }]
let current = null; // { id, ctl }

export const queueLength = () => waiting.length + (current ? 1 : 0);
export const queueState = () => ({ running: current ? current.id : null, waiting: waiting.map((j) => j.id) });

function add(job, front = false) {
  const i = waiting.findIndex((j) => j.id === job.id);
  if (i >= 0) waiting.splice(i, 1);
  if (front) waiting.unshift(job); else waiting.push(job);
  pump();
}
export const enqueue = (id) => add({ id: String(id), stage: 'prep' });
export const enqueueRender = (id) => add({ id: String(id), stage: 'render' });

async function pump() {
  if (current || !waiting.length) return;
  const job = waiting.shift();
  const ctl = new AbortController();
  current = { id: job.id, ctl };
  const reel = await Reel.findById(job.id).select('format');
  const mins = reel?.format === 'long' ? config.queue.jobMinutesLong : config.queue.jobMinutes;
  const timer = setTimeout(() => ctl.abort(new Error('timeout')), mins * 60e3);
  const run = (async () => {
    if (job.stage === 'render') await renderStage(job.id, { signal: ctl.signal });
    else if (await prepareReel(job.id, { signal: ctl.signal })) await renderStage(job.id, { signal: ctl.signal });
  })().catch((e) => console.error(e));
  // a hung step (e.g. a crashed browser) must not block the line forever
  const forced = new Promise((res) => ctl.signal.addEventListener('abort', () => { if (isTimeout(ctl.signal)) setTimeout(res, 30000); }));
  await Promise.race([run, forced]);
  clearTimeout(timer);
  if (isTimeout(ctl.signal)) await Reel.updateOne({ _id: job.id, status: { $in: ['scripting', 'voice', 'visuals', 'render_wait', 'rendering'] } }, { status: 'failed', error: `Timeout: ${mins} min mein poori nahi hui` });
  current = null;
  pump();
}

/** stop a video. Running -> stops after its current small step; waiting -> leaves the line. Progress is kept. */
export async function pauseReel(id) {
  id = String(id);
  if (current?.id === id) { current.ctl.abort(new Error('paused')); return 'stopping'; }
  const i = waiting.findIndex((j) => j.id === id);
  if (i >= 0) {
    const [job] = waiting.splice(i, 1);
    await Reel.updateOne({ _id: id }, { status: 'paused', pausedStage: job.stage === 'render' ? 'render_wait' : 'queued' });
    return 'paused';
  }
  return null;
}

/** continue a paused video (it goes to the front of the line). now=true also pauses the video that is running. */
export async function resumeReel(id, { now = false } = {}) {
  id = String(id);
  const reel = await Reel.findById(id).select('status project pausedStage');
  if (!reel) return null;
  let job = waiting.find((j) => j.id === id);
  if (reel.status === 'paused') {
    const stage = reel.project && reel.pausedStage === 'render_wait' ? 'render' : 'prep';
    await Reel.updateOne({ _id: id }, { status: stage === 'render' ? 'render_wait' : 'queued', error: null });
    job = { id, stage };
  } else if (!job) return null;
  add(job, true);
  if (now && current && current.id !== id) await pauseReel(current.id);
  return { stage: job.stage };
}

/** after a restart: continue whatever was in flight (it resumes from its saved steps, not from zero) */
export async function recoverQueue() {
  const prep = await Reel.find({ status: { $in: ['queued', 'scripting', 'voice', 'visuals'] } }).sort({ createdAt: 1 });
  const rend = await Reel.find({ status: { $in: ['render_wait', 'rendering'] }, project: { $ne: null } }).sort({ createdAt: 1 });
  const lost = await Reel.find({ status: { $in: ['render_wait', 'rendering'] }, project: null });
  for (const r of lost) { await Reel.updateOne({ _id: r._id }, { status: 'queued' }); prep.push(r); }
  rend.forEach((r) => enqueueRender(r._id));
  prep.forEach((r) => enqueue(r._id));
  return prep.length + rend.length;
}
