# CLAUDE_CONTEXT - Gita Reels Studio (paste/upload this first in a new Claude account)

## How to work with this user
- The user writes **Hinglish** (Hindi in Roman letters + English). Reply in Hinglish.
- For code changes they want the **complete updated file**, never small patch snippets.
- Deliver **only the changed or new files** in a zip, not the whole project.
- Do not commit or print secrets. `.env` and `*.pem` stay out of git.

## What the project is
Automated faceless Bhagavad-Gita reels: Gemini writes the script -> TTS voice -> AI images (animated) or videos -> Remotion render -> dashboard to edit/approve -> auto-upload to YouTube + Instagram. Node 20+/22, Express, MongoDB (mongoose), Remotion 4.0.543, React 18, esbuild for the editor bundle. Plain ESM (`"type": "module"`).
Daily plan: 3 reels (+ optional 1 long ~5 min video). Everything is a **story** (no shlok/chant in the current version). All files of a reel are deleted `KEEP_HOURS` (24) after generation, the DB record stays.
Two deployments of the same code may exist (one repo + EC2 + MongoDB per YouTube channel).

## Layout of the repo
- `server/index.js`, `server/app.js` - Express app, all `/api/*` routes, optional basic auth (`DASHBOARD_USER/PASS`)
- `server/services/` - `pipeline.js` (script -> voice -> visuals -> music -> project -> render), `gemini.js`, `scriptwriter.js`, `storyboard.js` (one image prompt per scene), `tts.js`/`voice.js`, `images.js`, `render.js`, `planner.js` (daily/weekly plan), `queue.js` (one video at a time, pause/resume), `publisher.js` + `uploaders/` (YouTube, Instagram), `keypool.js` (API-key rotation), `retention.js` (24h cleanup), `flowprompts.js` (NEW)
- `src/remotion/` - `Reel.tsx` (the composition; also used by the editor Player), `templates.ts`, `Background.tsx`, `fonts.ts`
- `src/editor/main.tsx` - the video editor (React, bundled by `scripts/build-editor.mjs` into `public/editor.js`)
- `public/index.html` - dashboard (Home, Calendar, Reels, Uploads, Assistant, Plan, Settings); `public/editor.html` - editor shell + CSS
- `deploy/` - `setup-ec2.sh`, `update.sh`, `nginx.conf`, `gita-reels.service`; service expects the app in `~/automation-claude`
- `README.md` (features), `AWS-DEPLOY.md` (older scp-based guide), `SETUP.md` (current setup: new EC2 + GitHub + GoDaddy)

## The editable "project" (Mongo `Reel.project`, edited by the editor, rendered by Remotion)
`ReelProps` in `src/remotion/Reel.tsx`: `format` ('short' 1080x1920 | 'long' 1920x1080), `durationSec`, `style`, `layout`, `hook`, `lines[{start,end,words[{text,emph,start,end}]}]`, `audio[{url,start,duration,rate}]`, `scenes[{type:'video'|'image'|'none',url,start,end,trim,motion}]`, `shloks`, `chapters`, `cta`, `musicUrl/Volume/On`, `channel`, `seed`.
Scenes in a saved project also carry extra fields the type does not list: `prompt` (image prompt from storyboard.js), `line`, `last`, `part`, `vid`, and since this session `flow` (Google Flow prompt). The editor spreads scenes on every update, so extra fields survive autosave.
URLs are stored absolute (`config.baseUrl`) in Mongo and made same-origin (`rel()`/`abs()` in `app.js`) for the browser.
Editor API: `GET/PUT /api/reels/:id/project`, `POST /api/reels/:id/render`, `POST /api/reels/:id/upload?ext=` (raw body, 300 MB, images/video/audio), `POST /api/reels/:id/scene-image`, `POST /api/reels/:id/flow-prompts` (NEW).

## What changed in this session
1. **Editor redesign** (`src/editor/main.tsx`, `public/editor.html`) in the style of a pro NLE (Avid/Premiere): Project bin (scene cards, drag-drop), Program monitor (own transport, timecode, mute; on-canvas handles for hook/captions/shlok/CTA kept), Inspector (tabs SCENE / TEXT / CAPS / STYLE / AUDIO via a strip on the right edge), multi-track timeline (ruler, V1 visuals with draggable cut handles, T1 captions, S1 shlok, A1 voice, A2 music, zoom, click/drag playhead, auto-follow), resizable bottom pane, shortcuts (Space, S, arrows, Home). All previous editing features were kept (split/merge, motion, transition, trim, AI image, own image/video, caption retime, style, audio).
2. **Google Flow workflow:** every scene has a Flow prompt (8 s clip, 9:16 or 16:9). `server/services/flowprompts.js` asks Gemini once for all scenes (never throws; falls back to a template built from the scene's `prompt` + camera motion; the same fallback exists client-side). Editor: Copy prompt, Open Flow, Copy all, download .txt, Rewrite all. Videos generated in Flow are uploaded onto scenes: per scene, drop on a card, or **bulk import** (files sorted by natural file name -> scene N, N+1, ...). A video scene longer than 8 s is flagged; `trim` is the start offset.
3. `.gitignore` now ignores `*.pem` and `*.key`. `SETUP.md` added.

## Not verified (no node_modules / network in the sandbox where this was written)
- The editor was only syntax-checked with `tsc` (no React types) - **run `npm run build:editor` and `npm run typecheck`** and open an editor page once.
- `flow-prompts` was not run against live Gemini. Flow URL `https://labs.google/fx/tools/flow` was written from memory - check it opens.
- Flow clips are not auto-downloaded; the user does that by hand in Flow's UI.

## Security debt (must be handled)
`gita-key.pem` and `gita-2.pem` were committed to git and pushed to GitHub. Treat them as compromised: private repo, new key pairs, delete the old ones (see SETUP.md section 0).

## Ideas not done yet
Undo/redo in the editor, per-scene clip speed/length stretching, audio waveforms, auto-split of a scene longer than 8 s, Phase 3 auto-upload tuning, drag to reorder scenes.
