# SCRIPT PACK - bahar ki script, fixed format, har reel ke liye

## Kyun
Software ka free Gemini AI kamzor script likhta tha, voice ka uchcharan bigadta tha, aur picture script se match nahi karti thi (kyunki purana storyboard AI "chehra mat dikhao, sirf silhouette" bolta tha, isliye Krishna/Mahadev kabhi dikhte hi nahi the).
Ab: script Claude ke naye chat mein banti hai, ek **fixed JSON format (Script Pack)** mein. Software us pack ko **bina badle** use karta hai.

## Flow (roz ka kaam, 3 minute)
1. Dashboard -> Plan -> **Script Pack** box -> **Master prompt copy karo**.
2. **Naye Claude chat** mein paste karo (ek baar per chat). Phir sirf topic bhejo: `Markandeya, Yamraj aur Mahadev` ya 5 topic ek saath.
3. Claude ek JSON code block dega. Poora copy karo (shuru ke `{` se aakhir ke `}` tak, ya `[` se `]` tak).
4. Dashboard mein paste -> **Check karo** (galtiyan dikhengi) -> **Plan mein daalo**.
5. Settings -> **"Software ka AI bhi script likhe"** ko **OFF** kar do, taaki AI khud kabhi script na likhe. Sirf tumhari packs ki videos banengi.

## Pack ke fields (har ek ka kaam)
| Field | Kaam |
|---|---|
| `title` | Video ke upar dikhne wali heading (Roman, max 8 words) |
| `characters` | Har kirdaar ka fixed look (English). Har picture ke prompt mein yahi description jaata hai, isliye chehra/kapde har scene mein wahi rehte hain |
| `lines[].speak` | Voice yahi padhti hai. Devanagari, saral bolchaal Hindi. **Uchcharan isi par depend karta hai** |
| `lines[].show` | Screen par caption (Roman Hinglish, speak ke same words, 1 key word *star* mein) |
| `lines[].scene` | Us line ki picture ka English description. Yahi image AI ko jaata hai |
| `lines[].who` | Us picture mein kaun-kaun hai (`characters` ke naam) |
| `music` | `epic` / `devotional` / `suspense` / `sad` / `calm` |
| `cta`, `caption`, `hashtags` | Post ke liye |
| `date` (optional) | `2026-12-01`: us din ke liye. Na doge to agle dino mein khud fail jaayegi |

Software har video mein **ek hi look** lagata hai (mythic illustration style, frame layout: upar title, beech mein framed picture, neeche caption). Chaho to pack mein `"look"`, `"variant"` (`classic/headline/kinetic/frame/cinema`), `"caption_style"` (`pop/box/glow`) de sakte ho.

## Pronunciation theek karne ke 3 tarike
1. **Script likhte waqt (sabse zaroori):** Master prompt mein rules hain: Devanagari, chhoti lines, sirf `, । ? !`, mushkil akshar (`ॐ ऋ ऽ ः`) nahi, naam hamesha ek jaise likhna. **Check karo** button bhi in galtiyon ko pakadta hai.
2. **Dictionary (`assets/pronounce.txt`):** jis word ko voice galat padhe, usko yahan likho: `galat spelling => sahi uchcharan wali spelling`. Sirf voice par lagta hai, caption nahi badalta. Save karte hi agli video mein lag jaata hai.
3. **Voice badlo:** Settings -> Voice mein Sarvam ka speaker badal ke dekho. Same script par 3 speakers test karo.
Tarika: video banao -> sunke note karo kaun se words galat hain -> dictionary mein daalo. 5-6 videos mein tumhari apni list ban jaayegi.

## Visuals ab kaise match hote hain
- Storyboard AI **band** hai Script Pack ki videos ke liye. Har line ka `scene` seedha image AI ko jaata hai.
- Har picture ke prompt mein `characters` ka description khud jud jaata hai (`who` ke hisaab se).
- Image generate na ho to 3 baar koshish hoti hai, tab stock picture par jaata hai.
- **Limit (sach):** free image AI (Cloudflare/Pollinations) character ko 100% same nahi banata. Description fixed hone se kaafi behtar hota hai, par kabhi-kabhi chehra thoda alag aa sakta hai. Pakka same chehra chahiye to next step: character ke 5-6 poses ki PNG ek baar bana ke software mein lagana.

## Music
`assets/music/<mood>/` folders mein 3-5 royalty-free tracks daalo (`assets/music/README.txt` dekho). Pack ka `music` mood wahi folder chunta hai. Folder khali ho to koi bhi track, wo bhi na ho to software ka simple synthetic ambience (wahi kamzor wala). **Asli tracks daale bina music achhi nahi hogi.**

## Example
`docs/example-pack.json` (Markandeya / Yamraj / Mahadev). Dashboard mein "Example box mein daalo" se bhi aata hai.

## Files
Naye: `server/services/pack.js`, `server/services/packImport.js`, `docs/SCRIPT_PACK_PROMPT.txt`, `docs/example-pack.json`, `docs/SCRIPT_PACK.md`, `assets/pronounce.txt`, `assets/music/README.txt` + mood folders.
Badle: `server/app.js` (`/api/pack/*`), `server/services/{pipeline,planner,music,voice,images,gemini,settings}.js`, `public/index.html`.
