# Gita Reels Studio - Setup guide (naya AWS server + GitHub + GoDaddy domain)

Ye guide **naye EC2 instance** ke liye hai. Code GitHub se seedha server par aayega (zip/scp ki zaroorat nahi).
Pehle section 0 (security) zaroor padho.

## 0. PEHLE YE KARO: `.pem` keys leak ho chuki hain
Project ke zip mein `gita-key.pem` aur `gita-2.pem` the, aur wo **git mein commit hain** (commit "new pem") aur GitHub par push ho chuki hain.
- Repo abhi **Private** karo (GitHub -> repo -> Settings -> General -> Danger Zone -> Change visibility).
- Un dono keys ko **compromised** maano. Naye instance ke liye **nayi key pair** banao (AWS -> EC2 -> Key Pairs) aur purani key pairs  delete kar do. Jin purane instances par wo keys lagi hain unka SSH sirf "My IP" se rakho ya instance band kar do.
- Repo se hatao (laptop par, project folder mein):
  ```bash
  git rm --cached gita-key.pem gita-2.pem
  git commit -m "remove keys"
  git push
  ```
  Is zip ke `.gitignore` mein `*.pem` aur `*.key` ab ignore hain, to dobara commit nahi honge.
- Git history mein purani keys phir bhi dikhengi. Isliye keys ko rotate karna (upar) hi asli fix hai. History saaf karna ho to `git filter-repo --path gita-key.pem --path gita-2.pem --invert-paths` (ya BFG) chalao aur force-push karo.
- `.pem` file kabhi project folder ke andar mat rakho (Downloads / `~/.ssh` mein rakho).

## 1. Naya EC2 instance
1. Region **ap-south-1 (Mumbai)**, AMI **Ubuntu Server 24.04 LTS**
2. Type **t3.large** (2 vCPU / 8 GB). Storage **30 GB gp3**
3. Nayi key pair banao, `.pem` apne laptop ke `~/.ssh/` mein rakho
4. Security group: **22 sirf My IP**, **80** aur **443** Anywhere. Port 4000 / 5000 kabhi open mat karo
5. **Elastic IP** allocate karke instance se attach karo (IP badlega nahi)
6. MongoDB Atlas free (M0) ka connection string ready rakho, aur Atlas -> Network Access mein Elastic IP allow karo

## 2. GitHub se code server par lao (deploy key)
Repo private hai, to server ko read-only "deploy key" do.
```bash
ssh -i ~/.ssh/NEWKEY.pem ubuntu@<ELASTIC_IP>
ssh-keygen -t ed25519 -f ~/.ssh/github_deploy -N ""
cat ~/.ssh/github_deploy.pub          # ye poori line copy karo
```
GitHub -> repo -> Settings -> **Deploy keys** -> Add deploy key -> line paste, **Allow write access OFF**.
```bash
printf 'Host github.com\n  IdentityFile ~/.ssh/github_deploy\n  IdentitiesOnly yes\n' >> ~/.ssh/config
ssh -T git@github.com                                    # "successfully authenticated" aana chahiye
git clone git@github.com:<GITHUB_USER>/gita-reels.git automation-claude
cd automation-claude
```
Folder ka naam **automation-claude** hi rakho: `deploy/setup-ec2.sh`, `deploy/update.sh` aur systemd service isi path (`~/automation-claude`) ko maante hain.

## 3. `.env` banao (sirf server par, kabhi commit nahi)
```bash
cp .env.example .env && nano .env
```
Zaroori: `GEMINI_API_KEY` (ya `GEMINI_API_KEYS=k1,k2,..`), `MONGODB_URI`, `ADMIN_EMAIL` (tumhari email), `SIGNUP_CODE` (jis ko account banane dena ho usko do), `PUBLIC_URL=https://reels.yourdomain.com`.
Optional: `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` (free images), `SARVAM_API_KEY` (voice), `YOUTUBE_CLIENT_ID/SECRET`, `IG_USER_ID`, `IG_ACCESS_TOKEN`.
Dusra deployment (doosra channel) chalana ho to alag instance + alag repo + alag `MONGODB_URI`, aur chahe to `PORT=5000`.

## 4. Ek command se install
```bash
bash deploy/setup-ec2.sh
curl http://127.0.0.1:4000/healthz        # "ok" (PORT badla ho to wo port)
journalctl -u gita-reels -f               # live logs
```
Ye Node 22, ffmpeg, Chrome libs, swap, `npm ci`, **editor build**, systemd service aur nginx laga deta hai.

## 5. GoDaddy domain -> server
GoDaddy -> My Products -> Domain -> **DNS** -> Add record:
| Type | Name | Value | TTL |
|---|---|---|---|
| A | `reels` | `<ELASTIC_IP>` | 600 |

(Doosre channel ke liye `reels2` -> doosre server ka IP.) 5-30 min mein `reels.yourdomain.com` khulega.
**Vercel wali site ko mat chhedo**: root (`@`) aur `www` ke records jo Vercel ke Domains tab ne bataye wahi rehne do. Gita Reels Vercel par nahi chal sakta (lamba render, ffmpeg, scheduler aur disk chahiye), isliye ye sirf **subdomain** se EC2 par jayega.

HTTPS (DNS chalne ke baad):
```bash
sudo certbot --nginx -d reels.yourdomain.com
```
Phir `https://reels.yourdomain.com` kholo, pehle **Sign up** karo (`ADMIN_EMAIL` wali email = admin), phir login. YouTube OAuth redirect: `https://reels.yourdomain.com/oauth/youtube/callback`.

## 6. Roz ka update (laptop se push -> server par ek command)
Laptop par: `git add -A && git commit -m "msg" && git push`
Server par:
```bash
cd ~/automation-claude && bash deploy/update.sh      # git pull, npm ci, editor build, service restart
```
`.env` git mein nahi hai, isliye update se overwrite nahi hota.

## 7. Naya editor (is zip ke saath aaya)
- Layout: Project bin (scenes) + Program monitor ooper, Inspector + multi-track timeline neeche, right edge par tabs.
- **Google Flow flow:** scene chuno -> Inspector mein prompt dikhega -> **Copy** -> Flow mein paste (8 sec clip) -> video download -> bin mein drag-drop ya Import. Clips ko `01.mp4, 02.mp4...` naam do, ek saath import karoge to scene 1, 2, 3... par lagengi.
- Shortcuts: `Space` play/pause, `S` split, `<- ->` 1 frame (Shift = 1 sec), `Home` start.
- **Editor `public/editor.js` ko rebuild karna zaroori hai:** `npm run build:editor` (update.sh ye khud karta hai; local par `npm start` bhi karta hai).
- Upload limit 300 MB per file (nginx `client_max_body_size 300m` pehle se hai).

## Troubleshooting
- 502 Bad Gateway: `sudo systemctl status gita-reels` / `journalctl -u gita-reels -n 100`
- Render memory error: `.env` mein `RENDER_CONCURRENCY=2`
- Editor purana dikhe: `npm run build:editor`, service restart, browser hard refresh (Ctrl+Shift+R)
- Flow prompts na bane: Gemini key/limit check karo; tab bhi har scene ke liye template prompt dikhta hai
