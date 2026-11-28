import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { keyCount, withKeys } from './keypool.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One art style per reel keeps the video coherent; different reels get different looks.
export const ART_STYLES = [
  // faces and gods are allowed here: used by Script Packs (mythology stories where the characters must be seen)
  { id: 'mythic', template: 'saffron-dawn', prefix: 'Indian mythology storytelling illustration, rich saturated colors, dramatic cinematic lighting, traditional ornaments and costumes, expressive detailed faces, consistent character design, painterly digital art' },
  { id: 'epic-painting', template: 'gold-cosmic', prefix: 'epic cinematic digital painting, dramatic volumetric god rays, deep indigo and glowing gold palette, highly detailed, atmospheric depth' },
  { id: 'temple-mural', template: 'saffron-dawn', prefix: 'ancient Indian temple mural art, Pahari miniature painting inspired, rich saffron red and gold, intricate fine detail, warm lamp glow' },
  { id: 'moody-noir', template: 'midnight-lotus', prefix: 'moody cinematic photograph, dark teal shadows with warm candle light, shallow depth of field, subtle film grain, 35mm' },
  { id: 'ethereal-ink', template: 'midnight-lotus', prefix: 'ethereal ink and watercolor illustration, soft misty gradients, muted blue and gold, dreamlike, delicate brush texture' },
];
export const SUFFIX = 'vertical composition, subject centered, no text, no letters, no watermark';
export const buildPrompt = (style, scene) => `${style.prefix}. ${scene}. ${SUFFIX}`.slice(0, 1800);

// ---------------------------------------------------------------- providers -> Buffer (or null)
async function cloudflare(prompt, key) {
  const [account, ...rest] = key.split(':'); // key = accountId:apiToken
  const token = rest.join(':');
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/black-forest-labs/flux-1-schnell`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, steps: 6 }),
  });
  // 404 / 400 = this account id or token is wrong -> treat like a bad key (skip it for hours, use the next key)
  if (!r.ok) throw Object.assign(new Error(`Cloudflare ${r.status}: ${(await r.text()).slice(0, 160)}`), { status: r.status === 404 || r.status === 400 ? 401 : r.status });
  const j = await r.json();
  const b64 = j.result?.image || j.image;
  if (!b64) throw new Error('Cloudflare: image missing');
  return { buf: Buffer.from(b64, 'base64'), ext: 'jpg' };
}

async function geminiImage(prompt, key) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${config.images.geminiModel}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '9:16' } },
    }),
  });
  if (!r.ok) throw Object.assign(new Error(`Gemini image ${r.status}: ${(await r.text()).slice(0, 160)}`), { status: r.status });
  const part = ((await r.json()).candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data);
  if (!part) throw new Error('Gemini image: no image');
  return { buf: Buffer.from(part.inlineData.data, 'base64'), ext: /png/.test(part.inlineData.mimeType || '') ? 'png' : 'jpg' };
}

async function pollinations(prompt, key) {
  const seed = Math.floor(Math.random() * 1e6);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1080&height=1920&model=flux&nologo=true&seed=${seed}`;
  const r = await fetch(url, { headers: key ? { Authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw Object.assign(new Error(`Pollinations ${r.status}`), { status: r.status });
  return { buf: Buffer.from(await r.arrayBuffer()), ext: 'jpg' };
}

const ENABLED = {
  cloudflare: () => keyCount('cloudflare') > 0,
  gemini: () => keyCount('gemini') > 0 && config.images.providers.includes('gemini'),
  pollinations: () => true,
};
const IMPL = { cloudflare, gemini: geminiImage, pollinations };
export const imageProvidersAvailable = () => config.images.providers.filter((p) => IMPL[p] && ENABLED[p]());

const warned = new Map();
const warnOnce = (p, msg) => { if (Date.now() - (warned.get(p) || 0) > 60000) { warned.set(p, Date.now()); console.warn(`[image:${p}] ${msg}`); } };

/** Generate one image into `${outBase}.<ext>`; returns { file, ext, provider } or null.
 *  Every provider may have several keys: a limited key is skipped, the next one is used; when all keys of a provider are
 *  resting the next provider is tried immediately (no waiting, no repeated failing calls). */
export async function generateImage(prompt, outBase) {
  for (const p of imageProvidersAvailable()) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const { buf, ext } = await withKeys(p, `image:${p}`, (key) => IMPL[p](prompt, key));
        if (buf.length < 5000) throw new Error('image too small');
        const file = `${outBase}.${ext}`;
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, buf);
        return { file, ext, provider: p };
      } catch (e) {
        warnOnce(p, e.message);
        if (e.allLimited || e.status === 401 || e.status === 403) break; // -> next provider
        await sleep(1500);
      }
    }
  }
  return null;
}

export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}
