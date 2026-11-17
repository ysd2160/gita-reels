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
