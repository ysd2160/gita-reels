import fs from 'node:fs/promises';
import { config } from '../config.js';
import { getSecret, setSecret } from '../services/settings.js';

const SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
export const youtubeConfigured = () => !!(config.youtube.clientId && config.youtube.clientSecret);
export const youtubeConnected = async () => !!(await getSecret('youtube_refresh'));

export function youtubeAuthUrl(redirectUri) {
  return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id: config.youtube.clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent',
  })}`;
}

export async function youtubeExchange(code, redirectUri) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: config.youtube.clientId, client_secret: config.youtube.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
  });
  const j = await r.json();
  if (!r.ok || !j.refresh_token) throw new Error(`YouTube auth failed: ${j.error_description || j.error || 'no refresh token (try again, prompt=consent)'}`);
  await setSecret('youtube_refresh', j.refresh_token);
}

async function accessToken() {
  const refresh = await getSecret('youtube_refresh');
  if (!refresh) throw new Error('YouTube connect nahi hai (Settings -> Connect YouTube)');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.youtube.clientId, client_secret: config.youtube.clientSecret, refresh_token: refresh, grant_type: 'refresh_token' }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`YouTube token refresh failed: ${j.error_description || j.error}`);
  return j.access_token;
}

/** Resumable upload. publishAt (Date) => scheduled by YouTube itself (video stays private until then). */
export async function uploadYoutube({ file, title, description, tags = [], privacy = 'public', publishAt = null }) {
  const token = await accessToken();
  const buf = await fs.readFile(file);
  const future = publishAt && publishAt.getTime() > Date.now() + 5 * 60 * 1000;
  const status = { privacyStatus: future ? 'private' : privacy, selfDeclaredMadeForKids: false };
  if (future) status.publishAt = publishAt.toISOString();
  const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(buf.length), 'X-Upload-Content-Type': 'video/mp4',
    },
    body: JSON.stringify({ snippet: { title: title.slice(0, 100), description: description.slice(0, 4900), tags: tags.slice(0, 15), categoryId: '22' }, status }),
  });
  if (!init.ok) throw new Error(`YouTube init ${init.status}: ${(await init.text()).slice(0, 300)}`);
  const loc = init.headers.get('location');
  if (!loc) throw new Error('YouTube: upload URL missing');
  const up = await fetch(loc, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(buf.length) }, body: buf });
  const j = await up.json().catch(() => ({}));
  if (!up.ok || !j.id) throw new Error(`YouTube upload ${up.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return { id: j.id, url: `https://youtu.be/${j.id}`, scheduled: !!future };
}
