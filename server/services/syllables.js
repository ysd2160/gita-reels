// Rough syllable counter for Hindi (Devanagari) + Hinglish/English (Latin). Used to predict how long a word / line is spoken.
const DEV_VOWEL = /[ऄ-औॠॡ]/;
const DEV_CONS = /[क-हक़-य़]/;
const VIRAMA = '्';

function devSyllables(w) {
  const ch = [...w];
  let n = 0;
  let lastCons = false; // word ends in a bare consonant (schwa is dropped when speaking)
  for (let i = 0; i < ch.length; i++) {
    const c = ch[i];
    if (DEV_VOWEL.test(c)) { n++; lastCons = false; }
    else if (DEV_CONS.test(c)) {
      if (ch[i + 1] === VIRAMA) { lastCons = false; continue; }
      n++; lastCons = true;
    } else if (/[ा-ौंःँॅॉ]/.test(c)) lastCons = false;
  }
  if (lastCons && n > 1) n--;
  return Math.max(1, n);
}

function latSyllables(w) {
  const m = w.toLowerCase().match(/[aeiouy]+/g);
  return Math.max(1, m ? m.length : 1);
}

export function syllables(text) {
  let n = 0;
  for (const word of String(text).split(/\s+/)) {
    const segs = word.match(/[ऀ-ॿ]+|[A-Za-z]+/g);
    if (!segs) continue;
    for (const s of segs) n += /[ऀ-ॿ]/.test(s) ? devSyllables(s) : latSyllables(s);
  }
  return n;
}

/** pause-causing punctuation inside a line */
export const pauseMarks = (s) => (String(s).match(/[,;:।—–-]|\.\.\./g) || []).length;
