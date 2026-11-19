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

/**
 * Where does this video go, and what happened? One entry per platform:
 * state = done | uploading | pending | waiting | error | off | na   (na = this video never goes there)
 * Shorts go to YouTube AND Instagram; the long video goes to YouTube only.
 */
export function platformStatus(reel, st, integ) {
  const pub = reel.publish || {};
  const one = (name, label) => {
    const p = pub[name];
    if (name === 'instagram' && reel.format === 'long') return { name, label, state: 'na', text: 'Long video sirf YouTube par jaati hai' };
    if (p?.state === 'done') return { name, label, state: 'done', url: p.url || '', at: p.at, text: p.scheduled ? 'YouTube par schedule ho gayi, time par public hogi' : 'Upload ho gayi' };
    if (p?.state === 'error') {
      const retry = st.autoPublish && (p.tries || 0) < 5 ? '10 min baad khud dobara try hoga' : '"Dobara upload karo" dabao';
      return { name, label, state: 'error', error: p.error || '', tries: p.tries || 1, at: p.at, text: `Upload fail (${p.tries || 1} baar). ${retry}` };
    }
    const enabled = name === 'youtube' ? st.youtube : st.instagram;
    const i = integ[name] || {};
    if (!enabled) return { name, label, state: 'off', text: 'Settings mein band hai' };
    if (!i.configured) return { name, label, state: 'off', text: name === 'youtube' ? 'YouTube keys .env mein nahi hain' : 'Instagram token .env mein nahi hai' };
    if (name === 'youtube' && !i.connected) return { name, label, state: 'off', text: 'YouTube connect nahi hua (Settings -> YouTube connect)' };
    if (pub.busy) return { name, label, state: 'uploading', text: 'Upload ho rahi hai...' };
    if (reel.status === 'approved') return { name, label, state: 'pending', text: st.autoPublish ? 'Time par khud upload hogi' : 'Auto-post band hai, "Abhi post karo" dabao' };
    if (reel.status === 'ready') return { name, label, state: 'waiting', text: 'Approve karoge tab upload hogi' };
    return { name, label, state: 'waiting', text: 'Video abhi ban rahi hai' };
  };
  return { youtube: one('youtube', 'YouTube'), instagram: one('instagram', 'Instagram') };
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
