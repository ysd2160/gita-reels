// Reel FORMATS: every video is a STORY (character -> trouble -> turn -> result), told in 30-60 seconds.
// The different formats only change the kind of story, so videos stop looking the same.
// There is NO shlok / chant anywhere (shlok is always false). The Gita idea lives inside the story, in plain Hinglish.
//
// Speaking speed used for length maths: ~2.4 Hinglish words per second (TTS + natural pauses).
export const WORDS_PER_SEC = 2.4;
export const CHANT_SEC = 12.5; // chant + hold, average
export const MIN_SEC = 30;
export const MAX_SEC = 120; // a short can be up to 2 minutes (Settings -> Reel ki length)

export const FORMATS = [
  {
    id: 'modern_story', label: 'Aaj ki kahani', shlok: false, weight: 5,
    desc: 'Ek naam wala aam insaan, ek asli situation, ek mod aur ant mein ek seekh. Poori video ek kahani.',
    hooks: ['Usne 11 baar resume bheja. Ek bhi jawab nahi.', 'Raat ke 2 baje, Riya ka phone phir *vibrate* hua.', 'Papa ka call aaya. Rohan ne uthaya *nahi*.'],
    structure: `hook = the most tense moment of the story, dropped in the middle (max 8 words) -> WHO: a named ordinary person with ONE specific detail (age, job, city, an object) in 1-2 lines -> WHAT WENT WRONG: 2-3 SCENES with concrete details (a time, an object, a spoken line) -> the WORST moment (1 line, the lowest point) -> THE TURN around the middle (mini re-hook "Par tabhi..."): something small shifts: a memory, a sentence someone says, or a quiet thought that carries Krishna's idea in plain Hinglish (no Sanskrit, no verse) -> WHAT THEY DID DIFFERENTLY (2-3 lines, one concrete action) -> RESULT (1-2 lines, honest, no miracle) -> ONE short lesson line the viewer will screenshot -> last line leaves a question or loop`,
  },
  {
    id: 'epic_story', label: 'Mahabharat ki kahani', shlok: false, weight: 3,
    desc: 'Mahabharat / Krishna ka koi jaana-pehchana prasang ek rochak kahani ki tarah, ant mein aaj ki zindagi se jod.',
    hooks: ['Karn ko sab kuch mila... bas *ek cheez* nahi.', 'Arjun ne dhanush *neeche* rakh diya. Kyun?', 'Ekalavya ne guru ko *angootha* diya. Phir?'],
    structure: `hook (cliffhanger from the episode) -> the episode told as a gripping scene-by-scene story, present tense, 6-8 short lines, vivid details, rising tension; use ONLY well-known events, never invent facts -> the turning point -> what the character realised or lost -> "Aaj ki zindagi mein ye wahi pal hai jab..." connecting it to the viewer (2 lines) -> ONE short lesson line -> last line is an open question`,
  },
  {
    id: 'dialogue', label: 'Arjun–Krishna ki baat', shlok: false, weight: 2,
    desc: 'Arjun ka aaj ke zamane jaisa sawaal, Krishna ka seedha jawab. Ek chhoti kahani jo baatcheet se aage badhti hai.',
    hooks: ['Arjun: "Mujhse nahi hoga." Krishna: "Ye line tum roz bolte ho."', 'Agar Arjun aaj ke zamane mein hota, to Krishna se ye *poochta*...', 'Arjun ne poocha: "Sab chhod doon?" Krishna ka jawab *chubhne* wala tha.'],
    structure: `hook (a one-line exchange) -> a tiny story told through back-and-forth: Arjun says a modern doubt in modern words (overthinking, comparison, fear of failing), Krishna answers short and direct (each answer is ONE idea from the grounding teachings) -> Arjun's mood visibly changes (that is the turn) -> a line where the viewer realises "ye to mera sawaal hai" -> ONE short lesson line -> closing line. Mark who speaks by writing the name at the start of the line, e.g. "Arjun: ..." / "Krishna: ...".`,
  },
  {
    id: 'twist_story', label: 'Ant mein twist', shlok: false, weight: 3,
    desc: 'Kahani jiska aakhri hissa sab kuch palat deta hai. Log ant tak dekhte hain.',
    hooks: ['Sabko laga wo *haar* gaya. Par...', 'Us din uski sabse badi *galti* ne use bacha liya.', 'Ye kahani *ulti* hai. Ant tak dekho.'],
    structure: `hook sets up an expectation -> story told in 6-8 SCENE lines that lead the viewer to ONE obvious assumption -> around 70% a small hint that something is off (re-hook) -> THE TWIST: the last 2 story lines flip the meaning of everything (what they feared was what saved them / the person they blamed was ...) -> ONE short lesson line that only makes sense after the twist -> closing question`,
  },
  {
    id: 'mystery', label: 'Raaz ki kahani', shlok: false, weight: 1,
    desc: 'Gita, Kurukshetra ya Krishna ke baare mein kam suni baat, ek kahani ki tarah khulti hui.',
    hooks: ['Gita ki ye baat *kisi ne nahi batayi*.', 'Kurukshetra mein jo hua, wo ek *sawaal* aaj bhi khada hai.', 'Gita ka pehla shabd *dharm* nahi hai, ye pata hai?'],
    structure: `hook (a curious claim that creates an itch) -> reveal the secret as a story step by step in 5-7 lines, each line adds one new piece -> a second smaller surprise around 60% (re-hook) -> why it matters for the viewer's life (2 lines) -> ONE short lesson line -> last line with a question. USE ONLY the FACT BANK below or facts you are 100% sure about; if unsure say "kaha jaata hai" and never invent numbers, names or dates.`,
  },
];

