/**
 * Islamic Audio Filter & Halal Policy Enforcement Engine for Discord Bot.
 * Ensures only Islamic content (Quran recitations, Nasheeds, Naat, Hamd, Duas)
 * is queried, loaded, and played. Strictly blocks all secular songs, DJ remixes, pop music, and secular artists.
 */

const ISLAMIC_TERMS = [
  // Quran & Recitation terms
  "quran", "qur'an", "quranic", "koran", "surah", "surat", "ayat", "ayah",
  "tilawat", "tilawah", "qirat", "qiraat", "recitation", "tajweed", "tajwid",
  "tafseer", "tafsir", "juz", "para", "ruqyah", "manzil", "mushaf", "tartil",
  "tarteel", "hafiz", "qari", "makki", "madani",

  // 114 Surahs
  "fatihah", "fateha", "fatiha", "baqarah", "bakara", "al-baqara",
  "ali imran", "al-imran", "imran", "nisa", "an-nisa", "maidah", "al-maidah",
  "anam", "al-anam", "araf", "al-araf", "anfal", "al-anfal", "tawbah", "tauba", "at-tawbah",
  "yunus", "surah hud", "surat hud", "yusuf", "ar-rad", "surah rad", "surat rad", "ibrahim", "hijr", "al-hijr",
  "nahl", "an-nahl", "isra", "al-isra", "kahf", "al-kahf", "maryam", "taha", "ta-ha",
  "anbiya", "al-anbiya", "hajj", "al-hajj", "muminun", "al-muminun", "an-nur", "al-nur", "surah nur", "surat nur",
  "furqan", "al-furqan", "shuara", "ash-shuara", "naml", "an-naml", "qasas", "al-qasas",
  "ankabut", "al-ankabut", "ar-rum", "surah rum", "surat rum", "luqman", "sajdah", "as-sajdah",
  "ahzab", "al-ahzab", "saba", "fatir", "yasin", "yaseen", "ya-sin", "ya-seen",
  "saffat", "as-saffat", "surah sad", "surat sad", "saad", "zumar", "az-zumar", "ghafir", "fussilat",
  "shura", "ash-shura", "zukhruf", "az-zukhruf", "dukhan", "ad-dukhan", "jathiyah",
  "ahqaf", "al-ahqaf", "muhammad", "fath", "al-fath", "hujurat", "al-hujurat",
  "surah qaf", "surat qaf", "dhariyat", "ad-dhariyat", "at-tur", "surah tur", "surat tur", "najm", "an-najm",
  "qamar", "al-qamar", "rahman", "ar-rahman", "waqiah", "al-waqiah", "waqia",
  "hadid", "al-hadid", "mujadilah", "hashr", "al-hashr", "mumtahanah",
  "saff", "as-saff", "jumuah", "al-jumuah", "jumah", "munafiqun", "al-munafiqun",
  "taghabun", "at-taghabun", "talaq", "at-talaq", "tahrim", "at-tahrim",
  "mulk", "al-mulk", "tabarak", "qalam", "al-qalam", "haqqah", "al-haqqah",
  "maarij", "al-maarij", "nuh", "jinn", "al-jinn", "muzzammil", "al-muzzammil",
  "muddathir", "al-muddathir", "qiyamah", "al-qiyamah", "insan", "al-insan", "dahr",
  "mursalat", "al-mursalat", "naba", "an-naba", "naziat", "an-naziat", "abasa",
  "takwir", "at-takwir", "infitar", "al-infitar", "mutaffifin", "al-mutaffifin",
  "inshiqaq", "al-inshiqaq", "burooj", "al-burooj", "tariq", "at-tariq",
  "al-ala", "surah ala", "surat ala", "ghashiyah", "al-ghashiyah", "fajr", "al-fajr", "balad", "al-balad",
  "shams", "ash-shams", "layl", "al-layl", "duha", "ad-duha", "sharh", "ash-sharh", "inshirah",
  "at-tin", "surah tin", "surat tin", "alaq", "al-alaq", "iqra", "qadr", "al-qadr", "bayyinah", "al-bayyinah",
  "zalzalah", "az-zalzalah", "adiyat", "al-adiyat", "qariah", "al-qariah",
  "takathur", "at-takathur", "al-asr", "surah asr", "surat asr", "humazah", "al-humazah",
  "al-fil", "surah fil", "surat fil", "quraysh", "maun", "al-maun", "kawthar", "al-kawthar", "kauthar",
  "kafirun", "al-kafirun", "nasr", "an-nasr", "masad", "al-masad", "lahab",
  "ikhlas", "al-ikhlas", "falaq", "al-falaq", "an-nas", "al-nas", "surah nas", "surat nas",

  // Genres & Styles
  "nasheed", "nasheeds", "anasheed", "anashid", "nasyid", "naat", "na'at",
  "naath", "hamd", "madih", "madeeh", "munajat", "manqabat", "qawwali",
  "ilahiler", "ilahi", "kalam", "dua", "du'a", "dhikr", "zikr", "azkar",
  "adhkar", "tasbih", "tasbeeh", "salawat", "darood", "durood", "athan",
  "azan", "adhan", "khutbah", "bayan", "dars", "waaz", "waz", "mahfil", "naseeha",
  "nasiha", "nasihat", "tahajjud", "istighfar",
  "taraweeh", "tarawih", "acapella nasheed", "vocal only nasheed", "halal audio",

  // Holy Entities & Concepts
  "allah", "subhanallah", "alhamdulillah", "allahu akbar", "bismillah",
  "la ilaha illallah", "prophet muhammad", "holy prophet", "rasool", "rasul", "rasulullah", "nabi",
  "sahaba", "ahle bait", "ramadan", "ramadhan", "ramzan", "eid mubarak",
  "eid ul fitr", "eid ul adha", "makkah", "mecca", "madinah", "medina",
  "kaaba", "ka'bah", "masjid", "mosque", "hajj", "umrah", "islam", "islamic",
  "muslim", "halal", "deen", "iman", "tawhid", "sunnah", "hadith", "jannah",
  "akhirah", "shariah", "seerah", "sirah",

  // Quran Reciters
  "mishary", "alafasy", "al-afasy", "abdul rahman al-sudais", "al-sudais", "sudais",
  "saud al-shuraim", "al-shuraim", "shuraim", "maher al-muaiqly", "al-muaiqly", "muaiqly",
  "saad al-ghamdi", "al-ghamdi", "ghamdi", "yasser al-dossari", "al-dossari", "dossari",
  "abdul basit", "abdus samad", "abu bakr al-shatri", "al-shatri", "shatri",
  "ali jaber", "mahmoud khalil al-hussary", "al-hussary", "hussary", "husary",
  "mohamed siddiq al-minshawi", "al-minshawi", "minshawi", "islam sobhi",
  "raad al kurdi", "raad mohammad al kurdi", "mansour al-salimi", "salimi",
  "omar hisham al arabi", "nasser al qatami", "qatami", "idrees abkar", "abkar",
  "ahmed al ajmi", "al-ajmi", "ajmi", "fares abbad", "abbad", "hazaa al balushi",
  "balushi", "khalid al jaleel", "salah bukhatir", "wadee al yamani", "ahmed al nufais",
  "bandar baleela", "qari abdul basith", "qari waheed zafar",

  // Islamic Artists & Speakers
  "maher zain", "sami yusuf", "harris j", "zain bhikha", "ahmed bukhatir",
  "omar esa", "siedd", "muhammad al muqit", "al muqit", "humood alkhudher",
  "humood", "mesut kurtis", "raef", "dawud wharnsby", "ali magrebi",
  "muhammad tariq", "baraa masoud", "mostafa atef", "amjad sabri",
  "nusrat fateh ali khan", "sabri brothers", "owais raza qadri", "owais qadri",
  "junaid jamshed", "fasih ud din soharwardi", "tariq jameel", "mufti menk",
  "menk", "mufti", "shaykh", "sheikh", "ustadh", "allama", "maulana",
  "nouman ali khan", "yasir qadhi", "dr zakir naik", "bilal assad",

  // Bengali, Urdu & Subcontinental Islamic Genres & Terms
  "gojol", "gozhol", "gajol", "ghazal", "gazal", "গজল", "নাত", "হামদ", "কোরআন", "সুরা", "তেলাওয়াত",
  "ওয়াজ", "মাহফিল", "বায়ান", "তাফসির", "নসিহত",
  "নবী", "রাসুল", "আল্লাহ", "ইসলামিক", "মাদরাসাহ", "কাফেলা", "কলরব", "kalarob", "kalarab", "abu rayhan",
  "mahfuzul alam", "sayed ahmad", "badhon", "ainuddin al azad", "motiur rahman mallik",
  "tariq monowar", "delwar hossain sayeedi", "mizanur rahman azhari", "azhari", "azhari bayan",
  "tawhid jamil", "anas nazeer", "hafiz jalabeeb", "iqra sisters", "laiba fatima",
  "kalam", "nazam", "nazm", "tarana",

  // Famous Nasheeds & Expressions
  "hasbi rabbi", "kun anta", "tala al badru", "tala al-badru", "ya nabi salam alayka",
  "assalamu alayka", "maula ya salli", "mawla ya salli", "qamarun", "labbayk", "labbaik",
  "atuna tufuli", "a'tuna tufuli", "salawat", "darood sharif", "durood sharif",
  "watu illu", "watu izzu", "watu zillu", "mantasha", "man tasha", "tuizzu man tasha",

  // Universal High-Traffic Islamic Hashtags & Slang
  "#islamicstatus", "islamic status", "islamicstatus",
  "#islamicvids", "islamic vids", "islamicvids",
  "#islamicvideo", "islamic video", "islamic videos", "islamicvideo",
  "#islamickalam", "islamic kalam", "islamickalam",
  "#islamicvibes", "islamic vibes", "islamicvibes",
  "#islamicremix", "islamic remix", "islamicremix",
  "#islamicshorts", "islamic shorts", "islamicshorts",
  "#islamicreels", "islamic reels", "islamicreels",
  "#halalmusic", "halal music", "halalmusic",

  // Waz (Sermons, Bayans, Speeches) Hashtags & Keywords
  "#waz", "waz", "#islamicwaz", "islamic waz", "islamicwaz",
  "#islamicspeech", "islamic speech", "islamicspeech", "islamic speeches",
  "islamic lecture", "islamic lectures",
  "#bayan", "bayan", "bayans",
  "#emotionalbayan", "emotional bayan", "emotionalbayan",
  "#emotionalwaz", "emotional waz", "emotionalwaz",
  "emotional speech", "dars", "khutbah", "mahfil", "#mahfil",

  // Naat (Praises of the Holy Prophet ﷺ) Hashtags & Keywords
  "#naat", "naat", "#naatsharif", "naat sharif", "naat shareef", "naatsharif",
  "#newnaat", "new naat", "newnaat", "latest naat",
  "#madinah", "madinah", "medina", "#makkah", "makkah", "mecca",
  "#yarasoolallah", "ya rasool allah", "ya rasoolallah", "yarasoolallah",
  "ya habiballah",

  // Nasheed (Vocal Chants & Halal Bangers) Hashtags & Slang
  "#nasheed", "nasheed", "#nasheeds", "nasheeds", "anasheed", "anashid", "nasyid",
  "#halalbanger", "halal banger", "halalbanger", "halal bangers", "#halalbangers",
  "#vocalonly", "vocal only", "vocalonly", "vocal without music",
  "#nomusic", "no music", "nomusic", "instruments free", "instrument free",
  "acapella nasheed", "vocal nasheed",

  // Modern Gen-Z & Trending Islamic Community Hashtags
  "#halalvibes", "halal vibes", "halalvibes",
  "#muslimvibes", "muslim vibes", "muslimvibes",
  "#nasheedvibes", "nasheed vibes", "nasheedvibes",
  "#quranvibes", "quran vibes", "quranvibes",
  "#quranrecitation", "quran recitation", "quranrecitation",
  "#quranstatus", "quran status", "quranstatus",
  "#islamicreminder", "islamic reminder", "islamic reminders", "islamicreminder",
  "#islamicquotes", "islamic quotes", "islamicquotes",
  "#deenoverdunya", "deen over dunya", "deenoverdunya",
  "#tahajjudvibes", "tahajjud vibes",
  "#ramadanvibes", "ramadan vibes",
  "#eidvibes", "eid vibes",
  "#jummahmubarak", "jummah mubarak", "jummahmubarak",
  "#alhamdulillah", "#subhanallah", "#allahuakbar",

  // Arabic
  "قرآن", "قران", "سورة", "تلاوة", "تجويد", "تفسير", "نشيد", "اناشيد", "أناشيد",
  "نعت", "حمد", "دعاء", "أدعية", "ذكر", "أذكار", "اذكار", "إسلام", "اسلام",
  "إسلامي", "اسلامي", "الله", "محمد", "رسول", "رمضان", "مكة", "المدينة",
  "الكعبة", "حج", "عمرة", "الأذان", "الاذان", "تراويح", "مشاري", "العفاسي",
  "السديس", "الشريم", "المعيقلي", "الغامدي", "الدوسري", "الحصري", "المنشاوي",
  "عبد الباسط", "ماهر زين", "سامي يوسف", "حمود الخضر", "أحمد بوخاطر", "عمر عيسى"
];

