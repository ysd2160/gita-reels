import { callGemini, asContents } from './gemini.js';

/**
 * Prompts for Google Flow (8-second AI video clips), one per scene of the edited project.
 * The editor shows them next to every scene: copy the prompt into Flow, download the clip, upload it back onto the scene.
 * Never throws: when Gemini fails every scene gets a template prompt built from its image prompt.
 */
const CAMERA = { in: 'slow push-in', out: 'slow pull-back', left: 'smooth pan to the left', right: 'smooth pan to the right', up: 'slow tilt up' };

const ratioOf = (project) => (project.format === 'long' ? '16:9 landscape' : '9:16 vertical');

const sayAt = (lines, a, b) => (lines || [])
  .filter((l) => l.end > a && l.start < b)
  .map((l) => (l.words || []).map((w) => w.text).join(' '))
  .join(' / ');

export function fallbackFlowPrompt(scene, project) {
  const base = String(scene.prompt || 'misty mountains at dawn, a lone silhouette, warm cinematic light').replace(/[.\s]+$/, '');
  return `${base}. Cinematic ${CAMERA[scene.motion] || 'slow push-in'}, natural subtle motion, 8 seconds, ${ratioOf(project)}, no text, no captions, no logos, no close-up faces.`;
}

export async function flowPrompts(project, { topic = '' } = {}) {
  const scenes = project.scenes || [];
  const ratio = ratioOf(project);
  const fallback = scenes.map((s) => fallbackFlowPrompt(s, project));
  if (!scenes.length) return fallback;
  try {
    const list = scenes.map((s, i) => {
      const say = sayAt(project.lines, s.start, s.end) || '(no narration)';
      return `${i}. [${(s.end - s.start).toFixed(1)}s] narration: "${say}" | still-image idea: ${s.prompt || 'none'} | camera hint: ${CAMERA[s.motion] || 'slow push-in'}`;
    }).join('\n');
    const prompt = `You write prompts for Google Flow, an AI tool that makes 8-second video clips. The video is a Hindi motivational / Bhagavad-Gita short ("${project.hook || topic}"), split into ${scenes.length} scenes in order.
Scenes:
${list}

For EACH scene write ONE English Flow prompt (35-60 words) for an 8-second ${ratio} clip that shows exactly what the narration says in that moment:
- Start with the subject and its action, then setting, then lighting and mood, then ONE camera move (use the camera hint if it fits).
- Smooth, slow, realistic motion that can be cut anywhere in the 8 seconds. Cinematic, shallow depth of field, natural film look.
- People only as silhouettes, from behind, small in a big landscape, or hands / objects. No close-up faces. No text, letters, logos or captions in the picture.
- Keep ONE consistent look for the whole video (same time of day and colour mood) but give every scene a different subject and camera angle from its neighbours.
- End every prompt with: "${ratio}, 8 seconds, no text."
Return JSON ONLY: { "scenes": [ { "i": 0, "prompt": "..." } ] } with exactly ${scenes.length} items.`;
    const out = await callGemini({ contents: asContents(prompt), temperature: 0.7 });
    const arr = Array.isArray(out) ? out : out?.scenes;
    if (!Array.isArray(arr)) throw new Error('bad reply');
    const res = [...fallback];
    for (const it of arr) {
      const p = String(it?.prompt || '').trim();
      if (Number.isInteger(it?.i) && it.i >= 0 && it.i < res.length && p.length > 20) res[it.i] = p.slice(0, 700);
    }
    return res;
  } catch (e) {
    console.warn('[flow-prompts] Gemini failed, template prompts used:', String(e.message || e).slice(0, 120));
    return fallback;
  }
}
