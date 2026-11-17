# AWS par deploy (EC2) - reels apne time par YouTube + Instagram pe upload

Ek hi EC2 server pe sab chalega: app + video render + scheduler. Server ka timezone koi matter nahi karta (app khud IST use karta hai).

## 0. Kya chahiye
- AWS account, ek domain (HTTPS ke liye; bina domain ke neeche "Option B" dekho)
- MongoDB: **MongoDB Atlas free (M0)** sabse aasan. Connection string `.env` ke `MONGODB_URI` mein jayegi
- API keys: Gemini (zaroori), Cloudflare (free images), Sarvam (optional voice), YouTube OAuth, Instagram token

## 1. EC2 banao
1. Region: **Asia Pacific (Mumbai) ap-south-1**
2. AMI: **Ubuntu Server 24.04 LTS**
3. Type: **t3.large** (2 vCPU / 8 GB) minimum. Render tez chahiye to **t3.xlarge**. 3 shorts/day ke liye t3.large kaafi hai. (Price AWS Pricing Calculator mein check karo)
4. Storage: **30 GB gp3** (files 24h mein delete hoti hain, isliye itna kaafi hai)
5. Key pair banao (.pem download karo)
6. Security group: **22 (SSH) sirf My IP**, **80** aur **443** Anywhere. **Port 4000 kabhi open mat karo.**
7. Launch ke baad **Elastic IP** allocate karke instance se attach karo (IP badlega nahi)
8. Domain ke DNS mein A record: `reels.yourdomain.com` -> Elastic IP
9. Atlas mein Network Access -> Elastic IP allow karo

## 2. Project server par daalo
Apne laptop se:
```bash
scp -i key.pem automation-claude.zip ubuntu@<ELASTIC_IP>:~
ssh -i key.pem ubuntu@<ELASTIC_IP>
unzip automation-claude.zip && cd automation-claude
cp .env.example .env && nano .env
```
`.env` mein ye bharo:
```
GEMINI_API_KEY=...
MONGODB_URI=mongodb+srv://...            # Atlas
CLOUDFLARE_ACCOUNT_ID=...  CLOUDFLARE_API_TOKEN=...
DASHBOARD_USER=admin
DASHBOARD_PASS=<lamba strong password>
PUBLIC_URL=https://reels.yourdomain.com
YOUTUBE_CLIENT_ID=...  YOUTUBE_CLIENT_SECRET=...
IG_USER_ID=...  IG_ACCESS_TOKEN=...
KEEP_HOURS=24
MAX_PER_DAY=3
```

## 3. Ek command se setup
```bash
bash deploy/setup-ec2.sh
```
Ye install karta hai: Node, ffmpeg, Chrome libs, swap, app dependencies, systemd service (server restart hone par bhi apne aap chalu), nginx.

Check:
```bash
curl http://127.0.0.1:4000/healthz      # "ok"
journalctl -u gita-reels -f              # live logs
```

## 4. HTTPS
```bash
sudo certbot --nginx -d reels.yourdomain.com
```
Ab `https://reels.yourdomain.com` kholo, `DASHBOARD_USER/PASS` se login.

**Option B (domain nahi hai):** laptop se `ssh -i key.pem -L 4000:localhost:4000 ubuntu@<IP>` chalao aur browser mein `http://localhost:4000` kholo. YouTube connect bhi isi tarah ho jayega (redirect localhost wala hi rahega, `PUBLIC_URL` khaali chhodo).

## 5. YouTube connect (zaroori baatein)
1. Google Cloud -> YouTube Data API v3 enable -> OAuth client (Web application)
2. Authorized redirect URI: `https://reels.yourdomain.com/oauth/youtube/callback`
3. OAuth consent screen ko **"In production"** karo. "Testing" mode mein refresh token **7 din** mein expire ho jata hai aur auto-upload ruk jayega.
4. Naye API project se upload **private** reh sakte hain jab tak Google ka API audit/verification pass na ho. Public chahiye to audit form bharo.
5. Dashboard -> Settings -> **Connect YouTube**

## 6. Instagram
- Professional (Business/Creator) account + Meta app + `instagram_content_publish` permission
- Token expire hota hai (long-lived ~60 din). Expire hone se pehle naya token `.env` mein daalo, phir `sudo systemctl restart gita-reels`
- Instagram par sirf shorts/reels jate hain

## 7. Dashboard Settings (ek baar)
- **Generate daily plan automatically**: ON
- Generate time: 06:00, Shorts per day: **3**, Long videos per day: **0**
- Publish times: 07:30 / 13:00 / 20:30 (jo chaho)
- **Auto-approve ON** aur **Auto-publish ON** (isi se reel apne time par bina click ke upload hoti hai)
- Keep hours: 24
- YouTube + Instagram dono ON

## 8. Roz kya hota hai
1. 00:10 IST - agle 7 din ka plan; 00:15 - aaj ki scripts likhi jati hain
2. 06:00 - 3 reels generate + render
3. Render hote hi auto-approve, aur **publish time par** YouTube + Instagram pe upload
4. Upload fail ho to 10 min ke gap se max 5 baar retry; generation fail ho to 2 baar auto-retry
5. Generation ke **24 ghante baad** us reel ki saari audio, images, clips aur mp4 delete (record + post links Calendar mein rehte hain). Jo reel abhi post nahi hui wo 72h tak rakhi jati hai taaki kho na jaye.

## 9. Update / maintenance
```bash
cd ~/automation-claude && sudo systemctl restart gita-reels      # .env badalne ke baad
journalctl -u gita-reels --since "1 hour ago"                    # kya hua dekho
df -h /                                                           # disk
```
Naya code: zip dobara upload karke extract karo (`.env` mat overwrite karna), `npm ci`, phir restart.
