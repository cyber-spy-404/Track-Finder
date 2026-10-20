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
  if (resolveSurahInfo(text)) return true;
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

const SURAH_NAMES = {
  1: "Al-Fatihah", 2: "Al-Baqarah", 3: "Ali 'Imran", 4: "An-Nisa", 5: "Al-Ma'idah",
  6: "Al-An'am", 7: "Al-A'raf", 8: "Al-Anfal", 9: "At-Tawbah", 10: "Yunus",
  11: "Hud", 12: "Yusuf", 13: "Ar-Ra'd", 14: "Ibrahim", 15: "Al-Hijr",
  16: "An-Nahl", 17: "Al-Isra", 18: "Al-Kahf", 19: "Maryam", 20: "Ta-Ha",
  21: "Al-Anbiya", 22: "Al-Hajj", 23: "Al-Mu'minun", 24: "An-Nur", 25: "Al-Furqan",
  26: "Ash-Shu'ara", 27: "An-Naml", 28: "Al-Qasas", 29: "Al-'Ankabut", 30: "Ar-Rum",
  31: "Luqman", 32: "As-Sajdah", 33: "Al-Ahzab", 34: "Saba", 35: "Fatir",
  36: "Ya-Sin", 37: "As-Saffat", 38: "Sad", 39: "Az-Zumar", 40: "Ghafir",
  41: "Fussilat", 42: "Ash-Shura", 43: "Az-Zukhruf", 44: "Ad-Dukhan", 45: "Al-Jathiyah",
  46: "Al-Ahqaf", 47: "Muhammad", 48: "Al-Fath", 49: "Al-Hujurat", 50: "Qaf",
  51: "Adh-Dhariyat", 52: "At-Tur", 53: "An-Najm", 54: "Al-Qamar", 55: "Ar-Rahman",
  56: "Al-Waqi'ah", 57: "Al-Hadid", 58: "Al-Mujadila", 59: "Al-Hashr", 60: "Al-Mumtahanah",
  61: "As-Saff", 62: "Al-Jumu'ah", 63: "Al-Munafiqun", 64: "At-Taghabun", 65: "At-Talaq",
  66: "At-Tahrim", 67: "Al-Mulk", 68: "Al-Qalam", 69: "Al-Haqqah", 70: "Al-Ma'arij",
  71: "Nuh", 72: "Al-Jinn", 73: "Al-Muzzammil", 74: "Al-Muddaththir", 75: "Al-Qiyamah",
  76: "Al-Insan", 77: "Al-Mursalat", 78: "An-Naba", 79: "An-Nazi'at", 80: "'Abasa",
  81: "At-Takwir", 82: "Al-Infitar", 83: "Al-Mutaffifin", 84: "Al-Inshiqaq", 85: "Al-Buruj",
  86: "At-Tariq", 87: "Al-A'la", 88: "Al-Ghashiyah", 89: "Al-Fajr", 90: "Al-Balad",
  91: "Ash-Shams", 92: "Al-Layl", 93: "Ad-Duha", 94: "Ash-Sharh", 95: "At-Tin",
  96: "Al-'Alaq", 97: "Al-Qadr", 98: "Al-Bayyinah", 99: "Az-Zalzalah", 100: "Al-'Adiyat",
  101: "Al-Qari'ah", 102: "At-Takathur", 103: "Al-'Asr", 104: "Al-Humazah", 105: "Al-Fil",
  106: "Quraysh", 107: "Al-Ma'un", 108: "Al-Kawthar", 109: "Al-Kafirun", 110: "An-Nasr",
  111: "Al-Masad", 112: "Al-Ikhlas", 113: "Al-Falaq", 114: "An-Nas"
};

