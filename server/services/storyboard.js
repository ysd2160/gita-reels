import { callGemini, asContents } from './gemini.js';

/**
 * One extra Gemini call per video: reads the finished script + the real scene timing and writes ONE image prompt per scene
 * that shows exactly what is being said in that moment (instead of a generic prompt written before the timing existed).
 * Returns the same scenes with `prompt` set. Never throws: on any problem the scenes keep the per-line "image" prompt.
 */
export async function storyboard(scenes, script, { log = () => {} } = {}) {
  try {
    const todo = scenes.filter((s) => !s.prompt);
    if (!todo.length) return scenes;
    const text = (s) => {
      const a = s.line, b = Math.max(a, s.last ?? s.line);
      return script.lines.slice(a, b + 1).map((l) => String(l.show || '').replace(/\*/g, '')).join(' / ');
    };
    const list = scenes.map((s, i) => `${i}. [${(s.end - s.start).toFixed(1)}s]${s.part ? ' (continues the same sentence as the previous picture - show the NEXT moment)' : ''} "${text(s)}"`).join('\n');
    const prompt = `You are the storyboard artist of a Hindi motivational / Bhagavad-Gita short video. The narration is below (Hinglish), split into ${scenes.length} scenes in order.
Title / hook: ${script.hookText || script.title || ''}
Scenes:
${list}

For EACH scene write ONE English image-generation prompt (20-35 words) that shows exactly what is said in that scene:
- Show the literal subject or a strong visual metaphor of THOSE words (a person lying awake at night with a phone glow for "raat ko overthink"; a clock melting for "time"; a single diya in a storm for "himmat"). Never a generic temple / lotus / Krishna picture unless the scene is really about that.
- One clear subject, concrete setting, lighting and mood that match the emotion of the line. Cinematic, vertical-friendly composition.
- People only as silhouettes, from behind, small in a big landscape, or hands / objects. NO close-up faces. No text, letters, logos or captions in the image.
- Keep ONE consistent look for the whole video (same time of day / colour mood), but every scene must have a clearly DIFFERENT subject and camera angle (wide, low angle, over-the-shoulder, top view, macro detail) from its neighbours.
Return JSON ONLY: { "scenes": [ { "i": 0, "prompt": "..." } ] } with exactly ${scenes.length} items.`;
    const out = await callGemini({ contents: asContents(prompt), temperature: 0.7 });
    const arr = Array.isArray(out) ? out : out?.scenes;
    if (!Array.isArray(arr)) throw new Error('storyboard: bad reply');
    let n = 0;
    for (const it of arr) {
      const sc = scenes[it?.i];
      const p = String(it?.prompt || '').trim();
      if (sc && p.length > 15 && !sc.prompt) { sc.prompt = p.slice(0, 400); n++; }
    }
    log(`storyboard: ${n}/${scenes.length} scene prompts`);
  } catch (e) {
    log(`storyboard skipped (${String(e.message || e).slice(0, 100)}) - per-line image prompts used`);
  }
  return scenes;
}
