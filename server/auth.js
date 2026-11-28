import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';
import { hmac, safeEqual } from './crypto.js';
import { User, claimLegacyData } from './models.js';
import { runAs } from './context.js';
import { seedTopics } from './services/batch.js';

const scrypt = promisify(crypto.scrypt);
export const COOKIE = 'gr_session';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ---------------------------------------------------------------- passwords
export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${h.toString('base64')}`;
}
export async function checkPassword(pw, stored) {
  const [alg, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const h = await scrypt(pw, Buffer.from(salt, 'base64'), 64);
  return safeEqual(h.toString('base64'), hash);
}

// ---------------------------------------------------------------- signed session cookie:  userId.expiry.signature
export function makeToken(userId) {
  const exp = Date.now() + config.auth.sessionDays * 86400e3;
  const body = `${userId}.${exp}`;
  return `${body}.${hmac(body)}`;
}
export function readToken(token) {
  const [uid, exp, sig] = String(token || '').split('.');
  if (!uid || !exp || !sig || !safeEqual(hmac(`${uid}.${exp}`), sig) || Number(exp) < Date.now()) return null;
  return uid;
}
export const cookieOf = (req, name = COOKIE) => {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
};
const isHttps = (req) => req.secure || req.headers['x-forwarded-proto'] === 'https' || config.publicUrl.startsWith('https://');
export function setSessionCookie(req, res, userId) {
  res.append('Set-Cookie', `${COOKIE}=${encodeURIComponent(makeToken(userId))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.auth.sessionDays * 86400}${isHttps(req) ? '; Secure' : ''}`);
}
export const clearSessionCookie = (res) => res.append('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);

// ---------------------------------------------------------------- who is logged in (cached 20 s so a disabled user is cut off quickly)
const userCache = new Map();
export const dropUserCache = (id) => userCache.delete(String(id));
export async function sessionUser(req) {
  const uid = readToken(cookieOf(req));
  if (!uid) return null;
  const hit = userCache.get(uid);
  if (hit && hit.until > Date.now()) return hit.user;
  const user = await User.findById(uid).select('name email isAdmin disabled').lean().catch(() => null);
  const ok = user && !user.disabled ? user : null;
  userCache.set(uid, { user: ok, until: Date.now() + 20e3 });
  return ok;
}
export const publicUser = (u) => ({ id: String(u._id), name: u.name, email: u.email, isAdmin: !!u.isAdmin });

// ---------------------------------------------------------------- brute-force guard (in memory, per ip + email)
const tries = new Map();
export function throttle(key, max = 10, windowMs = 15 * 60e3) {
  const now = Date.now();
  const t = (tries.get(key) || []).filter((x) => now - x < windowMs);
  tries.set(key, t);
  if (t.length >= max) return false;
  t.push(now);
  return true;
}
const clearThrottle = (key) => tries.delete(key);

// ---------------------------------------------------------------- register / login
export async function registerUser({ name, email, password, code }) {
  name = String(name || '').trim().slice(0, 60);
  email = String(email || '').trim().toLowerCase();
  password = String(password || '');
  if (name.length < 2) throw httpError(400, 'Naam likho (kam se kam 2 akshar)');
  if (!EMAIL_RE.test(email)) throw httpError(400, 'Email sahi nahi hai');
  if (password.length < 8) throw httpError(400, 'Password kam se kam 8 akshar ka rakho');
  const count = await User.countDocuments();
  const isAdminEmail = !!config.auth.adminEmail && email === config.auth.adminEmail;
  if (!isAdminEmail) { // the ADMIN_EMAIL account may always sign up; everybody else follows ALLOW_SIGNUP / SIGNUP_CODE
    if (count > 0 && !config.auth.allowSignup) throw httpError(403, 'Naye account abhi band hain. Admin se baat karo.');
    if (config.auth.signupCode && !safeEqual(String(code || ''), config.auth.signupCode)) throw httpError(403, 'Signup code galat hai');
  }
  // first account = admin. With ADMIN_EMAIL set, only that email is admin (so nobody can grab the admin seat by being first).
  const makeAdmin = config.auth.adminEmail ? isAdminEmail : count === 0;
  if (await User.exists({ email })) throw httpError(409, 'Is email se account pehle se hai. Login karo.');
  const user = await User.create({ name, email, passHash: await hashPassword(password), isAdmin: makeAdmin });
  if (makeAdmin) { // the admin inherits everything the old single-user install had
    try { await claimLegacyData(user._id); } catch (e) { console.warn('[migrate]', e.message); }
  }
  await runAs(user, () => seedTopics());
  return user;
}

export async function loginUser({ email, password }, ip) {
  email = String(email || '').trim().toLowerCase();
  const key = `${ip}|${email}`;
  if (!throttle(key)) throw httpError(429, 'Bahut zyada koshish. 15 minute baad try karo.');
  const user = await User.findOne({ email });
  // same work + same message for "no such user" and "wrong password"
  const ok = await checkPassword(String(password || ''), user?.passHash || 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');
  if (!user || !ok) throw httpError(401, 'Email ya password galat hai');
  if (user.disabled) throw httpError(403, 'Ye account band kar diya gaya hai');
  clearThrottle(key);
  user.lastLoginAt = new Date();
  await user.save();
  return user;
}

export async function changePassword(userId, current, next) {
  const user = await User.findById(userId);
  if (!user || !(await checkPassword(String(current || ''), user.passHash))) throw httpError(401, 'Purana password galat hai');
  if (String(next || '').length < 8) throw httpError(400, 'Naya password kam se kam 8 akshar ka rakho');
  user.passHash = await hashPassword(String(next));
  await user.save();
}

export function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