const BLOCKED_KEYWORDS = [
  // Dance, club, remix, electronic
  "remix", "dj", "dj remix", "dj song", "purulia", "club mix", "dance mix", "party song",
  "edm", "techno", "house music", "trance", "bass boosted", "slowed reverb", "lofi remix",
  "mashup", "disco", "rave", "nightclub", "strip club", "dance club",

  // Secular genres
  "item song", "item number", "pop song", "pop music", "hip hop", "rap", "rock",
  "metal", "heavy metal", "punk", "romantic love duet", "romantic song", "love song",
  "breakup song", "sad love", "sexy", "vulgar", "explicit",

  // Regional secular industries
  "bhojpuri", "bollywood", "tollywood", "kollywood", "punjabi song", "bengali song",
  "hindi song", "tamil song", "telugu song", "kpop", "jpop",

  // Popular secular artists
  "lil nas", "taylor swift", "justin bieber", "drake", "eminem", "travis scott",
  "ariana grande", "billie eilish", "the weeknd", "dua lipa", "post malone",
  "bad bunny", "ed sheeran", "shakira", "rihanna", "beyonce", "katy perry",
  "bruno mars", "selena gomez", "alan walker", "martin garrix", "david guetta",
  "marshmello", "avicii", "skrillex", "tiesto", "zedd", "calvin harris",
  "dj snake", "chainsmokers", "bts", "blackpink", "arijit singh", "neha kakkar",
  "badshah", "honey singh", "mc stan", "sidhu moose wala", "karan aujla", "diljit dosanjh"
];

