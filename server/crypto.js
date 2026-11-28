import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from './config.js';

// One server secret: env SESSION_SECRET, else a random one created on first start in storage/.session_secret (chmod 600, git-ignored).
// It signs login cookies and encrypts the social-media tokens stored in MongoDB, so a leaked DB dump alone is not enough to post on someone's channel.
let secret = config.auth.secret;
if (!secret) {
  const file = path.join(ROOT, 'storage', '.session_secret');
  try { secret = fs.readFileSync(file, 'utf8').trim(); } catch { /* first start */ }
  if (!secret) {
    secret = crypto.randomBytes(48).toString('hex');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, secret, { mode: 0o600 });
    console.log('[auth] created storage/.session_secret (keep this file when you move the server, or everybody has to log in + reconnect again)');
  }
}
const key = crypto.createHash('sha256').update(`enc:${secret}`).digest();

export const hmac = (data) => crypto.createHmac('sha256', secret).update(data).digest('base64url');
export const safeEqual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

export function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
  return `enc1:${Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64')}`;
}
export function decrypt(text) {
  const raw = Buffer.from(String(text).slice(5), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8'));
}
