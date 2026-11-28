
import { checkPack, packToScript, parsePacks } from './pack.js';

/** check one or more Script Packs without saving anything: { reels: [{ topic, seconds, lines, errors, warnings }], ok } */
export function checkPacks(input) {
  const packs = parsePacks(input);
  const reels = packs.map((p, i) => {
    const label = `Reel ${i + 1}${p.title ? ` (${String(p.title).slice(0, 30)})` : ''}`;
    const r = checkPack(p, label);
    return { index: i, title: String(p.title || p.topic || ''), seconds: r.seconds, lines: r.lines, errors: r.errors, warnings: r.warnings };
  });
  return { reels, ok: reels.every((r) => !r.errors.length), errors: reels.flatMap((r) => r.errors), warnings: reels.flatMap((r) => r.warnings) };
}

/** convert a pack into what the planner stores: { script, topic, date } (throws a readable error when the pack is broken) */
export function buildPack(p, i = 0) {
  const r = checkPack(p, `Reel ${i + 1}`);
  if (r.errors.length) throw new Error(r.errors.join(' | '));
  return { script: packToScript(p), topic: String(p.topic || p.title || p.lines[0].show || p.lines[0].speak).replace(/\*/g, '').slice(0, 140), date: /^\d{4}-\d{2}-\d{2}$/.test(String(p.date || '')) ? p.date : null, warnings: r.warnings };
}

