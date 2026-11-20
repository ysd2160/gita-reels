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
          signal: AbortSignal.timeout(Number(process.env.GEMINI_TIMEOUT_MS) || 120000), // a request that hangs is cut after 2 min and retried (before: it could wait forever)
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
      console.warn(`[gemini] try ${attempt}/4 failed (${m}): ${String(e.message).slice(0, 160)}`);
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
      speak: String(l.speak || '').trim(), // what the narrator says: Hindi in Devanagari + English in Latin (written by the AI writer; the Roman caption `show` is derived from it)
      speakOf: String(l.speakOf || ''),
      showOf: String(l.showOf || ''), // plain(speak) that `show` was derived from
      showAuto: String(l.showAuto || ''), // plain(show) exactly as derived (to notice manual edits)
      show: String(l.show || '').trim(),
      visual: String(l.visual || '').trim(),
      image: String(l.image || '').trim(),
    }))
    .filter((l) => l.show || l.speak);
  if (lines.length < 5 || lines.length > 60) throw new Error(`lines count invalid: ${lines.length}`);
  // shlok is switched off: whatever the AI sends, no verse is ever attached (videos are stories only)
  const fmt = formatById(s.format_id ?? s.formatId) || formatById('modern_story');
  const tags = s.hashtags || [];
  const grounding = s.grounding_id ?? s.groundingId;
  return {
    formatId: fmt.id,
    verseId: null,
    groundingId: grounding && verseById(grounding) ? grounding : null,
    targetSec: Number(s.target_sec ?? s.targetSec) || null,
    lines,
    shlokLineIndex: null,
    hookText: String(s.hook_text ?? s.hookText ?? lines[0].show ?? lines[0].speak).trim(),
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

/** how the narrator text ("speak") must be written: Devanagari for Hindi words, Latin for English words, but plain everyday Hindi (NOT shuddh Hindi) */
export const LANGUAGE_RULES = `
LANGUAGE OF THE SPOKEN TEXT (very important, the narrator reads it exactly as written)
- Write every line in DEVANAGARI for Hindi words and in LATIN letters for English words (code-mixed, like a bilingual Indian types it). Never write Roman Hindi (no "nahi", "hai", "tum"): a Roman caption is generated from your text later.
- It is everyday BOLCHAAL Hindi, the way a 22-year-old friend talks on WhatsApp, NOT shuddh / textbook Hindi. Use "तुम", short sentences, fragments are fine.
- Keep these common English words in Latin letters, do not translate them: phone, chat, call, message, mail, resume, result, screen, laptop, overthink, overthinking, stress, mood, time, life, relationship, job, interview, exam, family, friend, love, breakup, post, story, status, online, sorry, plan, problem, tension, normal.
- BANNED heavy words (use the simple word on the right): चिंतन→सोच, व्याकुल→परेशान, अत्यंत→बहुत, प्रयत्न→कोशिश, मनःस्थिति→हाल, इत्यादि→वगैरह, परंतु→पर, किंतु→पर, अतः→इसलिए, समस्या→दिक्कत, अनुभव करना→महसूस करना, निरंतर→लगातार, आत्मविश्वास→भरोसा.
- Spell the way people say it: नहीं, क्यों, मत, और, पर, फिर, कोशिश, जवाब, दोस्त, ज़िंदगी. Numbers as digits (2 बजे, 11 बार). Pauses with "," "।" "..." "?" "!". Do not use half-sentences that a TTS cannot read (no emoji, no hashtags, no brackets).
- GOOD: "रात के 2 बजे, उसने फिर phone उठाया।"   BAD (too heavy): "रात्रि के दो बजे, उसने पुनः दूरभाष उठाया।"   BAD (Roman): "Raat ke 2 baje, usne phir phone uthaya."`;

const SCRIPT_RULES = `
STORYTELLING RULES (every video is ONE STORY, not a lecture; previous videos felt generic and AI-made - fix that)
- The video is a story with a beginning, middle and end: a person (or Arjun / Karn / Krishna), what they want, what goes wrong, the turning point, the result. The viewer must keep thinking "phir kya hua?".
- Tell it in SCENES, present tense ("Raat ke 2 baje, Rohit ne phir uska chat khola."). Never summarise ("wo bahut pareshan tha"); show it with a time, an object, a place, a spoken line.
- Hook = drop into the most tense moment of the story, max 8 words. No greeting, no "aaj hum baat karenge".
- Give the main character a name and ONE specific detail so the viewer sees themselves. Modern stories are clearly fictional ("Rohit naam ka ek ladka...").
- A turn near the middle (mini re-hook: "Par tabhi..."). Every line adds something NEW.
- The lesson is SHOWN by what happens and said ONCE in one short line near the end. No sermon, no "hume seekhna chahiye". Krishna / the Gita can appear only inside the story, in plain Hinglish.
- NO shlok, NO Sanskrit, NO verse numbers, NO chanting anywhere. Never write the words shlok / verse / adhyay.
- Write like a friend talking to ONE person at 2 AM. Use "tum". Short punchy lines, fragments are fine. Max 12 words per line.
- BANNED generic phrases: "aaj ke fast-paced zamane mein", "in today's world", "yaad rakhiye", "dosto", "namaste", "ultimately", "at the end of the day", "life ek journey hai".
- Last line closes the story and leaves a question / open loop so people comment or rewatch.
- Be faithful: only well-known Mahabharat / Gita episodes or a clearly fictional modern person. Never invent quotes, numbers or historical facts. No medical/therapy claims or guarantees.

${LANGUAGE_RULES}
FIELDS
- "speak": the line exactly as the narrator says it, in Devanagari + English-in-Latin as described in LANGUAGE above, written to be spoken: commas / "।" / "..." where a human pauses. Wrap exactly 1 key emotional word per line in *asterisks*, e.g. "तुम *overthink* नहीं कर रहे". Do NOT output a Roman version, it is generated automatically.
- "image": English prompt for an AI image generator for that line: concrete scene + lighting + mood, 15-30 words. NO close-up faces: prefer silhouettes seen from behind, hands, symbolic objects (diya, clock, mirror, storm, river, chariot, candle, empty road), landscapes. Consecutive lines must look DIFFERENT. Show the emotion of the line visually. No text/letters in the image.
- "visual": 2-4 word stock-footage search fallback for the same scene (e.g. "rain window night").`;

export async function generateTopics(count = 20, existing = []) {
  const prompt = `Give ${count} fresh, specific, highly relatable modern-life problems (young Indian audience, 18-35) for short STORY videos (each topic must be a situation that can be told as a short story with a person, a problem and a turn; the Bhagavad Gita idea lives inside the story). Style examples: "Overthinking at 3 AM", "Heartbreak after breakup", "Feeling behind in life". Avoid duplicates of: ${existing.slice(-60).join(', ') || 'none'}.
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

/** Devanagari (+ English in Latin) -> Roman Hinglish caption. Safe direction: a wrong spelling only shows on screen, the voice is not affected. */
export async function speakToRoman(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += 40) {
    const part = texts.slice(i, i + 40);
    const prompt = `Convert each line below into the Roman-letter Hinglish caption that a young Indian creator would type on a reel: Hindi words in Roman letters, English words unchanged.
RULES: keep EXACTLY the same words in the same order (one-to-one, do not rephrase, add or drop words). Keep punctuation and pauses (commas, ..., ?, !); a Devanagari "।" becomes ".". Keep the *asterisks* around the same word. Use common, simple, consistent spellings: nahi, hai, hain, kyun, tum, tumhare, mat, aur, par, phir, koshish, kuch, bas, raat, ek, kya, ho, tha, thi, mein, se, ko, ka, ki, ke, bahut, abhi, jawab, dost. No capital letters except at the start of a sentence, names and English words.
Return JSON ONLY: { "show": ["...", ...] } with exactly ${part.length} items in the same order.
Lines:
${part.map((t, k) => `${k + 1}. ${t}`).join('\n')}`;
    const o = await callGemini({ contents: asContents(prompt), temperature: 0.1 });
    if (!Array.isArray(o.show) || o.show.length !== part.length) throw new Error('Caption conversion mismatch');
    out.push(...o.show.map(String));
  }
  return out;
}

/**
 * Keeps the two texts of every line in step. `speak` (Devanagari, for the voice) is the source of truth for new scripts, `show` (Roman) is the caption.
 *  - only `speak` exists / changed  -> caption derived from it (Devanagari -> Roman, harmless)
 *  - only `show` exists / was edited by hand -> voice text derived from it (Roman -> Devanagari, the old path)
 *  - both changed -> both are trusted as they are
 * Returns true if anything changed.
 */
export async function ensureVoiceText(script) {
  const toSpeak = [], toShow = [];
  let changed = false;
  script.lines.forEach((l, i) => {
    const sp = plain(l.speak), sh = plain(l.show);
    if (!sp && !sh) return;
    if (!sp) return void toSpeak.push(i);
    if (!sh) return void toShow.push(i);
    const tracked = !!(l.showOf || l.speakOf);
    if (!tracked) { l.showOf = sp; l.showAuto = sh; l.speakOf = sh; return void (changed = true); } // both given together: trust them
    const showEdited = l.showOf ? l.showAuto !== sh : l.speakOf !== sh;
    const speakEdited = l.showOf ? l.showOf !== sp : false;
    if (showEdited && speakEdited) { l.showOf = sp; l.showAuto = sh; l.speakOf = sh; changed = true; }
    else if (showEdited) toSpeak.push(i);
    else if (speakEdited) toShow.push(i);
    else if (!l.showOf) { l.showOf = sp; l.showAuto = sh; changed = true; } // old script, already in step: just start tracking
  });
  if (toShow.length) {
    const shown = await speakToRoman(toShow.map((i) => script.lines[i].speak));
    toShow.forEach((i, k) => {
      const l = script.lines[i];
      l.show = shown[k].trim() || plain(l.speak);
      l.speak = plain(l.speak); // *asterisks* only live in the caption; the narrator text stays clean
      l.showOf = plain(l.speak); l.showAuto = plain(l.show); l.speakOf = plain(l.show);
    });
    changed = true;
  }
  if (toSpeak.length) {
    const spoken = await romanToSpeak(toSpeak.map((i) => script.lines[i].show));
    toSpeak.forEach((i, k) => {
      const l = script.lines[i];
      l.speak = spoken[k];
      l.showOf = plain(l.speak); l.showAuto = plain(l.show); l.speakOf = plain(l.show);
    });
    changed = true;
  }
  return changed;
}

const HAS_DEVANAGARI = /[\u0900-\u097F]/;
/** one line of the creator's own script: Devanagari (+ English) goes to the narrator text `speak`, Roman Hinglish goes to the caption `show`; the other one is derived later (ensureVoiceText) */
const ownLine = (l) => {
  const text = String(l.show || l.speak || l.text || '').trim();
  return HAS_DEVANAGARI.test(text) ? { speak: text, show: '' } : { speak: '', show: text };
};

/** The creator pasted their own script (Hinglish). Keep their words, add structure/visuals. */
export async function scriptFromText(text, topic, format = 'short') {
  const clean = String(text || '').trim();
  if (clean.length < 40) throw new Error('Script bahut chhoti hai');
  const imageRules = '"image" = English AI-image prompt for that line (concrete scene + light + mood, 15-30 words, no close-up faces, prefer silhouettes/hands/symbolic objects/landscapes, no text), "visual" = 2-4 word stock search.';
  if (format !== 'long') {
    const prompt = `The creator wrote this Hinglish script for a ${topic ? `short video about "${topic}"` : 'short video'} (Bhagavad Gita channel). KEEP THEIR WORDS AND STYLE; only fix obvious typos, split into short lines (max 12 words each) and add structure. Wrap 1 key word per line in *asterisks* for emphasis.
SCRIPT:
${clean}

Pick the story format that fits best: ${FORMATS.map((f) => `"${f.id}" (${f.label})`).join(', ')}.
- Videos are stories only: set verse_id null and shlok_line_index null ALWAYS. If the creator's text quotes a shlok or Sanskrit, keep only the plain-Hinglish meaning as a normal line and drop the Sanskrit.
Fields: ${imageRules}
The creator's words may be in Devanagari, Roman Hinglish or mixed: keep each line in the SAME script the creator used, do NOT transliterate or translate anything. "hook_text" is always in Roman Hinglish.
Return JSON ONLY: { "format_id": "modern_story", "verse_id": null, "hook_text": "max 7 words", "lines": [ { "text": "...", "image": "...", "visual": "..." } ], "shlok_line_index": null, "cta": "max 6 words", "caption": "1-2 line post caption ending with a question", "hashtags": ["#..."] }`;
    const raw = await callGemini({ contents: asContents(prompt), temperature: 0.3 });
    raw.lines = (raw.lines || []).map((l) => ({ ...l, ...ownLine(l), text: undefined }));
    const s = validateScript(raw);
    s.lines.forEach((l) => { if (!l.visual) l.visual = topic || 'sunrise mountain mist'; if (!l.image) l.image = `${l.visual}, cinematic, moody lighting`; });
    await ensureVoiceText(s).catch(() => {}); // fills the missing Roman caption / Devanagari voice text (retried when the video is made)
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

No shlok / Sanskrit: if the text quotes a verse, keep only its plain-Hinglish meaning as a normal line.
Fields: ${imageRules}
Keep each line in the SAME script the creator used (Devanagari / Roman / mixed), never transliterate or translate.
Return JSON ONLY: { "section_title": "max 5 words", "lines": [ { "text": "...", "image": "...", "visual": "..." } ] }`;
    return callGemini({ contents: asContents(prompt), temperature: 0.3 });
  }));
  const lines = [], shloks = [], sections = [];
  parts.forEach((p) => {
    const ls = (p.lines || []).map((l) => ({ ...ownLine(l), speakOf: '', showOf: '', showAuto: '', image: String(l.image || '').trim(), visual: String(l.visual || '').trim() })).filter((l) => l.show || l.speak);
    const start = lines.length;
    ls.forEach((l) => lines.push({ ...l, visual: l.visual || topic || 'sunrise mountain mist', image: l.image || `${l.visual || topic}, cinematic, moody lighting` }));
    if (ls.length > 2) sections.push({ title: String(p.section_title || 'Part').slice(0, 40), startLine: start });
  });
  if (lines.length < 3) throw new Error('Long script mein kam se kam 3 line chahiye');
  if (lines.length < 20) console.warn(`[script] long script chhoti hai (${lines.length} lines): video 5 min se chhoti banegi, error nahi diya`); // before: this stopped the video with an error
  const meta = await callGemini({ contents: asContents(`Video script (Hinglish):\n${clean.slice(0, 6000)}\nReturn JSON ONLY: { "title": "curiosity-driven YouTube title max 70 chars", "hook_text": "max 7 words", "description": "2-3 line description ending with a question", "tags": ["10 tags"] }`), temperature: 0.5 });
  const draftLong = { lines };
  await ensureVoiceText(draftLong).catch(() => {}); // Roman captions from the Devanagari narrator text (retried when the video is made if this fails)
  return {
    format: 'long', title: String(meta.title || topic).slice(0, 100), hookText: String(meta.hook_text || meta.title || topic), lines, shloks, sections,
    cta: 'Subscribe for daily Gita wisdom', caption: String(meta.description || ''),
    hashtags: (meta.tags || []).map((t) => `#${String(t).replace(/^#/, '').replace(/\s+/g, '')}`).slice(0, 15),
  };
}

