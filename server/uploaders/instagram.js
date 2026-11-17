import fs from 'node:fs/promises';
import { config } from '../config.js';

const GV = process.env.IG_GRAPH_VERSION || 'v25.0';
const HOST = process.env.IG_GRAPH_HOST || 'graph.facebook.com'; // graph.instagram.com if your token is an Instagram-Login token
export const instagramConfigured = () => !!(config.instagram.userId && config.instagram.token);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Reels via resumable upload straight from disk (no public URL needed). */
export async function uploadInstagramReel({ file, caption }) {
  const { userId, token } = config.instagram;
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const c = await fetch(`https://${HOST}/${GV}/${userId}/media`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ media_type: 'REELS', upload_type: 'resumable', caption: caption.slice(0, 2200), share_to_feed: true }),
  });
  const cj = await c.json();
  if (!c.ok || !cj.id) throw new Error(`Instagram container ${c.status}: ${JSON.stringify(cj).slice(0, 300)}`);

  const buf = await fs.readFile(file);
  const up = await fetch(cj.uri || `https://rupload.facebook.com/ig-api-upload/${GV}/${cj.id}`, {
    method: 'POST', headers: { Authorization: `OAuth ${token}`, offset: '0', file_size: String(buf.length) }, body: buf,
  });
  if (!up.ok) throw new Error(`Instagram upload ${up.status}: ${(await up.text()).slice(0, 300)}`);

  let code = '';
  for (let i = 0; i < 60; i++) { // up to ~5 min
    await sleep(5000);
    const s = await (await fetch(`https://${HOST}/${GV}/${cj.id}?fields=status_code,status`, { headers: { Authorization: `Bearer ${token}` } })).json();
    code = s.status_code;
    if (code === 'FINISHED') break;
    if (code === 'ERROR' || code === 'EXPIRED') throw new Error(`Instagram processing ${code}: ${s.status || ''}`);
  }
  if (code !== 'FINISHED') throw new Error('Instagram processing timeout');

  const p = await fetch(`https://${HOST}/${GV}/${userId}/media_publish`, { method: 'POST', headers: auth, body: JSON.stringify({ creation_id: cj.id }) });
  const pj = await p.json();
  if (!p.ok || !pj.id) throw new Error(`Instagram publish ${p.status}: ${JSON.stringify(pj).slice(0, 300)}`);
  let url = '';
  try { url = (await (await fetch(`https://${HOST}/${GV}/${pj.id}?fields=permalink`, { headers: { Authorization: `Bearer ${token}` } })).json()).permalink || ''; } catch { /* optional */ }
  return { id: pj.id, url };
}
