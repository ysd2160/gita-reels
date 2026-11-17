import cron from 'node-cron';
import mongoose from 'mongoose';
import { config } from './config.js';
import { Reel } from './models.js';
import { recoverQueue } from './services/queue.js';
import { seedTopics } from './services/batch.js';
import { ensurePlan, prepareToday, prewriteScripts, tick, todayIST } from './services/planner.js';
import { approveReel } from './services/reelActions.js';
import { publishDue } from './services/publisher.js';
import { getSettings } from './services/settings.js';
import { setVoiceOverrides } from './services/tts.js';
import { createApp } from './app.js';

async function main() {
  await mongoose.connect(config.mongoUri);
  console.log('MongoDB connected');
  await seedTopics();
  setVoiceOverrides(await getSettings());
  const resumed = await recoverQueue();
  if (resumed) console.log(`Resumed ${resumed} unfinished video(s)`);
  await Reel.updateMany({ 'publish.busy': true }, { $unset: { 'publish.busy': 1 } });

  prepareToday().catch((e) => console.warn('[plan]', e.message));
  // every minute: daily generation window, plan status, auto-approve, auto-publish
  cron.schedule('* * * * *', async () => {
    try { await tick(approveReel); await publishDue(); } catch (e) { console.error('[tick]', e); }
  }, { timezone: 'Asia/Kolkata' });
  cron.schedule('10 0 * * *', () => ensurePlan().catch(() => {}), { timezone: 'Asia/Kolkata' });
  // 00:15 IST: today's scripts are written in advance, so the Home page shows topic + script and you can change them before generation
  cron.schedule('15 0 * * *', async () => { try { if ((await getSettings()).prewriteScripts) await prewriteScripts(todayIST()); } catch (e) { console.warn('[prewrite]', e.message); } }, { timezone: 'Asia/Kolkata' });

  createApp().listen(config.port, config.host, () => console.log(`Dashboard -> http://${config.host}:${config.port}`));
}
main().catch((e) => { console.error(e); process.exit(1); });