/** ChatGPT-style assistant inside the dashboard. May return an updated script for the selected reel. */
export async function chatAssistant(messages, reel) {
  const system = `You are the creative partner of a Hindi/Hinglish faceless channel ("Bhagavad Gita For Modern Problems", Reels/Shorts and one 5-minute YouTube video a day). Talk to the creator in friendly Hinglish. You suggest viral topics, hooks, STORY scripts, captions, posting ideas and improve scripts. Be concrete and honest (say if a hook is weak). Keep replies compact.
EVERY video is a STORY (a character, trouble, a turn, a result), never a lecture and never with a shlok. When asked for a script for ANY topic, write it as a story with that topic as the situation.
Reels are 30-60 seconds (about 2.4 spoken words per second, so roughly 70-140 spoken words in 8-14 lines). Story formats (field format_id): ${FORMATS.map((f) => `${f.id} = ${f.label}`).join('; ')}. verse_id is ALWAYS null and shlok_line_index is ALWAYS null.
${SCRIPT_RULES}
When you return a script: every line has "speak" (Devanagari + English in Latin). Copy the existing "speak" of lines you do NOT change word for word; if an existing line has an empty "speak", write it from its Roman "show". hook_text and cta stay in Roman Hinglish (they are only shown on screen).

${reel?.script ? `CURRENTLY SELECTED ${reel.format === 'long' ? 'LONG VIDEO' : 'REEL'} (topic: ${reel.topic}). Script JSON:\n${JSON.stringify({ ...toApiShape(reel.script), lines: reel.script.lines.map(({ speak, show, image, visual }) => ({ speak: speak || '', show, image, visual })) }, null, 1)}` : 'No reel is selected right now.'}

Always answer with JSON ONLY:
{
  "reply": "your message (plain text, can use line breaks and short lists)",
  "updated_script": null OR the COMPLETE updated script object (same shape as the script JSON above, keep format_id) - only when the creator asks to change/improve/rewrite the SELECTED reel's script,
  "new_script": null OR a COMPLETE script object for a NEW reel (same shape: format_id, verse_id or null, hook_text, lines[{speak,image,visual}], verse_id null, shlok_line_index null, cta, caption, hashtags) - when the creator asks you to write a script for a topic/idea (the creator can then press "Make video" to produce it exactly as written),
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
      await ensureVoiceText(updatedScript).catch(() => {});
      updatedScript.lines.forEach((l) => { if (!l.visual) l.visual = reel?.topic || 'sunrise mountain mist'; if (!l.image) l.image = `${l.visual}, cinematic, moody lighting`; });
    } catch (e) { out.reply = `${out.reply || ''}\n\n(Script update valid nahi tha: ${e.message})`; }
  }
  let newScript = null;
  if (out.new_script) {
    try {
      newScript = validateScript(out.new_script);
      await ensureVoiceText(newScript).catch(() => {});
      newScript.lines.forEach((l) => { if (!l.visual) l.visual = 'sunrise mountain mist'; if (!l.image) l.image = `${l.visual}, cinematic, moody lighting`; });
    } catch (e) { out.reply = `${out.reply || ''}\n\n(Naya script valid nahi tha: ${e.message})`; }
  }
  return { reply: String(out.reply || ''), updatedScript, newScript, topics: Array.isArray(out.topics) ? out.topics.map(String).slice(0, 20) : [] };
}

// ---------------------------------------------------------------- long-form (~5 min) video
function sectionPrompt({ kind, topic, outline, idx, retry = '' }) {
  const words = kind === 'intro' ? '55-70' : kind === 'outro' ? '50-65' : '105-130';
  const plan = outline.sections.map((x, i) => `${i + 1}. ${x.title} (${x.angle})`).join('\n');
  const structure = kind === 'intro'
    ? `Hook (max 8 words) dropped into the most tense moment of the story -> introduce the main character (${outline.character || 'a named person'}) with ONE specific detail (2-3 lines) -> promise that by the end the viewer will know what changed (1 line) -> step into chapter 1.`
    : kind === 'outro'
      ? 'Resolve the story: where the character ends up (3-4 scene lines) -> ONE short lesson line the viewer will screenshot -> a question that makes people comment -> a natural, non-pushy ask to subscribe.'
      : `Continue the SAME story, scene by scene (3-5 scenes with concrete details, a spoken line or two allowed), rising tension. This chapter's turn: ${outline.sections[idx - 1].angle}. End with a cliffhanger line that pulls into the next chapter (the last chapter ends by leading into the finale).`;
  return `You are writing ONE part of a ~${outline.sections.length} minute Hindi/Hinglish STORY video "${outline.title}" for the channel "Bhagavad Gita For Modern Problems".
TOPIC: ${topic}
THE WHOLE STORY (chapters):
${plan}

NOW WRITE: ${kind === 'body' ? `chapter ${idx} "${outline.sections[idx - 1].title}"` : kind.toUpperCase()}
Structure: ${structure}
${SCRIPT_RULES.split('FIELDS')[0]}
- This part: ${words} spoken words, ${kind === 'body' ? '9-14' : '5-10'} lines (at least ${kind === 'body' ? 6 : 4} lines), max 12 words per line. Keep the same character name and details as the outline.
FIELDS: "speak" = what the narrator says, in natural everyday spoken Hindi written in DEVANAGARI with common English words kept in Latin letters (example: "रात के 2 बजे, उसने फिर phone उठाया।"), with commas / "।" / "..." where a human pauses and 1 *emphasis* word per line. NEVER use heavy, bookish or Sanskrit-style Hindi: write the Hindi a 22-year-old really speaks (सोच, परेशान, कोशिश, बहुत; not चिंतन, व्याकुल, प्रयत्न, अत्यंत). Roman captions are generated from this later, so do NOT write any Roman Hindi. "image" = English AI-image prompt (concrete scene, light, mood; no close-up faces, no text), "visual" = 2-4 word stock search.
${retry ? `\nYOUR PREVIOUS ATTEMPT WAS REJECTED: ${retry}. Fix exactly that.\n` : ''}Return JSON ONLY: { "lines": [ { "speak": "...", "image": "...", "visual": "..." } ] }`;
}

