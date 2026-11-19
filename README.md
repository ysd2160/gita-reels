# Gita Reels Studio v4 + Home / Calendar / 24h storage

Plan -> script -> natural voice + shloka chant -> AI images animated -> music -> render -> **edit in the dashboard** -> approve -> **auto-upload** (YouTube + Instagram).

## Setup
1. Node 20+, MongoDB. `npm install`
2. `.env.example` -> `.env`. Minimum: `GEMINI_API_KEY`. Better: `SARVAM_API_KEY` (voice) + `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` (free AI images).
3. `npm start` (builds the editor, then http://localhost:4000)

## Dashboard
- **Home (opens first):** today's plan. Every planned video shows its topic and its full script (hook, all lines, caption), its publish time and live status. Buttons: **Generate all N videos** (one click, the whole day) or **Generate this** for a single one; **Script** to read/edit/paste/chat-change a script; **New topic**; **Skip**. Scripts are written in advance at 00:15 IST (Settings -> *Write today's scripts*), or press **Write scripts**. Finished videos show Watch + YouTube/Instagram links.
- **Calendar:** month view, Mon-Sun. Every day shows its videos with status: published (green), scheduled/ready (blue), generating (amber), failed (red), planned (grey). Click a day for the list with topic, hook, post time and links to the posted YouTube/Instagram video. The record stays even after the files are cleaned.
- **Reels:** generate a Short or a Long (~5 min, landscape 1920x1080, 5 verses with chapters). Bulk create. Pipeline steps on in-progress cards.
- **Edit video:** opens the editor (live preview). Drag Hook / Captions / Shlok / CTA up-down on the canvas; edit every text, each caption line (use *word* to highlight), shlok text/timing, scenes (replace with your image/video, generate a new AI image, split/merge, motion, cut time), colours, caption/hook/shlok styles, music (on/off, volume, your file), voice volume, overlays. Autosaves. "Render video" re-renders without re-generating anything.
- **Assistant:** ask for topics/hooks/captions. "Write a script for X" -> press **Make video from this script** and it is produced exactly as written. With a reel selected it rewrites that reel's script (Apply and re-render).
- **Plan:** next 7 days of topics (AI-picked in advance, no repeats). Edit topic or publish time, ask for a new topic, skip, or "Make now".
- **Settings:** daily automation (default 06:00 IST: 3 shorts + 1 long), publish times, auto-approve, auto-publish, YouTube/Instagram.

## Daily automation
Switch on "Generate daily plan automatically" in Settings. At the set time the day's plan is queued; scripts, voices and images of the next videos are prepared while one renders. Shorts are published at their times (default 07:30 / 13:00 / 20:30), the long video at 18:00. Keep "Auto-approve" off to review first (recommended); videos approved or auto-approved are uploaded at their time when "Auto-publish" is on.

## Storage: everything is deleted 24h after generation
All files of a reel (images, audio, stock clips, editor project **and the mp4**) are kept for `KEEP_HOURS` (default 24, also in Settings) after the video finished rendering, then deleted by the storage keeper (runs every 10 min). Rules:
- only reels that are **published / rejected / failed** are deleted at 24h; an approved or ready video that has **not been posted yet** is kept up to `KEEP_MAX_HOURS` (72h) so it is never lost before it goes out;
- the database record (topic, script, post links, status) stays, so Calendar keeps showing what was posted; the Reels page shows "Files auto-cleaned";
- leftovers of deleted reels (orphan folders) are swept too; the chant cache is kept (it saves API calls);
- the editor works until the files are deleted (nothing is deleted at approve any more; `CLEAN_MODE=retention`).
Target setup: **3 shorts a day** (Settings -> Long videos per day = 0; the default is now 0). If you saved Settings earlier, set it to 0 there.

## Temp files (older option)
Audio, AI images, uploads and music of a video stay until you **approve** it (so it remains editable). Approve (or `KEEP_DRAFT_DAYS` old drafts) deletes them; only the mp4 + script stay.

## Publishing notes
- **YouTube:** Google Cloud project + OAuth (redirect `http://localhost:4000/oauth/youtube/callback`). Until Google's API audit is passed, uploads from new API projects stay private.
- **Instagram:** Reels only (shorts), resumable upload straight from disk. Needs a professional account, Meta app and an access token (they expire; renew). Long videos go to YouTube only.
- Long-video render takes time (≈10-25 min on a normal laptop); it starts at the generation time.

## Safety limits and server notes (latest)
- **Max 3 videos a day** is enforced (`MAX_PER_DAY`, default 3): extra planned items (for example an old long-video slot) are removed from the plan automatically.
- Auto-approve and auto-publish are ON by default now, so every video goes out at its publish time without a click (switch off in Settings to review first).
- A failed generation is retried twice automatically; a failed upload is retried every 10 min (max 5).
- Calendar shows days that were planned but never generated as "Missed".
- Server: set `DASHBOARD_USER` / `DASHBOARD_PASS` (basic-auth) and `PUBLIC_URL`. See `AWS-DEPLOY.md` for the full EC2 guide.

