import { config } from '../config.js';
import { VERSES, verseById } from '../verses.js';
import { FORMATS, formatById } from '../formats.js';
import { withKeys } from './keypool.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function callGemini({ contents, system, temperature = 0.9, model }) {
  const m = model || config.gemini.model;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      // several keys: when one hits its limit the next key is used automatically
      const data = await withKeys('gemini', `gemini:${m}`, async (key) => {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            contents,
            ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
            generationConfig: { temperature, responseMimeType: 'application/json' },
          }),
        });
        if (!res.ok) {
          const err = new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
          err.status = res.status; // 401/403/429 -> next key
          err.retry = res.status >= 500;
          throw err;
        }
        return res.json();
      });
      const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
      if (!text) throw new Error('Gemini ne empty response diya');
      return JSON.parse(text.replace(/^```json\s*|```$/g, '').trim());
    } catch (e) {
      lastErr = e;
      if (e.allLimited) { // every key is resting: wait for the first one only if it is back soon
        if (!(e.retryInMs <= 65000)) break;
        await sleep(e.retryInMs + 500);
        continue;
      }
      if (e.retry === false) break;
      await sleep(1500 * attempt);
    }
  }
  throw lastErr;
}
export const asContents = (prompt, extraParts = []) => [{ role: 'user', parts: [...extraParts, { text: prompt }] }];