// old format ids (saved plans, old reels) are mapped to a story format, so nothing breaks
const LEGACY = { story: 'modern_story', classic: 'modern_story', decode: 'epic_story', story_shlok: 'epic_story', deep_truth: 'twist_story', myth: 'twist_story', challenge: 'modern_story' };
export const formatById = (id) => FORMATS.find((f) => f.id === id) || FORMATS.find((f) => f.id === LEGACY[id]) || null;
export const SHLOK_FORMATS = [];

/** Safe, widely-known facts for the 'mystery' format (keeps the AI away from invented trivia). */
export const FACT_BANK = [
  'Gita Mahabharat ke Bhishma Parva mein aati hai; ye Kurukshetra yuddh shuru hone se theek pehle Krishna aur Arjun ke beech ka samvad hai.',
  'Gita mein 18 adhyay hain aur lagbhag 700 shlok (aam taur par 700 maane jaate hain).',
  'Gita ka pehla shlok "dharmakshetre kurukshetre..." Dhritarashtra ke sawaal se shuru hota hai, Krishna ke nahi.',
  'Ye samvad Dhritarashtra ko Sanjaya ne sunaya, jinhe Vyas ji se divya drishti mili thi (parampara ke anusaar).',
  'Krishna ne yuddh mein hathiyaar na uthane ka vachan liya tha aur Arjun ke saarthi bane.',
  'Arjun ke rath ke dhwaj par Hanuman ji the (Mahabharat mein aisa varnan milta hai).',
  'Arjun ka naam "Gudakesh" bhi hai, jiska ek arth hai neend par vijay paane wala.',
  'Gita ke shuruaat mein Arjun yuddh se mana karke dhanush chhod deta hai; Krishna ka upadesh uske baad shuru hota hai.',
  'Gita mein Krishna "karm" par sabse zyada zor dete hain: karm, gyaan aur bhakti, teeno raaste batate hain.',
  'Kurukshetra ka yuddh 18 din chala (Mahabharat ke anusaar).',
  'Gita ko "Gitopanishad" bhi kehte hain, kyunki ise upanishadon ka saar maana jaata hai.',
  'Ek adhyay ke ant mein "iti shrimad bhagavadgitasu upanishatsu..." jaisi pushpika aati hai jisme adhyay ka naam yog ke roop mein diya hota hai (jaise Sankhya Yog, Karm Yog).',
];

/** target seconds -> how many words / lines the narrator can say */
export function lengthPlan(targetSec, hasShlok) {
  let T = Math.round(Number(targetSec) || 45);
  T = Math.min(MAX_SEC, Math.max(hasShlok ? 40 : MIN_SEC, T));
  const speechSec = Math.max(14, T - 2 - (hasShlok ? CHANT_SEC : 0));
  const target = Math.round(speechSec * WORDS_PER_SEC);
  const lines = Math.max(7, Math.round(target / 8));
  return { sec: T, target, min: Math.round(target * 0.88), max: Math.round(target * 1.12), lines, minLines: Math.max(6, lines - 3), maxLines: lines + 4 };
}

export function randomTargetSec() {
  return 34 + Math.floor(Math.random() * 23); // 34..56 s
}

/** weighted pick that avoids the last few formats and (optionally) formats already used the same day */
export function pickFormat({ recent = [], sameDay = [] } = {}) { // shlok is gone: only story formats
  const pool = FORMATS;
  const weights = pool.map((f) => {
    let w = f.weight;
    const idx = recent.indexOf(f.id);
    if (idx === 0) w *= 0.05; else if (idx > 0 && idx < 3) w *= 0.3; else if (idx >= 3 && idx < 6) w *= 0.7;
    if (sameDay.includes(f.id)) w *= 0.05;
    return w;
  });
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) return pool[i].id; }
  return pool[0].id;
}
