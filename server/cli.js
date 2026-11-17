// Phase 1: one command -> one finished reel.   npm run make -- "Overthinking"
import mongoose from 'mongoose';
import { config } from './config.js';
import { Reel, Topic, SEED_TOPICS } from './models.js';
import { prepareReel, renderStage } from './services/pipeline.js';
import { startMediaServer } from './services/media.js';

await mongoose.connect(config.mongoUri);
const media = await startMediaServer();
let topic = process.argv.slice(2).join(' ').trim();
if (!topic) {
  const unused = (await Topic.find({ used: false })).map((t) => t.text);
  const pool = unused.length ? unused : SEED_TOPICS;
  topic = pool[Math.floor(Math.random() * pool.length)];
  await Topic.updateOne({ text: topic }, { used: true });
}
console.log(`Topic: ${topic}`);
const reel = await Reel.create({ topic });
if (await prepareReel(reel._id)) await renderStage(reel._id);
const done = await Reel.findById(reel._id);
console.log(done.status === 'ready' ? `\nDONE -> storage/videos/${done.videoFile}` : `\nFAILED: ${done.error}`);
media?.close();
await mongoose.disconnect();
process.exit(done.status === 'ready' ? 0 : 1);