// ---------------------------------------------------------------- script shape
export function validateScript(s) {
  if (!s || !Array.isArray(s.lines)) throw new Error('lines missing');
  const lines = s.lines
    .map((l) => ({
      speak: String(l.speak || '').trim(), // derived automatically (Hindi in Devanagari for the TTS); creators only write Hinglish
      speakOf: String(l.speakOf || ''),
      show: String(l.show || '').trim(),
      visual: String(l.visual || '').trim(),
      image: String(l.image || '').trim(),
    }))
    .filter((l) => l.show);
  if (lines.length < 5 || lines.length > 26) throw new Error(`lines count invalid: ${lines.length}`);
  // a verse is optional: story / mystery / deep-truth reels have no shlok. If a verse_id is given it is chanted.
  const rawVerse = s.verse_id ?? s.verseId;
  const verse = rawVerse && rawVerse !== 'null' ? verseById(rawVerse) : null;
  if (rawVerse && rawVerse !== 'null' && !verse) throw new Error(`unknown verse_id: ${rawVerse}`);
  const fmt = formatById(s.format_id ?? s.formatId) || (verse ? formatById('classic') : formatById('story'));
  let idx = Number.isInteger(s.shlok_line_index ?? s.shlokLineIndex) ? (s.shlok_line_index ?? s.shlokLineIndex) : 3;
  idx = Math.min(Math.max(idx, 1), lines.length - 2);
  const tags = s.hashtags || [];
  const grounding = s.grounding_id ?? s.groundingId;
  return {
    formatId: fmt.id,
    verseId: verse ? verse.id : null,
    groundingId: grounding && verseById(grounding) ? grounding : null,
    targetSec: Number(s.target_sec ?? s.targetSec) || null,
    lines,
    shlokLineIndex: verse ? idx : null,
    hookText: String(s.hook_text ?? s.hookText ?? lines[0].show).trim(),
    cta: String(s.cta || 'Follow for daily Gita wisdom').trim(),
    caption: String(s.caption || '').trim(),
    hashtags: (Array.isArray(tags) ? tags : String(tags).split(/[\s,]+/)).filter(Boolean).map((h) => String(h).replace(/^#?/, '#')).slice(0, 12),
  };
}
export const toApiShape = (s) => ({
  format_id: s.formatId, verse_id: s.verseId, grounding_id: s.groundingId, target_sec: s.targetSec, hook_text: s.hookText, lines: s.lines, shlok_line_index: s.shlokLineIndex,
  cta: s.cta, caption: s.caption, hashtags: s.hashtags,
});

const HOOK_STYLES = [
  'a relatable late-night moment ("Raat ke 2 baje, phone haath mein...")',
  'a bold uncomfortable truth ("Sach ye hai ki...")',
  'a mistake most people make ("Tum galat jagah dhoondh rahe ho...")',
  'a direct question that stings ("Kya tum bhi ... ?")',
  'a surprising claim about Krishna/Gita that makes people curious ("Gita mein sabse ignore kiya gaya sabak...")',
  'a "pattern interrupt" command ("Ruko. Ye sunne ke baad ...")',
];

const SCRIPT_RULES = `
VOICE & ENGAGEMENT (previous videos felt generic and AI-made - fix that)
- Write like a real person talking to ONE friend at 2 AM, not a preacher or a blog. Use "tum". Specific everyday moments (unread message, 3 AM ceiling, rejection mail, WhatsApp "last seen", comparing on Instagram) instead of abstract words.
- Strong emotion + rhythm: punchy lines, some fragments. Mix 3-word lines with 9-word lines. Max 10 words per line.
- BANNED generic phrases: "aaj ke fast-paced zamane mein", "in today's world", "yaad rakhiye", "dosto", "namaste", "ultimately", "at the end of the day", "life ek journey hai".
- Open loop in the first 2 lines (promise a payoff), deliver it with the verse meaning, end with a loop/question that makes people comment or rewatch.
- 9 to 11 lines. TOTAL 60-80 spoken words (25-35 sec). Hook line max 8 words.
- Structure: hook -> pain (2 lines, viewer feels seen) -> "Shri Krishna ne Gita mein kaha tha..." line (this is shlok_line_index; the Sanskrit verse is then chanted by the narrator, so this line must lead naturally into it) -> meaning in plain modern words (2 lines) -> ONE tiny action for today -> closing loop line.
- Be FAITHFUL to the verse meaning given in the bank. Never invent quotes or meanings. Do not write the Sanskrit in lines.
- No medical/therapy claims, fear-mongering or guarantees.

FIELDS
- "show": the line in natural Hinglish (Hindi words in Roman letters, English words as they are), exactly how a young Indian creator speaks. This text is both the on-screen caption AND what the narrator says, so write it to be spoken: simple consistent spelling (nahi, hai, kyun, tum, mat), commas/full stops/... where a human would pause. Wrap 1 key emotional word per line in *asterisks*, e.g. "Tum *overthink* nahi kar rahe".
- "image": English prompt for an AI image generator for that line: concrete scene + lighting + mood, 15-30 words. NO close-up faces: prefer silhouettes seen from behind, hands, symbolic objects (diya, clock, mirror, storm, river, chariot, candle, empty road), landscapes. Consecutive lines must look DIFFERENT. Show the emotion of the line visually. For the Krishna line: silhouette of Lord Krishna playing flute with peacock feather against glowing sky. No text/letters in the image.
- "visual": 2-4 word stock-footage search fallback for the same scene (e.g. "rain window night").`;

export async function generateTopics(count = 20, existing = []) {
  const prompt = `Give ${count} fresh, specific, highly relatable modern-life problems (young Indian audience, 18-35) for short videos that answer each with a Bhagavad Gita verse. Style examples: "Overthinking at 3 AM", "Heartbreak after breakup", "Feeling behind in life". Avoid duplicates of: ${existing.slice(-60).join(', ') || 'none'}.
Return JSON ONLY: { "topics": ["...", "..."] } (max 6 words each).`;
  const out = await callGemini({ contents: asContents(prompt), temperature: 1 });
  return (out.topics || []).map((t) => String(t).trim()).filter(Boolean);
}

/** Hinglish (Roman) -> mixed script for TTS: Hindi words in Devanagari, English words in Latin. (TTS engines read this far better than Roman Hindi.) */
export async function romanToSpeak(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += 40) {
    const part = texts.slice(i, i + 40);
    const prompt = `Rewrite each Hinglish line for a voice narrator: Hindi words in Devanagari script, English words in Latin script (code-mixed), exactly like a bilingual Indian reader would write it. Keep the meaning, tone and words; do not translate English words; keep punctuation and pauses (commas, ..., ?, !), end sentences with । or ? or !. Remove any *asterisks*.
Return JSON ONLY: { "speak": ["...", ...] } with exactly ${part.length} items in the same order.
Lines:
${part.map((t, k) => `${k + 1}. ${t.replace(/\*/g, '')}`).join('\n')}`;
    const o = await callGemini({ contents: asContents(prompt), temperature: 0.2 });
    if (!Array.isArray(o.speak) || o.speak.length !== part.length) throw new Error('Voice-text conversion mismatch');
    out.push(...o.speak.map(String));
  }
  return out;
}

const plain = (s) => String(s || '').replace(/\*/g, '').replace(/\s+/g, ' ').trim();
/** Fill / refresh `speak` for lines whose Hinglish changed. Returns true if anything changed. */
export async function ensureVoiceText(script) {
  const todo = script.lines.map((l, i) => i).filter((i) => !script.lines[i].speak || script.lines[i].speakOf !== plain(script.lines[i].show));
  if (!todo.length) return false;
  const speak = await romanToSpeak(todo.map((i) => script.lines[i].show));
  todo.forEach((i, k) => { script.lines[i].speak = speak[k]; script.lines[i].speakOf = plain(script.lines[i].show); });
  return true;
}

/** The creator pasted their own script (Hinglish). Keep their words, add structure/visuals. */
export async function scriptFromText(text, topic, format = 'short') {
  const bank = VERSES.map((v) => `- ${v.id} | ${v.ref} | themes: ${v.themes}\n    meaning: ${v.meaning}`).join('\n');
  const clean = String(text || '').trim();
  if (clean.length < 40) throw new Error('Script bahut chhoti hai');
  const imageRules = '"image" = English AI-image prompt for that line (concrete scene + light + mood, 15-30 words, no close-up faces, prefer silhouettes/hands/symbolic objects/landscapes, no text), "visual" = 2-4 word stock search.';
  if (format !== 'long') {
    const prompt = `The creator wrote this Hinglish script for a ${topic ? `short video about "${topic}"` : 'short video'} (Bhagavad Gita channel). KEEP THEIR WORDS AND STYLE; only fix obvious typos, split into short lines (max 12 words each) and add structure. Wrap 1 key word per line in *asterisks* for emphasis.
SCRIPT:
${clean}

Decide what kind of reel this is: ${FORMATS.map((f) => `"${f.id}" (${f.label}${f.shlok ? ', has a chanted shlok' : ', no shlok'})`).join(', ')}.
- If it is a story / mystery / list / dialogue / challenge that needs NO verse, set format_id accordingly, verse_id null and shlok_line_index null. Do NOT force a shlok into it.
- If the script talks about Krishna's words or explains a verse, set a "shlok" format, pick the best verse from this bank (id) and set shlok_line_index (0-based line after which the narrator chants it). If the script does not already introduce Krishna/the Gita right before the meaning, add ONE short lead-in line like "Shri Krishna ne Gita mein kaha tha..." at the right place.
${bank}
Fields: ${imageRules}
Return JSON ONLY: { "format_id": "story", "verse_id": null, "hook_text": "max 7 words", "lines": [ { "show": "...", "image": "...", "visual": "..." } ], "shlok_line_index": null, "cta": "max 6 words", "caption": "1-2 line post caption ending with a question", "hashtags": ["#..."] }`;
    const s = validateScript(await callGemini({ contents: asContents(prompt), temperature: 0.3 }));
    s.lines.forEach((l) => { if (!l.visual) l.visual = topic || 'sunrise mountain mist'; if (!l.image) l.image = `${l.visual}, cinematic, moody lighting`; });
    return s;
  }
  // long: split into ~6 groups of paragraphs, structure each group, then title/description
  const paras = clean.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const per = Math.max(1, Math.ceil(paras.length / 6));
  const groups = [];
  for (let i = 0; i < paras.length; i += per) groups.push(paras.slice(i, i + per).join('\n'));
  const parts = await Promise.all(groups.map(async (g, gi) => {
    const prompt = `Part ${gi + 1} of ${groups.length} of a ~5 minute Hinglish Bhagavad Gita video written by the creator. KEEP THEIR WORDS; only fix typos and split into short lines (max 12 words). Wrap 1 key word per line in *asterisks*.
PART TEXT:
${g}

If this part explains/quotes a Gita verse, pick the best matching verse id from the bank and set shlok_line_index to the 0-based line after which the narrator should chant it (add a short lead-in line like "Shri Krishna ne Gita mein kaha tha..." if missing). If the part has no verse (intro/outro), use verse_id null and shlok_line_index null.
${bank}
Fields: ${imageRules}
Return JSON ONLY: { "section_title": "max 5 words", "verse_id": "bg-2-47 or null", "shlok_line_index": 3, "lines": [ { "show": "...", "image": "...", "visual": "..." } ] }`;
    return callGemini({ contents: asContents(prompt), temperature: 0.3 });
  }));
  const lines = [], shloks = [], sections = [];
  parts.forEach((p) => {
    const ls = (p.lines || []).map((l) => ({ speak: '', speakOf: '', show: String(l.show || '').trim(), image: String(l.image || '').trim(), visual: String(l.visual || '').trim() })).filter((l) => l.show);
    const start = lines.length;
    ls.forEach((l) => lines.push({ ...l, visual: l.visual || topic || 'sunrise mountain mist', image: l.image || `${l.visual || topic}, cinematic, moody lighting` }));
    if (p.verse_id && verseById(p.verse_id) && ls.length > 2) {
      const idx = Math.min(Math.max(Number.isInteger(p.shlok_line_index) ? p.shlok_line_index : 2, 1), ls.length - 2);
      shloks.push({ afterLine: start + idx, verseId: p.verse_id });
      sections.push({ title: String(p.section_title || 'Part').slice(0, 40), startLine: start });
    }
  });
  if (lines.length < 20) throw new Error('Long script ke liye text kam hai (kam se kam ~400 words likho)');
  const meta = await callGemini({ contents: asContents(`Video script (Hinglish):\n${clean.slice(0, 6000)}\nReturn JSON ONLY: { "title": "curiosity-driven YouTube title max 70 chars", "hook_text": "max 7 words", "description": "2-3 line description ending with a question", "tags": ["10 tags"] }`), temperature: 0.5 });
  return {
    format: 'long', title: String(meta.title || topic).slice(0, 100), hookText: String(meta.hook_text || meta.title || topic), lines, shloks, sections,
    cta: 'Subscribe for daily Gita wisdom', caption: String(meta.description || ''),
    hashtags: (meta.tags || []).map((t) => `#${String(t).replace(/^#/, '').replace(/\s+/g, '')}`).slice(0, 15),
  };
}

/** ChatGPT-style assistant inside the dashboard. May return an updated script for the selected reel. */
export async function chatAssistant(messages, reel) {
  const system = `You are the creative partner of a Hindi/Hinglish faceless spiritual channel ("Bhagavad Gita For Modern Problems", Reels/Shorts, 25-40 sec). Talk to the creator in friendly Hinglish. You suggest viral topics, hooks, scripts, captions, posting ideas and improve scripts. Be concrete and honest (say if a hook is weak). Keep replies compact.
Reels are 30-60 seconds (about 2.4 spoken words per second; a chanted shlok adds ~12 s). Reel formats (field format_id): ${FORMATS.map((f) => `${f.id} = ${f.label} (${f.shlok ? 'with shlok' : 'no shlok'})`).join('; ')}.
Not every reel needs a shlok: story, mystery, deep-truth, dialogue, myth and challenge reels have verse_id null and shlok_line_index null. Never repeat the same hook style or the same shlok back to back.
Verse bank (only these verse_ids may be used):
${VERSES.map((v) => `${v.id}: ${v.ref} (${v.themes})`).join('\n')}
${SCRIPT_RULES}
(The "9 to 11 lines / 60-80 words / structure" lines above describe only the classic shlok reel. For any other format follow that format's shape and aim for a 30-60 second reel, i.e. roughly 70-140 spoken words.)

${reel?.script ? `CURRENTLY SELECTED ${reel.format === 'long' ? 'LONG VIDEO' : 'REEL'} (topic: ${reel.topic}). Script JSON:\n${JSON.stringify({ ...toApiShape(reel.script), lines: reel.script.lines.map(({ show, image, visual }) => ({ show, image, visual })) }, null, 1)}` : 'No reel is selected right now.'}

Always answer with JSON ONLY:
{
  "reply": "your message (plain text, can use line breaks and short lists)",
  "updated_script": null OR the COMPLETE updated script object (same shape as the script JSON above, keep format_id) - only when the creator asks to change/improve/rewrite the SELECTED reel's script,
  "new_script": null OR a COMPLETE script object for a NEW reel (same shape: format_id, verse_id or null, hook_text, lines[{show,image,visual}], shlok_line_index or null, cta, caption, hashtags) - when the creator asks you to write a script for a topic/idea (the creator can then press "Make video" to produce it exactly as written),
  "topics": [ "optional list of topic ideas if the creator asked for ideas" ]
}`;
  const contents = messages.slice(-14).map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(m.content || '').slice(0, 6000) }],
  }));
  const out = await callGemini({ contents, system, temperature: 0.8 });
  let updatedScript = null;
  if (out.updated_script) {
    try {
      updatedScript = validateScript(out.updated_script);
      updatedScript.lines.forEach((l) => { if (!l.visual) l.visual = reel?.topic || 'sunrise mountain mist'; if (!l.image) l.image = `${l.visual}, cinematic, moody lighting`; });
    } catch (e) { out.reply = `${out.reply || ''}\n\n(Script update valid nahi tha: ${e.message})`; }
  }
  let newScript = null;
  if (out.new_script) {
    try {
      newScript = validateScript(out.new_script);
      newScript.lines.forEach((l) => { if (!l.visual) l.visual = 'sunrise mountain mist'; if (!l.image) l.image = `${l.visual}, cinematic, moody lighting`; });
    } catch (e) { out.reply = `${out.reply || ''}\n\n(Naya script valid nahi tha: ${e.message})`; }
  }
  return { reply: String(out.reply || ''), updatedScript, newScript, topics: Array.isArray(out.topics) ? out.topics.map(String).slice(0, 20) : [] };
}

