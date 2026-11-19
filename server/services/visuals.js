import { withKeys } from './keypool.js';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from '../config.js';

const API = 'https://api.pexels.com';
const cache = new Map();
const shuffle = (a) => a.map((x) => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map((x) => x[1]);
const exists = (f) => fs.access(f).then(() => true, () => false);
const visualsDir = () => path.join(config.paths.storage, 'visuals');

async function pexels(p) {
  return withKeys('pexels', 'stock:pexels', async (key) => {
    const r = await fetch(API + p, { headers: { Authorization: key } });
    if (!r.ok) throw Object.assign(new Error(`Pexels ${r.status}`), { status: r.status });
    return r.json();
  });
}

async function download(url, dest) {
  if (await exists(dest)) return;
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const r = await fetch(url);
  if (!r.ok || !r.body) throw new Error(`download ${r.status}`);
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(r.body), createWriteStream(tmp));
  await fs.rename(tmp, dest);
}

function bestVideoFile(v) {
  const files = (v.video_files || []).filter((f) => f.file_type === 'video/mp4' && f.height >= f.width && f.width >= 540);
  if (!files.length) return null;
  const ok = files.filter((f) => f.width <= 1100);
  return (ok.length ? ok : files).sort((a, b) => Math.abs(a.width - 1080) - Math.abs(b.width - 1080))[0];
}

/** Stock footage / photo from Pexels (free, no attribution needed). Returns { type, id, url } or null. */
async function findPexels(query, { minDur = 3, usedIds = new Set(), allowPhoto = true } = {}) {
  try {
    let key = `v:${query}`;
    let videos = cache.get(key);
    if (!videos) {
      const page = 1 + Math.floor(Math.random() * 2);
      videos = (await pexels(`/videos/search?query=${encodeURIComponent(query)}&orientation=portrait&size=medium&per_page=15&page=${page}`)).videos || [];
      cache.set(key, videos);
    }
    for (const v of shuffle(videos)) {
      const id = `v${v.id}`;
      if (usedIds.has(id) || v.duration < minDur) continue;
      const f = bestVideoFile(v);
      if (!f) continue;
      await download(f.link, path.join(visualsDir(), `${id}.mp4`));
      usedIds.add(id);
      return { type: 'video', id, url: `${config.baseUrl}/media/visuals/${id}.mp4`, duration: v.duration };
    }
    if (!allowPhoto) return null;
    key = `p:${query}`;
    let photos = cache.get(key);
    if (!photos) {
      photos = (await pexels(`/v1/search?query=${encodeURIComponent(query)}&orientation=portrait&per_page=15`)).photos || [];
      cache.set(key, photos);
    }
    for (const p of shuffle(photos)) {
      const id = `p${p.id}`;
      if (usedIds.has(id)) continue;
      await download(p.src.portrait, path.join(visualsDir(), `${id}.jpg`));
      usedIds.add(id);
      return { type: 'image', id, url: `${config.baseUrl}/media/visuals/${id}.jpg` };
    }
  } catch (e) {
    console.warn(`[visuals] "${query}" -> ${e.message}`);
  }
  return null;
}

/** Pixabay videos (free key, no attribution needed). Mostly landscape clips -> centre-cropped to vertical. */
async function findPixabay(query, { minDur = 3, usedIds = new Set() } = {}) {
  try {
    const key = `x:${query}`;
    let hits = cache.get(key);
    if (!hits) {
      hits = (await withKeys('pixabay', 'stock:pixabay', async (key) => {
        const r = await fetch(`https://pixabay.com/api/videos/?key=${key}&q=${encodeURIComponent(query.slice(0, 100))}&video_type=film&safesearch=true&per_page=30`);
        if (!r.ok) throw Object.assign(new Error(`Pixabay ${r.status}`), { status: r.status });
        return r.json();
      })).hits || [];
      cache.set(key, hits);
    }
    for (const h of shuffle(hits)) {
      const id = `x${h.id}`;
      if (usedIds.has(id) || h.duration < minDur) continue;
      const v = h.videos || {};
      const f = [v.medium, v.large, v.small].find((x) => x?.url && x.height >= 1000) || [v.medium, v.small, v.large].find((x) => x?.url);
      if (!f) continue;
      await download(f.url, path.join(visualsDir(), `${id}.mp4`));
      usedIds.add(id);
      return { type: 'video', id, url: `${config.baseUrl}/media/visuals/${id}.mp4`, duration: h.duration };
    }
  } catch (e) {
    console.warn(`[visuals] pixabay "${query}" -> ${e.message}`);
  }
  return null;
}

/** Tries Pexels (if key) then Pixabay (if key). */
export async function findStock(query, opts = {}) {
  if (!query) return null;
  if (config.pexels.key) {
    const r = await findPexels(query, opts);
    if (r) return r;
  }
  if (config.pixabay.key) return findPixabay(query, opts);
  return null;
}

/** Your own files: assets/images/*.jpg (Krishna art etc.) or assets/backgrounds/*.mp4 */
export async function findLocal(kind, usedIds = new Set()) {
  const dir = path.join(config.paths.assets, kind === 'image' ? 'images' : 'backgrounds');
  const exts = kind === 'image' ? ['.jpg', '.jpeg', '.png', '.webp'] : ['.mp4', '.mov', '.webm'];
  let files = [];
  try { files = (await fs.readdir(dir)).filter((f) => exts.some((e) => f.toLowerCase().endsWith(e))); } catch { /* none */ }
  const fresh = files.filter((f) => !usedIds.has(`l:${f}`));
  const pool = fresh.length ? fresh : files;
  if (!pool.length) return null;
  const f = pool[Math.floor(Math.random() * pool.length)];
  usedIds.add(`l:${f}`);
  return { type: kind === 'image' ? 'image' : 'video', id: `l:${f}`, url: `${config.baseUrl}/assets/${kind === 'image' ? 'images' : 'backgrounds'}/${encodeURIComponent(f)}`, duration: 999 };
}
