// Script engine for 30-60 s reels.
// - every video is a STORY (modern story / Mahabharat story / dialogue / twist / mystery); no shlok, no chant
// - picks teaching candidates (grounding) that were NOT used recently
// - writes draft -> editor polish -> automatic quality check (word count, banned phrases, weak hook, repeated hook)
import { config } from '../config.js';
import { FACT_BANK, formatById, lengthPlan, pickFormat, randomTargetSec } from '../formats.js';
import { candidateVerses, verseById } from '../verses.js';
import { asContents, callGemini, validateScript } from './gemini.js';

export const BANNED = [
  'aaj ke fast-paced', 'in today', 'yaad rakhiye', 'dosto', 'namaste', 'ultimately', 'at the end of the day', 'life ek journey', 'zindagi ek safar',
  'sabse pehle', 'toh chaliye', 'chaliye shuru', 'is video mein', 'aaj hum baat karenge', 'hum sab jaante hain', 'kya aap jaante hain', 'dhyan se suniye',
  'har insaan ke jeevan mein', 'jeevan mein safal', 'positive socho', 'universe',
];

const IMAGE_MOOD = {
  modern_story: 'cinematic scenes of modern Indian life told as a story: night city, rain on a window, a phone glowing in the dark, a desk lamp, an empty road, train platform; people only as silhouettes from behind or hands; keep the same main colours across the story',
  epic_story: 'painterly cinematic scenes of the story, ancient India, warm firelight or dusk, silhouettes, chariots, banners, battlefield dust, no close-up faces',
  dialogue: 'two silhouettes (a chariot warrior and Krishna) in a vast battlefield dusk, then modern symbolic scenes for the modern doubts',
  twist_story: 'cinematic story scenes with a quiet mood, then one striking symbolic image for the twist (an opening door, light through a crack, a clock stopping); silhouettes only',
  mystery: 'dark moody symbolic visuals: old manuscripts, temple stone, mist, lamps, stars, battlefield dust; a sense of secret',
};

const wordsOf = (s) => String(s || '').replace(/\*/g, '').split(/\s+/).filter(Boolean);
const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const jaccard = (a, b) => {
  const A = new Set(norm(a).split(' ').filter((w) => w.length > 2)), B = new Set(norm(b).split(' ').filter((w) => w.length > 2));
  if (!A.size || !B.size) return 0;
  let i = 0; A.forEach((w) => B.has(w) && i++);
  return i / (A.size + B.size - i);
};

export const spokenWords = (script) => script.lines.reduce((n, l) => n + wordsOf(l.show).length, 0);
/** rough length of the finished video in seconds */
export const estimateSec = (script) => Math.round(spokenWords(script) / 2.4 + 2 + (script.verseId ? 12.5 : 0));

// ------------------------------------------------------------------ quality check
export function lintScript(script, spec) {
  const errors = [];
  const { fmt, plan, recentHooks = [], recentVerseIds = [] } = spec;
  const n = spokenWords(script);
  if (n < plan.min * 0.9) errors.push(`Too short: ${n} spoken words, need ${plan.min}-${plan.max} (add real content, not filler)`);
  if (n > plan.max * 1.1) errors.push(`Too long: ${n} spoken words, need ${plan.min}-${plan.max} (cut the weakest lines)`);
  if (script.lines.length < plan.minLines || script.lines.length > plan.maxLines) errors.push(`Use ${plan.minLines}-${plan.maxLines} lines (now ${script.lines.length})`);
  const hookWords = wordsOf(script.hookText).length;
  if (hookWords > 9) errors.push(`hook_text has ${hookWords} words, max 8`);
  const longLine = script.lines.findIndex((l) => wordsOf(l.show).length > 14);
  if (longLine >= 0) errors.push(`Line ${longLine + 1} is longer than 14 words; split it`);
  const text = norm(script.lines.map((l) => l.show).join(' ') + ' ' + script.hookText);
  const hit = BANNED.filter((b) => text.includes(norm(b)));
  if (hit.length) errors.push(`Banned generic phrases used: ${hit.join(', ')}`);
  const seen = new Set();
  for (const l of script.lines) { const k = norm(l.show); if (seen.has(k)) { errors.push('Two lines are identical'); break; } seen.add(k); }
  const first = script.lines[0]?.show || '';
  const sim = Math.max(0, ...recentHooks.map((h) => Math.max(jaccard(h, script.hookText), jaccard(h, first))));
  if (sim >= 0.5) errors.push('Hook is too similar to a recent video; make it a completely different angle');
  if (/\b(shlok|sloka|shloka|sanskrit|verse|adhyay)\b|\bbg[- ]?\d|श्लोक/i.test(text)) errors.push('Do not mention shlok / verse / Sanskrit / adhyay anywhere: tell a story instead');
  if (!/[?!]|\.{3}/.test(script.lines.at(-1)?.show || '')) errors.push('Last line should leave a question / open loop');
  return errors;
}