// ---------------------------------------------------------------- long-form (~5 min) video
function sectionPrompt({ kind, topic, outline, idx, verse }) {
  const words = kind === 'intro' ? '55-70' : kind === 'outro' ? '50-65' : '105-130';
  const plan = outline.sections.map((x, i) => `${i + 1}. ${x.title} (${x.angle})`).join('\n');
  const structure = kind === 'intro'
    ? 'Hook (max 8 words) -> relatable pain in 2-3 lines -> promise what this video will give them -> short bridge into part 1. No verse.'
    : kind === 'outro'
      ? 'Quick recap of the journey in 2-3 lines -> one emotional closing thought -> a question that makes people comment -> ask them to subscribe in a natural, non-pushy way. No verse.'
      : `Story/pain moment (3-4 lines, specific everyday scene) -> ONE lead-in line like "Shri Krishna ne Gita mein kaha tha..." (its 0-based index = shlok_line_index; the narrator then chants the verse) -> meaning of the verse in plain modern words (3 lines, faithful to: ${verse.meaning}) -> ONE tiny action for today (1-2 lines) -> a bridge line into the next part.`;
  return `You are writing ONE part of a ~5 minute Hindi/Hinglish YouTube video "${outline.title}" for the channel "Bhagavad Gita For Modern Problems".
TOPIC: ${topic}
FULL OUTLINE:
${plan}

NOW WRITE: ${kind === 'body' ? `part ${idx} "${outline.sections[idx - 1].title}" using verse ${verse.ref}` : kind.toUpperCase()}
Structure: ${structure}
${SCRIPT_RULES.split('FIELDS')[0].replace(/- 9 to 11 lines[^\n]*\n/, '').replace(/- Structure:[^\n]*\n/, '')}
- This part: ${words} spoken words, 9-14 lines, max 12 words per line.
FIELDS: "show" = natural spoken Hinglish (Hindi words in Roman letters, English as is; this is both the caption and what the narrator says; commas/full stops where a human pauses) with 1 *emphasis* word per line, "image" = English AI-image prompt (concrete scene, light, mood; no close-up faces, no text), "visual" = 2-4 word stock search.
Return JSON ONLY: { "lines": [ { "show": "...", "image": "...", "visual": "..." } ], "shlok_line_index": ${kind === 'body' ? 4 : 'null'} }`;
}

