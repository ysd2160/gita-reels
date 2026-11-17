import path from 'node:path';
import { config } from '../config.js';
import { Reel } from '../models.js';
import { getSettings } from './settings.js';
import { instagramConfigured, uploadInstagramReel } from '../uploaders/instagram.js';
import { uploadYoutube, youtubeConfigured, youtubeConnected } from '../uploaders/youtube.js';

const stamp = (s) => { const m = Math.floor(s / 60); return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };

export function youtubeText(reel) {
  const sc = reel.script || {};
  const tags = (sc.hashtags || []).join(' ');
  if (reel.format === 'long') {
    const ch = (reel.chapters || []).filter((c) => c.at >= 0);
    const chapterText = ch.length >= 2 ? `\n\n${['0:00 Intro', ...ch.map((c) => `${stamp(Math.max(c.at, 10))} ${c.title}`)].join('\n')}` : '';
    return { title: sc.title || reel.topic, description: `${sc.caption || ''}${chapterText}\n\n${tags}`, tags: tags.split(/\s+/).map((t) => t.replace('#', '')).filter(Boolean) };
  }
  return { title: `${sc.hookText || reel.topic} #Shorts`, description: `${sc.caption || ''}\n\n${tags} #Shorts`, tags: tags.split(/\s+/).map((t) => t.replace('#', '')).filter(Boolean) };
}

export async function integrationStatus() {
  return {
    youtube: { configured: youtubeConfigured(), connected: await youtubeConnected() },
    instagram: { configured: instagramConfigured() },
  };
}

/** Upload one reel to every enabled + configured platform. Returns the new publish state. */
export async function publishReel(id, { now = false } = {}) {
  const reel = await Reel.findById(id);
  if (!reel?.videoFile) throw new Error('video ready nahi hai');
  const st = await getSettings();
  const file = path.join(config.paths.storage, 'videos', reel.videoFile);
  const state = { ...(reel.publish || {}) };
  const when = now ? null : reel.scheduledFor;
  const jobs = [];
  if (st.youtube && youtubeConfigured() && (await youtubeConnected()) && state.youtube?.state !== 'done') {
    jobs.push(['youtube', async () => uploadYoutube({ file, ...youtubeText(reel), privacy: st.youtubePrivacy, publishAt: when ? new Date(when) : null })]);
  }
  if (reel.format === 'short' && st.instagram && instagramConfigured() && state.instagram?.state !== 'done') {
    const sc = reel.script || {};
    jobs.push(['instagram', async () => uploadInstagramReel({ file, caption: `${sc.caption || ''}\n\n${(sc.hashtags || []).slice(0, 25).join(' ')}` })]);
  }
  if (!jobs.length && !Object.keys(state).length) throw new Error('Koi platform connected/enabled nahi hai (Settings dekho)');
  await Reel.updateOne({ _id: id }, { publish: { ...state, busy: true } });
  for (const [name, fn] of jobs) {
    try {
      const r = await fn();
      state[name] = { state: 'done', id: r.id, url: r.url, scheduled: !!r.scheduled, at: new Date() };
    } catch (e) {
      state[name] = { state: 'error', error: String(e.message).slice(0, 300), tries: (state[name]?.tries || 0) + 1, at: new Date() };
    }
  }
  delete state.busy;
  const enabled = ['youtube', 'instagram'].filter((n) => state[n]);
  const all = enabled.length && enabled.every((n) => state[n].state === 'done');
  await Reel.updateOne({ _id: id }, { publish: state, ...(all ? { status: 'published' } : {}) });
  return state;
}

/** called every minute */
export async function publishDue() {
  const st = await getSettings();
  if (!st.autoPublish) return;
  const due = await Reel.find({ status: 'approved', scheduledFor: { $lte: new Date() }, 'publish.busy': { $ne: true } }).limit(3);
  for (const r of due) {
    const tries = Math.max(r.publish?.youtube?.tries || 0, r.publish?.instagram?.tries || 0, r.publish?.fails || 0);
    if (tries >= 5) continue;
    // wait 10 min between attempts (a temporary Google/Meta error should not burn all tries in 3 minutes)
    const lastTry = Math.max(...['youtube', 'instagram'].map((p) => (r.publish?.[p]?.state === 'error' && r.publish[p].at ? +new Date(r.publish[p].at) : 0)), 0);
    if (lastTry && Date.now() - lastTry < 10 * 60 * 1000) continue;
    try { await publishReel(r._id); } catch (e) { console.error('[publish]', e.message); await Reel.updateOne({ _id: r._id }, { publish: { ...(r.publish || {}), error: e.message, fails: (r.publish?.fails || 0) + 1 } }); }
  }
}