export async function generateLongScript(topic, recentTitles = [], notes = '', minutes = 5) {
  const N = [5, 7, 10].includes(Number(minutes)) ? Number(minutes) : 5; // chapters = minutes (every chapter is about one minute)
  const outlinePrompt = `Plan a ~${N} minute Hindi/Hinglish YouTube STORY video for the channel "Bhagavad Gita For Modern Problems".
TOPIC: ${topic}
${notes ? `CREATOR'S NOTES (follow them): ${notes}\n` : ''}Avoid titles similar to: ${recentTitles.join(' | ') || 'none'}
It is ONE continuing story told in exactly ${N} chapters: a named modern fictional person (or a well-known Mahabharat episode) with a problem related to the topic. Chapter by chapter: the trouble grows, a turn happens in the middle, the result comes in the last chapter. The Gita idea appears only inside the story, in plain words. NO shlok, NO Sanskrit, NO verse numbers.
Return JSON ONLY: { "title": "curiosity-driven YouTube title, max 70 chars, Hinglish ok", "hook_text": "max 7 words on-screen opener", "character": "name + one specific detail", "description": "2-3 line YouTube description ending with a question", "tags": ["10 tags without #"], "sections": [ { "title": "max 5 words", "angle": "one line: what happens in this chapter + how it turns" } ] }`;
  let outline;
  for (let i = 0; i < 3 && !outline; i++) {
    try {
      const o = await callGemini({ contents: asContents(outlinePrompt), temperature: 0.9 });
      if (o.sections?.length >= Math.max(4, N - 2) && o.sections.every((x) => x.title && x.angle)) outline = { ...o, sections: o.sections.slice(0, N) };
    } catch { /* retry */ }
  }
  if (!outline) throw new Error('Long outline generation failed');
  const jobs = [{ kind: 'intro' }, ...outline.sections.map((x, i) => ({ kind: 'body', idx: i + 1 })), { kind: 'outro' }];
  const parts = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (next < jobs.length) {
      const k = next++;
      let lastErr;
      const need = jobs[k].kind === 'body' ? 6 : 3; // intro / outro are short by design
      let best = [];
      for (let a = 0; a < 4 && !parts[k]; a++) {
        try {
          const j = jobs[k];
          const o = await callGemini({ contents: asContents(sectionPrompt({ kind: j.kind, topic, outline, idx: j.idx, retry: a ? String(lastErr?.message || '') : '' })), temperature: 0.9 });
          const lines = (o.lines || []).map((l) => ({ speak: String(l.speak || '').trim(), speakOf: '', showOf: '', showAuto: '', show: String(l.show || '').trim(), image: String(l.image || '').trim(), visual: String(l.visual || '').trim() })).filter((l) => l.speak || l.show);
          if (lines.length > best.length) best = lines;
          if (lines.length < (a >= 2 ? Math.max(2, need - 2) : need)) throw new Error(`too few lines (${lines.length}); write at least ${need} lines`);
          parts[k] = { lines };
        } catch (e) { lastErr = e; }
      }
      if (!parts[k] && best.length >= 2) { parts[k] = { lines: best }; console.warn(`[script] long part ${k}: sirf ${best.length} lines mili, wahi use ki (error nahi diya)`); } // a short part no longer stops the whole video
      if (!parts[k]) throw new Error(`Long script part ${k} failed: ${lastErr?.message}`);
    }
  }));
  const lines = [], shloks = [], sections = [];
  parts.forEach((p, k) => {
    const start = lines.length;
    p.lines.forEach((l) => lines.push({ ...l, image: l.image || `${l.visual || topic}, cinematic, moody lighting`, visual: l.visual || topic }));
    if (jobs[k].kind === 'body') {
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
Give ${shorts} SHORT-video topics (specific relatable situations that can be told as a short story, max 6 words each, e.g. "Overthinking at 3 AM") and ${long} LONG-video themes (~5 min, each is ONE story told in 5 chapters, max 9 words, e.g. "Ek ladka jo har cheez mein late tha"). All different from each other and from: ${avoid.slice(-80).join(', ') || 'none'}.
Return JSON ONLY: { "shorts": ["..."], "long": ["..."] }`;
  const o = await callGemini({ contents: asContents(prompt), temperature: 1 });
  return { shorts: (o.shorts || []).map(String).slice(0, shorts), long: (o.long || []).map(String).slice(0, long) };
}


