// Phase 1: one command -> one finished reel.   npm run make -- "Overthinking"
import mongoose from 'mongoose';
import { config } from './config.js';
import { Reel, Topic, User, SEED_TOPICS } from './models.js';
import { runAs } from './context.js';
import { prepareReel, renderStage } from './services/pipeline.js';
import { startMediaServer } from './services/media.js';

await mongoose.connect(config.mongoUri);
// multi-user: the CLI makes the video for one account (CLI_USER=email in .env / shell, default = the admin)
const email = (process.env.CLI_USER || '').trim().toLowerCase();
const cliUser = await User.findOne(email ? { email } : { isAdmin: true }).select('name email isAdmin').lean();
if (!cliUser) { console.error('Koi user nahi mila. Pehle website par signup karo (pehla account admin banta hai).'); process.exit(1); }
console.log(`User: ${cliUser.email}`);
await runAs(cliUser, async () => {
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
globalThis.__cliOk = done.status === 'ready';
});
await mongoose.disconnect();
process.exit(globalThis.__cliOk ? 0 : 1);