## Script engine v5 (30-60 sec reels, many formats, no repeated shloks)
- **9 reel formats** (`server/formats.js`): Dard→Gita→Shlok, Shlok Decode, Kahani→Shlok (these 3 chant a shlok) and Arjun-Krishna sawaal-jawab, Kahani, Raaz/Anjaani baat, Deep baat (3 sacchaiyan), Myth vs Gita, Aaj ka challenge (**no shlok, no chant**). A format is chosen automatically (never the same one twice in a day, recent ones are avoided) or picked by you per video.
- **Length 30-60 sec**: Settings -> *Reel ki length* (Auto = random 34-56 s, or 30/45/60) and per video in Plan / Script Studio. The writer gets an exact word budget (~2.4 words/sec; a chanted shlok adds ~12 s, so shlok reels start at 40 s). The dashboard shows the estimated length of every script and turns red outside 30-60 s.
- **No repeated shlok**: verse bank grew from 12 to 34. Recently used verses (also the scripts already written for the coming days) are excluded, so the same shlok comes back only after ~25 reels.
- **Share of shlok reels**: Settings -> *Kitni % reels mein shlok ho* (default 45%).
- **Better scripts**: draft -> editor polish -> automatic quality check (word count, banned generic phrases, weak/repeated hook, last line open loop) with one repair pass. Optional `GEMINI_SCRIPT_MODEL` in `.env` uses a stronger model for scripts only.
- **Week plan** (Plan page): upload a PDF / photo / txt or paste text -> AI reads it, puts every reel in the right day (topic, format, your notes; a full script in your plan is used word for word) and writes the scripts in the background. Or press *AI se poora week plan banao* (optionally with an instruction like "is hafte anger aur karma par").
- Shloks added in v5 (2.13, 2.20, 2.23, 2.27, 2.40, 2.48, 2.50, 2.62, 2.66, 2.71, 3.8, 3.21, 3.35, 3.37, 4.11, 4.38, 6.6, 6.17, 6.26, 9.26, 16.21, 18.78): please compare the Sanskrit once with a Gita Press edition before publishing.


## Multiple API keys, one video at a time, pause / resume

- **Key rotation:** every provider accepts several keys (`GEMINI_API_KEYS=k1,k2,k3,k4,k5`, same for `SARVAM`, `ELEVENLABS`, `GOOGLE_TTS`, `PEXELS`, `PIXABAY`, `POLLINATIONS`; Cloudflare as `CLOUDFLARE_ACCOUNTS=acc1:token1,acc2:token2`). When a key hits its limit the next one is used; a limited key rests (60 s, then 5 min, 15 min, 1 h, 6 h; daily quotas until midnight UTC) and comes back by itself. Settings -> "API keys" shows how many are limited.
- **Daily plan:** 3 shorts (YouTube + Instagram) and 1 long video (~5 min, YouTube only). Settings -> "Long videos per day" must be 1 (it is a saved setting; the default only applies if you never saved it).
- **One video at a time:** the queue runs script -> voice -> images -> music -> render for one video, then the next.
- **Pause / Resume:** "Roko" stops a video and keeps its finished steps (script, voice, every finished image). "Resume" continues from that step. A render that is paused restarts from frame 0, everything before it is kept. "Abhi chalao" pauses the running video and starts this one now. The same saved steps are used after a crash or server restart.


## Stories only (no shlok), uploads page, weekly plan format

- **Every video is a story** (a named character, trouble, a turn, a result), 30-60 s for reels and one ~5 min story in 5 chapters for the long video. Formats: Aaj ki kahani, Mahabharat ki kahani, Arjun-Krishna ki baat, Ant mein twist, Raaz ki kahani. Shlok / chant is switched off everywhere (no verse is ever attached, the script check rejects the words shlok / verse / Sanskrit). Old saved plans with old format ids are mapped to a story format automatically.
- **Uploads page:** every finished video with its status per platform (YouTube / Instagram): done, uploading, pending, waiting for approval, error (with the error text and a "Dobara upload karo" button), or "not going there" (long video never goes to Instagram). Cards on the Today / Videos pages show the same YT / Insta chips.
- **Daily plan:** 3 reels (YouTube + Instagram) + 1 long video (YouTube only). The daily cap is at least 4, even if an old `.env` still says `MAX_PER_DAY=3`.
- **Weekly plan from outside (text / PDF / photo):** write one block per day, one line per video:

```
Din 1
Reel: topic | kahani ka type (optional) | note: ... (optional)
Reel: topic
Reel: topic
LONG: topic of the 5-minute video (YouTube only)
SCRIPT: (optional) paste your own full script under a topic, it is used word for word
```
  The template can be copied / downloaded from Plan -> "Plan ka format kaisa hona chahiye?". Any other layout also works, the AI reads it.


## Long video: voice in parts, low-memory render

- **Voice** of a long script is made in parts of ~1300 characters (cut at chapter starts); every part is cached, so a retry / resume never pays for finished parts again.
- **Render** of the 5-minute video uses ONE browser tab and 1280x720 by default (`RENDER_CONCURRENCY_LONG`, `LONG_RENDER_SCALE` in `.env`). If the PC still runs out of memory, the render is automatically retried with lighter settings (960x540, one thread, no parallel encoding). Reels keep 1080x1920 and also get a low-memory second try.
- If Windows still says "memory allocation failed": close Chrome / other heavy apps, and set Windows virtual memory (pagefile) to "System managed size".