const SURAH_ALIASES = {
  1: ["fatihah", "fatiha", "fateha", "the opening", "al fatiha", "al fatihah", "surah fatiha", "surah fatihah"],
  2: ["baqarah", "baqara", "bakara", "al baqarah", "al baqara", "the cow", "surah baqarah", "surah al baqarah"],
  3: ["ali imran", "al imran", "aal e imran", "imran", "family of imran"],
  4: ["an nisa", "nisa", "al nisa", "women"],
  5: ["al maidah", "maidah", "maida", "the table spread"],
  6: ["al anam", "anam", "an am", "cattle"],
  7: ["al araf", "araf", "a'raf", "the heights"],
  8: ["al anfal", "anfal", "the spoils of war"],
  9: ["at tawbah", "tawbah", "tauba", "at taubah", "repentance"],
  10: ["yunus", "jonah"],
  11: ["hud"],
  12: ["yusuf", "joseph"],
  13: ["ar rad", "rad", "ra'd", "the thunder"],
  14: ["ibrahim", "abraham"],
  15: ["al hijr", "hijr", "the rocky tract"],
  16: ["an nahl", "nahl", "the bee"],
  17: ["al isra", "isra", "bani israil", "the night journey"],
  18: ["al kahf", "kahf", "the cave"],
  19: ["maryam", "mary"],
  20: ["ta ha", "taha"],
  21: ["al anbiya", "anbiya", "the prophets"],
  22: ["al hajj", "hajj", "the pilgrimage"],
  23: ["al muminun", "muminun", "mu'minun", "the believers"],
  24: ["an nur", "nur", "noor", "the light"],
  25: ["al furqan", "furqan", "the criterion"],
  26: ["ash shuara", "shuara", "the poets"],
  27: ["an naml", "naml", "the ant"],
  28: ["al qasas", "qasas", "the stories"],
  29: ["al ankabut", "ankabut", "the spider"],
  30: ["ar rum", "rum", "the romans"],
  31: ["luqman"],
  32: ["as sajdah", "sajdah", "sajda", "prostration"],
  33: ["al ahzab", "ahzab", "the combined forces"],
  34: ["saba", "sheba"],
  35: ["fatir", "the originator"],
  36: ["ya sin", "yasin", "yaseen", "ya seen"],
  37: ["as saffat", "saffat", "those who set the ranks"],
  38: ["sad", "saad"],
  39: ["az zumar", "zumar", "the troops"],
  40: ["ghafir", "mumin", "the forgiver"],
  41: ["fussilat", "ha mim sajdah"],
  42: ["ash shura", "shura", "consultation"],
  43: ["az zukhruf", "zukhruf", "the gold ornaments"],
  44: ["ad dukhan", "dukhan", "the smoke"],
  45: ["al jathiyah", "jathiyah", "the crouching"],
  46: ["al ahqaf", "ahqaf", "the wind curved sandhills"],
  47: ["muhammad"],
  48: ["al fath", "fath", "the victory"],
  49: ["al hujurat", "hujurat", "the rooms"],
  50: ["qaf"],
  51: ["adh dhariyat", "dhariyat", "the winnowing winds"],
  52: ["at tur", "tur", "the mount"],
  53: ["an najm", "najm", "the star"],
  54: ["al qamar", "qamar", "the moon"],
  55: ["ar rahman", "rahman", "rehman", "the beneficent", "the most merciful"],
  56: ["al waqiah", "waqiah", "waqia", "the inevitable"],
  57: ["al hadid", "hadid", "the iron"],
  58: ["al mujadila", "mujadila", "mujadilah", "the pleading woman"],
  59: ["al hashr", "hashr", "the exile"],
  60: ["al mumtahanah", "mumtahanah", "the examined one"],
  61: ["as saff", "saff", "the ranks"],
  62: ["al jumuah", "jumuah", "jumah", "friday"],
  63: ["al munafiqun", "munafiqun", "the hypocrites"],
  64: ["at taghabun", "taghabun", "mutual disillusion"],
  65: ["at talaq", "talaq", "divorce"],
  66: ["at tahrim", "tahrim", "the prohibition"],
  67: ["al mulk", "mulk", "tabarak", "the sovereignty", "dominion"],
  68: ["al qalam", "qalam", "nun", "the pen"],
  69: ["al haqqah", "haqqah", "the reality"],
  70: ["al maarij", "maarij", "the ascending stairways"],
  71: ["nuh", "noah"],
  72: ["al jinn", "jinn", "the jinn"],
  73: ["al muzzammil", "muzzammil", "muzammil", "the enshrouded one"],
  74: ["al muddaththir", "muddathir", "mudassir", "the cloaked one"],
  75: ["al qiyamah", "qiyamah", "the resurrection"],
  76: ["al insan", "insan", "dahr", "ad dahr", "man"],
  77: ["al mursalat", "mursalat", "the emissaries"],
  78: ["an naba", "naba", "amma", "the tidings"],
  79: ["an naziat", "naziat", "those who drag forth"],
  80: ["abasa", "'abasa", "he frowned"],
  81: ["at takwir", "takwir", "the overthrowing"],
  82: ["al infitar", "infitar", "the cleaving"],
  83: ["al mutaffifin", "mutaffifin", "the defrauding"],
  84: ["al inshiqaq", "inshiqaq", "the splitting open"],
  85: ["al buruj", "buruj", "burooj", "the constellations"],
  86: ["at tariq", "tariq", "the night comer"],
  87: ["al ala", "ala", "a'la", "the most high"],
  88: ["al ghashiyah", "ghashiyah", "the overwhelming"],
  89: ["al fajr", "fajr", "the dawn"],
  90: ["al balad", "balad", "the city"],
  91: ["ash shams", "shams", "the sun"],
  92: ["al layl", "layl", "lail", "the night"],
  93: ["ad duha", "duha", "the morning hours"],
  94: ["ash sharh", "sharh", "inshirah", "alam nashrah", "the relief"],
  95: ["at tin", "tin", "the fig"],
  96: ["al alaq", "alaq", "iqra", "the clot"],
  97: ["al qadr", "qadr", "the power", "night of decree"],
  98: ["al bayyinah", "bayyinah", "bayyina", "the clear proof"],
  99: ["az zalzalah", "zalzalah", "zilzal", "the earthquake"],
  100: ["al adiyat", "adiyat", "the courser"],
  101: ["al qariah", "qariah", "the calamity"],
  102: ["at takathur", "takathur", "competition in increase"],
  103: ["al asr", "asr", "the declining day", "time"],
  104: ["al humazah", "humazah", "the traducer"],
  105: ["al fil", "fil", "feel", "the elephant"],
  106: ["quraysh", "quraish"],
  107: ["al maun", "maun", "small kindnesses"],
  108: ["al kawthar", "kawthar", "kauthar", "abundance"],
  109: ["al kafirun", "kafirun", "the disbelievers"],
  110: ["an nasr", "nasr", "the divine support"],
  111: ["al masad", "masad", "lahab", "the palm fiber"],
  112: ["al ikhlas", "ikhlas", "sincerity", "monotheism"],
  113: ["al falaq", "falaq", "the daybreak"],
  114: ["an nas", "nas", "mankind"]
};

