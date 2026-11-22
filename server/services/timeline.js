import { syllables } from './syllables.js';
export const LEAD_IN = 0.02; // the voice starts at once: the first second decides if people swipe
export const GAP_SPEECH = 0.16; // between speech chunk and chant / next chunk
export const GAP_LINE = 0.1;
export const CHANT_HOLD = 0.35;
export const TAIL = 0.8; // a short end so the video loops back into its first line

/** "Tum *overthink* nahi karte" -> [{text:'Tum'}, {text:'overthink', emph:true}, ...] */
export function parseShow(show) {
  return show.split(/\s+/).filter(Boolean).map((tok) => {
    const emph = /^\*|\*$/.test(tok);
    return { text: tok.replace(/\*/g, ''), emph };
  }).filter((t) => t.text);
}
export const plainShow = (show) => show.replace(/\*/g, '').replace(/\s+/g, ' ').trim();

/** Spread [start,end] over words, weighted by word length. */
export function wordTimings(show, start, end) {
  const toks = parseShow(show);
  const weights = toks.map((w) => w.text.length + 2);
  const total = weights.reduce((a, b) => a + b, 0);
  const dur = Math.max(0.2, end - start);
  let t = start;
  return toks.map((w, i) => {
    const d = (dur * weights[i]) / total;
    const out = { text: w.text, emph: !!w.emph, start: +t.toFixed(3), end: +(t + d).toFixed(3) };
    t += d;
    return out;
  });
}

export const CAP_LEAD = 0.04; // captions appear a hair before the voice (the eye is faster than the ear)

const wordWeight = (t) => syllables(t) + 0.12 * t.replace(/[^\p{L}\p{N}]/gu, '').length + 0.2;

/**
 * Word timings from the REAL voiced stretches of the line (pauses do not eat word time).
 * runs = [[a,b],...] absolute seconds. Words are placed on the voiced time axis by syllable weight.
 */
export function wordTimingsRuns(show, start, end, runs) {
  const toks = parseShow(show);
  if (!toks.length) return [];
  const rr = (runs || []).filter((r) => r[1] > r[0]);
  if (!rr.length) return wordTimings(show, start, end);
  const voiced = rr.reduce((a, r) => a + (r[1] - r[0]), 0);
  const weights = toks.map((w) => wordWeight(w.text));
  const total = weights.reduce((a, b) => a + b, 0);
  const at = (v) => { // voiced-time -> real time
    let left = v;
    for (const r of rr) { const d = r[1] - r[0]; if (left <= d) return r[0] + left; left -= d; }
    return rr.at(-1)[1];
  };
  let cum = 0;
  const starts = toks.map((_, i) => { const s = at((voiced * cum) / total); cum += weights[i]; return s; });
  return toks.map((w, i) => {
    const s = Math.max(start, i === 0 ? start : starts[i] - CAP_LEAD);
    const e = i < toks.length - 1 ? Math.max(s + 0.05, starts[i + 1] - CAP_LEAD) : Math.max(end, s + 0.1);
    return { text: w.text, emph: !!w.emph, start: +s.toFixed(3), end: +e.toFixed(3) };
  });
}
