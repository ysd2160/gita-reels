// SCRIPT PACK = the fixed format for scripts that are written OUTSIDE the software (for example in a Claude chat).
// The software does not rewrite them: speak (Devanagari, for the voice) + show (caption) + scene (picture) of every line are used exactly as given.
// This file: parse the pasted JSON, check it (pronunciation / structure / pictures), turn it into a script, build the picture prompts, and the pronunciation dictionary.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { validateScript } from './gemini.js';
import { SUFFIX } from './images.js';
import { VARIANTS } from './shape.js';

export const PACK_VERSION = 1;
const DEVANAGARI = /[\u0900-\u097F]/;
const wordsOf = (s) => String(s || '').replace(/\*/g, '').split(/\s+/).filter(Boolean);
const CAPTION_STYLES = ['pop', 'box', 'glow'];
export const MOODS = ['epic', 'devotional', 'suspense', 'sad', 'calm'];

// ------------------------------------------------------------------ parse (tolerant: code fences, one object, a list, or {reels:[...]})
export function parsePacks(input) {
  let data = input;
  if (typeof input === 'string') {
    let t = input.replace(/^\uFEFF/, '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    if (!t) throw new Error('Script Pack khali hai');
    try { data = JSON.parse(t); } catch (e1) {
      try { data = JSON.parse(`[${t.replace(/}\s*{/g, '},{')}]`); } // several objects pasted one after another
      catch { throw new Error(`JSON sahi nahi hai (${String(e1.message).slice(0, 120)}). Chat se poora code block copy karo, shuru ke { se aakhir ke } tak.`); }
    }
  }
  const arr = Array.isArray(data) ? data : Array.isArray(data?.reels) ? data.reels : [data];
  if (!arr.length || arr.some((p) => !p || typeof p !== 'object')) throw new Error('Script Pack mein koi reel nahi mili');
  return arr;
}

// ------------------------------------------------------------------ check one pack: errors stop the import, warnings are shown
export function checkPack(p, label = 'Reel') {
  const errors = [], warnings = [];
  const w = (m) => warnings.push(`${label}: ${m}`), e = (m) => errors.push(`${label}: ${m}`);
  const lines = Array.isArray(p.lines) ? p.lines : [];
  if (lines.length < 5) e(`kam se kam 5 lines chahiye (mili ${lines.length})`);
  if (lines.length > 40) e(`bahut zyada lines (${lines.length}), max 40`);
  if (!String(p.title || p.hook || '').trim()) w('"title" nahi hai (screen par upar jo heading dikhti hai), pehli line use hogi');
  else if (DEVANAGARI.test(String(p.title || p.hook))) w('"title" Roman Hinglish mein likho (screen font Devanagari ke liye set nahi hai)');
  const chars = p.characters && typeof p.characters === 'object' ? p.characters : {};
  if (!Object.keys(chars).length) w('"characters" khali hai: har video mein character alag dikh sakta hai. Har kirdaar ka ek fixed description do.');
  let spoken = 0;
  lines.forEach((l, i) => {
    const n = i + 1, speak = String(l?.speak || '').trim(), show = String(l?.show || '').trim(), scene = String(l?.scene || l?.image || '').trim();
    if (!speak) return void e(`line ${n}: "speak" khali hai`);
    const wc = wordsOf(speak).length;
    spoken += wc;
    if (!DEVANAGARI.test(speak) && wc > 2) w(`line ${n}: "speak" Roman mein hai. Devanagari mein likho warna voice ka uchcharan bigad sakta hai`);
    if (wc > 14) w(`line ${n}: ${wc} words, bahut lambi (max 12-14). Do lines mein todo`);
    if (wc < 5 && i > 0) w(`line ${n}: sirf ${wc} words. Chhoti line agli line ke saath ek hi picture mein jud jaati hai`);
    if (/[()[\]{}<>#@_~^|\\"“”‘’:;—–\u{1F300}-\u{1FAFF}]/u.test(speak.replace(/\*/g, ''))) w(`line ${n}: "speak" mein bracket / quote / colon / emoji hain. Voice inhe galat padh sakti hai, hata do`);
    if (/\b[A-Z]{2,}\b/.test(speak)) w(`line ${n}: capital abbreviation hai (voice akshar-akshar padhegi). Devanagari mein likho`);
    if (/[ऋॠऌॐऽ]/.test(speak)) w(`line ${n}: mushkil akshar (ऋ ॐ ऽ). Saral spelling likho (ॐ → ओम, ऋषि → रिषि)`);
    if (!show) w(`line ${n}: "show" (caption) nahi hai, AI se banega (kam bharosemand)`);
    else if (DEVANAGARI.test(show)) w(`line ${n}: "show" Roman Hinglish mein likho (caption font Roman ke liye set hai)`);
    if (scene.length < 30) w(`line ${n}: "scene" nahi hai ya bahut chhota hai. Isi se picture banti hai, bina iske picture is line se match nahi karegi`);
    else if (DEVANAGARI.test(scene)) w(`line ${n}: "scene" English mein likho (image AI English samajhta hai)`);
    const who = Array.isArray(l?.who) ? l.who : [];
    for (const name of who) if (!chars[name]) w(`line ${n}: who "${name}" "characters" mein nahi hai`);
    for (const name of Object.keys(chars)) if (!who.includes(name) && new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(scene)) w(`line ${n}: scene mein "${name}" hai par "who" mein nahi, uska look alag ho sakta hai`);
  });
  const sec = Math.round(spoken / 2.4 + 2);
  if (lines.length >= 5 && (sec < 22 || sec > 125)) w(`video lagbhag ${sec} sec ki banegi (ideal 35-60 sec)`);
  else if (lines.length >= 5 && sec > 75) w(`video lagbhag ${sec} sec ki banegi. Shorts mein 35-60 sec behtar chalti hain`);
  if (lines.length >= 5 && !/[?？]/.test(String(lines.at(-1)?.speak || ''))) w('aakhri line mein sawal nahi hai (comment kam aayenge)');
  if (p.music && !MOODS.includes(String(p.music))) w(`"music" "${p.music}" jaana-pehchana mood nahi (${MOODS.join(' / ')}). Koi bhi folder-naam chalega agar assets/music/${p.music}/ banaya ho`);
  return { errors, warnings, seconds: sec, lines: lines.length };
}

// ------------------------------------------------------------------ pack -> script (the shape the rest of the software already understands)
export function packToScript(p) {
  const lines = p.lines.map((l) => ({
    speak: String(l.speak || '').trim(),
    show: String(l.show || '').trim(),
    image: String(l.scene || l.image || '').trim(),
    visual: String(l.visual || '').trim(),
    who: Array.isArray(l.who) ? l.who.map((x) => String(x).trim()).filter(Boolean) : [],
  }));
  const s = validateScript({
    format_id: p.format || p.format_id || 'epic_story',
    hook_text: String(p.title || p.hook || '').trim() || undefined,
    lines,
    cta: p.cta || 'Follow for more',
    caption: p.caption || '',
    hashtags: p.hashtags || [],
  });
  const chars = {};
  for (const [k, v] of Object.entries(p.characters && typeof p.characters === 'object' ? p.characters : {})) if (String(v || '').trim()) chars[String(k).trim()] = String(v).trim().slice(0, 400);
  s.pack = {
    v: PACK_VERSION,
    locked: true, // the software must not rewrite this script / these picture prompts
    look: String(p.look || '').trim().slice(0, 500),
    characters: chars,
    music: String(p.music || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30),
    variant: VARIANTS.includes(p.variant) ? p.variant : 'frame',
    captionStyle: CAPTION_STYLES.includes(p.caption_style) ? p.caption_style : '',
  };
  return s;
}

/** the final image prompt of one scene: fixed look + what happens + the exact description of every character in it */
export function packPrompt(script, art, sceneText, whoList = []) {
  const p = script.pack || {};
  const look = p.look || art.prefix;
  const descs = [...new Set(whoList)].map((n) => (p.characters?.[n] ? `${n}: ${p.characters[n]}` : '')).filter(Boolean);
  return `${look}. ${sceneText}.${descs.length ? ` Characters, keep their exact appearance in every picture: ${descs.join('; ')}.` : ''} ${SUFFIX}`.slice(0, 1800);
}

// ------------------------------------------------------------------ pronunciation dictionary (assets/pronounce.txt, one "word => how the voice should read it" per line)
const BUILTIN = [['ॐ', 'ओम']];
let cache = { mtime: 0, rules: [] };
function rules() {
  const file = path.join(config.paths.assets, 'pronounce.txt');
  try {
    const m = fs.statSync(file).mtimeMs;
    if (m !== cache.mtime) {
      const rs = fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && l.includes('=>'))
        .map((l) => { const i = l.indexOf('=>'); return [l.slice(0, i).trim(), l.slice(i + 2).trim()]; }).filter(([a, b]) => a && b);
      cache = { mtime: m, rules: rs };
    }
  } catch { cache = { mtime: 0, rules: [] }; }
  return [...BUILTIN, ...cache.rules];
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WORD = '\\u0900-\\u097FA-Za-z0-9';
/** applied to the text the voice reads (never to captions). Whole words only. */
export function pronounce(text) {
  let t = String(text || '');
  for (const [from, to] of rules()) t = t.replace(new RegExp(`(?<![${WORD}])${esc(from)}(?![${WORD}])`, 'g'), to);
  return t;
}