function isTranslationOrTafsir(text) {
  if (!text || typeof text !== "string") return false;
  return /(?:translation|transl|অনুবাদ|উচ্চারণ|বাংলা|bangla|bengali|tarjuma|tarjama|urdu|hindi|english|tafsir|tafseer|meaning|অর্থ|bayan|dars|waz|lecture|sheikh|mufti)/i.test(text);
}

function resolveSurahInfo(text, allowTranslation = false) {
  if (!text || typeof text !== "string") return null;
  const str = text.trim();
  if (!str) return null;

  // Do not resolve to Arabic Mishary audio if user explicitly requested a translation, tafsir, or lecture
  if (!allowTranslation && isTranslationOrTafsir(str)) {
    return null;
  }

  // 1. Check for explicit number: "surah 1", "surat 02", "036 surah", "surah #114", "surah: 55", or standalone number
  const numMatch = str.match(/(?:surah|surat|soorah)\s*[:#.-]?\s*(\d{1,3})/i) ||
                   str.match(/^(\d{1,3})\s*[:.-]?\s*(?:surah|surat)/i) ||
                   str.match(/^(\d{1,3})$/);
  if (numMatch) {
    const n = parseInt(numMatch[1], 10);
    if (n >= 1 && n <= 114) {
      return { number: n, name: SURAH_NAMES[n] };
    }
  }

  // 2. Check for leading track numbering like "001 Al-Fatihah", "02. Al-Baqarah", "36 - Ya-Sin"
  const leadingNumMatch = str.match(/^0*(\d{1,3})\s*[:.-]\s*(.+)$/);
  if (leadingNumMatch) {
    const n = parseInt(leadingNumMatch[1], 10);
    if (n >= 1 && n <= 114) {
      return { number: n, name: SURAH_NAMES[n] };
    }
  }

  // 3. Normalize string for word/alias lookup
  const clean = str.toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // If text doesn't mention Surah or Quran, only match if it starts with "al " or is a very specific Surah alias
  const hasSurahKeyword = /(?:surah|surat|quran|koran|tilawat|recitation|ayat)/i.test(str);

  // Check aliases
  for (let num = 1; num <= 114; num++) {
    const aliases = SURAH_ALIASES[num] || [];
    const surahNameClean = SURAH_NAMES[num].toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    
    if (clean.includes(surahNameClean)) {
      return { number: num, name: SURAH_NAMES[num] };
    }

    for (const alias of aliases) {
      const aliasClean = alias.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
      const regex = new RegExp(`(^|\\s)${aliasClean}(\\s|$)`, "i");
      if (regex.test(clean)) {
        if (["hud", "sad", "qaf", "nur", "rum", "mary", "man", "time"].includes(aliasClean)) {
          if (!hasSurahKeyword && clean !== aliasClean) continue;
        }
        return { number: num, name: SURAH_NAMES[num] };
      }
    }
  }

  return null;
}

module.exports = {
  checkBlocked,
  isIslamicText,
  isIslamicTrack,
  isIslamicQuery,
  sanitizeSearchQuery,
  validateByFilterMode,
  ISLAMIC_TERMS,
  BLOCKED_KEYWORDS,
  SURAH_NAMES,
  SURAH_ALIASES,
  isTranslationOrTafsir,
  resolveSurahInfo
};

