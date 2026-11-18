// Curated verse bank. Gemini only PICKS an id from here, so Sanskrit text is never hallucinated.
// Still: verify against a trusted edition (e.g. Gita Press) before publishing.
export const VERSES = [
  { id: 'bg-2-47', meaning: 'Tumhara adhikaar sirf karm karne par hai, uske phal par kabhi nahi. Phal ko apna maksad mat banao, aur karm na karne mein bhi aasakti mat rakho.', ref: 'Bhagavad Gita 2.47', themes: 'failure, results, anxiety about outcome, effort, karma',
    sanskrit: 'कर्मण्येवाधिकारस्ते मा फलेषु कदाचन ।\nमा कर्मफलहेतुर्भूर्मा ते सङ्गोऽस्त्वकर्मणि ॥' },
  { id: 'bg-6-35', meaning: 'Krishna maante hain ki mann chanchal hai aur ise kaabu karna mushkil hai, lekin abhyas (lagatar practice) aur vairagya (anaasakti) se ye vash mein aa jaata hai.', ref: 'Bhagavad Gita 6.35', themes: 'overthinking, restless mind, mental control, practice',
    sanskrit: 'असंशयं महाबाहो मनो दुर्निग्रहं चलम् ।\nअभ्यासेन तु कौन्तेय वैराग्येण च गृह्यते ॥' },
  { id: 'bg-2-14', meaning: 'Sardi-garmi, sukh-dukh ka anubhav indriyon ke sparsh se aata-jaata hai, ye anitya hain. Isliye inhe sehna seekho.', ref: 'Bhagavad Gita 2.14', themes: 'heartbreak, pain is temporary, endurance, ups and downs',
    sanskrit: 'मात्रास्पर्शास्तु कौन्तेय शीतोष्णसुखदुःखदाः ।\nआगमापायिनोऽनित्यास्तांस्तितिक्षस्व भारत ॥' },
  { id: 'bg-2-22', meaning: 'Jaise insaan purane kapde chhod kar naye pehen leta hai, waise hi aatma purane sharir chhod kar naye mein jaati hai.', ref: 'Bhagavad Gita 2.22', themes: 'loss, letting go, endings, new beginnings, grief',
    sanskrit: 'वासांसि जीर्णानि यथा विहाय नवानि गृह्णाति नरोऽपराणि ।\nतथा शरीराणि विहाय जीर्णान्यन्यानि संयाति नवानि देही ॥' },
  { id: 'bg-2-63', meaning: 'Krodh se moh paida hota hai, moh se yaadasht bhatakti hai, usse buddhi nasht hoti hai, aur buddhi nasht hone par insaan khud gir jaata hai.', ref: 'Bhagavad Gita 2.63', themes: 'anger, losing control, clouded judgment',
    sanskrit: 'क्रोधाद्भवति सम्मोहः सम्मोहात्स्मृतिविभ्रमः ।\nस्मृतिभ्रंशाद् बुद्धिनाशो बुद्धिनाशात्प्रणश्यति ॥' },
  { id: 'bg-6-5', meaning: 'Khud ko khud hi upar uthao, khud ko giraao mat. Insaan khud hi apna mitra hai aur khud hi apna shatru.', ref: 'Bhagavad Gita 6.5', themes: 'self-doubt, self-worth, being your own friend, self-improvement',
    sanskrit: 'उद्धरेदात्मनात्मानं नात्मानमवसादयेत् ।\nआत्मैव ह्यात्मनो बन्धुरात्मैव रिपुरात्मनः ॥' },
  { id: 'bg-2-38', meaning: 'Sukh-dukh, laabh-haani, jeet-haar ko barabar samajh kar apna kartavya karo. Aise karoge to paap nahi lagega.', ref: 'Bhagavad Gita 2.38', themes: 'balance in success and failure, win or lose, pressure',
    sanskrit: 'सुखदुःखे समे कृत्वा लाभालाभौ जयाजयौ ।\nततो युद्धाय युज्यस्व नैवं पापमवाप्स्यसि ॥' },
  { id: 'bg-2-56', meaning: 'Jo dukh mein vichlit nahi hota, sukh mein lalayit nahi hota, aur raag-bhay-krodh se mukt hai, use sthir buddhi wala kehte hain.', ref: 'Bhagavad Gita 2.56', themes: 'anxiety, calm mind, emotional stability, detachment from highs and lows',
    sanskrit: 'दुःखेष्वनुद्विग्नमनाः सुखेषु विगतस्पृहः ।\nवीतरागभयक्रोधः स्थितधीर्मुनिरुच्यते ॥' },
  { id: 'bg-9-22', meaning: 'Jo log bina kisi aur sahare ke mujhe yaad karte hain, un nirantar judne walon ki zaroorat aur suraksha ka zimma main khud uthata hoon.', ref: 'Bhagavad Gita 9.22', themes: 'fear of future, security, trust, loneliness, faith',
    sanskrit: 'अनन्याश्चिन्तयन्तो मां ये जनाः पर्युपासते ।\nतेषां नित्याभियुक्तानां योगक्षेमं वहाम्यहम् ॥' },
  { id: 'bg-2-3', meaning: 'Kamzori mat apnao, ye tumhe shobha nahi deti. Dil ki is chhoti kamzori ko chhodo aur uth khade ho.', ref: 'Bhagavad Gita 2.3', themes: 'courage, weakness, rising up, lack of confidence, motivation',
    sanskrit: 'क्लैब्यं मा स्म गमः पार्थ नैतत्त्वय्युपपद्यते ।\nक्षुद्रं हृदयदौर्बल्यं त्यक्त्वोत्तिष्ठ परन्तप ॥' },
  { id: 'bg-18-66', meaning: 'Saare sahare aur chintaaein chhod kar meri sharan mein aa jao. Main tumhe saare bojh aur paapon se mukt kar dunga, shok mat karo.', ref: 'Bhagavad Gita 18.66', themes: 'guilt, surrender, regret, burden, letting go of worry',
    sanskrit: 'सर्वधर्मान्परित्यज्य मामेकं शरणं व्रज ।\nअहं त्वां सर्वपापेभ्यो मोक्षयिष्यामि मा शुचः ॥' },
  { id: 'bg-4-7', meaning: 'Jab-jab dharm ki haani hoti hai aur adharm badhta hai, tab-tab main khud prakat hota hoon.', ref: 'Bhagavad Gita 4.7', themes: 'hope, dark times, faith, hard phase of life',
    sanskrit: 'यदा यदा हि धर्मस्य ग्लानिर्भवति भारत ।\nअभ्युत्थानमधर्मस्य तदात्मानं सृजाम्यहम् ॥' },

  // ---- added: more verses so reels stop repeating the same shlok. Verify against Gita Press before publishing. ----
  { id: 'bg-2-13', meaning: 'Jaise is sharir mein bachpan, jawani aur budhapa aata hai, waise hi doosra sharir milta hai. Samajhdaar insaan is badlav se vichlit nahi hota.', ref: 'Bhagavad Gita 2.13', themes: 'change, growing up, aging, time passing, acceptance',
    sanskrit: 'देहिनोऽस्मिन्यथा देहे कौमारं यौवनं जरा ।\nतथा देहान्तरप्राप्तिर्धीरस्तत्र न मुह्यति ॥' },
  { id: 'bg-2-20', meaning: 'Aatma na kabhi janmati hai na marti hai. Wo ajanma, nitya aur purani hai; sharir ke mar jaane par bhi wo nahi marti.', ref: 'Bhagavad Gita 2.20', themes: 'death, grief, losing someone, fear of death, eternal self',
    sanskrit: 'न जायते म्रियते वा कदाचिन्नायं भूत्वा भविता वा न भूयः ।\nअजो नित्यः शाश्वतोऽयं पुराणो न हन्यते हन्यमाने शरीरे ॥' },
  { id: 'bg-2-23', meaning: 'Aatma ko shastra kaat nahi sakte, aag jala nahi sakti, paani bhigo nahi sakta aur hawa sukha nahi sakti.', ref: 'Bhagavad Gita 2.23', themes: 'inner strength, unbreakable, fear, resilience, hurt',
    sanskrit: 'नैनं छिन्दन्ति शस्त्राणि नैनं दहति पावकः ।\nन चैनं क्लेदयन्त्यापो न शोषयति मारुतः ॥' },
  { id: 'bg-2-27', meaning: 'Jiska janm hua hai uski mrityu nishchit hai, aur jo mara hai uska janm nishchit hai. Isliye jo taala nahi ja sakta, uske liye shok karna theek nahi.', ref: 'Bhagavad Gita 2.27', themes: 'death, grief, acceptance, what cannot be changed, loss',
    sanskrit: 'जातस्य हि ध्रुवो मृत्युर्ध्रुवं जन्म मृतस्य च ।\nतस्मादपरिहार्येऽर्थे न त्वं शोचितुमर्हसि ॥' },
  { id: 'bg-2-40', meaning: 'Is marg mein koshish kabhi bekaar nahi jaati aur koi ulta nuksaan nahi hota. Is dharm ka thoda sa abhyas bhi bade bhay se bacha leta hai.', ref: 'Bhagavad Gita 2.40', themes: 'small steps, starting, consistency, fear of wasting effort, discipline',
    sanskrit: 'नेहाभिक्रमनाशोऽस्ति प्रत्यवायो न विद्यते ।\nस्वल्पमप्यस्य धर्मस्य त्रायते महतो भयात् ॥' },
  { id: 'bg-2-48', meaning: 'Aasakti chhod kar, safalta aur asafalta mein sam rehkar apne karm karo. Is samta ko hi yog kehte hain.', ref: 'Bhagavad Gita 2.48', themes: 'balance, success and failure, detachment, focus, pressure',
    sanskrit: 'योगस्थः कुरु कर्माणि सङ्गं त्यक्त्वा धनञ्जय ।\nसिद्ध्यसिद्ध्योः समो भूत्वा समत्वं योग उच्यते ॥' },
  { id: 'bg-2-50', meaning: 'Samajhdaar insaan yahin sukrit aur dushkrit dono se upar uth jaata hai. Isliye yog mein lag jao; karm mein kushalta hi yog hai.', ref: 'Bhagavad Gita 2.50', themes: 'skill, work excellence, career, doing your best, focus',
    sanskrit: 'बुद्धियुक्तो जहातीह उभे सुकृतदुष्कृते ।\nतस्माद्योगाय युज्यस्व योगः कर्मसु कौशलम् ॥' },
  { id: 'bg-2-62', meaning: 'Vishayon ka lagatar chintan karne se unmein aasakti ho jaati hai, aasakti se kaamna, aur kaamna se krodh paida hota hai.', ref: 'Bhagavad Gita 2.62', themes: 'obsession, addiction, phone, attachment, desire turning into anger',
    sanskrit: 'ध्यायतो विषयान्पुंसः सङ्गस्तेषूपजायते ।\nसङ्गात्सञ्जायते कामः कामात्क्रोधोऽभिजायते ॥' },
  { id: 'bg-2-66', meaning: 'Jiska mann sthir nahi, uski buddhi nahi, bhavna nahi; aur bhavna ke bina shanti nahi. Jisme shanti nahi, usse sukh kahan?', ref: 'Bhagavad Gita 2.66', themes: 'peace of mind, restlessness, no happiness, focus, inner calm',
    sanskrit: 'नास्ति बुद्धिरयुक्तस्य न चायुक्तस्य भावना ।\nन चाभावयतः शान्तिरशान्तस्य कुतः सुखम् ॥' },
  { id: 'bg-2-71', meaning: 'Jo insaan saari kaamnaon ko chhod kar, mamta aur ahankar ke bina jeeta hai, wahi shanti paata hai.', ref: 'Bhagavad Gita 2.71', themes: 'ego, desires, peace, minimalism, letting go, contentment',
    sanskrit: 'विहाय कामान्यः सर्वान्पुमांश्चरति निःस्पृहः ।\nनिर्ममो निरहङ्कारः स शान्तिमधिगच्छति ॥' },
  { id: 'bg-3-8', meaning: 'Apna nirdharit karm karo, kyunki karm na karne se karm karna behtar hai. Karm ke bina to sharir ki yatra bhi nahi chal sakti.', ref: 'Bhagavad Gita 3.8', themes: 'laziness, procrastination, doing work, motivation, discipline',
    sanskrit: 'नियतं कुरु कर्म त्वं कर्म ज्यायो ह्यकर्मणः ।\nशरीरयात्रापि च ते न प्रसिद्ध्येदकर्मणः ॥' },
  { id: 'bg-3-21', meaning: 'Shreshth insaan jo karta hai, baaki log wahi karte hain. Wo jo maanak banata hai, duniya usi ka anusaran karti hai.', ref: 'Bhagavad Gita 3.21', themes: 'leadership, example, influence, role model, parenting',
    sanskrit: 'यद्यदाचरति श्रेष्ठस्तत्तदेवेतरो जनः ।\nस यत्प्रमाणं कुरुते लोकस्तदनुवर्तते ॥' },
  { id: 'bg-3-35', meaning: 'Apna dharm, bhale gunhin ho, doosre ke achhe se nibhaaye dharm se behtar hai. Apne dharm mein marna bhi achha hai, doosre ka dharm bhay dene wala hai.', ref: 'Bhagavad Gita 3.35', themes: 'comparison, own path, copying others, identity, career choice',
    sanskrit: 'श्रेयान्स्वधर्मो विगुणः परधर्मात्स्वनुष्ठितात् ।\nस्वधर्मे निधनं श्रेयः परधर्मो भयावहः ॥' },
  { id: 'bg-3-37', meaning: 'Ye kaamna aur krodh, jo rajogun se paida hote hain, bahut khaane wale aur bade paapi hain. Ise hi apna shatru samjho.', ref: 'Bhagavad Gita 3.37', themes: 'desire, anger, greed, enemy within, self-control',
    sanskrit: 'काम एष क्रोध एष रजोगुणसमुद्भवः ।\nमहाशनो महापाप्मा विद्ध्येनमिह वैरिणम् ॥' },
  { id: 'bg-4-11', meaning: 'Jo mujhe jis bhaav se bhajta hai, main use usi roop mein sweekar karta hoon. Sab manushya sab prakaar se mere hi marg par chalte hain.', ref: 'Bhagavad Gita 4.11', themes: 'faith, devotion, your intent matters, relationships, giving what you get',
    sanskrit: 'ये यथा मां प्रपद्यन्ते तांस्तथैव भजाम्यहम् ।\nमम वर्त्मानुवर्तन्ते मनुष्याः पार्थ सर्वशः ॥' },
  { id: 'bg-4-38', meaning: 'Is sansaar mein gyaan ke samaan pavitra kuch nahi. Jo yog mein siddh ho jaata hai, wo samay ke saath use apne hi andar paa leta hai.', ref: 'Bhagavad Gita 4.38', themes: 'knowledge, learning, clarity, confusion, self-awareness',
    sanskrit: 'न हि ज्ञानेन सदृशं पवित्रमिह विद्यते ।\nतत्स्वयं योगसंसिद्धः कालेनात्मनि विन्दति ॥' },
  { id: 'bg-6-6', meaning: 'Jisne khud ko jeet liya, uske liye uska mann mitra hai. Jisne nahi jeeta, uske liye wahi mann shatru jaisa kaam karta hai.', ref: 'Bhagavad Gita 6.6', themes: 'mind as friend or enemy, self-control, self-talk, discipline, overthinking',
    sanskrit: 'बन्धुरात्मात्मनस्तस्य येनात्मैवात्मना जितः ।\nअनात्मनस्तु शत्रुत्वे वर्तेतात्मैव शत्रुवत् ॥' },
  { id: 'bg-6-17', meaning: 'Jiska khana-peena, ghoomna-firna, kaam aur sona-jaagna santulit hai, uske liye yog dukhon ko mitane wala ban jaata hai.', ref: 'Bhagavad Gita 6.17', themes: 'balance, sleep, routine, health, burnout, work-life balance',
    sanskrit: 'युक्ताहारविहारस्य युक्तचेष्टस्य कर्मसु ।\nयुक्तस्वप्नावबोधस्य योगो भवति दुःखहा ॥' },
  { id: 'bg-6-26', meaning: 'Chanchal aur asthir mann jahan-jahan bhatke, wahan-wahan se use roak kar baar-baar apne andar hi vash mein lao.', ref: 'Bhagavad Gita 6.26', themes: 'distraction, focus, wandering mind, meditation, concentration',
    sanskrit: 'यतो यतो निश्चरति मनश्चञ्चलमस्थिरम् ।\nततस्ततो नियम्यैतदात्मन्येव वशं नयेत् ॥' },
  { id: 'bg-9-26', meaning: 'Jo bhakti se mujhe ek patta, phool, phal ya jal bhi arpit karta hai, main use prem se sweekar karta hoon.', ref: 'Bhagavad Gita 9.26', themes: 'simple offering, sincerity, small things matter, devotion, intention',
    sanskrit: 'पत्रं पुष्पं फलं तोयं यो मे भक्त्या प्रयच्छति ।\nतदहं भक्त्युपहृतमश्नामि प्रयतात्मनः ॥' },
  { id: 'bg-16-21', meaning: 'Kaam, krodh aur lobh, ye teen narak ke dwaar hain jo aatma ka naash karte hain. Isliye in teenon ko chhod dena chahiye.', ref: 'Bhagavad Gita 16.21', themes: 'greed, anger, lust, toxic habits, self-destruction, what to avoid',
    sanskrit: 'त्रिविधं नरकस्येदं द्वारं नाशनमात्मनः ।\nकामः क्रोधस्तथा लोभस्तस्मादेतत्त्रयं त्यजेत् ॥' },
  { id: 'bg-18-78', meaning: 'Jahan yogeshwar Krishna hain aur jahan dhanurdhari Arjun hai, wahan shree, vijay, aishwarya aur achal neeti hai, aisa mera mat hai.', ref: 'Bhagavad Gita 18.78', themes: 'victory, guidance, right mentor, effort plus faith, success',
    sanskrit: 'यत्र योगेश्वरः कृष्णो यत्र पार्थो धनुर्धरः ।\nतत्र श्रीर्विजयो भूतिर्ध्रुवा नीतिर्मतिर्मम ॥' },
];
export const verseById = (id) => VERSES.find((v) => v.id === id);

const words = (s) => String(s || '').toLowerCase().match(/[a-z]{3,}/g) || [];

/**
 * Pick N candidate verses for a topic. Verses used in the most recent reels are skipped
 * (recentIds is newest-first), so the same shlok does not come back for a long time.
 */
export function candidateVerses(topic, recentIds = [], n = 6) {
  const blocked = new Set(recentIds.slice(0, Math.min(recentIds.length, Math.max(0, VERSES.length - n - 4)))); // cycle through almost the whole bank before any repeat
  const tw = new Set(words(topic));
  const scored = VERSES.map((v) => {
    const vw = words(`${v.themes} ${v.ref}`);
    const hit = vw.filter((w) => tw.has(w) || [...tw].some((t) => t.length > 4 && (w.startsWith(t.slice(0, 5)) || t.startsWith(w.slice(0, 5))))).length;
    return { v, s: hit * 2 + Math.random() * 1.5 - (blocked.has(v.id) ? 100 : 0) };
  }).sort((a, b) => b.s - a.s);
  return scored.slice(0, n).map((x) => x.v);
}
