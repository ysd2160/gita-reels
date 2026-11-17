export const LEAD_IN = 0.12;
export const GAP_SPEECH = 0.16; // between speech chunk and chant / next chunk
export const GAP_LINE = 0.1;
export const CHANT_HOLD = 0.35;
export const TAIL = 1.3;

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