const ISLAMIC_REMIX_EXCEPTIONS = [
  "islamic remix", "nasheed remix", "halal remix", "naat remix",
  "acapella remix", "vocal remix", "quran remix", "islamic slowed",
  "nasheed slowed", "halal slowed", "islamic lofi", "nasheed lofi", "halal lofi"
];

function isIslamicRemix(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  const withSpaces = t.replace(/[-_#]/g, " ");
  const cleanSpaceless = t.replace(/[^a-z0-9]/g, "");
  const spacelessExceptions = ISLAMIC_REMIX_EXCEPTIONS.map(e => e.replace(/\s+/g, ""));
  return ISLAMIC_REMIX_EXCEPTIONS.some(e => withSpaces.includes(e)) ||
         spacelessExceptions.some(e => cleanSpaceless.includes(e));
}

function normalizeText(text) {
  if (!text) return "";
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function containsTerm(text, term) {
  if (!text || !term) return false;
  const cleanText = text.toLowerCase().replace(/[-'’]/g, " ");
  const cleanKw = term.toLowerCase().replace(/[-'’]/g, " ");

  const escaped = cleanKw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
  return regex.test(cleanText);
}

function checkBlocked(text) {
  if (!text) return { blocked: false };
  const normalized = normalizeText(text);
  const remixExempt = isIslamicRemix(normalized);

  for (const blocked of BLOCKED_KEYWORDS) {
    // If the query/track is explicitly tagged as an Islamic/Nasheed remix or Islamic lofi,
    // do not flag generic 'remix', 'lofi remix', or 'slowed reverb'.
    // Strictly blocks secular DJ, dance, club, Bollywood, Purulia remix terms.
    if (remixExempt && (blocked === "remix" || blocked === "lofi remix" || blocked === "slowed reverb")) {
      continue;
    }

    if (containsTerm(normalized, blocked)) {
      return { blocked: true, keyword: blocked };
    }
  }
  return { blocked: false };
}

function isIslamicText(text) {
  if (!text) return false;
  const normalized = normalizeText(text);

  // If it contains any explicitly blocked keyword, reject immediately
  if (checkBlocked(normalized).blocked) {
    return false;
  }

  // Check against Islamic terms
  for (const term of ISLAMIC_TERMS) {
    if (containsTerm(normalized, term)) {
      return true;
    }
  }

  return false;
}

function isIslamicTrack(track) {
  if (!track || !track.info) return false;

  const uri = track.info.uri || "";
  // Direct Quran CDN audio is always halal
  if (uri.includes("download.quranicaudio.com") || uri.includes("quranicaudio.com")) {
    return true;
  }

  const combined = `${track.info.title || ""} ${track.info.author || ""} ${track.info.sourceName || ""}`;
  return isIslamicText(combined);
}

function isIslamicQuery(query) {
  return isIslamicText(query);
}

function sanitizeSearchQuery(query) {
  if (!query) return query;
  if (isIslamicQuery(query)) {
    return query;
  }
  return `${query.trim()} Islamic Nasheed`;
}

function validateByFilterMode(mode, target) {
  // target can be string query or track object
  const isTrack = target && typeof target === "object" && target.info;
  const uri = isTrack ? (target.info.uri || "") : (typeof target === "string" ? target : "");
  const text = isTrack ? `${target.info.title || ""} ${target.info.author || ""}` : String(target || "");

  // Direct Quran CDN audio is ALWAYS halal under all filters
  if (uri.includes("download.quranicaudio.com") || uri.includes("quranicaudio.com")) {
    return { allowed: true, reason: "Direct Quranic Audio CDN" };
  }

  // 1. FILTERLESS PLAY
  if (mode === "filterless") {
    return { allowed: true, reason: "Filterless play (Unrestricted audio)" };
  }

  const normalized = normalizeText(text);

  // 2. FILTER 1: STRICT HALAL ('#')
  if (mode === "strict") {
    // In strict mode, no remixes, DJs, or instrumentals are permitted at all
    for (const blocked of BLOCKED_KEYWORDS) {
      if (containsTerm(normalized, blocked)) {
        return { allowed: false, reason: `Blocked in Strict Halal mode (contains "${blocked}")` };
      }
    }
    // Must match confirmed Islamic keywords (Quran, pure nasheed, naat, hamd, etc.)
    for (const term of ISLAMIC_TERMS) {
      if (containsTerm(normalized, term)) {
        return { allowed: true, reason: `Verified Islamic: "${term}"` };
      }
    }
    return { allowed: false, reason: "No verified Islamic term found in query/track" };
  }

  // 3. FILTER 2: ISLAMIC REMIX & VIBES ('*' or '$')
  if (mode === "remix") {
    let hasIslamicTerm = false;
    for (const term of ISLAMIC_TERMS) {
      if (containsTerm(normalized, term)) {
        hasIslamicTerm = true;
        break;
      }
    }
    if (!hasIslamicTerm && !isIslamicRemix(normalized)) {
      return { allowed: false, reason: "No Islamic topic or Islamic remix tag found in query" };
    }

    // In Filter 2, permit audio production & styling terms for Islamic tracks:
    const allowedProductionTerms = new Set([
      "remix", "lofi", "slowed", "reverb", "bass", "trap", "acoustic", "beat",
      "lofi remix", "slowed reverb", "slowed and reverb", "bass boost", "bass boosted"
    ]);

    for (const blocked of BLOCKED_KEYWORDS) {
      if (allowedProductionTerms.has(blocked)) {
        continue; // Allowed in Islamic Remix & Vibes filter
      }
      if (containsTerm(normalized, blocked)) {
        return { allowed: false, reason: `Blocked in Islamic Remix mode (contains "${blocked}")` };
      }
    }

    return { allowed: true, reason: "Islamic Remix & Vibes verified" };
  }

  return { allowed: true, reason: "Passed" };
}

module.exports = {
  checkBlocked,
  isIslamicText,
  isIslamicTrack,
  isIslamicQuery,
  sanitizeSearchQuery,
  validateByFilterMode,
  ISLAMIC_TERMS,
  BLOCKED_KEYWORDS
};