export async function generateLongScript(topic, recentTitles = []) {
  const bank = VERSES.map((v) => `- ${v.id} | ${v.ref} | themes: ${v.themes}`).join('\n');
  const outlinePrompt = `Plan a ~5 minute Hindi/Hinglish YouTube video for the channel "Bhagavad Gita For Modern Problems".
TOPIC: ${topic}
Avoid titles similar to: ${recentTitles.join(' | ') || 'none'}
Make it a list-style or journey-style video with exactly 5 parts, each using a DIFFERENT verse from this bank (use ids):
${bank}
Return JSON ONLY: { "title": "curiosity-driven YouTube title, max 70 chars, Hinglish ok", "hook_text": "max 7 words on-screen opener", "description": "2-3 line YouTube description ending with a question", "tags": ["10 tags without #"], "sections": [ { "title": "max 5 words", "verse_id": "bg-2-47", "angle": "one line: the life situation + what the verse teaches" } ] }`;
  let outline;
  for (let i = 0; i < 3 && !outline; i++) {
    try {
      const o = await callGemini({ contents: asContents(outlinePrompt), temperature: 0.9 });
      const ids = (o.sections || []).map((x) => x.verse_id);
      if (o.sections?.length >= 4 && ids.every((id) => verseById(id)) && new Set(ids).size === ids.length) outline = o;
    } catch { /* retry */ }
  }
  if (!outline) throw new Error('Long outline generation failed');
  const jobs = [{ kind: 'intro' }, ...outline.sections.map((x, i) => ({ kind: 'body', idx: i + 1, verse: verseById(x.verse_id) })), { kind: 'outro' }];
  const parts = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (next < jobs.length) {
      const k = next++;
      let lastErr;
      for (let a = 0; a < 3 && !parts[k]; a++) {
        try {
          const j = jobs[k];
          const o = await callGemini({ contents: asContents(sectionPrompt({ kind: j.kind, topic, outline, idx: j.idx, verse: j.verse })), temperature: 0.9 });
          const lines = (o.lines || []).map((l) => ({ speak: '', speakOf: '', show: String(l.show || '').trim(), image: String(l.image || '').trim(), visual: String(l.visual || '').trim() })).filter((l) => l.show);
          if (lines.length < 6) throw new Error('too few lines');
          let sh = Number.isInteger(o.shlok_line_index) ? o.shlok_line_index : 4;
          sh = Math.min(Math.max(sh, 1), lines.length - 2);
          parts[k] = { lines, sh };
        } catch (e) { lastErr = e; }
      }
      if (!parts[k]) throw new Error(`Long script part ${k} failed: ${lastErr?.message}`);
    }
  }));
  const lines = [], shloks = [], sections = [];
  parts.forEach((p, k) => {
    const start = lines.length;
    p.lines.forEach((l) => lines.push({ ...l, image: l.image || `${l.visual || topic}, cinematic, moody lighting`, visual: l.visual || topic }));
    if (jobs[k].kind === 'body') {
      shloks.push({ afterLine: start + p.sh, verseId: jobs[k].verse.id });
      sections.push({ title: outline.sections[jobs[k].idx - 1].title, startLine: start });
    }
  });
  return {
    format: 'long',
    title: String(outline.title).slice(0, 100),
    hookText: String(outline.hook_text || outline.title).trim(),
    lines, shloks, sections,
    cta: 'Subscribe for daily Gita wisdom',
    caption: String(outline.description || '').trim(),
    hashtags: (outline.tags || []).map((t) => `#${String(t).replace(/^#/, '').replace(/\s+/g, '')}`).slice(0, 15),
  };
}

