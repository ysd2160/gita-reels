# MULTIUSER - Gita Reels Studio ab multi-user hai

Pehle: 1 server = 1 user = 1 YouTube + 1 Instagram.
Ab: **1 server = bahut saare users**. Har user apna account banata hai (email + password), apni **ek YouTube channel + ek Instagram account** connect karta hai, aur uska plan, scripts, videos, settings, topics sab alag rehte hain.

Tumhare "2 insta + 2 youtube ek jagah se" wale case ke liye: 2 account banao (ya 2 logon ko do), har account mein apni YT + IG connect karo. Dono ki videos ek hi server/render machine se banti hain, par content kabhi mix nahi hota.

## Kaise kaam karta hai (chhota version)
- **Login:** email + password (scrypt hash), signed cookie session (30 din). Pehla account = admin (ya `ADMIN_EMAIL` wala).
- **Data alag-alag:** `Reel`, `Plan`, `Topic`, `Setting` har document par `userId`. `server/tenancy.js` (mongoose plugin) har query mein khud `userId` laga deta hai, aur `server/context.js` (AsyncLocalStorage) batata hai abhi kaun sa user chal raha hai. Isliye purane service files (planner, pipeline, publisher...) ko almost badalna nahi pada.
- **Har request** `runAs(user, ...)` ke andar chalti hai (`wrap` in `app.js`). **Har background kaam** bhi: cron `eachUser()` (index.js) har user ke liye alag chalta hai, queue har job ko uske owner ke context mein chalati hai.
- **YouTube:** ek Google OAuth app (`YOUTUBE_CLIENT_ID/SECRET` .env mein), har user apna channel Settings -> "YouTube connect" se jodta hai. Refresh token us user ke naam par **encrypted** save hota hai. Disconnect = token delete + Google se revoke.
- **Instagram:** har user Settings mein apna **Instagram User ID + Access token** daalta hai (check hota hai, phir encrypted save). `.env` ke `IG_USER_ID/IG_ACCESS_TOKEN` ab sirf purane single-user admin ka fallback hain.
- **Render queue:** machine ek time par ek hi video banati hai (sabke liye). Users ki baari baari lagti hai (round-robin), taaki ek user ki 4 videos baaki sabko din bhar na rokein.
- **Media files:** `/media/(videos|audio|gen)/<reelId>` sirf us video ke owner ko milti hai.
- **Admin panel:** Settings ke neeche "Users": kisne signup kiya, kisne YT/IG connect kiya, account band/chalu, password reset.

## Pehli baar chalane ke steps
1. Naya code upar copy karo (zip ki files apne project par extract), `npm install` (koi nayi dependency nahi hai), `.env` mein ye daalo:
   ```
   ADMIN_EMAIL=tumhari@email.com
   SIGNUP_CODE=koi-code-jo-sirf-tum-doge     # optional, par recommended
   ALLOW_SIGNUP=true
   ```
   (`DASHBOARD_USER/PASS` ab kaam nahi karte, hata do.)
2. `sudo systemctl restart gita-reels` (ya `npm start`).
3. Site kholo -> **Sign up** -> `ADMIN_EMAIL` wali email se account banao. Tumhara purana sara data (reels, plan, topics, settings, YouTube token) **apne aap is admin account ko mil jaata hai**.
4. Dusre users: unhe site ka link + signup code do. Wo Sign up karke Settings -> "Mere YouTube + Instagram account" se apne accounts jodte hain.
5. `storage/.session_secret` ka backup rakho (server shift karo to saath le jao), warna sab ko dobara login + YouTube/IG reconnect karna padega.

## Ye cheezein ab bhi SHARED hain (jaanna zaroori)
- **AI keys** (Gemini, voice, images) `.env` ki hain, sab users ke video unhi par chalte hain. Users badhenge to free limit jaldi khatam hogi. Keys badhao (`GEMINI_API_KEYS=k1,k2,...`) ya per-user keys ka feature baad mein banao.
- **Render machine** ek hai: har video 5-25 min leti hai. 10 users x 3 videos = lambi line. Zyada users ke liye bada server / do worker chahiye.
- **Google OAuth app:** jab tak consent screen "Testing" mein hai, sirf tumhare joday hue test users (max 100) connect kar sakte hain aur token 7 din mein expire hota hai. Asli users ke liye app ko **Publish + Verify** karna padega (`youtube.upload` sensitive scope hai). Landing/privacy/terms pages isi ke hisaab se update kar diye gaye hain, par ek baar khud padh lo.
- **Instagram:** Meta ki policy ke hisaab se doosre logon ke accounts par post karne ke liye ya to wo account tumhare Meta app mein tester/role mein hon, ya app ko `instagram_content_publish` ka **App Review (advanced access)** mile. Abhi manual token paste hai; "Login with Instagram" button (OAuth) next phase hai.

## Naye / badle hue files
Naye: `server/context.js`, `server/tenancy.js`, `server/auth.js`, `server/crypto.js`, `server/site/login.html`, `MULTIUSER.md`
Badle: `server/models.js`, `server/config.js`, `server/app.js`, `server/index.js`, `server/cli.js`, `server/services/{queue,retention,planner,publisher,settings,tts}.js`, `server/uploaders/{youtube,instagram}.js`, `server/site/{index,privacy,terms}.html`, `public/index.html`, `public/editor.html`, `.env.example`, `CLAUDE_CONTEXT.md`, `README.md`, `SETUP.md`, `AWS-DEPLOY.md`

## Test checklist (sandbox mein MongoDB/node_modules nahi the, isliye ye khud chalake dekho)
- [ ] Server start hota hai, log mein `[migrate]` / "user account(s)" dikhta hai.
- [ ] Signup (admin) -> purani videos / plan / settings dikhte hain.
- [ ] Doosra account banao -> uska Plan / Videos khali hai, admin ka kuch nahi dikhta.
- [ ] Dono accounts mein alag YouTube connect -> Settings mein alag email dikhti hai.
- [ ] Dono se ek-ek video banao: queue baari baari chalti hai, upload sahi channel par jaata hai.
- [ ] Doosre user ka video URL (`/media/videos/<id>.mp4`) pehle user ke login se 404 deta hai.
- [ ] Logout -> `/api/reels` 401 deta hai; editor khulta hai aur video render hoti hai (renderer local hai, login nahi maangta).
- [ ] Admin -> user ko "Band karo" -> wo login nahi kar paata.
