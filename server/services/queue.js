import { config } from '../config.js';
import { Reel } from '../models.js';
import { prepareReel, renderStage } from './pipeline.js';

// Two stages so bulk jobs overlap: while one reel renders (CPU), the next ones are already
// getting script/voice/images (network).
const prepQ = [];
const renderQ = [];
let prepActive = 0;
let renderActive = 0;

export const queueLength = () => prepQ.length + renderQ.length + prepActive + renderActive;

export function enqueue(id) {
  prepQ.push(String(id));
  pumpPrep();
}
export function enqueueRender(id) {
  renderQ.push(String(id));
  pumpRender();
}

function pumpPrep() {
  while (prepActive < config.queue.prep && prepQ.length) {
    const id = prepQ.shift();
    prepActive++;
    prepareReel(id)
      .then((ok) => ok && enqueueRender(id))
      .catch((e) => console.error(e))
      .finally(() => { prepActive--; pumpPrep(); });
  }
}
function pumpRender() {
  if (renderActive >= 1 || !renderQ.length) return;
  const id = renderQ.shift();
  renderActive++;
  renderStage(id)
    .catch((e) => console.error(e))
    .finally(() => { renderActive--; pumpRender(); });
}

/** after a restart: continue whatever was in flight */
export async function recoverQueue() {
  const prep = await Reel.find({ status: { $in: ['queued', 'scripting', 'voice', 'visuals'] } });
  const rend = await Reel.find({ status: { $in: ['render_wait', 'rendering'] }, project: { $ne: null } });
  const lost = await Reel.find({ status: { $in: ['render_wait', 'rendering'] }, project: null });
  for (const r of lost) await Reel.updateOne({ _id: r._id }, { status: 'queued' }), prep.push(r);
  prep.forEach((r) => enqueue(r._id));
  rend.forEach((r) => enqueueRender(r._id));
  return prep.length + rend.length;
}
