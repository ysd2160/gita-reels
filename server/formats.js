// Reel FORMATS: every reel is written in one of these shapes, so videos stop looking the same.
// `shlok: true`  -> the narrator chants a verse from the verse bank (server/verses.js)
// `shlok: false` -> no chant at all: story / mystery / deep truth / challenge style
//
// Speaking speed used for length maths: ~2.4 Hinglish words per second (TTS + natural pauses).
export const WORDS_PER_SEC = 2.4;
export const CHANT_SEC = 12.5; // chant + hold, average
export const MIN_SEC = 30;
export const MAX_SEC = 60;

export const FORMATS = [
  {
    id: 'classic', label: 'Dard → Gita → Shlok', shlok: true, weight: 3,
    desc: 'Viewer ka dard, phir Krishna ka shlok (chant), phir uska matlab aur ek chhota action.',
    hooks: ['Raat ke 2 baje, phone haath mein... aur dimaag mein wahi *purani baat*.', 'Tum kamzor nahi ho. Tum bas *thak* chuke ho.', 'Jo tumhe ignore karta hai, uske liye *rona* band karo.'],
    structure: `hook (pattern interrupt) -> pain in 2-3 lines with ONE specific everyday moment (viewer feels seen) -> a small twist / open loop ("par Krishna ne isse alag hi baat kahi thi") -> lead-in line "Shri Krishna ne Gita mein kaha tha..." (this is shlok_line_index; the verse is then CHANTED) -> meaning in plain modern words (2-3 lines) -> ONE tiny action for today -> closing loop line that makes people comment or rewatch`,
  },
  {
    id: 'decode', label: 'Shlok Decode (shlok pehle)', shlok: true, weight: 2,
    desc: 'Ek famous shlok ke andar chhupi baat ko 2-3 shabdon mein tod ke samjhana.',
    hooks: ['Gita ka ye ek shlok tumne *galat* padha hai.', 'Is shlok mein sirf *3 shabd* hain jo sab badal dete hain.', 'Sab isko bolte hain, *samajhte* kam hain.'],
    structure: `hook claiming people misunderstand this verse -> 1-2 lines of common wrong understanding -> short lead-in ("Suno, Krishna ne kya kaha...") (this is shlok_line_index, keep it EARLY: line 2 or 3; the verse is then CHANTED) -> decode 2-3 key words / ideas of the verse, one line each, with a modern example -> "iska matlab tumhari life mein" 2 lines -> closing line that dares the viewer to try it today`,
  },
  {
    id: 'story_shlok', label: 'Kahani → Shlok', shlok: true, weight: 2,
    desc: 'Chhoti kahani (Mahabharat ya modern), aur climax par shlok chant hota hai.',
    hooks: ['Arjun ne ladai se pehle *hathiyaar* kyun chhod diye?', 'Ek ladka tha, jisne *sab kuch* kho diya. Phir usne ye ek line suni...', 'Kurukshetra ke maidan mein sabse *dari hui* cheez thi... Arjun ki aankhein.'],
    structure: `hook (cliffhanger) -> story told in present tense with concrete details, 5-7 short lines, tension rising -> the turning point -> lead-in "Tab Krishna ne kaha..." (this is shlok_line_index; the verse is then CHANTED as the climax) -> what that verse means for the viewer's own life (2 lines) -> last line that leaves one open question`,
  },
  {
    id: 'dialogue', label: 'Arjun–Krishna sawaal-jawab', shlok: false, weight: 2,
    desc: 'Arjun ka aaj ke zamane jaisa sawaal, Krishna ka seedha jawab. Shlok chant nahi.',
    hooks: ['Arjun: "Mujhse nahi hoga." Krishna: "Ye line tum roz bolte ho."', 'Agar Arjun aaj ke zamane mein hota, to Krishna se ye *poochta*...', 'Arjun ne poocha: "Sab chhod doon?" Krishna ka jawab *chubhne* wala tha.'],
    structure: `hook (a one-line exchange) -> 4-6 lines of back-and-forth: Arjun says a modern doubt in modern words (overthinking, comparison, fear of failing), Krishna answers short and direct (each answer is ONE idea from the grounding teachings) -> a line where the viewer realises "ye to mera sawaal hai" -> ONE action for today -> closing line. Mark who speaks by writing the name at the start of the line, e.g. "Arjun: ..." / "Krishna: ...". NO verse is chanted.`,
  },
  {
    id: 'story', label: 'Kahani (bina shlok)', shlok: false, weight: 3,
    desc: 'Mahabharat / Krishna ki kahani ya modern parable, ant mein ek sacchi seekh.',
    hooks: ['Karn ko sab kuch mila... bas *ek cheez* nahi.', 'Ek raja ne apne *dost* ko khud se bada bana diya. Kyun?', 'Mahabharat ka sabse *akela* insaan koi aur tha.'],
    structure: `hook (cliffhanger or strange fact) -> the story in 6-9 short lines, present tense, vivid specific details, one clear emotional turn in the middle -> the twist / realisation -> "Isse hum kya seekhte hain" in 2 plain lines connected to the viewer's own life -> last line that makes people think or comment. NO verse is chanted. Use only well-known episodes of Mahabharat/Gita/Krishna lore or a clearly modern fictional person ("Rohit naam ka ek ladka..."); never present an invented event as scripture.`,
  },
  {
    id: 'mystery', label: 'Raaz / Anjaani baat', shlok: false, weight: 2,
    desc: 'Gita, Kurukshetra ya Krishna ke baare mein kam suni hui baat. Curiosity wali reel.',
    hooks: ['Gita ki ye baat *kisi ne nahi batayi*.', 'Kurukshetra mein jo hua, wo ek *sawaal* aaj bhi khada hai.', 'Gita ka pehla shabd *dharm* nahi hai, ye pata hai?'],
    structure: `hook (a curious claim that creates an itch) -> "sunne mein ajeeb lagega, par..." -> reveal the fact step by step in 4-6 lines, each line adds one new piece -> a second smaller surprise around 60% of the video (re-hook) -> why it matters for the viewer's life (2 lines) -> last line with a question or "kya tumhe ye pata tha?". NO verse is chanted. USE ONLY the FACT BANK given below or facts you are 100% sure about; if unsure say "kaha jaata hai" and never invent numbers, names or dates.`,
  },
  {
    id: 'deep_truth', label: 'Deep baat / 3 sacchaiyan', shlok: false, weight: 2,
    desc: 'Numbered deep truths (3 baatein), har baat chhoti aur chubhne wali. Shlok chant nahi.',
    hooks: ['3 sacchaiyan jo tumhe koi *nahi batayega*.', 'Jis din ye *samajh* aaya, sab badal gaya.', '4 baatein jo Krishna ne bina bole *sikha di*.'],
    structure: `hook with a number -> 3 (or 4) numbered truths; each truth = a punchy statement (max 8 words) + one concrete example line -> the strongest truth LAST -> closing line asking "tumhe kaunsi sabse zyada chubhi? number likho". NO verse is chanted.`,
  },
  {
    id: 'myth', label: 'Log kehte hain... Gita kehti hai', shlok: false, weight: 2,
    desc: 'Ek galat dharna todna: "Sab sochte hain X, par Gita ka matlab Y hai".',
    hooks: ['Log kehte hain "sab chhod do". Gita ne ye *kabhi nahi kaha*.', '"Kismat mein jo hoga wahi hoga" - ye line Gita ki *nahi* hai.', 'Gita sirf *buddhe logon* ke liye hai? Ruko.'],
    structure: `hook stating the myth -> why people believe it (1-2 lines) -> "par asli baat ye hai" -> the real meaning, 3-4 lines, grounded in the grounding teachings -> example of the difference in daily life -> closing line challenging the viewer. NO verse is chanted.`,
  },
  {
    id: 'challenge', label: 'Aaj ka challenge', shlok: false, weight: 1,
    desc: 'Ek chhota action-challenge jo viewer aaj hi kar sake, comment mein result bataye.',
    hooks: ['Aaj sirf *ek kaam* karo. Phone mat uthana.', 'Agle 60 second mein ye karke dekho.', 'Ye *5 minute* ka kaam tumhara mood badal dega.'],
    structure: `hook promising a tiny challenge -> why this problem keeps happening (2 lines) -> the challenge in simple steps (max 3 steps, doable today without money or tools) -> what Krishna's idea behind it is (2 lines, grounded) -> closing line "kar ke comment mein 'done' likho". NO verse is chanted.`,
  },
];

export const formatById = (id) => FORMATS.find((f) => f.id === id) || null;
export const SHLOK_FORMATS = FORMATS.filter((f) => f.shlok).map((f) => f.id);

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
export function pickFormat({ recent = [], sameDay = [], shlokPercent = 45 } = {}) {
  const wantShlok = Math.random() * 100 < Math.min(100, Math.max(0, Number(shlokPercent)));
  const pool = FORMATS.filter((f) => f.shlok === wantShlok);
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