// ---------------------------------------------------------------- weekly plan
/** Topics for planned shorts. slots = [{formatId}] -> one topic per slot, each fitting its format. */
export async function generateWeekTopics({ slots, avoid = [], brief = '' }) {
  if (!slots.length) return [];
  const list = slots.map((sl, i) => { const f = formatById(sl.formatId); return `${i + 1}. format "${f.label}" - ${f.desc}`; }).join('\n');
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
- "kind": "long" if the plan marks this item as the long / 5 minute / lamba video, otherwise "short". (Normally each day has 3 shorts and at most 1 long.)
- "topic": short topic/title in Hinglish or English (max 9 words).
- "format_id": the best match of ${FORMATS.map((f) => `"${f.id}" (${f.label})`).join(', ')}; null if you cannot tell. Words like kahani/story/aaj ki kahani -> modern_story, Mahabharat/Karn/Arjun ki kahani -> epic_story, sawaal-jawab/Arjun-Krishna baat -> dialogue, twist/ant/palat -> twist_story, raaz/mystery/fact -> mystery. There is no shlok format: ignore shlok instructions.
- "notes": any angle, idea, hook or instruction the plan gives for this reel (one or two sentences, may be empty).
- "script_text": the COMPLETE ready-to-speak script of this reel if the document contains one (copy it word for word), else null. Do not invent scripts.
Do not invent reels that are not in the plan. If a day has several reels, return each as its own item with the same day.
Return JSON ONLY: { "items": [ { "day": 1, "date": null, "kind": "short", "topic": "...", "format_id": null, "notes": "", "script_text": null } ] }`;
  const o = await callGemini({ contents: asContents(prompt, parts), temperature: 0.1 });
  return (Array.isArray(o.items) ? o.items : []).map((it) => ({
    day: Number.isInteger(it.day) ? it.day : parseInt(it.day, 10) || null,
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(it.date || '')) ? String(it.date) : null,
    kind: String(it.kind || '').toLowerCase() === 'long' ? 'long' : 'short',
    topic: String(it.topic || '').trim().slice(0, 140),
    formatId: formatById(it.format_id || it.formatId) ? (it.format_id || it.formatId) : null,
    notes: String(it.notes || '').trim().slice(0, 600),
    scriptText: it.script_text && String(it.script_text).trim().length >= 40 ? String(it.script_text).trim() : null,
  })).filter((it) => it.topic);
}