// ------------------------------------------------------------------ prompts
const CRAFT = `
STORYTELLING RULES (every video is ONE STORY, not a lecture; the previous videos felt generic and AI-made, these rules fix that)
1. STORY FIRST: the video has a beginning, middle and end: a person (or Arjun / Karn / Krishna), what they want, what goes wrong, the turning point, the result. The viewer must keep thinking \"phir kya hua?\".
2. TELL IT IN SCENES, present tense: \"Raat ke 2 baje, Rohit ne phir uska chat khola.\" Never summarise (\"wo bahut pareshan tha\"); show it with a time, an object, a place, a spoken line. At least 4 concrete scene details.
3. HOOK = drop into the story at its most tense moment, 8 words or fewer. Never a greeting, never \"aaj hum baat karenge\", never a general statement.
4. CHARACTER: give the main character a name and ONE specific detail so the viewer sees themselves. (Modern stories are clearly fictional: \"Rohit naam ka ek ladka...\".)
5. TURN + RE-HOOK around the middle (\"Par tabhi...\" / \"Phir ek cheez badli...\"). Every line adds something NEW (a fact, an image, an emotion); never repeat an idea in other words.
6. THE LESSON IS SHOWN BY WHAT HAPPENS and said only ONCE, in one short line near the end (the line people will screenshot). No sermon, no \"hume seekhna chahiye\", no list of advice. Krishna / the Gita may appear only INSIDE the story (a memory, someone's advice, Krishna as a character) in plain Hinglish.
7. NO SHLOK, NO SANSKRIT, NO VERSE NUMBERS, NO CHANTING anywhere. Do not write the words shlok / verse / adhyay.
8. VOICE: one friend talking to ONE person at night. Use \"tum\". Simple Hinglish a 22-year-old Indian speaks. Short punchy lines (4-12 words, average 8), fragments are fine. No preaching, no \"dosto\".
9. LOOPABLE ENDING: the last line closes the story AND leaves a question or open loop that makes people comment or rewatch. Do NOT say \"follow karo\" in spoken lines (the on-screen \"cta\" field does that).
10. FAITH & HONESTY: stay faithful to the teaching given below. Never invent a quote, a number or a historical \"fact\". Use only well-known Mahabharat / Gita episodes. No medical, therapy or guarantee claims. Respectful tone about Krishna and the Gita.
11. BANNED phrases: ${BANNED.join(' | ')}.
12. ANTI-CLICHE: never use the template \"Tum X nahi ho, tum bas Y ho\" or \"Ye X nahi, Y hai\" more than once per script, never end with a generic \"Kya tum bhi...?\". Say something only THIS story could say.
13. GOLD STANDARD for energy (match the specificity, rhythm and story flow, never copy the words):
   hook: \"Usne 11 baar resume bheja.\"
   \"Usne 11 baar resume bheja. Ek bhi jawab nahi.\"
   \"Aman, 24 saal. Kamre mein laptop aur thandi chai.\"
   \"Papa ka call aaya. Usne uthaya *nahi*.\"
   \"Raat ke 1 baje, bas screen ko ghoor raha tha.\"
   \"Tabhi dost ka message aaya: Result tere haath mein nahi, koshish hai.\"
   \"Par tabhi ek baat *chubh* gayi.\"
   \"Usne 12th resume bheja. Is baar 3 galtiyan theek karke.\"
   \"Jawab phir bhi nahi aaya. Par ab wo *dar* nahi raha.\"
   \"Koshish hamesha tumhare haath mein thi. Result kabhi nahi.\"
   \"14th din ek mail aayi. Subject line mein bas ek shabd...\"
   Notice: a named person, real numbers, tiny actions, a turn, a short lesson line, an open ending.`;

