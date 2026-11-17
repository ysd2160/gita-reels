import { config } from '../config.js';
import { Reel } from '../models.js';
import { cleanupAssets } from './pipeline.js';

/** approve = final. With CLEAN_MODE=approve the temp audio/images are deleted now (editing is no longer possible). */
export async function approveReel(id) {
  const reel = await Reel.findOneAndUpdate({ _id: id, status: { $in: ['ready', 'rejected'] } }, { status: 'approved' }, { new: true });
  if (reel && config.cleanup === 'approve') await cleanupAssets(reel);
  return reel;
}
