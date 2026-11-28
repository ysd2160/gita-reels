import fs from 'node:fs/promises';
import { config } from '../config.js';
import { isAdminCtx } from '../context.js';
import { deleteSecret, getSecret, setSecret } from '../services/settings.js';

const GV = process.env.IG_GRAPH_VERSION || 'v25.0';
const HOST = process.env.IG_GRAPH_HOST || 'graph.facebook.com'; // graph.instagram.com if your token is an Instagram-Login token

/** This user's Instagram account: saved in Settings (per user). The admin of an old single-user install falls back to IG_USER_ID / IG_ACCESS_TOKEN from .env. */
export async function instagramCreds() {
  const own = await getSecret('instagram');
  if (own?.userId && own?.token) return own;
  if (isAdminCtx() && config.instagram.userId && config.instagram.token) return { userId: config.instagram.userId, token: config.instagram.token, username: '' };
  return null;
}
export const instagramConfigured = async () => !!(await instagramCreds());

/** Settings -> Instagram connect: check the token really works for this account id, then save it (encrypted). */
export async function instagramConnect({ userId, token }) {
  userId = String(userId || '').trim(); token = String(token || '').trim();
  if (!/^\d{5,25}$/.test(userId)) throw new Error('Instagram User ID sirf numbers hota hai (jaise 17841400000000000)');
  if (token.length < 20) throw new Error('Access token chhota/galat lag raha hai');
  const r = await fetch(`https://${HOST}/${GV}/${userId}?fields=username`, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`Instagram ne token reject kiya: ${String(j.error?.message || r.status).slice(0, 200)}`);
  await setSecret('instagram', { userId, token, username: j.username || '', savedAt: new Date().toISOString() });
  return { username: j.username || '' };
}
export const instagramDisconnect = () => deleteSecret('instagram');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Reels via resumable upload straight from disk (no public URL needed). */
export async function uploadInstagramReel({ file, caption }) {
  const creds = await instagramCreds();
  if (!creds) throw new Error('Instagram connect nahi hai (Settings -> Instagram)');
  const { userId, token } = creds;
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