const FIELDS = `
FIELDS
- "show": the line in natural Hinglish (Hindi words in Roman letters, English words as they are). It is BOTH the on-screen caption AND what the narrator says, so write it to be spoken: consistent simple spelling (nahi, hai, kyun, tum, mat), commas / full stops / "..." where a human pauses. Wrap exactly 1 key emotional word per line in *asterisks*, e.g. "Tum *overthink* nahi kar rahe".
- "image": English prompt for an AI image generator for that line: concrete scene + lighting + mood, 15-30 words. NO close-up faces (silhouettes from behind, hands, symbolic objects, landscapes). Consecutive lines must look DIFFERENT. No text or letters in the image.
- "visual": 2-4 word stock-footage search fallback.`;

const verseBlock = (list) => list.map((v) => `- ${v.id} | ${v.ref} | themes: ${v.themes}\n    meaning: ${v.meaning}`).join('\n');

function draftPrompt(topic, spec, notes) {
  const { fmt, plan, cands, recentHooks } = spec;
  const grounding = fmt.shlok
    ? `VERSE CANDIDATES (pick EXACTLY ONE id that fits best; it will be chanted in Sanskrit by the narrator, so never write the Sanskrit yourself; stay faithful to its meaning):\n${verseBlock(cands)}`
    : `GROUNDING TEACHINGS (base the lesson on 1-2 of these ideas so the content stays faithful to the Gita; do NOT quote verse numbers or Sanskrit; put the id of the main one in "grounding_id"):\n${verseBlock(cands)}`
      + (fmt.id === 'mystery' ? `\n\nFACT BANK (use only these facts or facts you are 100% sure about):\n${FACT_BANK.map((f) => `- ${f}`).join('\n')}` : '');
  return `You are the head writer of a Hindi/Hinglish faceless spiritual short-video channel "Bhagavad Gita For Modern Problems" (Instagram Reels / YouTube Shorts, audience: Indians aged 18-35).

TOPIC: ${topic}
${notes ? `CREATOR'S NOTES FOR THIS VIDEO (follow them): ${notes}\n` : ''}FORMAT: "${fmt.label}" - ${fmt.desc}
STRUCTURE: ${fmt.structure}
Hook flavour examples for this format (inspiration only, do NOT copy): ${fmt.hooks.map((h) => `"${h}"`).join(' / ')}

LENGTH: the finished video must run about ${plan.sec} seconds. So write ${plan.min}-${plan.max} spoken words in total (target ${plan.target}) across ${plan.minLines}-${plan.maxLines} lines.${fmt.shlok ? ' (The chanted verse adds about 12 seconds by itself, already counted.)' : ''}
Do NOT reuse or paraphrase these recent hooks:
${recentHooks.length ? recentHooks.slice(0, 12).map((h) => `- ${h}`).join('\n') : '(none)'}

${grounding}
${CRAFT}
${FIELDS}
- Image mood for this format: ${IMAGE_MOOD[fmt.id] || IMAGE_MOOD.classic}

Return JSON ONLY:
{
  "format_id": "${fmt.id}",
  "verse_id": ${fmt.shlok ? '"bg-2-47"' : 'null'},
  "grounding_id": ${fmt.shlok ? 'null' : '"bg-2-47"'},
  "hook_text": "max 7 words, Roman Hinglish, big on-screen title in the first 2 seconds",
  "lines": [ { "show": "...", "image": "...", "visual": "..." } ],
  "shlok_line_index": ${fmt.shlok ? '4' : 'null'},
  "cta": "max 6 words on-screen end text, different style each time (comment prompt / save / follow for part 2)",
  "caption": "1-2 line post caption ending with a question",
  "hashtags": ["#bhagavadgita", "..."]
}
${fmt.shlok ? '"shlok_line_index" = 0-based index of the line AFTER which the Sanskrit verse is chanted; that line must lead naturally into it (e.g. "Shri Krishna ne Gita mein kaha tha...").' : 'No chant in this format: verse_id must be null and shlok_line_index null.'}
hashtags: 8-10, mix broad and topic-specific.`;
}

function polishPrompt(draft, spec, issues) {
  const { fmt, plan, cands } = spec;
  return `You are a ruthless short-form video editor and Hindi copywriter. Below is a DRAFT reel script (JSON), format "${fmt.label}". Make it genuinely better, not just reworded.

CHECKLIST
1. Hook: would a stranger stop scrolling within 2 seconds? If not, rewrite it sharper (max 8 words, specific, tension).
2. Delete every generic motivational-poster sentence; replace with a concrete human moment or a vivid detail.
3. Keep ${plan.min}-${plan.max} spoken words and ${plan.minLines}-${plan.maxLines} lines, every line max 12 words, no two lines saying the same thing.
4. Rhythm: mix 3-word lines with 9-word lines. There must be a mini re-hook near the middle and exactly one screenshot-worthy line.
5. The last line must make people comment or rewatch (question / loop back to the hook).
6. Faithfulness: ${fmt.shlok ? 'keep one verse_id from the candidates below and make sure the line before the chant leads into it naturally; meaning must stay faithful.' : 'stay faithful to the grounding teaching; no invented facts or quotes. verse_id stays null.'}
7. Every "image" prompt matches its line's emotion, no close-up faces, consecutive images differ. Keep "*word*" emphasis (1 per line).
8. STORY CHECK: is it still ONE story with a named character, scenes, a turn near the middle and a result? If any part turned into advice or a lecture, rewrite it as a scene. No word like shlok / verse / Sanskrit.
9. Keep the same JSON schema and field names.
${issues.length ? `\nKNOWN PROBLEMS THAT MUST BE FIXED:\n${issues.map((i) => `- ${i}`).join('\n')}\n` : ''}
${fmt.shlok ? `Verse candidates:\n${verseBlock(cands)}\n` : ''}
DRAFT:
${JSON.stringify(draft)}

Return the improved script as JSON ONLY.`;
}

// ------------------------------------------------------------------ main
function normalize(raw, spec) {
  const s = validateScript({ ...raw, format_id: spec.fmt.id });
  if (!spec.fmt.shlok) { s.verseId = null; s.shlokLineIndex = null; } // no chant for these formats
  s.formatId = spec.fmt.id;
  s.targetSec = spec.plan.sec;
  s.lines.forEach((l) => { if (!l.visual) l.visual = spec.topic; if (!l.image) l.image = `${l.visual}, cinematic, moody lighting`; });
  return s;
}

/**
 * ctx: { formatId, targetSec, notes, recentHooks, recentVerseIds, recentFormats, shlokPercent }
 */
export async function generateScript(topic, ctx = {}) {
  const fmt = formatById(ctx.formatId) || formatById(pickFormat({ recent: ctx.recentFormats || [] }));
  const plan = lengthPlan(ctx.targetSec || randomTargetSec(), fmt.shlok);
  const cands = candidateVerses(topic, ctx.recentVerseIds || [], fmt.shlok ? 6 : 4);
  const spec = { fmt, plan, cands, topic, recentHooks: ctx.recentHooks || [], recentVerseIds: ctx.recentVerseIds || [] };
  const model = config.gemini.scriptModel;

  let draft, lastErr;
  for (let i = 0; i < 3 && !draft; i++) {
    try { draft = normalize(await callGemini({ contents: asContents(draftPrompt(topic, spec, ctx.notes)), temperature: 0.95, model }), spec); } catch (e) { lastErr = e; }
  }
  if (!draft) throw new Error(`Script generation failed: ${lastErr?.message}`);

  const candidates = [{ s: draft, errs: lintScript(draft, spec) }];
  for (let pass = 0; pass < 2; pass++) { // editor polish (always once), then one repair if problems remain
    const prev = candidates.at(-1);
    if (pass === 1 && !prev.errs.length) break;
    try {
      const s = normalize(await callGemini({ contents: asContents(polishPrompt(prev.s, spec, prev.errs)), temperature: pass ? 0.4 : 0.6, model }), spec);
      candidates.push({ s, errs: lintScript(s, spec) });
    } catch { /* keep what we have */ }
  }
  candidates.reverse().sort((a, b) => a.errs.length - b.errs.length); // fewest problems wins; on a tie the latest (most polished) version wins
  const best = candidates[0];
  if (best.errs.length) console.warn(`[script] "${topic}" (${fmt.id}) still has: ${best.errs.join(' | ')}`);
  const out = best.s;
  if (fmt.shlok && !out.verseId) { // never ship a broken chant format: degrade to a no-chant story
    out.formatId = 'modern_story'; out.shlokLineIndex = null;
    console.warn(`[script] "${topic}": no verse picked, saved as a no-shlok script`);
  }
  out.estimatedSec = estimateSec(out);
  return out;
}

export { verseById };
