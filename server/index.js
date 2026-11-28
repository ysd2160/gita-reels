import cron from 'node-cron';
import mongoose from 'mongoose';
import { config } from './config.js';
import { Reel, User, claimLegacyData, migrateIndexes } from './models.js';
import { runAs } from './context.js';
import { recoverQueue } from './services/queue.js';
import { seedTopics } from './services/batch.js';
import { ensurePlan, prepareToday, prewriteScripts, tick, todayIST } from './services/planner.js';
import { approveReel } from './services/reelActions.js';
import { publishDue } from './services/publisher.js';
import { getSettings } from './services/settings.js';
import { purgeOrphans } from './services/retention.js';
import { createApp } from './app.js';

// a crashing child process (Chrome / ffmpeg pipe: "write EOF") must not take the whole dashboard down
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException', (e) => {
  console.error('[uncaughtException]', e);
  if (!['EOF', 'EPIPE', 'ECONNRESET', 'ERR_STREAM_DESTROYED'].includes(e?.code)) process.exit(1);
});

/** run something once for every active user, each inside their own context (own settings, plan, tokens). One user failing never stops the others. */
async function eachUser(label, fn) {
  const users = await User.find({ disabled: { $ne: true } }).select('name email isAdmin').lean();
  for (const u of users) {
    try { await runAs(u, () => fn(u)); } catch (e) { console.error(`[${label}] ${u.email}:`, e.message); }
  }
}

async function main() {
  await mongoose.connect(config.mongoUri);
  console.log('MongoDB connected');
  await migrateIndexes();
  // old single-user data -> admin (does nothing when there is nothing to claim or no admin yet; the first signup claims it)
  const admin = await User.findOne({ isAdmin: true }).select('_id').lean();
  if (admin) { try { await claimLegacyData(admin._id); } catch (e) { console.warn('[migrate]', e.message); } }
  const userCount = await User.countDocuments();
  console.log(userCount ? `${userCount} user account(s)` : 'No user yet: open the site and sign up, the FIRST account becomes the admin');
  await eachUser('seed', () => seedTopics());
  const resumed = await recoverQueue();
  if (resumed) console.log(`Resumed ${resumed} unfinished video(s)`);
  await Reel.updateMany({ 'publish.busy': true }, { $unset: { 'publish.busy': 1 } }).setOptions({ allUsers: true });

  // users with daily automation on get their plan ready at startup (others get it when they open the Plan page)
  eachUser('plan', async () => { if ((await getSettings()).automation) await prepareToday(); }).catch((e) => console.warn('[plan]', e.message));
  // every minute: daily generation window, plan status, auto-approve, auto-publish - for every user
  let ticking = false;
  cron.schedule('* * * * *', async () => {
    if (ticking) return; // a slow minute must not overlap the next one
    ticking = true;
    try { await eachUser('tick', async () => { await tick(approveReel); await publishDue(); }); } catch (e) { console.error('[tick]', e); } finally { ticking = false; }
  }, { timezone: 'Asia/Kolkata' });
  cron.schedule('10 0 * * *', () => eachUser('plan', async () => { if ((await getSettings()).automation) await ensurePlan(); }).catch(() => {}), { timezone: 'Asia/Kolkata' });
  // 00:15 IST: today's scripts are written in advance, so the Home page shows topic + script and you can change them before generation
  cron.schedule('15 0 * * *', () => eachUser('prewrite', async () => { const st = await getSettings(); if (st.automation && st.prewriteScripts) await prewriteScripts(todayIST()); }).catch((e) => console.warn('[prewrite]', e.message)), { timezone: 'Asia/Kolkata' });
  // leftovers of deleted videos: swept once for everybody (system context)
  cron.schedule('*/10 * * * *', () => runAs(null, () => purgeOrphans()).catch((e) => console.warn('[storage]', e.message)));

  createApp().listen(config.port, config.host, () => console.log(`Dashboard -> http://${config.host}:${config.port}`));
}
main().catch((e) => { console.error(e); process.exit(1); });
