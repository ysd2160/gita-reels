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
];
export const verseById = (id) => VERSES.find((v) => v.id === id);