// ---------------------------------------------------------------- content plan topics
export async function generatePlanTopics({ shorts = 0, long = 0, avoid = [] }) {
  const prompt = `Plan content for a Hindi/Hinglish channel "Bhagavad Gita For Modern Problems" (young Indian audience, 18-35).
Give ${shorts} SHORT-video topics (specific relatable problems, max 6 words each, e.g. "Overthinking at 3 AM") and ${long} LONG-video themes (~5 min list/journey style, max 9 words, e.g. "5 Gita lessons when life feels stuck"). All different from each other and from: ${avoid.slice(-80).join(', ') || 'none'}.
Return JSON ONLY: { "shorts": ["..."], "long": ["..."] }`;
  const o = await callGemini({ contents: asContents(prompt), temperature: 1 });
  return { shorts: (o.shorts || []).map(String).slice(0, shorts), long: (o.long || []).map(String).slice(0, long) };
}


// ---------------------------------------------------------------- weekly plan
/** Topics for planned shorts. slots = [{formatId}] -> one topic per slot, each fitting its format. */
export async function generateWeekTopics({ slots, avoid = [], brief = '' }) {
  if (!slots.length) return [];
  const list = slots.map((sl, i) => { const f = formatById(sl.formatId); return `${i + 1}. format "${f.label}" (${f.shlok ? 'will have a chanted shlok' : 'no shlok'}) - ${f.desc}`; }).join('\n');
  const prompt = `Plan content for a Hindi/Hinglish channel "Bhagavad Gita For Modern Problems" (young Indian audience, 18-35, 30-60 second reels).
${brief ? `THE CREATOR'S BRIEF FOR THIS PERIOD (follow it): ${brief}\n` : ''}Give exactly ${slots.length} topics, one per numbered slot, each one fitting the slot's FORMAT:
${list}
Rules: specific and relatable (max 8 words), e.g. "Overthinking at 3 AM", "Karn ka sabse bada dukh", "Gita ka pehla shabd kya hai?", "Dost se dhokha". All topics must differ from each other and from: ${avoid.slice(-80).join(', ') || 'none'}. Spread different life problems (work, love, family, money, health of mind, comparison, anger, fear...) across the list.
Return JSON ONLY: { "topics": ["...", "..."] } with exactly ${slots.length} strings in the same order.`;
  const o = await callGemini({ contents: asContents(prompt), temperature: 1 });
  return (o.topics || []).map((t) => String(t).trim());
}

/**
 * Read a weekly plan from text and/or a file (PDF, image, txt) with Gemini.
 * Returns [{ day, date, topic, formatId, notes, scriptText }] in the order of the document.
 */
export async function extractWeekPlan({ text = '', file = null, brief = '' }) {
  const parts = [];
  if (file?.data) parts.push({ inlineData: { mimeType: file.mime || 'application/pdf', data: file.data } });
  const prompt = `The creator of a Hindi/Hinglish Bhagavad Gita reels channel gave you a WEEKLY CONTENT PLAN${file ? ' (attached file)' : ''}${text ? ' (pasted text below)' : ''}. Extract every planned reel, in order.
${text ? `PASTED TEXT:\n"""\n${String(text).slice(0, 30000)}\n"""\n` : ''}${brief ? `Extra instruction from the creator: ${brief}\n` : ''}
For each reel return:
- "day": the day number inside the plan (1 = first day of the plan, 2 = second ...). If the plan names weekdays (Monday/Somvar ...) number them in the order they appear.
- "date": "YYYY-MM-DD" ONLY if the document gives an explicit calendar date, else null.
- "topic": short topic/title in Hinglish or English (max 9 words).
- "format_id": the best match of ${FORMATS.map((f) => `"${f.id}" (${f.label})`).join(', ')}; null if you cannot tell. Words like kahani/story -> story, raaz/mystery/fact -> mystery, sawaal-jawab/Arjun -> dialogue, shlok -> classic or decode, "3 baatein/deep" -> deep_truth, myth -> myth, challenge/task -> challenge.
- "notes": any angle, idea, hook, shlok or instruction the plan gives for this reel (one or two sentences, may be empty).
- "script_text": the COMPLETE ready-to-speak script of this reel if the document contains one (copy it word for word), else null. Do not invent scripts.
Do not invent reels that are not in the plan. If a day has several reels, return each as its own item with the same day.
Return JSON ONLY: { "items": [ { "day": 1, "date": null, "topic": "...", "format_id": null, "notes": "", "script_text": null } ] }`;
  const o = await callGemini({ contents: asContents(prompt, parts), temperature: 0.1 });
  return (Array.isArray(o.items) ? o.items : []).map((it) => ({
    day: Number.isInteger(it.day) ? it.day : parseInt(it.day, 10) || null,
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(it.date || '')) ? String(it.date) : null,
    topic: String(it.topic || '').trim().slice(0, 140),
    formatId: formatById(it.format_id || it.formatId) ? (it.format_id || it.formatId) : null,
    notes: String(it.notes || '').trim().slice(0, 600),
    scriptText: it.script_text && String(it.script_text).trim().length >= 40 ? String(it.script_text).trim() : null,
  })).filter((it) => it.topic);
}
