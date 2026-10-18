/**
 * Spotify React Web Client — Audio & Playlist Engine
 * Inspired by francoborrelli/spotify-react-web-client
 * 
 * Features:
 * 1. Pixel-perfect Spotify Web Client layout, views, components & design system
 * 2. 3 Independent System Channels (Web Browser, Mobile App, Discord Bot, All 3)
 * 3. Default Song Announcement Channel: #music (with live switcher)
 * 4. Trending Indian Spotify Playlists (Bollywood, Punjabi, Arijit, Atif, Sufi, Indie, South)
 * 5. Sacred Quran 114 Surahs Direct Progressive Playback
 * 6. Dual Halal & Filterless Search Integration
 * 7. Persistent 3-column Player Bar + Floating Mobile Player Pill
 */

// Universal HTML Escaper to prevent XSS and runtime ReferenceErrors
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
window.escapeHtml = escapeHtml;

// Standalone Android APK Download URL (Can be set dynamically or updated with direct link)
window.AHM_APK_DOWNLOAD_URL = "";

// Universal Built-in Cloud Server URL
const BUILT_IN_SERVER_URL = "https://track-finder.onrender.com";
window.BUILT_IN_SERVER_URL = BUILT_IN_SERVER_URL;

// Universal API Base URL Resolver for Web Browser & Mobile Capacitor App
function getApiBaseUrl() {
  const custom = (localStorage.getItem("ahm_server_url") || "").trim();
  // Strictly validate that custom is a valid HTTP/HTTPS URL
  if (custom && (custom.startsWith("http://") || custom.startsWith("https://"))) {
    return custom.replace(/\/+$/, "");
  }
  // If invalid text was saved, purge it
  if (custom) {
    localStorage.removeItem("ahm_server_url");
  }

  // If running in browser and already served directly from track-finder.onrender.com, use relative path
  if (typeof window !== "undefined" && window.location?.origin && window.location.origin.includes("track-finder.onrender.com")) {
    return "";
  }

  // Built-in connection to https://track-finder.onrender.com for native Android APK, Capacitor, iOS, PWA, or local shells
  return BUILT_IN_SERVER_URL;
}
window.getApiBaseUrl = getApiBaseUrl;

function resolveApiUrl(path) {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const base = getApiBaseUrl();
  return base ? (base + (path.startsWith("/") ? path : "/" + path)) : path;
}
window.resolveApiUrl = resolveApiUrl;

// ==========================================================================
// CLIENT PLATFORM IDENTIFIER & ENVIRONMENT DETECTION
// ==========================================================================
const isMobileAppEnvironment = Boolean(
  (typeof window !== "undefined" && window.AndroidAudioBridge) ||
  (typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.()) ||
  (typeof window !== "undefined" && window.location?.protocol === "file:") ||
  ((typeof window !== "undefined" && window.location?.origin && (window.location.origin.includes("capacitor") || window.location.origin.includes("localhost:"))) &&
  (typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)))
);
window.isMobileAppEnvironment = isMobileAppEnvironment;

// Dedicated active channel: "app" for mobile app, "browser" for web browser
let activeSystemChannel = isMobileAppEnvironment ? "app" : "browser";
window.activeSystemChannel = activeSystemChannel;

function isLocalChannel(channel) {
  const c = channel || activeSystemChannel;
  return c === "browser" || c === "app" || c === "all";
}
window.isLocalChannel = isLocalChannel;

function isDirectPlayableAudioUrl(url) {
  if (!url || typeof url !== "string") return false;
  const u = url.trim();
  if (u.includes("youtube.com/watch") || u.includes("youtu.be/") || u.includes("open.spotify.com/")) {
    return false;
  }
  if (u.includes("/api/stream-audio")) {
    try {
      const parsed = new URL(u, (typeof window !== "undefined" && window.location?.origin) || "http://localhost");
      const target = parsed.searchParams.get("url");
      return Boolean(target && isDirectPlayableAudioUrl(target));
    } catch (_) {
      return false;
    }
  }
  return u.startsWith("http://") || u.startsWith("https://") || u.startsWith("blob:");
}
window.isDirectPlayableAudioUrl = isDirectPlayableAudioUrl;

// Transparently wrap window.fetch so all relative API requests hit the server cleanly without CORS preflight failures
const _nativeFetch = window.fetch;
window.fetch = function(input, init) {
  init = init || {};
  const platform = isMobileAppEnvironment ? "mobile-app" : "web-app";
  const channel = activeSystemChannel || (isMobileAppEnvironment ? "app" : "browser");

  if (typeof input === "string") {
    if (input.startsWith("/api/") || input.startsWith("api/")) {
      const resolved = resolveApiUrl(input);
      const sep = resolved.includes("?") ? "&" : "?";
      input = `${resolved}${sep}platform=${encodeURIComponent(platform)}&channel=${encodeURIComponent(channel)}`;
    }
  } else if (input instanceof Request && input.url) {
    if (input.url.startsWith("/api/") || input.url.startsWith("api/")) {
      const resolved = resolveApiUrl(input.url);
      const sep = resolved.includes("?") ? "&" : "?";
      input = new Request(`${resolved}${sep}platform=${encodeURIComponent(platform)}&channel=${encodeURIComponent(channel)}`, input);
    }
  }
  return _nativeFetch.call(this, input, init);
};

// 114 Surah Catalog
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

// ==========================================================================
// TRENDING INDIAN SPOTIFY PLAYLISTS DATA
// ==========================================================================
const DEFAULT_MUSIC_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.85"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>';

const SPOTIFY_INDIAN_PLAYLISTS = [
  {
    id: "top50-india",
    genre: "charts",
    badge: "Official Chart",
    name: "Top 50 - India",
    desc: "Your daily update of the most played tracks in India right now on Spotify Charts.",
    coverUrl: "covers/top50_india.jpg",
    gradient: "linear-gradient(145deg, #1C2028 0%, #101217 100%)",
    tracksCount: 10,
    tags: ["Daily Hits", "Trending #1", "All India"],
    tracks: [
      { title: "Tauba Tauba", artist: "Karan Aujla & Badshah", duration: "03:26" },
      { title: "Aaj Ki Raat", artist: "Sachin-Jigar, Madhubanti & Divya", duration: "03:48" },
      { title: "Chuttamalle", artist: "Anirudh Ravichander & Shilpa Rao", duration: "03:45" },
      { title: "Sajni", artist: "Arijit Singh & Ram Sampath", duration: "02:50" },
      { title: "Illuminati", artist: "Sushin Shyam & Dabzee", duration: "03:12" },
      { title: "Ve Kamleya", artist: "Arijit Singh & Shreya Ghoshal", duration: "04:06" },
      { title: "Husn", artist: "Anuv Jain", duration: "03:38" },
      { title: "O Sajni Re", artist: "Arijit Singh", duration: "03:25" },
      { title: "Tujhe Kitna Chahne Lage", artist: "Arijit Singh & Mithoon", duration: "04:44" },
      { title: "Apna Bana Le", artist: "Arijit Singh & Sachin-Jigar", duration: "04:21" }
    ]
  },
  {
    id: "bollywood-butter",
    genre: "bollywood",
    badge: "Bollywood #1",
    name: "Bollywood Butter",
    desc: "The ultimate Bollywood playlist packed with signature blockbusters and love anthems.",
    coverUrl: "covers/bollywood_butter.jpg",
    gradient: "linear-gradient(145deg, #222630 0%, #121419 100%)",
    tracksCount: 8,
    tags: ["Bollywood", "Love Anthems", "Romance"],
    tracks: [
      { title: "Kesariya", artist: "Arijit Singh & Pritam (Brahmastra)", duration: "04:28" },
      { title: "Tum Hi Ho", artist: "Arijit Singh & Mithoon (Aashiqui 2)", duration: "04:22" },
      { title: "Tere Vaaste", artist: "Varun Jain & Sachin-Jigar", duration: "03:09" },
      { title: "Dil Diyan Gallan", artist: "Atif Aslam & Vishal-Shekhar", duration: "04:20" },
      { title: "Raataan Lambiyan", artist: "Jubin Nautiyal & Asees Kaur", duration: "03:50" },
      { title: "Ghungroo", artist: "Arijit Singh & Shilpa Rao (War)", duration: "05:02" },
      { title: "Pee Loon", artist: "Mohit Chauhan (OUATIM)", duration: "04:47" },
      { title: "Shayad", artist: "Arijit Singh & Pritam", duration: "04:07" }
    ]
  },
  {
    id: "hot-hits-hindi",
    genre: "hothits",
    badge: "Trending Hot",
    name: "Hot Hits Hindi",
    desc: "Catch the hottest Hindi tracks setting the country on fire this week.",
    coverUrl: "covers/hot_hits_hindi.jpg",
    gradient: "linear-gradient(145deg, #1E222B 0%, #111317 100%)",
    tracksCount: 7,
    tags: ["New Releases", "Fresh Viral", "Hindi Pop"],
    tracks: [
      { title: "Naina", artist: "Crew - Diljit Dosanjh & Badshah", duration: "03:00" },
      { title: "Pehle Bhi Main", artist: "Vishal Mishra & Harshavardhan (Animal)", duration: "04:10" },
      { title: "Satranga", artist: "Arijit Singh & Shreyas Puranik", duration: "04:31" },
      { title: "Chaleya", artist: "Arijit Singh & Shilpa Rao (Jawan)", duration: "03:20" },
      { title: "Heeriye", artist: "Jasleen Royal & Arijit Singh", duration: "03:15" },
      { title: "Maan Meri Jaan", artist: "King", duration: "03:14" },
      { title: "Zihaal e Miskin", artist: "Vishal Mishra & Shreya Ghoshal", duration: "04:05" }
    ]
  },
  {
    id: "punjabi-101",
    genre: "punjabi",
    badge: "Punjabi Bangers",
    name: "Punjabi 101",
    desc: "The premier Punjabi anthem hub: Karan Aujla, Diljit Dosanjh, AP Dhillon & Shubh.",
    coverUrl: "covers/punjabi_101.jpg",
    gradient: "linear-gradient(145deg, #232732 0%, #13151B 100%)",
    tracksCount: 8,
    tags: ["Punjabi Hip-Hop", "Bhangra", "Urban Desi"],
    tracks: [
      { title: "Softly", artist: "Karan Aujla & Ikky", duration: "02:35" },
      { title: "Winning Speech", artist: "Karan Aujla & Mxrci", duration: "03:42" },
      { title: "GOAT", artist: "Diljit Dosanjh", duration: "03:43" },
      { title: "Lover", artist: "Diljit Dosanjh & Intense", duration: "03:05" },
      { title: "Cheques", artist: "Shubh", duration: "03:03" },
      { title: "Elevated", artist: "Shubh", duration: "03:20" },
      { title: "Brown Munde", artist: "AP Dhillon, Gurinder Gill & Shinda Kahlon", duration: "04:27" },
      { title: "295", artist: "Sidhu Moose Wala", duration: "04:30" }
    ]
  },
  {
    id: "arijit-singh-essentials",
    genre: "arijit",
    badge: "King of Melodies",
    name: "Arijit Singh: King of Romance",
    desc: "The definitive collection of soul-stirring masterpieces by India's voice of emotion.",
    coverUrl: "covers/arijit_singh.jpg",
    gradient: "linear-gradient(145deg, #1F232D 0%, #111318 100%)",
    tracksCount: 8,
    tags: ["Arijit Singh", "Heartfelt", "Pure Vocal"],
    tracks: [
      { title: "Channa Mereya", artist: "Arijit Singh (Ae Dil Hai Mushkil)", duration: "04:49" },
      { title: "Tum Hi Ho", artist: "Arijit Singh", duration: "04:22" },
      { title: "Agar Tum Saath Ho", artist: "Arijit Singh & Alka Yagnik", duration: "05:41" },
      { title: "Ilahi", artist: "Arijit Singh (YJHD)", duration: "03:49" },
      { title: "Hawayein", artist: "Arijit Singh & Pritam", duration: "04:50" },
      { title: "Kalank Title Track", artist: "Arijit Singh", duration: "05:11" },
      { title: "Kabira", artist: "Arijit Singh & Harshdeep Kaur", duration: "04:11" },
      { title: "Mast Magan", artist: "Arijit Singh & Chinmayi", duration: "04:40" }
    ]
  },
  {
    id: "atif-aslam-essentials",
    genre: "atif",
    badge: "Soul Anthems",
    name: "Atif Aslam: Soul Anthems",
    desc: "Unforgettable vocal classics, romantic ballads and spiritual tributes from Atif Aslam.",
    coverUrl: "covers/atif_aslam.jpg",
    gradient: "linear-gradient(145deg, #212530 0%, #12141A 100%)",
    tracksCount: 7,
    tags: ["Atif Aslam", "Sufi-Pop", "Evergreen"],
    tracks: [
      { title: "Tajdar-e-Haram", artist: "Atif Aslam (Coke Studio)", duration: "10:28" },
      { title: "Woh Lamhe", artist: "Atif Aslam (Zeher)", duration: "05:20" },
      { title: "Tera Hone Laga Hoon", artist: "Atif Aslam & Alisha Chinai", duration: "04:59" },
      { title: "Jeena Jeena", artist: "Atif Aslam (Badlapur)", duration: "03:49" },
      { title: "Pehli Nazar Mein", artist: "Atif Aslam (Race)", duration: "05:14" },
      { title: "Tu Jaane Na", artist: "Atif Aslam", duration: "05:41" },
      { title: "Aadat", artist: "Atif Aslam (Jal)", duration: "04:28" }
    ]
  },
  {
    id: "sufi-qawwali-mystics",
    genre: "sufi",
    badge: "Spiritual Ecstasy",
    name: "Sufi & Qawwali Mystics",
    desc: "Divine spiritual trance, sacred verses and timeless qawwalis.",
    coverUrl: "covers/sufi_mystics.jpg",
    gradient: "linear-gradient(145deg, #1D212A 0%, #101216 100%)",
    tracksCount: 7,
    tags: ["Sufi", "Qawwali", "Spiritual"],
    tracks: [
      { title: "Dam Mast Qalandar", artist: "Nusrat Fateh Ali Khan", duration: "08:15" },
      { title: "Afreen Afreen", artist: "Rahat Fateh Ali Khan & Momina Mustehsan", duration: "06:45" },
      { title: "Kun Faya Kun", artist: "A.R. Rahman, Javed Ali & Mohit Chauhan", duration: "07:53" },
      { title: "Khwaja Mere Khwaja", artist: "A.R. Rahman (Jodhaa Akbar)", duration: "06:56" },
      { title: "Chap Tilak Sab Cheen Li", artist: "Rahat Fateh Ali Khan", duration: "06:12" },
      { title: "Bhar Do Jholi Meri", artist: "Adnan Sami (Bajrangi Bhaijaan)", duration: "08:19" },
      { title: "Mast Nazron Se Allah Bachaye", artist: "Nusrat Fateh Ali Khan", duration: "07:22" }
    ]
  },
  {
    id: "indie-india-chill",
    genre: "indie",
    badge: "Desi Acoustic",
    name: "Indie India Chill",
    desc: "Warm acoustic melodies, poetic lyrics, and relaxing desi indie tunes.",
    coverUrl: "https://i.scdn.co/image/ab67706f00000002656f14776fbb39aa2ae900f0",
    gradient: "linear-gradient(145deg, #20242E 0%, #111317 100%)",
    tracksCount: 6,
    tags: ["Indian Indie", "Acoustic", "Chillout"],
    tracks: [
      { title: "Baarishein", artist: "Anuv Jain", duration: "03:27" },
      { title: "Alag Aasmaan", artist: "Anuv Jain", duration: "03:52" },
      { title: "Cold/Mess", artist: "Prateek Kuhad", duration: "04:45" },
      { title: "Kasoor", artist: "Prateek Kuhad", duration: "03:16" },
      { title: "Khoj (Passing By)", artist: "When Chai Met Toast", duration: "03:40" },
      { title: "Iraaday", artist: "Ruvii & Abdul Hannan", duration: "03:18" }
    ]
  },
  {
    id: "tollywood-bangers",
    genre: "south",
    badge: "Telugu Mass Beats",
    name: "Tollywood Bangers (Telugu)",
    desc: "High-octane mass beats and viral Telugu chartbusters.",
    coverUrl: "covers/tollywood_bangers.jpg",
    gradient: "linear-gradient(145deg, #222631 0%, #12141A 100%)",
    tracksCount: 5,
    tags: ["Telugu", "Tollywood", "Mass Beats"],
    tracks: [
      { title: "Kurchi Madathapetti", artist: "Thaman S & Mahesh Babu", duration: "03:36" },
      { title: "Oo Antava Mava", artist: "Devi Sri Prasad & Indravathi (Pushpa)", duration: "03:48" },
      { title: "Naatu Naatu", artist: "M.M. Keeravaani & Rahul Sipligunj (RRR)", duration: "03:36" },
      { title: "Samajavaragamana", artist: "Sid Sriram & Thaman S", duration: "04:34" },
      { title: "Butta Bomma", artist: "Armaan Malik & Thaman S", duration: "03:18" }
    ]
  },
  {
    id: "kollywood-chartbusters",
    genre: "south",
    badge: "Tamil Hits",
    name: "Kollywood Chartbusters (Tamil)",
    desc: "Anirudh Ravichander and A.R. Rahman trending Tamil master tracks.",
    coverUrl: "covers/kollywood.jpg",
    gradient: "linear-gradient(145deg, #1E222C 0%, #101217 100%)",
    tracksCount: 5,
    tags: ["Tamil", "Kollywood", "Anirudh Hits"],
    tracks: [
      { title: "Hukum - Thalaivar Alappara", artist: "Anirudh Ravichander (Jailer)", duration: "03:27" },
      { title: "Naa Ready", artist: "Anirudh Ravichander & Thalapathy Vijay (Leo)", duration: "04:08" },
      { title: "Arabic Kuthu", artist: "Anirudh Ravichander & Jonita Gandhi", duration: "04:39" },
      { title: "Vaathi Coming", artist: "Anirudh Ravichander (Master)", duration: "03:50" },
      { title: "Enjoy Enjaami", artist: "Dhee & Arivu", duration: "04:47" }
    ]
  }
];

// Islamic Status & Spoken Kalam Items
const ISLAMIC_VIBES_ITEMS = [
  { title: "Hasbi Rabbi Jallallah", artist: "Sami Yusuf", badge: "Vocal Remake", query: "hasbi rabbi jallallah sami yusuf" },
  { title: "Maula Ya Salli Wa Sallim", artist: "Al-Afasy", badge: "Pure Nasheed", query: "maula ya salli wa sallim alafasy" },
  { title: "Qamarun Sidnan Nabi", artist: "Mustafa Atef", badge: "Islamic Kalam", query: "qamarun sidnan nabi mustafa atef" },
  { title: "Heart-Touching Waz Reminders", artist: "Mizanur Rahman Azhari", badge: "Islamic Speech", query: "emotional islamic bayan heart touching" }
];

// Global State
let currentState = null;
let currentActivePlaylist = null;
let currentFilterMode = "filterless"; // "filterless" | "strict" | "remix"
let isScrubbing = false;
let isVolumeDragging = false;
let currentTab = "queue";
let deferredInstallPrompt = null;

// Custom / Imported Spotify Playlists Store
let customPlaylists = [];
try {
  customPlaylists = JSON.parse(localStorage.getItem("imported_spotify_playlists") || "[]");
} catch(e) {}

function isSpotifyUrl(url) {
  if (!url || typeof url !== "string") return false;
  return /open\.spotify\.com\/(playlist|album|track|artist)\/([a-zA-Z0-9]+)/i.test(url) ||
         /spotify:(playlist|album|track|artist):([a-zA-Z0-9]+)/i.test(url);
}


// Environment Detection alias
if (typeof window !== "undefined") {
  window.isMobileApp = isMobileAppEnvironment;
}

// ==========================================================================
// BULLETPROOF DIRECT NATIVE BROWSER AUDIO ENGINE
// ==========================================================================
const BrowserPlayer = {
  audio: null,
  currentTrack: null,
  queue: [],
  history: [],
  repeatMode: "off", // "off" | "track" | "queue"
  volume: 1.0,
  isShuffle: false,
  isInitialized: false,
  lastReportTime: 0,
  savedPosition: 0,
  // Spotify Infinite Radio & Autoplay State (Disabled by default to prevent unwanted station takeovers)
  autoplayRadioEnabled: localStorage.getItem("ahm_autoplay_radio") === "true",
  isRadioActive: false,
  activeRadioSeed: null,
  isFetchingRadio: false,
  isBuffering: false,
  _userExplicitlyPaused: false,

  setBuffering(buffering) {
    buffering = Boolean(buffering);
    if (this.isBuffering === buffering) return;
    this.isBuffering = buffering;
    console.log(`[Audio Engine] Buffering state changed: ${buffering}`);

    updatePlayPauseIcons(!this.audio?.paused);

    // Sync with Native Android Bridge for notification bar progress bar & MediaSessionCompat
    if (window.AndroidAudioBridge && typeof window.AndroidAudioBridge.setBuffering === "function") {
      try {
        window.AndroidAudioBridge.setBuffering(buffering);
      } catch (e) {
        console.warn("[AndroidAudioBridge] setBuffering sync error:", e);
      }
    }

    this.updateMediaSession(this.currentTrack, !this.audio?.paused, buffering);
  },

  init() {
    if (this.isInitialized) return;
    this.audio = document.getElementById("browserAudio");
    if (!this.audio) {
      this.audio = new Audio();
      this.audio.id = "browserAudio";
      document.body.appendChild(this.audio);
    }
    this.audio.preload = "auto";
    if (typeof EqualizerEngine !== "undefined" && EqualizerEngine.isEnabled) {
      try { this.audio.crossOrigin = "anonymous"; } catch (_) {}
    } else {
      try { this.audio.removeAttribute("crossorigin"); } catch (_) {}
    }
    this.audio.muted = false;
    this.audio.removeAttribute("muted");
    const initVol = typeof this.volume === "number" && this.volume > 0 ? Math.min(this.volume, 1.0) : 1.0;
    this.audio.volume = initVol;
    this.volume = initVol;

    // Native audio event listeners
    this.audio.addEventListener("timeupdate", () => this.onTimeUpdate());
    this.audio.addEventListener("loadedmetadata", () => this.onLoadedMetadata());
    this.audio.addEventListener("play", () => this.onPlay());
    this.audio.addEventListener("pause", () => this.onPause());
    this.audio.addEventListener("ended", () => this.onEnded());
    this.audio.addEventListener("error", (e) => this.onError(e));

    // Audio buffering and network delay event listeners
    this.audio.addEventListener("waiting", () => {
      console.log("[Audio Engine] Audio waiting / network delay detected");
      this.setBuffering(true);
    });
    this.audio.addEventListener("stalled", () => {
      console.log("[Audio Engine] Audio stalled due to network delay");
      this.setBuffering(true);
    });
    this.audio.addEventListener("loadstart", () => {
      if (this.currentTrack && !this._userExplicitlyPaused) {
        this.setBuffering(true);
      }
    });
    this.audio.addEventListener("canplay", () => {
      this.setBuffering(false);
    });
    this.audio.addEventListener("playing", () => {
      this.setBuffering(false);
    });

    // Media Session Support (System Notification Bar, Lockscreen & Hardware media keys)
    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.setActionHandler("play", () => this.play());
        navigator.mediaSession.setActionHandler("pause", () => this.pause());
        navigator.mediaSession.setActionHandler("previoustrack", () => this.prev());
        navigator.mediaSession.setActionHandler("nexttrack", () => this.next());
        navigator.mediaSession.setActionHandler("seekbackward", (details) => {
          const skip = details.seekOffset || 10;
          this.seek(Math.max((this.audio?.currentTime || 0) - skip, 0));
        });
        navigator.mediaSession.setActionHandler("seekforward", (details) => {
          const skip = details.seekOffset || 10;
          this.seek((this.audio?.currentTime || 0) + skip);
        });
        navigator.mediaSession.setActionHandler("seekto", (details) => {
          if (details.seekTime !== undefined) {
            this.seek(details.seekTime);
          }
        });
        navigator.mediaSession.setActionHandler("stop", () => this.stop());
      } catch (e) {}
    }

    this.isInitialized = true;
  },

  prime() {
    this.init();
    // Warm up Web Audio context if available without altering HTML5 audio element
    try {
      if (typeof EqualizerEngine !== "undefined" && EqualizerEngine.audioCtx && EqualizerEngine.audioCtx.state === "suspended") {
        EqualizerEngine.audioCtx.resume().catch(() => {});
      }
    } catch (e) {}
  },

  updateMediaSession(track, isPlayingOverride, isBufferingOverride) {
    track = track || this.currentTrack;
    if (!track) return;
    const title = track.title || track.info?.title || "Spy Sec Music";
    const artist = track.author || track.artist || track.info?.author || "CyberSpy 404";
    const album = track.album || "Lossless Sovereign Audio";
    let art = track.artworkUrl || track.info?.artworkUrl || "logo.png";
    if (art.startsWith("/")) art = art.substring(1);
    const fullArtUrl = (art.startsWith("http://") || art.startsWith("https://")) ? art : new URL(art, window.location.href).href;

    const cur = this.audio?.currentTime || 0;
    let dur = this.audio?.duration;
    if (!dur || !Number.isFinite(dur) || dur <= 0) {
      dur = (track.duration && track.duration > 0) ? (track.duration > 1000 ? track.duration / 1000 : track.duration) : 0;
    }
    const isPlaying = typeof isPlayingOverride === "boolean"
      ? isPlayingOverride
      : Boolean(this.audio && !this.audio.paused);
    const isBuffering = typeof isBufferingOverride === "boolean"
      ? isBufferingOverride
      : Boolean(this.isBuffering);

    // 1. Standard W3C navigator.mediaSession (for Chrome, Edge, WebView)
    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: title,
          artist: artist,
          album: album,
          artwork: [
            { src: fullArtUrl, sizes: "96x96", type: "image/png" },
            { src: fullArtUrl, sizes: "128x128", type: "image/png" },
            { src: fullArtUrl, sizes: "192x192", type: "image/png" },
            { src: fullArtUrl, sizes: "256x256", type: "image/png" },
            { src: fullArtUrl, sizes: "384x384", type: "image/png" },
            { src: fullArtUrl, sizes: "512x512", type: "image/png" }
          ]
        });
        navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";

        if (dur > 0 && Number.isFinite(dur)) {
          navigator.mediaSession.setPositionState({
            duration: dur,
            playbackRate: (isPlaying && !isBuffering) ? (this.audio?.playbackRate || 1.0) : 0,
            position: Math.min(Math.max(cur, 0), dur)
          });
        }
      } catch (err) {
        console.warn("[MediaSession] Metadata error:", err);
      }
    }

    // 2. Native Android Media Bridge (MediaSessionCompat & MediaStyle Notification on Android 10+)
    if (window.AndroidAudioBridge && typeof window.AndroidAudioBridge.updateMediaState === "function") {
      try {
        window.AndroidAudioBridge.updateMediaState(title, artist, album, fullArtUrl, dur || 0, cur, isPlaying, isBuffering);
      } catch (err) {
        console.warn("[AndroidAudioBridge] Sync error:", err);
      }
    }
  },

  async playTrack(track) {
    if (!track) return;
    this.init();
    this._userExplicitlyPaused = false;
    this.setBuffering(true);
    window._vivoCapsuleDismissed = false; // Reset Vivo OriginOS capsule notification visibility on new track

    // Spotify Infinite Radio state synchronization:
    if (track.isRadio || (this.isRadioActive && (this.queue.some(t => t.isRadio) || this.activeRadioSeed))) {
      this.isRadioActive = true;
      if (!this.activeRadioSeed) this.activeRadioSeed = track;
    } else {
      this.isRadioActive = false;
      this.activeRadioSeed = null;
    }
    if (typeof updateRadioUI === "function") updateRadioUI();

    const hasPlayableStream = Boolean(
      (track.streamUrl && isDirectPlayableAudioUrl(track.streamUrl)) ||
      (track.proxyStreamUrl && isDirectPlayableAudioUrl(track.proxyStreamUrl)) ||
      (track.rawStreamUrl && isDirectPlayableAudioUrl(track.rawStreamUrl))
    );

    // Dynamically resolve audio stream if track was enqueued without a verified playable direct URL
    if (!hasPlayableStream) {
      showToast(`Resolving audio: ${track.title}...`);
      try {
        const query = (track.query || track.url || `${track.title} ${track.author || track.artist || ""}`).trim();
        const resolveUrl = resolveApiUrl(`/api/resolve-track?q=${encodeURIComponent(query)}&filterMode=${encodeURIComponent(track.filterMode || currentFilterMode)}&channel=${encodeURIComponent(activeSystemChannel)}&set=true`);
        const res = await fetch(resolveUrl);
        const data = await res.json();
        if (data.dropped) {
          this.setBuffering(false);
          return;
        }
        if (data.success && data.track) {
          track = {
            ...track,
            ...data.track,
            title: track.title && track.title !== "YouTube Audio" ? track.title : data.track.title,
            author: track.author && track.author !== "Trending Music" ? track.author : (data.track.author || "YouTube Music"),
            duration: track.duration && track.duration > 0 ? track.duration : data.track.duration,
            artworkUrl: track.artworkUrl && track.artworkUrl !== "logo.png" ? track.artworkUrl : (data.track.artworkUrl || "logo.png")
          };
        }
      } catch (err) {
        console.error("Auto stream resolve error:", err);
      }

      // Secondary client-side fallback if server resolution yielded no playable stream
      if (!track.streamUrl || !isDirectPlayableAudioUrl(track.streamUrl)) {
        try {
          const cleanTitle = (track.title || "").replace(/\(.*?\)|\[.*?\]/g, "").trim();
          const cleanArtist = (track.author || track.artist || "").split(/[,&x/]|feat\.|ft\./i)[0].trim();
          const fallbackQuery = cleanArtist ? `${cleanTitle} ${cleanArtist}` : cleanTitle;
          const searchRes = await fetch(resolveApiUrl(`/api/search?q=${encodeURIComponent(fallbackQuery)}&type=tracks&filterMode=${encodeURIComponent(track.filterMode || currentFilterMode)}`));
          const searchData = await searchRes.json();
          const match = (searchData.results || []).find(r => r && isDirectPlayableAudioUrl(r.streamUrl));
          if (match) {
            track.streamUrl = match.streamUrl;
            track.proxyStreamUrl = match.proxyStreamUrl || `/api/stream-audio?channel=${encodeURIComponent(activeSystemChannel)}&url=${encodeURIComponent(match.streamUrl)}`;
            if (!track.duration && match.duration) track.duration = match.duration;
            if ((!track.artworkUrl || track.artworkUrl === "logo.png") && match.artworkUrl) track.artworkUrl = match.artworkUrl;
          }
        } catch (e) {
          console.warn("Client fallback resolve error:", e);
        }
      }
    }

    this.currentTrack = track;

    // High-Fidelity Audio Stream Pipeline:
    // Direct CDN streams (Saavn CDN / Quranic Audio) are loaded directly with zero proxy overhead for blazing fast playback.
    // If direct CDN is unavailable or proxyStreamUrl is direct, fall back to same-origin /api/stream-audio.
    let src = null;
    if (track.streamUrl && isDirectPlayableAudioUrl(track.streamUrl)) {
      src = track.streamUrl;
    } else if (track.proxyStreamUrl && isDirectPlayableAudioUrl(track.proxyStreamUrl)) {
      src = resolveApiUrl(track.proxyStreamUrl);
    } else if (track.rawStreamUrl && isDirectPlayableAudioUrl(track.rawStreamUrl)) {
      src = track.rawStreamUrl;
    } else if (track.streamUrl) {
      src = resolveApiUrl(`/api/stream-audio?channel=${encodeURIComponent(activeSystemChannel)}&url=${encodeURIComponent(track.streamUrl)}`);
    }

    if (!src) {
      this.setBuffering(false);
      showToast(`Could not play "${track.title}" - audio stream unavailable`);
      if (this.queue.length > 0) {
        return this.next();
      }
      return;
    }

    // High-Fidelity Audio Stream Pipeline:
    // Only apply crossOrigin="anonymous" when Equalizer is actively enabled.
    // In Android WebView and mobile browsers, setting crossOrigin on direct CDN audio (e.g. JioSaavn / Quranic)
    // causes CORS origin check failures on file:// or cross-origin requests, resulting in complete silence!
    if (typeof EqualizerEngine !== "undefined" && EqualizerEngine.isEnabled) {
      try { this.audio.crossOrigin = "anonymous"; } catch (_) {}
    } else {
      try { this.audio.removeAttribute("crossorigin"); } catch (_) {}
    }
    this._isChangingTrack = true;
    this._playRequestId = (this._playRequestId || 0) + 1;
    const currentReqId = this._playRequestId;

    this.audio.src = src;
    this.audio.currentTime = 0;
    this.audio.muted = false;
    this.audio.removeAttribute("muted");
    const safeVol = typeof this.volume === "number" && this.volume > 0 ? Math.min(this.volume, 1.0) : 1.0;
    this.audio.volume = safeVol;
    this.volume = safeVol;

    const playPromise = this.audio.play();
    if (playPromise !== undefined) {
      playPromise.then(() => {
        if (this._playRequestId !== currentReqId) return;
        this._isChangingTrack = false;
        this.setBuffering(false);
        if (typeof EqualizerEngine !== "undefined" && EqualizerEngine.isEnabled) {
          EqualizerEngine.resume();
        }
        this.updateMediaSession(track);
        this.reportState();
        showToast(`▶ Playing: ${track.title}`);
      }).catch(err => {
        if (this._playRequestId !== currentReqId) return;
        this._isChangingTrack = false;
        this.setBuffering(false);
        if (err.name === "AbortError") {
          return; // Aborted by subsequent track skip
        }
        console.warn("Direct browser audio play note:", err.message);
        showToast(`Tap anywhere to start audio: ${track.title}`);
        const resumeOnTap = () => {
          if (typeof EqualizerEngine !== "undefined") EqualizerEngine.resume();
          this.audio.muted = false;
          this.audio.removeAttribute("muted");
          this.setBuffering(true);
          this.audio.play().then(() => {
            this.setBuffering(false);
            showToast(`▶ Playing: ${track.title}`);
          }).catch(() => {
            this.setBuffering(false);
          });
          window.removeEventListener("pointerdown", resumeOnTap);
          window.removeEventListener("click", resumeOnTap);
        };
        window.addEventListener("pointerdown", resumeOnTap, { once: true });
        window.addEventListener("click", resumeOnTap, { once: true });
      });
    }

    sendAction("set_track", null, { targetChannel: activeSystemChannel || (isMobileAppEnvironment ? "app" : "browser"), track }).catch(() => {});
    updateUIWithTrack(track, true);
    if (typeof updateAllQueueBadges === "function") updateAllQueueBadges();
    if (typeof updateHeartButtonStatus === "function") updateHeartButtonStatus();
    if (typeof savePlaybackState === "function") savePlaybackState();
    if (typeof recordTrackTaste === "function") recordTrackTaste(track, "play");

    // Spotify Features: Synced Lyrics, 6-Band Equalizer (only when explicitly enabled), and Reactive Visualizer
    if (typeof LyricsManager !== "undefined") LyricsManager.loadLyricsForTrack(track);
    if (typeof EqualizerEngine !== "undefined" && EqualizerEngine.isEnabled) {
      EqualizerEngine.init(this.audio);
      EqualizerEngine.resume();
    }
    if (typeof ReactiveVisualizerEngine !== "undefined") ReactiveVisualizerEngine.start();

    // Seamlessly pre-resolve next track so queue transitions have zero latency
    this.prefetchNextTrack();
  },

  prefetchNextTrack() {
    if (!this.queue || this.queue.length === 0) return;
    const nextItem = this.queue[0];
    const hasStream = Boolean(
      (nextItem.streamUrl && isDirectPlayableAudioUrl(nextItem.streamUrl)) ||
      (nextItem.proxyStreamUrl && isDirectPlayableAudioUrl(nextItem.proxyStreamUrl))
    );
    if (nextItem && !hasStream) {
      const query = (nextItem.query || nextItem.url || `${nextItem.title} ${nextItem.author || nextItem.artist || ""}`).trim();
      fetch(resolveApiUrl(`/api/resolve-track?q=${encodeURIComponent(query)}&filterMode=${encodeURIComponent(nextItem.filterMode || currentFilterMode)}&channel=${encodeURIComponent(activeSystemChannel)}&set=false`))
        .then(r => r.json())
        .then(d => {
          if (d.success && d.track && (d.track.streamUrl || d.track.proxyStreamUrl)) {
            Object.assign(nextItem, d.track);
          }
        })
        .catch(() => {});
    }
  },

  playNow(item, filterMode = "filterless") {
    this.prime();
    if (typeof item === "string") {
      return this.playQuery(item, filterMode, true);
    }
    if (item && typeof item === "object") {
      if (!item.isRadio) {
        this.isRadioActive = false;
        this.activeRadioSeed = null;
        if (Array.isArray(this.queue)) {
          this.queue = this.queue.filter(t => !t.isRadio);
        }
      }
      if (this.currentTrack) this.history.push(this.currentTrack);
      this.playTrack(item);
      if (typeof saveUserQueue === "function") saveUserQueue();
    }
  },

  enqueue(item, filterMode = "filterless") {
    this.prime();
    if (typeof item === "string") {
      return this.playQuery(item, filterMode, false);
    }
    if (item && typeof item === "object") {
      const isCurrentlySilent = !this.isPlaying() && (!this.audio?.src || this.audio.ended || !this.currentTrack);
      if (isCurrentlySilent) {
        this.playTrack(item);
      } else {
        this.queue.push(item);
        showToast(`Queued in Browser: ${item.title}`);
        renderQueueView();
        renderSidebarLibrary("queue");
        if (typeof saveUserQueue === "function") saveUserQueue();
      }
    }
  },

  async playQuery(query, filterMode = "filterless", immediate = true) {
    this.prime();
    if (isSpotifyUrl(query)) {
      return importAndPlaySpotifyLink(query, activeSystemChannel);
    }
    showToast(`Loading: ${query}...`);
    const isCurrentlySilent = !this.isPlaying() && (!this.audio?.src || this.audio.ended || !this.currentTrack);
    if (immediate || isCurrentlySilent) {
      this._userExplicitlyPaused = false;
      this.setBuffering(true);
    }

    try {
      const shouldSet = immediate ? "true" : "false";
      const res = await fetch(resolveApiUrl(`/api/resolve-track?q=${encodeURIComponent(query)}&filterMode=${encodeURIComponent(filterMode)}&channel=${encodeURIComponent(activeSystemChannel)}&set=${shouldSet}`));
      const data = await res.json();
      if (data.dropped) {
        if (immediate || isCurrentlySilent) this.setBuffering(false);
        return;
      }
      if (data.success && data.track) {
        if (immediate || isCurrentlySilent) {
          if (!data.track.isRadio) {
            this.isRadioActive = false;
            this.activeRadioSeed = null;
            if (Array.isArray(this.queue)) {
              this.queue = this.queue.filter(t => !t.isRadio);
            }
          }
          if (this.currentTrack) this.history.push(this.currentTrack);
          await this.playTrack(data.track);
        } else {
          this.setBuffering(false);
          this.queue.push(data.track);
          showToast(`Queued in Browser: ${data.track.title}`);
          renderQueueView();
          renderSidebarLibrary("queue");
          if (typeof saveUserQueue === "function") saveUserQueue();
        }
      } else {
        if (immediate || isCurrentlySilent) this.setBuffering(false);
        showToast(`Could not play "${query}": ${data.error || "Not found"}`);
      }
    } catch (err) {
      if (immediate || isCurrentlySilent) this.setBuffering(false);
      console.error("playQuery error:", err);
      showToast(`Connection error resolving "${query}"`);
    }
  },

  playSurah(surahNum, immediate = true) {
    this.prime();
    const padded = String(surahNum).padStart(3, "0");
    const surahName = SURAH_NAMES[surahNum] || `Surah ${surahNum}`;
    const track = {
      title: `Surah ${surahNum}: ${surahName}`,
      author: "Mishary Rashid Alafasy",
      duration: 180000,
      streamUrl: `https://download.quranicaudio.com/quran/mishaari_raashid_al_3afaasee/${padded}.mp3`,
      rawStreamUrl: `https://download.quranicaudio.com/quran/mishaari_raashid_al_3afaasee/${padded}.mp3`,
      artworkUrl: "logo.png",
      filterMode: "strict",
      proxyStreamUrl: `/api/stream-audio?channel=${encodeURIComponent(activeSystemChannel)}`
    };
    if (immediate || !this.isPlaying()) {
      if (this.currentTrack) this.history.push(this.currentTrack);
      this.playTrack(track);
    } else {
      this.queue.push(track);
      showToast(`Queued in Browser: ${track.title}`);
      renderQueueView();
    }
  },

  playPlaylistAtIndex(playlist, startIndex = 0) {
    if (!playlist || !playlist.tracks || playlist.tracks.length === 0) return;
    this.prime();
    const tracks = playlist.tracks;
    const safeIndex = Math.max(0, Math.min(startIndex, tracks.length - 1));
    showToast(`Starting ${playlist.name || playlist.title}...`);

    this.isRadioActive = false;
    this.activeRadioSeed = null;
    this.queue = [];

    // Push preceding songs to history so user can navigate back
    for (let i = 0; i < safeIndex; i++) {
      const p = tracks[i];
      this.history.push({
        title: p.title,
        author: p.artist || p.author || playlist.name,
        artist: p.artist || p.author || playlist.name,
        duration: p.duration || 0,
        artworkUrl: p.artworkUrl || playlist.coverUrl || "logo.png",
        query: p.query || `${p.title} ${p.artist || ""}`.trim(),
        url: p.url || null,
        streamUrl: p.streamUrl || null,
        rawStreamUrl: p.rawStreamUrl || null,
        filterMode: "filterless"
      });
    }

    const cur = tracks[safeIndex];
    const currentTrack = {
      title: cur.title,
      author: cur.artist || cur.author || playlist.name,
      artist: cur.artist || cur.author || playlist.name,
      duration: cur.duration || 0,
      artworkUrl: cur.artworkUrl || playlist.coverUrl || "logo.png",
      query: cur.query || `${cur.title} ${cur.artist || ""}`.trim(),
      url: cur.url || null,
      streamUrl: cur.streamUrl || null,
      rawStreamUrl: cur.rawStreamUrl || null,
      filterMode: "filterless"
    };

    // Subsequent songs populate the Upcoming Queue
    for (let i = safeIndex + 1; i < tracks.length; i++) {
      const t = tracks[i];
      this.queue.push({
        title: t.title,
        author: t.artist || t.author || playlist.name,
        artist: t.artist || t.author || playlist.name,
        duration: t.duration || 0,
        artworkUrl: t.artworkUrl || playlist.coverUrl || "logo.png",
        query: t.query || `${t.title} ${t.artist || ""}`.trim(),
        url: t.url || null,
        streamUrl: t.streamUrl || null,
        rawStreamUrl: t.rawStreamUrl || null,
        filterMode: "filterless"
      });
    }

    renderQueueView();
    renderSidebarLibrary("queue");
    if (typeof saveUserQueue === "function") saveUserQueue();
    this.playTrack(currentTrack);
  },

  playPlaylist(playlist) {
    this.playPlaylistAtIndex(playlist, 0);
  },

  playPause() {
    this.init();
    if (!this.audio) return;
    if (this.isBuffering && !this.audio.paused) {
      this.pause();
      return;
    }
    if (this.audio.paused) {
      this._userExplicitlyPaused = false;
      if ((!this.audio.src || this.audio.src === "" || this.audio.src.endsWith("#")) && this.currentTrack) {
        if (typeof resumeSavedPlayback === "function") {
          resumeSavedPlayback();
        } else {
          this.playTrack(this.currentTrack);
        }
      } else if (!this.audio.src && this.queue.length > 0) {
        this.next();
      } else if (this.audio.src) {
        this.setBuffering(true);
        this.audio.play().then(() => {
          this.setBuffering(false);
          this.onPlay();
        }).catch(e => {
          this.setBuffering(false);
          console.warn("play error:", e);
        });
      }
    } else {
      this.pause();
    }
  },

  play() {
    this.init();
    this._userExplicitlyPaused = false;
    if (this.audio) {
      this.audio.muted = false;
      this.audio.removeAttribute("muted");
      if (this.audio.volume === 0) this.setVolume(100);
      if (typeof EqualizerEngine !== "undefined" && EqualizerEngine.isEnabled) {
        EqualizerEngine.resume();
      }
      if (this.audio.paused) {
        this.setBuffering(true);
        this.audio.play().then(() => {
          this.setBuffering(false);
          this.onPlay();
        }).catch(() => {
          this.setBuffering(false);
        });
      } else {
        this.onPlay();
      }
    }
  },

  pause() {
    this._userExplicitlyPaused = true;
    this.setBuffering(false);
    if (this.audio) {
      try { this.audio.pause(); } catch (_) {}
    }
    this.onPause();
  },

  async next() {
    this.init();
    if (this.queue.length > 0) {
      if (this.currentTrack) this.history.push(this.currentTrack);
      const nextTrack = this.queue.shift();
      await this.playTrack(nextTrack);
      renderQueueView();
      if (typeof saveUserQueue === "function") saveUserQueue();

      // Seamlessly prefetch more radio tracks if running low so playback is truly infinite
      if (this.isRadioActive && this.queue.length <= 2 && !this.isFetchingRadio && this.activeRadioSeed) {
        this.prefetchInfiniteRadio();
      }
      return;
    }

    if (this.repeatMode === "queue" && this.history.length > 0) {
      this.queue = [...this.history];
      this.history = [];
      const nextTrack = this.queue.shift();
      await this.playTrack(nextTrack);
      renderQueueView();
      if (typeof saveUserQueue === "function") saveUserQueue();
      return;
    }

    // SPOTIFY INFINITE RADIO & AUTOPLAY:
    // If queue finishes, connect to a radio channel related to the last song of queue.
    // If no queue existed, connect to a radio channel related to the last song played.
    if (this.autoplayRadioEnabled) {
      const seedTrack = this.currentTrack || (this.history.length > 0 ? this.history[this.history.length - 1] : null);
      if (seedTrack) {
        const seedTitle = seedTrack.title || seedTrack.info?.title || "Music";
        showToast(`📻 Queue complete! Connecting to ${seedTitle} Radio...`);
        this.activeRadioSeed = seedTrack;
        this.isRadioActive = true;
        if (this.currentTrack) {
          this.history.push(this.currentTrack);
          this.currentTrack = null;
        }

        const radioTracks = await this.fetchRadioTracks(seedTrack, 15);
        if (radioTracks && radioTracks.length > 0) {
          const firstTrack = radioTracks[0];
          this.queue = radioTracks.slice(1);
          await this.playTrack(firstTrack);
          showToast(`📻 Now Playing ${seedTitle} Radio`);
          renderQueueView();
          if (typeof saveUserQueue === "function") saveUserQueue();
          return;
        }
      }
    }

    this.stop();
    showToast("Playback completed");
    renderQueueView();
    if (typeof saveUserQueue === "function") saveUserQueue();
  },

  async fetchRadioTracks(seedTrack, limit = 15) {
    if (!seedTrack) return [];
    this.isFetchingRadio = true;
    const title = seedTrack.title || seedTrack.info?.title || "";
    const author = seedTrack.author || seedTrack.artist || seedTrack.info?.author || "";
    const filterMode = seedTrack.filterMode || currentFilterMode || "filterless";

    // 1. Backend Spotify Radio Generator
    try {
      const url = resolveApiUrl(`/api/radio?seedTitle=${encodeURIComponent(title)}&seedArtist=${encodeURIComponent(author)}&filterMode=${encodeURIComponent(filterMode)}&limit=${limit}&channel=${encodeURIComponent(activeSystemChannel)}`);
      const res = await fetch(url);
      const data = await res.json();
      const fetchedTracks = (data && data.success && Array.isArray(data.tracks)) ? data.tracks : (Array.isArray(data?.results) ? data.results : []);
      if (fetchedTracks.length > 0) {
        this.isFetchingRadio = false;
        return fetchedTracks.map(t => ({
          ...t,
          isRadio: true,
          radioSeedTitle: title
        }));
      }
    } catch (err) {
      console.warn("fetchRadioTracks API warning, using client fallback:", err);
    }

    // 2. Client-side fallback via search API
    try {
      const cleanArtist = author.split(/[,&x/]|feat\.|ft\./i)[0].trim();
      const query = cleanArtist ? `${cleanArtist} hits` : `${title} similar`;
      const res = await fetch(resolveApiUrl(`/api/search?q=${encodeURIComponent(query)}&type=tracks&filterMode=${encodeURIComponent(currentFilterMode)}`));
      const data = await res.json();
      const rawTracks = (data && Array.isArray(data.results)) ? data.results : (Array.isArray(data?.tracks) ? data.tracks : []);
      if (rawTracks.length > 0) {
        const normSeed = title.toLowerCase().replace(/[^a-z0-9]/g, "");
        const fallbackList = rawTracks
          .filter(t => {
            const tNorm = (t.title || "").toLowerCase().replace(/[^a-z0-9]/g, "");
            return !tNorm.includes(normSeed) && !normSeed.includes(tNorm);
          })
          .map(t => ({
            ...t,
            isRadio: true,
            radioSeedTitle: title
          }));
        this.isFetchingRadio = false;
        return fallbackList;
      }
    } catch (e) {}

    // 3. Client-side direct JioSaavn public API fallback (zero dependencies, works standalone)
    try {
      const cleanArtist = author.split(/[,&x/]|feat\.|ft\./i)[0].trim();
      const q = cleanArtist || (title || "").replace(/\(.*?\)|\[.*?\]/g, "").trim();
      if (q) {
        const jioRes = await fetch(`https://www.jiosaavn.com/api.php?__call=autocomplete.get&_format=json&_marker=0&cc=in&includeMetaTags=1&query=${encodeURIComponent(q)}`);
        const jioData = await jioRes.json();
        const songs = jioData?.songs?.data || [];
        if (Array.isArray(songs) && songs.length > 0) {
          const normSeed = title.toLowerCase().replace(/[^a-z0-9]/g, "");
          const directTracks = songs
            .filter(s => {
              const st = (s.title || s.song || "").toLowerCase().replace(/[^a-z0-9]/g, "");
              return !normSeed || (!st.includes(normSeed) && !normSeed.includes(st));
            })
            .slice(0, limit)
            .map(s => {
              const rawArt = s.image || s.artworkUrl || "logo.png";
              const art500 = rawArt.replace(/150x150/g, "500x500").replace(/50x50/g, "500x500");
              const songTitle = (s.title || s.song || "").replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&');
              const songArtist = (s.more_info?.primary_artists || s.music || s.description || "Artist").replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&');
              return {
                id: s.id || `radio_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                title: songTitle,
                author: songArtist,
                artist: songArtist,
                duration: parseInt(s.more_info?.duration || "210", 10),
                artworkUrl: art500,
                query: `${songTitle} ${songArtist}`.trim(),
                streamUrl: s.more_info?.vlink || null,
                rawStreamUrl: s.more_info?.vlink || null,
                isRadio: true,
                radioSeedTitle: title,
                filterMode: "filterless"
              };
            });
          if (directTracks.length > 0) {
            this.isFetchingRadio = false;
            return directTracks;
          }
        }
      }
    } catch (jioErr) {}

    this.isFetchingRadio = false;
    return [];
  },

  async prefetchInfiniteRadio() {
    if (!this.activeRadioSeed || this.isFetchingRadio) return;
    this.isFetchingRadio = true;
    try {
      const baseSeed = this.queue.length > 0 ? this.queue[this.queue.length - 1] : this.activeRadioSeed;
      const moreTracks = await this.fetchRadioTracks(baseSeed, 8);
      if (moreTracks && moreTracks.length > 0) {
        const existingTitles = new Set([
          ...this.history.map(t => (t.title || "").toLowerCase()),
          ...this.queue.map(t => (t.title || "").toLowerCase()),
          (this.currentTrack?.title || "").toLowerCase()
        ]);
        const fresh = moreTracks.filter(t => !existingTitles.has((t.title || "").toLowerCase()));
        if (fresh.length > 0) {
          this.queue.push(...fresh);
          renderQueueView();
          if (typeof saveUserQueue === "function") saveUserQueue();
        }
      }
    } catch (e) {
    } finally {
      this.isFetchingRadio = false;
    }
  },

  async startRadioForTrack(track) {
    if (!track) return;
    showToast(`📻 Tuning in to ${track.title} Radio...`);
    track.isRadio = true;
    this.activeRadioSeed = track;
    this.isRadioActive = true;
    if (typeof updateRadioUI === "function") updateRadioUI();

    const radioTracks = await this.fetchRadioTracks(track, 15);
    if (radioTracks && radioTracks.length > 0) {
      if (this.currentTrack) {
        this.history.push(this.currentTrack);
      }
      const first = radioTracks[0];
      first.isRadio = true;
      this.queue = radioTracks.slice(1);
      await this.playTrack(first);
      showToast(`📻 Connected to ${track.title} Radio`);
      renderQueueView();
      if (typeof saveUserQueue === "function") saveUserQueue();
    } else {
      await this.playTrack(track);
    }
    if (typeof updateRadioUI === "function") updateRadioUI();
  },

  toggleAutoplay() {
    this.autoplayRadioEnabled = !this.autoplayRadioEnabled;
    const isEnabled = this.autoplayRadioEnabled;
    localStorage.setItem("ahm_autoplay_radio", isEnabled ? "true" : "false");
    showToast(`Spotify Autoplay Radio: ${isEnabled ? "ON (Infinite Music)" : "OFF"}`);
    
    const btnBar = document.getElementById("btnAutoplayRadio");
    const btnQueue = document.getElementById("btnToggleAutoplay");
    if (btnBar) btnBar.classList.toggle("active", isEnabled);
    if (btnQueue) {
      btnQueue.classList.toggle("active", isEnabled);
      const textSpan = btnQueue.querySelector("span:not(.radio-pulse-dot)");
      if (textSpan) textSpan.textContent = `Autoplay Radio: ${isEnabled ? "On" : "Off"}`;
    }
    if (typeof updateRadioUI === "function") updateRadioUI();
    return isEnabled;
  },

  async prev() {
    this.init();
    if (this.audio && this.audio.currentTime > 5) {
      this.audio.currentTime = 0;
      return;
    }
    if (this.history.length > 0) {
      if (this.currentTrack) this.queue.unshift(this.currentTrack);
      const prevTrack = this.history.pop();
      await this.playTrack(prevTrack);
      renderQueueView();
      if (typeof saveUserQueue === "function") saveUserQueue();
    } else {
      if (this.audio) this.audio.currentTime = 0;
    }
  },

  stop() {
    this.isRadioActive = false;
    this.activeRadioSeed = null;
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
    }
    if (this.currentTrack) this.history.push(this.currentTrack);
    this.currentTrack = null;
    updateUIWithTrack(null, false);
    if (typeof updateRadioUI === "function") updateRadioUI();
    this.reportState();
  },

  seek(seconds) {
    if (!this.audio) return;
    const dur = (Number.isFinite(this.audio.duration) && this.audio.duration > 0)
      ? this.audio.duration
      : (this.currentTrack?.duration ? this.currentTrack.duration / 1000 : 0);
    const target = dur > 0 ? Math.min(Math.max(seconds, 0), dur) : Math.max(seconds, 0);
    this.audio.currentTime = target;
    this.updateMediaSession(this.currentTrack);
    this.reportState();
  },

  setVolume(volPercent) {
    const v = Math.min(Math.max(volPercent / 100, 0), 1.0);
    this.volume = v;
    if (this.audio) this.audio.volume = v;
    updateVolumeUI(v * 100);
  },

  toggleRepeat() {
    const modes = ["off", "track", "queue"];
    const curIdx = modes.indexOf(this.repeatMode);
    const nextMode = modes[(curIdx + 1) % modes.length];
    this.repeatMode = nextMode;
    showToast(`Repeat Mode: ${nextMode.toUpperCase()}`);
    updateRepeatUI(nextMode);
    return nextMode;
  },

  toggleShuffle() {
    this.isShuffle = !this.isShuffle;
    if (this.isShuffle && this.queue.length > 1) {
      for (let i = this.queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
      }
    }
    showToast(`Shuffle: ${this.isShuffle ? "ON" : "OFF"}`);
    document.getElementById("btnShuffle")?.classList.toggle("active", this.isShuffle);
  },

  isPlaying() {
    return this.audio && !this.audio.paused && !this.audio.ended && this.audio.readyState > 1;
  },

  onTimeUpdate() {
    if (isScrubbing) return;
    const cur = this.audio?.currentTime || 0;
    const dur = (Number.isFinite(this.audio?.duration) && this.audio.duration > 0)
      ? this.audio.duration
      : (this.currentTrack?.duration ? this.currentTrack.duration / 1000 : 0);

    const pct = dur > 0 ? (cur / dur) * 100 : 0;
    updateProgressUI(cur, dur, pct);

    // Sync notification bar seek scrubber and current progress
    if ("mediaSession" in navigator && "setPositionState" in navigator.mediaSession && dur > 0 && Number.isFinite(dur)) {
      try {
        navigator.mediaSession.setPositionState({
          duration: dur,
          playbackRate: this.audio?.playbackRate || 1.0,
          position: Math.min(Math.max(cur, 0), dur)
        });
      } catch (e) {}
    }

    // Sync time-synchronized karaoke lyrics
    if (typeof LyricsManager !== "undefined") LyricsManager.sync(cur);

    const now = Date.now();
    if (now - this.lastReportTime > 2500) {
      this.lastReportTime = now;

      // Sync Android 10+ system MediaSession seekbar & progress
      if (window.AndroidAudioBridge && typeof window.AndroidAudioBridge.updateMediaState === "function") {
        try {
          const track = this.currentTrack;
          if (track) {
            const title = track.title || "Spy Sec Music";
            const artist = track.author || track.artist || "CyberSpy 404";
            const album = track.album || "Lossless Sovereign Audio";
            let art = track.artworkUrl || "logo.png";
            if (art.startsWith("/")) art = art.substring(1);
            const fullArtUrl = (art.startsWith("http://") || art.startsWith("https://")) ? art : new URL(art, window.location.href).href;
            const isPlaying = Boolean(this.audio && !this.audio.paused);
            window.AndroidAudioBridge.updateMediaState(title, artist, album, fullArtUrl, dur, cur, isPlaying, Boolean(this.isBuffering));
          }
        } catch (_) {}
      }

      this.reportState();
      if (typeof savePlaybackState === "function") savePlaybackState();
    }
  },

  onLoadedMetadata() {
    const dur = this.audio?.duration || 0;
    const totalEl = document.getElementById("totalDurationLabel");
    if (totalEl && dur > 0) totalEl.textContent = formatTime(dur * 1000);
    const expTot = document.getElementById("expandedTotalDuration");
    if (expTot && dur > 0) expTot.textContent = formatTime(dur * 1000);
    this.updateMediaSession(this.currentTrack);
    const cur = this.audio?.currentTime || 0;
    const pct = dur > 0 ? (cur / dur) * 100 : 0;
    updateProgressUI(cur, dur, pct);
  },

  onPlay() {
    if ("mediaSession" in navigator && "playbackState" in navigator.mediaSession) {
      try { navigator.mediaSession.playbackState = "playing"; } catch (e) {}
    }
    this.updateMediaSession(this.currentTrack, true);
    // Note: Android WebView automatically manages Audio Focus for HTMLMediaElements.
    // Avoid manual AudioFocus calls through bridge that cause focus collisions and silent playback.
    updatePlayPauseIcons(true);
    const cur = this.audio?.currentTime || 0;
    const dur = (Number.isFinite(this.audio?.duration) && this.audio.duration > 0)
      ? this.audio.duration
      : (this.currentTrack?.duration ? this.currentTrack.duration / 1000 : 0);
    const pct = dur > 0 ? (cur / dur) * 100 : 0;
    updateProgressUI(cur, dur, pct);
    if (typeof EqualizerEngine !== "undefined" && EqualizerEngine.isEnabled) EqualizerEngine.resume();
    if (typeof ReactiveVisualizerEngine !== "undefined") ReactiveVisualizerEngine.start();
    this.reportState();
  },

  onPause() {
    if ("mediaSession" in navigator && "playbackState" in navigator.mediaSession) {
      try { navigator.mediaSession.playbackState = "paused"; } catch (e) {}
    }
    this.updateMediaSession(this.currentTrack, false);
    updatePlayPauseIcons(false);
    if (typeof ReactiveVisualizerEngine !== "undefined") ReactiveVisualizerEngine.stop();
    this.reportState();
    if (typeof savePlaybackState === "function") savePlaybackState();
  },

  onEnded() {
    if (!this.audio || !this.currentTrack) return;
    const cur = this.audio.currentTime || 0;

    // Ignore ended events for dummy data URLs or empty audio
    if (!this.audio.src || this.audio.src.startsWith("data:") || this.audio.src.endsWith("#")) {
      return;
    }

    // Determine expected track duration: check finite audio.duration first, else currentTrack.duration in seconds
    let expectedDur = 0;
    if (Number.isFinite(this.audio.duration) && this.audio.duration > 0) {
      expectedDur = this.audio.duration;
    } else if (this.currentTrack && typeof this.currentTrack.duration === "number" && this.currentTrack.duration > 0) {
      expectedDur = this.currentTrack.duration / 1000;
    }

    // Guard 1: Never trigger track end if playback just started (< 3 seconds)
    if (cur < 3) {
      console.warn(`[Audio Engine] False ended event ignored at ${cur.toFixed(1)}s.`);
      return;
    }

    // Guard 2: If expected duration is known and significant (> 8s), guard against premature ends
    // caused by mobile network stalls, chunk boundaries, or buffer underruns
    if (expectedDur > 8 && cur < (expectedDur - 5)) {
      console.warn(`[Audio Engine] False premature ended event caught at ${cur.toFixed(1)}s / ${expectedDur.toFixed(1)}s. Resuming playback...`);
      this.audio.play().catch(() => {});
      return;
    }

    if (typeof SleepTimerEngine !== "undefined") SleepTimerEngine.checkTrackEnd();

    if (this.repeatMode === "track") {
      this.audio.currentTime = 0;
      this.audio.play().catch(() => {});
    } else {
      this.next();
    }
  },

  onError(e) {
    if (this._isChangingTrack || this.audio?.error?.code === 1) {
      // MEDIA_ERR_ABORTED (code 1): Track was intentionally interrupted/aborted by a fast skip or new track load.
      return;
    }
    console.error("Browser audio error:", e);
    if (!this.currentTrack) return;

    // Retry Strategy 1: Switch between proxy and direct CDN stream
    if (this.audio?.src && this.audio.src.includes("/api/stream-audio") && this.currentTrack.streamUrl) {
      console.log("Audio proxy failed or stalled, falling back to direct CDN stream without CORS restrictions...");
      try { this.audio.removeAttribute("crossorigin"); } catch (_) {}
      this.audio.src = this.currentTrack.streamUrl;
      this.audio.currentTime = 0;
      this.audio.play().catch(() => {});
      return;
    } else if (this.audio?.src && !this.audio.src.includes("/api/stream-audio") && this.currentTrack.streamUrl) {
      console.log("Direct stream failed, falling back to server audio proxy with fresh timestamp...");
      try { this.audio.crossOrigin = "anonymous"; } catch (_) {}
      this.audio.src = resolveApiUrl(`/api/stream-audio?channel=${encodeURIComponent(activeSystemChannel)}&url=${encodeURIComponent(this.currentTrack.streamUrl)}&t=${Date.now()}`);
      this.audio.currentTime = 0;
      this.audio.play().catch(() => {});
      return;
    }

    // Retry Strategy 2: If primary failed, re-resolve via JioSaavn CDN
    if (!this.currentTrack._fallbackAttempted) {
      this.currentTrack._fallbackAttempted = true;
      const cleanTitle = (this.currentTrack.title || "").replace(/\(.*?\)|\[.*?\]/g, "").trim();
      const cleanArtist = (this.currentTrack.author || this.currentTrack.artist || "").split(/[,&x/]|feat\.|ft\./i)[0].trim();
      const query = cleanArtist ? `${cleanTitle} ${cleanArtist}` : cleanTitle;
      console.log(`Re-resolving fallback audio for: ${query}`);
      fetch(resolveApiUrl(`/api/resolve-track?q=${encodeURIComponent(query)}&filterMode=filterless&channel=${encodeURIComponent(activeSystemChannel)}&forceSaavn=true`))
        .then(r => r.json())
        .then(d => {
          if (d.success && d.track?.streamUrl) {
            this.currentTrack.streamUrl = d.track.streamUrl;
            this.currentTrack.proxyStreamUrl = d.track.proxyStreamUrl;
            const chosenSrc = d.track.streamUrl || resolveApiUrl(d.track.proxyStreamUrl);
            try { this.audio.crossOrigin = "anonymous"; } catch (_) {}
            this.audio.src = chosenSrc;
            this.audio.currentTime = 0;
            this.audio.play().catch(() => {});
          } else if (this.queue.length > 0) {
            this.next();
          }
        })
        .catch(() => {
          if (this.queue.length > 0) this.next();
        });
    } else if (this.queue.length > 0) {
      this.next();
    }
  },

  reportState() {
    if (!this.audio) return;
    const targetChannel = activeSystemChannel || (isMobileAppEnvironment ? "app" : "browser");
    fetch("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetChannel: targetChannel,
        channel: targetChannel,
        action: "report_state",
        position: Math.round((this.audio.currentTime || 0) * 1000),
        duration: Math.round((this.audio.duration || 0) * 1000),
        isPlaying: !this.audio.paused && !this.audio.ended,
        isPaused: this.audio.paused
      })
    }).catch(() => {});
  }
};
window.BrowserPlayer = BrowserPlayer;
window.AudioEngine = BrowserPlayer;
const AudioEngine = BrowserPlayer;

// ==========================================================================
// SPOTIFY FEATURE 1: TIME-SYNCED KARAOKE LYRICS (LRCLIB + MUSIXMATCH EQUIV)
// ==========================================================================
const LyricsManager = {
  activeLyrics: null,
  activeTrackKey: null,
  isFetching: false,
  userIsScrolling: false,
  scrollResumeTimeout: null,
  currentActiveLineIdx: -1,

  async loadLyricsForTrack(track, force = false) {
    if (!track) return;
    const title = track.title || track.info?.title || "";
    const artist = track.author || track.artist || track.info?.author || "";
    const dur = track.duration || track.info?.duration || 0;
    const trackKey = `${title.toLowerCase()}_${artist.toLowerCase()}`;

    if (!force && this.activeTrackKey === trackKey && this.activeLyrics) {
      this.render();
      return;
    }

    this.activeTrackKey = trackKey;
    this.isFetching = true;
    this.activeLyrics = null;
    this.currentActiveLineIdx = -1;
    this.renderLoading(title, artist, track.artworkUrl);

    try {
      const res = await fetch(`/api/lyrics?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}&duration=${dur}`);
      const data = await res.json();
      if (data.success && data.lyrics) {
        let synced = null;
        if (data.lyrics.syncedLyrics) {
          synced = this.parseLRC(data.lyrics.syncedLyrics);
        }
        this.activeLyrics = {
          synced: synced && synced.length > 0 ? synced : null,
          plain: data.lyrics.plainLyrics || null,
          isQuran: Boolean(data.lyrics.isQuran),
          instrumental: Boolean(data.lyrics.instrumental),
          title: data.lyrics.title || title,
          artist: data.lyrics.artist || artist,
          artworkUrl: track.artworkUrl || "logo.png"
        };
      }
    } catch (e) {
      console.warn("Lyrics fetch note:", e);
    } finally {
      this.isFetching = false;
      this.render();
    }
  },

  parseLRC(lrcText) {
    if (!lrcText || typeof lrcText !== "string") return [];
    const lines = lrcText.split("\n");
    const parsed = [];
    const timeRegex = /\[(\d{2}):(\d{2})\.?(\d{2,3})?\](.*)/;

    for (const raw of lines) {
      const trimmed = raw.trim();
      const match = trimmed.match(timeRegex);
      if (match) {
        const min = parseInt(match[1], 10);
        const sec = parseInt(match[2], 10);
        const msRaw = match[3] || "0";
        const ms = parseInt(msRaw.padEnd(3, "0").slice(0, 3), 10);
        const time = min * 60 + sec + ms / 1000;
        const text = match[4].trim();
        if (text) {
          parsed.push({ time, text });
        }
      }
    }
    return parsed.sort((a, b) => a.time - b.time);
  },

  renderLoading(title, artist, artworkUrl) {
    const artEl = document.getElementById("lyricsTrackArt");
    const titleEl = document.getElementById("lyricsSongTitle");
    const artistEl = document.getElementById("lyricsSongArtist");
    const statusEl = document.getElementById("lyricsStatusBadge");
    const wrap = document.getElementById("lyricsLinesWrapper");

    if (artEl) artEl.src = artworkUrl || "logo.png";
    if (titleEl) titleEl.textContent = title || "Loading...";
    if (artistEl) artistEl.textContent = artist || "";
    if (statusEl) statusEl.textContent = "⏳ Loading Lyrics...";

    if (wrap) {
      wrap.innerHTML = `
        <div class="lyrics-empty-state">
          <div class="lyrics-empty-icon" style="animation: spin 1.5s linear infinite;">🔄</div>
          <div class="lyrics-empty-title">Loading synchronized lyrics...</div>
          <div class="lyrics-empty-sub">Connecting to free open LRCLIB database</div>
        </div>
      `;
    }
  },

  render() {
    const artEl = document.getElementById("lyricsTrackArt");
    const titleEl = document.getElementById("lyricsSongTitle");
    const artistEl = document.getElementById("lyricsSongArtist");
    const statusEl = document.getElementById("lyricsStatusBadge");
    const wrap = document.getElementById("lyricsLinesWrapper");
    const prevActive = document.getElementById("expandedLyricLineActive");
    const prevNext = document.getElementById("expandedLyricLineNext");
    const prevBadge = document.getElementById("expandedLyricsBadge");

    const track = BrowserPlayer.currentTrack || { title: "No Song Playing", author: "Select a track", artworkUrl: "logo.png" };
    if (artEl) artEl.src = track.artworkUrl || "logo.png";
    if (titleEl) titleEl.textContent = track.title || "No Song Playing";
    if (artistEl) artistEl.textContent = track.author || track.artist || "";

    if (!this.activeLyrics) {
      if (statusEl) statusEl.textContent = "No Lyrics Available";
      if (wrap) {
        wrap.innerHTML = `
          <div class="lyrics-empty-state">
            <div class="lyrics-empty-icon">🎵</div>
            <div class="lyrics-empty-title">No lyrics found for this track</div>
            <div class="lyrics-empty-sub">Enjoy the pure melody! You can still search for other songs.</div>
          </div>
        `;
      }
      if (prevActive) prevActive.textContent = "Lyrics unavailable for this track";
      if (prevNext) prevNext.textContent = "";
      return;
    }

    if (this.activeLyrics.instrumental) {
      if (statusEl) statusEl.textContent = "🎻 Instrumental";
      if (wrap) {
        wrap.innerHTML = `
          <div class="lyrics-empty-state">
            <div class="lyrics-empty-icon">🎻</div>
            <div class="lyrics-empty-title">Instrumental Track</div>
            <div class="lyrics-empty-sub">This song is purely instrumental with no vocal lyrics.</div>
          </div>
        `;
      }
      if (prevActive) prevActive.textContent = "Instrumental Track";
      if (prevNext) prevNext.textContent = "";
      return;
    }

    // Time-synced lyrics available!
    if (this.activeLyrics.synced && this.activeLyrics.synced.length > 0) {
      if (statusEl) statusEl.textContent = "🟢 Synced Karaoke";
      if (prevBadge) prevBadge.textContent = "Synced";
      if (wrap) {
        wrap.innerHTML = "";
        this.activeLyrics.synced.forEach((line, idx) => {
          const p = document.createElement("p");
          p.className = "lyric-line";
          p.id = `lyricLine_${idx}`;
          p.dataset.index = idx;
          p.dataset.time = line.time;
          p.textContent = line.text;
          p.addEventListener("click", () => {
            BrowserPlayer.seek(line.time);
            showToast(`Jumped to ${formatTime(line.time * 1000)}`);
          });
          wrap.appendChild(p);
        });
      }
      return;
    }

    // Plain text lyrics fallback
    if (this.activeLyrics.plain) {
      if (statusEl) statusEl.textContent = "📝 Plain Lyrics";
      if (prevBadge) prevBadge.textContent = "Plain";
      if (wrap) {
        wrap.innerHTML = "";
        const lines = this.activeLyrics.plain.split("\n");
        lines.forEach((line, idx) => {
          if (!line.trim()) {
            const spacer = document.createElement("div");
            spacer.style.height = "16px";
            wrap.appendChild(spacer);
            return;
          }
          const p = document.createElement("p");
          p.className = "lyric-line active";
          p.style.fontSize = "1.5rem";
          p.textContent = line.trim();
          wrap.appendChild(p);
        });
      }
      if (prevActive) prevActive.textContent = this.activeLyrics.plain.split("\n")[0] || "";
      if (prevNext) prevNext.textContent = this.activeLyrics.plain.split("\n")[1] || "";
    }
  },

  sync(currentTimeSec) {
    if (!this.activeLyrics || !this.activeLyrics.synced || this.activeLyrics.synced.length === 0) return;
    const synced = this.activeLyrics.synced;

    let activeIdx = -1;
    for (let i = 0; i < synced.length; i++) {
      if (currentTimeSec >= synced[i].time) {
        activeIdx = i;
      } else {
        break;
      }
    }

    if (activeIdx === this.currentActiveLineIdx) return;
    this.currentActiveLineIdx = activeIdx;

    // Update lines in full view
    const allLines = document.querySelectorAll(".lyric-line[data-index]");
    allLines.forEach((el) => {
      const lineIdx = parseInt(el.dataset.index, 10);
      if (lineIdx === activeIdx) {
        el.classList.add("active");
        el.classList.remove("passed");
      } else if (lineIdx < activeIdx) {
        el.classList.add("passed");
        el.classList.remove("active");
      } else {
        el.classList.remove("active", "passed");
      }
    });

    // Auto-scroll full view container smoothly
    if (activeIdx >= 0 && !this.userIsScrolling) {
      const activeEl = document.getElementById(`lyricLine_${activeIdx}`);
      const scrollBox = document.getElementById("lyricsScrollBox");
      if (activeEl && scrollBox) {
        const boxRect = scrollBox.getBoundingClientRect();
        const lineRect = activeEl.getBoundingClientRect();
        const offset = (lineRect.top - boxRect.top) - (boxRect.height / 2) + (lineRect.height / 2);
        scrollBox.scrollBy({ top: offset, behavior: "smooth" });
      }
    }

    // Update Expanded Now Playing mini lyrics preview card
    const prevActive = document.getElementById("expandedLyricLineActive");
    const prevNext = document.getElementById("expandedLyricLineNext");
    if (activeIdx >= 0 && synced[activeIdx]) {
      if (prevActive) prevActive.textContent = synced[activeIdx].text;
      if (prevNext && synced[activeIdx + 1]) prevNext.textContent = synced[activeIdx + 1].text;
    }
  },

  renderActiveTrackHeader() {
    this.render();
  },

  initScrollListener() {
    const scrollBox = document.getElementById("lyricsScrollBox");
    if (!scrollBox) return;
    scrollBox.addEventListener("wheel", () => {
      this.userIsScrolling = true;
      clearTimeout(this.scrollResumeTimeout);
      this.scrollResumeTimeout = setTimeout(() => {
        this.userIsScrolling = false;
      }, 3500);
    }, { passive: true });
    scrollBox.addEventListener("touchmove", () => {
      this.userIsScrolling = true;
      clearTimeout(this.scrollResumeTimeout);
      this.scrollResumeTimeout = setTimeout(() => {
        this.userIsScrolling = false;
      }, 3500);
    }, { passive: true });
  }
};
window.LyricsManager = LyricsManager;

// ==========================================================================
// SPOTIFY FEATURE 2: 6-BAND GRAPHIC EQUALIZER (WEB AUDIO API DSP)
// ==========================================================================
const EqualizerEngine = {
  audioCtx: null,
  sourceNode: null,
  filters: [],
  analyser: null,
  frequencies: [60, 230, 910, 3000, 8000, 14000],
  filterTypes: ["lowshelf", "peaking", "peaking", "peaking", "peaking", "highshelf"],
  presets: {
    flat: [0, 0, 0, 0, 0, 0],
    bass_boost: [6, 4.5, 1, 0, 0, 0],
    bass_reducer: [-6, -4, 0, 0, 0, 0],
    vocal_booster: [-2, 0, 2.5, 4.5, 3, 1],
    acoustic: [3, 2, 1, 2, 3.5, 3],
    electronic: [5, 3.5, 0, 2, 4, 3.5],
    rock: [4.5, 2.5, -1, 1.5, 3.5, 4],
    hiphop: [6, 4, 1, 2, 1, 2.5],
    pop: [-1, 2, 3, 3.5, 2, 1]
  },
  currentPreset: localStorage.getItem("ahm_eq_preset") || "flat",
  isEnabled: localStorage.getItem("ahm_eq_enabled") === "true", // Default false to prevent Web Audio cross-origin CORS mute
  gains: JSON.parse(localStorage.getItem("ahm_eq_gains") || "[0,0,0,0,0,0]"),
  isInitialized: false,

  init(audioElement) {
    if (!this.isEnabled) return;
    if (this.isInitialized || !audioElement) return;
    try {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtxClass) return;
      if (!this.audioCtx) {
        this.audioCtx = new AudioCtxClass();
      }
      this.resume();

      // Create 6 Biquad Filter nodes in series
      this.filters = this.frequencies.map((freq, i) => {
        const filter = this.audioCtx.createBiquadFilter();
        filter.type = this.filterTypes[i];
        filter.frequency.value = freq;
        filter.Q.value = 1.0;
        filter.gain.value = this.isEnabled ? (this.gains[i] || 0) : 0;
        return filter;
      });

      // Create AnalyserNode for Reactive Visualizer Canvas
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 128;
      this.analyser.smoothingTimeConstant = 0.8;

      // Connect HTML5 Audio -> Filter 0 -> Filter 1 -> ... -> Filter 5 -> Analyser -> Destination
      try {
        this.sourceNode = this.audioCtx.createMediaElementSource(audioElement);
      } catch (srcErr) {
        console.warn("createMediaElementSource note:", srcErr.message);
        return;
      }
      let prevNode = this.sourceNode;
      for (const f of this.filters) {
        prevNode.connect(f);
        prevNode = f;
      }
      prevNode.connect(this.analyser);
      this.analyser.connect(this.audioCtx.destination);

      this.isInitialized = true;
      console.log("🎚️ [Equalizer DSP] Native 6-Band Web Audio Graph connected successfully!");
    } catch (err) {
      console.warn("Equalizer initialization note:", err.message);
    }
  },

  resume() {
    try {
      if (this.audioCtx && this.audioCtx.state === "suspended") {
        this.audioCtx.resume().catch(() => {});
      }
    } catch (_) {}
  },

  setBandGain(bandIdx, gainDb) {
    gainDb = Math.min(Math.max(parseFloat(gainDb) || 0, -12), 12);
    this.gains[bandIdx] = gainDb;
    if (this.filters[bandIdx] && this.isEnabled && this.audioCtx) {
      this.filters[bandIdx].gain.setTargetAtTime(gainDb, this.audioCtx.currentTime, 0.05);
    }
    localStorage.setItem("ahm_eq_gains", JSON.stringify(this.gains));
    const lbl = document.getElementById(`eqVal${bandIdx}`);
    if (lbl) lbl.textContent = `${gainDb > 0 ? "+" : ""}${gainDb}dB`;
  },

  applyPreset(presetKey) {
    const pValues = this.presets[presetKey];
    if (!pValues) return;
    this.currentPreset = presetKey;
    localStorage.setItem("ahm_eq_preset", presetKey);
    this.gains = [...pValues];
    localStorage.setItem("ahm_eq_gains", JSON.stringify(this.gains));

    this.gains.forEach((g, idx) => {
      if (this.filters[idx] && this.isEnabled && this.audioCtx) {
        this.filters[idx].gain.setTargetAtTime(g, this.audioCtx.currentTime, 0.05);
      }
      const slider = document.getElementById(`eqBand${idx}`);
      const lbl = document.getElementById(`eqVal${idx}`);
      if (slider) slider.value = g;
      if (lbl) lbl.textContent = `${g > 0 ? "+" : ""}${g}dB`;
    });

    document.querySelectorAll(".eq-preset-chip").forEach(c => {
      c.classList.toggle("active", c.getAttribute("data-preset") === presetKey);
    });

    showToast(`Equalizer Preset: ${presetKey.replace("_", " ").toUpperCase()}`);
  },

  toggle(enable) {
    this.isEnabled = Boolean(enable);
    localStorage.setItem("ahm_eq_enabled", this.isEnabled ? "true" : "false");
    if (this.isEnabled) {
      if (!this.isInitialized && BrowserPlayer.audio) {
        this.init(BrowserPlayer.audio);
      }
      this.resume();
      this.filters.forEach((f, idx) => {
        const g = this.gains[idx] || 0;
        if (this.audioCtx) f.gain.setTargetAtTime(g, this.audioCtx.currentTime, 0.05);
      });
      showToast("Equalizer: ON (Studio DSP Active)");
    } else {
      // Flat transparent passthrough so volume is never lost
      this.filters.forEach((f) => {
        if (this.audioCtx) f.gain.setTargetAtTime(0, this.audioCtx.currentTime, 0.05);
      });
      showToast("Equalizer: OFF (Direct Flat Audio)");
    }
  }
};
window.EqualizerEngine = EqualizerEngine;

// ==========================================================================
// SPOTIFY FEATURE 3: SLEEP TIMER WITH GENTLE AUDIO ATTENUATION
// ==========================================================================
const SleepTimerEngine = {
  timerId: null,
  updateIntervalId: null,
  targetTimestamp: null,
  durationMinutes: 0,
  isFading: false,
  originalVolume: 1.0,

  start(minutes) {
    this.cancel();
    if (minutes === "track") {
      this.durationMinutes = "track";
      showToast("🌙 Sleep timer set: End of track");
      this.updateUI(true, "End of track");
      return;
    }

    const mins = parseInt(minutes, 10);
    if (!mins || mins <= 0) return;

    this.durationMinutes = mins;
    this.targetTimestamp = Date.now() + (mins * 60 * 1000);
    showToast(`🌙 Sleep timer set for ${mins} minutes`);

    this.updateIntervalId = setInterval(() => {
      const remainingMs = this.targetTimestamp - Date.now();
      if (remainingMs <= 0) {
        this.fire();
      } else {
        const remainingSec = Math.floor(remainingMs / 1000);
        const m = Math.floor(remainingSec / 60);
        const s = remainingSec % 60;
        const timeStr = `${m}:${String(s).padStart(2, "0")}`;
        this.updateUI(true, timeStr);

        // In final 15 seconds: gently fade out audio volume
        if (remainingSec <= 15 && !this.isFading && BrowserPlayer.audio) {
          this.isFading = true;
          this.originalVolume = BrowserPlayer.audio.volume;
          this.startSmoothFadeOut(15);
        }
      }
    }, 1000);

    this.updateUI(true, `${mins}:00`);
  },

  startSmoothFadeOut(seconds) {
    const steps = seconds * 4;
    let stepCount = 0;
    const fadeInterval = setInterval(() => {
      stepCount++;
      if (!BrowserPlayer.audio || stepCount >= steps) {
        clearInterval(fadeInterval);
        return;
      }
      const factor = Math.max(0, 1 - (stepCount / steps));
      BrowserPlayer.audio.volume = this.originalVolume * factor;
    }, 250);
  },

  fire() {
    this.cancel();
    if (BrowserPlayer.audio) {
      BrowserPlayer.audio.pause();
      BrowserPlayer.audio.volume = this.originalVolume;
    }
    this.isFading = false;
    showToast("🌙 Sleep timer expired. Playback paused.");
  },

  checkTrackEnd() {
    if (this.durationMinutes === "track") {
      this.cancel();
      if (BrowserPlayer.audio) BrowserPlayer.audio.pause();
      showToast("🌙 Sleep timer: Reached end of track. Playback paused.");
    }
  },

  cancel() {
    clearInterval(this.updateIntervalId);
    this.updateIntervalId = null;
    this.targetTimestamp = null;
    this.durationMinutes = 0;
    if (this.isFading && BrowserPlayer.audio) {
      BrowserPlayer.audio.volume = this.originalVolume;
    }
    this.isFading = false;
    this.updateUI(false);
  },

  updateUI(isActive, text = "") {
    const badgeBar = document.getElementById("sleepTimerBadge");
    const turnOffBtn = document.getElementById("btnTurnOffSleepTimer");
    const subtitle = document.getElementById("sleepTimerSubtitle");

    if (badgeBar) {
      badgeBar.style.display = isActive ? "inline-block" : "none";
      badgeBar.textContent = text;
    }
    if (turnOffBtn) {
      turnOffBtn.style.display = isActive ? "flex" : "none";
    }
    if (subtitle) {
      subtitle.textContent = isActive ? `Active • Stopping in ${text}` : "Automatically stop playback";
    }

    document.querySelectorAll(".sleep-timer-btn").forEach(btn => {
      const m = btn.getAttribute("data-minutes");
      btn.classList.toggle("active", isActive && String(m) === String(this.durationMinutes));
    });
  }
};
window.SleepTimerEngine = SleepTimerEngine;

// ==========================================================================
// SPOTIFY FEATURE 4: HI-FI AUDIO STREAMING QUALITY SELECTOR
// ==========================================================================
const AudioQualityManager = {
  currentQuality: localStorage.getItem("ahm_audio_quality") || "very_high",

  init() {
    this.apply(this.currentQuality, false);
  },

  set(qualityKey) {
    this.currentQuality = qualityKey;
    localStorage.setItem("ahm_audio_quality", qualityKey);
    this.apply(qualityKey, true);
  },

  apply(qualityKey, notify = true) {
    const pillText = document.getElementById("qualityPillText");
    const labels = {
      very_high: "320k Hi-Fi",
      high: "160k High",
      data_saver: "96k Saver"
    };
    if (pillText) pillText.textContent = labels[qualityKey] || "320k Hi-Fi";

    document.querySelectorAll(".quality-option-card").forEach(c => {
      c.classList.toggle("active", c.getAttribute("data-quality") === qualityKey);
    });

    if (notify) {
      const descriptions = {
        very_high: "Very High (320 kbps Extreme Hi-Fi AAC)",
        high: "High (160 kbps Crisp Audio)",
        data_saver: "Normal (96 kbps Data Saver)"
      };
      showToast(`Audio Quality: ${descriptions[qualityKey] || qualityKey}`);
    }
  }
};
window.AudioQualityManager = AudioQualityManager;

// ==========================================================================
// SPOTIFY FEATURE 5: SPOTIFY CANVAS & LIVE REACTIVE AUDIO VISUALIZER
// ==========================================================================
const ReactiveVisualizerEngine = {
  isRunning: false,
  canvas: null,
  ctx: null,
  animationId: null,

  start() {
    this.canvas = document.getElementById("expandedSpectrumCanvas");
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext("2d");
    if (!this.ctx) return;
    if (this.isRunning) return;

    this.isRunning = true;
    this.loop();
  },

  stop() {
    this.isRunning = false;
    if (this.animationId) cancelAnimationFrame(this.animationId);
    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  },

  loop() {
    if (!this.isRunning) return;
    this.animationId = requestAnimationFrame(() => this.loop());

    const canvas = this.canvas;
    const ctx = this.ctx;
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!BrowserPlayer.isPlaying()) {
      return;
    }

    let dataArray = null;
    let bufferLength = 48;
    if (EqualizerEngine.analyser && EqualizerEngine.isEnabled) {
      bufferLength = EqualizerEngine.analyser.frequencyBinCount;
      dataArray = new Uint8Array(bufferLength);
      EqualizerEngine.analyser.getByteFrequencyData(dataArray);
    }

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = 105;
    const numBars = 48;
    const step = (Math.PI * 2) / numBars;
    const time = Date.now() / 250;

    ctx.save();
    for (let i = 0; i < numBars; i++) {
      let val = 0;
      if (dataArray) {
        const dataIdx = Math.floor((i / numBars) * (bufferLength / 2));
        val = dataArray[dataIdx] || 0;
      } else {
        // Procedural smooth reactive visualizer if Equalizer is off
        val = 70 + Math.sin(time + i * 0.45) * 45 + Math.cos(time * 0.8 + i * 0.3) * 35;
      }
      const barHeight = Math.max((val / 255) * 42, 4);

      const angle = i * step;
      const x1 = centerX + Math.cos(angle) * radius;
      const y1 = centerY + Math.sin(angle) * radius;
      const x2 = centerX + Math.cos(angle) * (radius + barHeight);
      const y2 = centerY + Math.sin(angle) * (radius + barHeight);

      const grad = ctx.createLinearGradient(x1, y1, x2, y2);
      grad.addColorStop(0, "rgba(30, 215, 96, 0.4)");
      grad.addColorStop(1, "rgba(16, 185, 129, 0.95)");

      ctx.strokeStyle = grad;
      ctx.lineWidth = 3.5;
      ctx.lineCap = "round";

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.restore();
  }
};
window.ReactiveVisualizerEngine = ReactiveVisualizerEngine;

// ==========================================================================
// SYSTEM CHANNELS & ROUTING (Fixed to Local Device Output)
// ==========================================================================
function switchSystemChannel(chanKey = "browser") {
  activeSystemChannel = "browser";
  if (BrowserPlayer.currentTrack) {
    updateUIWithTrack(BrowserPlayer.currentTrack, BrowserPlayer.isPlaying());
  } else if (currentState) {
    updateUI(currentState);
  }
}
window.switchSystemChannel = switchSystemChannel;

// Legacy alias
function setAudioRouting(mode) {
  switchSystemChannel("browser");
}
window.setAudioRouting = setAudioRouting;

// ==========================================================================
// VIEW SWITCHING & COMPREHENSIVE NAVIGATION HISTORY STACK
// ==========================================================================
let currentActiveView = "home";
let viewHistoryStack = ["home"];
let forwardHistoryStack = [];

function updateNavButtonsState() {
  const btnBack = document.getElementById("btnNavBack");
  const btnFwd = document.getElementById("btnNavForward");
  const canGoBack = viewHistoryStack.length > 1 || currentActiveView !== "home";
  const canGoFwd = forwardHistoryStack.length > 0;

  if (btnBack) {
    btnBack.disabled = !canGoBack;
    btnBack.classList.toggle("nav-btn-active", canGoBack);
  }
  if (btnFwd) {
    btnFwd.disabled = !canGoFwd;
    btnFwd.classList.toggle("nav-btn-active", canGoFwd);
  }
}

function switchView(viewName, addToHistory = true, isForward = false) {
  if (!viewName) viewName = "home";

  document.querySelectorAll(".stage-view").forEach(v => v.style.display = "none");
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  document.querySelectorAll(".mobile-nav-item").forEach(n => n.classList.remove("active"));

  if (viewName === "home") {
    const el = document.getElementById("viewHome");
    if (el) el.style.display = "block";
    document.getElementById("navLinkHome")?.classList.add("active");
    document.getElementById("mobileNavHome")?.classList.add("active");
  } else if (viewName === "search") {
    const el = document.getElementById("viewSearch");
    if (el) el.style.display = "block";
    document.getElementById("navLinkSearch")?.classList.add("active");
    document.getElementById("mobileNavSearch")?.classList.add("active");
    const inPageInput = document.getElementById("inPageSearchInput");
    const masterInput = document.getElementById("masterSearchInput");
    if (window.innerWidth <= 900 && inPageInput) {
      inPageInput.value = masterInput?.value || "";
      setTimeout(() => inPageInput.focus(), 80);
    } else {
      masterInput?.focus();
    }
  } else if (viewName === "quran") {
    const el = document.getElementById("viewQuran");
    if (el) el.style.display = "block";
    document.getElementById("navLinkQuran")?.classList.add("active");
    renderAll114Surahs();
  } else if (viewName === "playlist") {
    const el = document.getElementById("viewPlaylist");
    if (el) el.style.display = "block";
  } else if (viewName === "queue") {
    const el = document.getElementById("viewQueue");
    if (el) el.style.display = "block";
    document.getElementById("navLinkQueue")?.classList.add("active");
    document.getElementById("mobileNavQueue")?.classList.add("active");
    renderQueueView();
  } else if (viewName === "liked") {
    const el = document.getElementById("viewLiked");
    if (el) el.style.display = "block";
    renderLikedSongsView();
  } else if (viewName === "lyrics") {
    const el = document.getElementById("viewLyrics");
    if (el) el.style.display = "block";
    if (typeof LyricsManager !== "undefined") {
      const cur = isLocalChannel(activeSystemChannel)
        ? BrowserPlayer.currentTrack
        : (currentState?.channels?.[activeSystemChannel]?.current || currentState?.current);
      if (cur) LyricsManager.loadLyricsForTrack(cur);
      else LyricsManager.render();
    }
  }

  // Manage history stack
  if (addToHistory && currentActiveView !== viewName) {
    viewHistoryStack.push(viewName);
    if (!isForward) {
      forwardHistoryStack = [];
    }
    try {
      window.history.pushState({ view: viewName }, "", `#${viewName}`);
    } catch (e) {}
  }

  currentActiveView = viewName;
  updateNavButtonsState();

  // Scroll to top of main stage
  const mainStage = document.getElementById("spotifyMainStage");
  if (mainStage) mainStage.scrollTop = 0;
}
window.switchView = switchView;

function handleAppBack() {
  // 1. If expanded player is open -> close it
  const overlay = document.getElementById("expandedNowPlayingOverlay");
  if (overlay && overlay.classList.contains("active")) {
    if (typeof closeExpandedPlayer === "function") closeExpandedPlayer();
    return true;
  }

  // 2. If any modal is open -> close it
  const profileModal = document.getElementById("modalUserProfile");
  if (profileModal && profileModal.style.display !== "none") {
    profileModal.style.display = "none";
    return true;
  }
  const spotifyModal = document.getElementById("spotifyLinkModal");
  if (spotifyModal && !spotifyModal.classList.contains("hidden")) {
    spotifyModal.classList.add("hidden");
    return true;
  }

  // 3. If right panel is open -> close it
  const rightPanel = document.getElementById("rightNowPlayingPanel");
  if (rightPanel && rightPanel.style.display !== "none") {
    rightPanel.style.display = "none";
    document.getElementById("spotifyAppRoot")?.classList.remove("has-right-panel");
    return true;
  }

  // 4. If in a sub-view (playlist, search, quran, queue, liked) -> go back to previous view
  if (viewHistoryStack.length > 1) {
    const popped = viewHistoryStack.pop(); // Remove current
    forwardHistoryStack.push(popped);
    const prevView = viewHistoryStack[viewHistoryStack.length - 1] || "home";
    switchView(prevView, false);
    return true;
  } else if (currentActiveView !== "home") {
    forwardHistoryStack.push(currentActiveView);
    switchView("home", false);
    return true;
  }

  // 5. At home root with nothing open
  return false;
}
window.handleAppBack = handleAppBack;

function navigateAppBack() {
  handleAppBack();
}
window.navigateAppBack = navigateAppBack;

function navigateAppForward() {
  if (forwardHistoryStack.length > 0) {
    const nextView = forwardHistoryStack.pop();
    switchView(nextView, true, true);
  }
}
window.navigateAppForward = navigateAppForward;

// Listen to browser / Android popstate navigation
window.addEventListener("popstate", (e) => {
  if (e.state && e.state.view) {
    switchView(e.state.view, false);
  } else {
    handleAppBack();
  }
});

// Listen to Capacitor native Android back button event if available
if (window.Capacitor?.Plugins?.App) {
  try {
    window.Capacitor.Plugins.App.addListener("backButton", () => {
      window.handleAppBack();
    });
  } catch (e) {}
}

// ==========================================================================
// PLAYLIST VIEW & RENDERING
// ==========================================================================
function openPlaylist(playlistOrId) {
  let pl = null;
  if (typeof playlistOrId === "object" && playlistOrId !== null) {
    pl = playlistOrId;
  } else {
    pl = (window.spotifyDailyTrending?.playlists || []).find(p => p.id === playlistOrId) ||
         SPOTIFY_INDIAN_PLAYLISTS.find(p => p.id === playlistOrId) ||
         customPlaylists.find(p => p.id === playlistOrId);
  }
  if (!pl) return;
  currentActivePlaylist = pl;

  // Set Hero Elements
  const heroCover = document.getElementById("playlistHeroCover");
  const heroTitle = document.getElementById("playlistHeroTitle");
  const heroDesc = document.getElementById("playlistHeroDesc");
  const heroAuthor = document.getElementById("playlistHeroAuthor");
  const heroCount = document.getElementById("playlistHeroTracksCount");
  const ambientGrad = document.getElementById("stageAmbientGradient");

  if (heroTitle) heroTitle.textContent = pl.name;
  if (heroDesc) heroDesc.textContent = pl.desc || pl.description || "";
  if (heroAuthor) heroAuthor.textContent = pl.author || "Spotify Official";
  const songCount = pl.tracks ? pl.tracks.length : (pl.trackCount || 0);
  if (heroCount) heroCount.textContent = `${songCount} songs • ${pl.badge || "Playlist"}`;
  if (heroCover) {
    heroCover.src = pl.coverUrl || "logo.png";
  }

  if (ambientGrad) {
    ambientGrad.style.background = "linear-gradient(180deg, var(--bg-hover) 0%, transparent 100%)";
  }

  // Render Track rows in Songs Table
  const tableBody = document.getElementById("playlistSongsTableBody");
  if (tableBody) {
    tableBody.innerHTML = "";
    const tracksList = pl.tracks || [];
    if (tracksList.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 32px; color: var(--text-subdued);">No tracks available in this playlist.</td></tr>`;
    } else {
      tracksList.forEach((t, idx) => {
        const tr = document.createElement("tr");
        tr.className = "song-row";
        tr.innerHTML = `
          <td class="td-num">
            <span class="row-index">${idx + 1}</span>
            <span class="row-play-btn" title="Play Now">▶</span>
          </td>
          <td>
            <div class="song-info-cell">
              <div class="song-title-group">
                <span class="song-title">${escapeHtml(t.title)}</span>
                <span class="song-artist">${escapeHtml(t.artist)}</span>
              </div>
            </div>
          </td>
          <td class="song-album-cell">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
              <span>${escapeHtml(pl.name)}</span>
              <div style="display: flex; gap: 6px;">
                <button class="btn-play-now-mini btn-row-play-now" title="Play immediately"><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> Play</button>
                <button class="btn-queue-mini btn-row-enqueue" title="Add to queue"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>
              </div>
            </div>
          </td>
          <td class="song-time-cell">${escapeHtml(t.duration || "3:30")}</td>
        `;

        const trackQuery = t.query || `${t.title} ${t.artist}`;
        tr.querySelector(".btn-row-play-now")?.addEventListener("click", (e) => {
          e.stopPropagation();
          if (isLocalChannel(activeSystemChannel)) {
            BrowserPlayer.playPlaylistAtIndex(pl, idx);
          } else {
            dispatchPlayNow(trackQuery, "filterless");
          }
        });
        tr.querySelector(".btn-row-enqueue")?.addEventListener("click", (e) => {
          e.stopPropagation();
          dispatchEnqueue(trackQuery, "filterless");
        });
        tr.addEventListener("click", () => {
          if (isLocalChannel(activeSystemChannel)) {
            BrowserPlayer.playPlaylistAtIndex(pl, idx);
          } else {
            dispatchPlayNow(trackQuery, "filterless");
          }
        });

        tableBody.appendChild(tr);
      });
    }
  }

  switchView("playlist");
}
window.openPlaylist = openPlaylist;

// Import and Play any Spotify Link (Playlist, Album, Track)
async function importAndPlaySpotifyLink(url, target = activeSystemChannel) {
  const cleanUrl = (url || "").trim();
  if (!cleanUrl) return;

  showToast("Resolving Spotify playlist tracks from link...");

  try {
    const res = await fetch(`/api/spotify-playlist?url=${encodeURIComponent(cleanUrl)}`);
    if (!res.ok) {
      let errText = "Could not load Spotify playlist";
      try {
        const errJson = await res.json();
        errText = errJson.error || errText;
      } catch(e) {}
      showToast(errText);
      return;
    }
    const data = await res.json();
    if (!data.success || !data.playlist) {
      showToast(data.error || "Could not load Spotify playlist");
      return;
    }

    const pl = data.playlist;
    const playlistId = `spotify-${Date.now()}`;
    const customPl = {
      id: playlistId,
      genre: "spotify-imported",
      badge: "Spotify Imported",
      emblem: "",
      name: pl.title || "Imported Spotify Playlist",
      desc: pl.description || `Imported Spotify ${pl.type} • ${pl.artist}`,
      author: pl.artist || "Spotify Curated",
      gradient: "linear-gradient(135deg, #1db954 0%, #121212 100%)",
      tracksCount: pl.trackCount,
      coverUrl: pl.image,
      tags: ["Spotify", pl.type, pl.artist],
      tracks: pl.tracks.map(t => ({
        title: t.title,
        artist: t.artist,
        duration: formatTime(t.duration),
        query: t.query || `${t.artist} - ${t.title}`,
        previewUrl: t.previewUrl,
        artworkUrl: t.artworkUrl
      }))
    };

    customPlaylists.unshift(customPl);
    try {
      localStorage.setItem("imported_spotify_playlists", JSON.stringify(customPlaylists.slice(0, 15)));
    } catch(e) {}

    renderSidebarLibrary("playlists");
    openPlaylist(customPl);

    showToast(`Loaded Spotify Playlist: ${pl.title} (${pl.trackCount} tracks)!`);

    if (target === "browser" || target === "all") {
      BrowserPlayer.playPlaylist(customPl);
    }
    if (target === "bot" || target === "all") {
      sendAction("play_now", cleanUrl, { targetChannel: "bot", immediate: true });
    }
  } catch (err) {
    console.error("Spotify link import error:", err);
    showToast("Network error importing Spotify playlist");
  }
}
window.importAndPlaySpotifyLink = importAndPlaySpotifyLink;


// ==========================================================================
// INDIVIDUAL USER TASTE PATTERN ENGINE & DAILY RECOMMENDATIONS (WEB & MOBILE)
// ==========================================================================
let userDailyRecommendations = {
  date: "",
  mixes: [],
  quickTiles: [],
  becauseYouLove: null
};
let userTasteProfile = null;
let lastLoadedRecommendationDate = "";
window.userDailyRecommendations = userDailyRecommendations;
window.userTasteProfile = userTasteProfile;

// Record real-time listening events to calibrate user's individual taste pattern
async function recordTrackTaste(track, eventType = "play") {
  if (!track || !track.title) return;
  const token = localStorage.getItem("ahm_session_token");
  
  // Track in local memory cache for guest fallback
  try {
    const raw = localStorage.getItem("ahm_guest_taste_events");
    const arr = raw ? JSON.parse(raw) : [];
    arr.unshift({ track: { title: track.title, artist: track.artist, genre: track.genre }, eventType, time: Date.now() });
    if (arr.length > 50) arr.length = 50;
    localStorage.setItem("ahm_guest_taste_events", JSON.stringify(arr));
  } catch (e) {}

  if (!token) return;
  try {
    await fetch("/api/user/taste/record", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ track, eventType })
    });
  } catch (e) {
    // Non-blocking background telemetry
  }
}
window.recordTrackTaste = recordTrackTaste;

// Load Today's Daily Recommendations (Refreshed everyday & tailored to individual customer)
async function loadDailyRecommendations(forceRefresh = false) {
  const syncBtn = document.getElementById("btnRefreshDailyTaste");
  if (syncBtn && forceRefresh) syncBtn.classList.add("spinning");

  try {
    const token = localStorage.getItem("ahm_session_token");
    const headers = token ? { "Authorization": `Bearer ${token}` } : {};
    const url = forceRefresh ? "/api/user/daily-recommendations?refresh=true" : "/api/user/daily-recommendations";
    const res = await fetch(url, { headers });
    const data = await res.json();

    if (data.success && data.recommendations) {
      userDailyRecommendations = data.recommendations;
      window.userDailyRecommendations = data.recommendations;
      lastLoadedRecommendationDate = data.recommendations.todayDate || data.recommendations.date || new Date().toISOString().slice(0, 10);
      if (data.tasteProfile) {
        userTasteProfile = data.tasteProfile;
        window.userTasteProfile = data.tasteProfile;
      }
      renderPersonalizedHomepage();
      if (forceRefresh) {
        showToast("Refreshed today's personalized taste mixes!");
      }
    }
  } catch (err) {
    console.warn("Could not load daily recommendations:", err);
  } finally {
    if (syncBtn) syncBtn.classList.remove("spinning");
  }
}
window.loadDailyRecommendations = loadDailyRecommendations;

// Master renderer for all personalized home sections
function renderPersonalizedHomepage() {
  renderDailyTasteBanner();
  renderHeroGrid();
  renderDailyTasteMixes();
  renderBecauseYouLove();
  updateSidebarTasteCard();
}

// 1. Personalized Daily Taste Banner
function renderDailyTasteBanner() {
  const badge = document.getElementById("tasteBannerBadge");
  const heading = document.getElementById("tasteBannerHeading");
  const sub = document.getElementById("tasteBannerSub");
  const authText = document.getElementById("btnBannerAuthText");

  const todayStr = userDailyRecommendations.todayDate || userDailyRecommendations.date || new Date().toLocaleDateString([], { month: "short", day: "numeric" });
  if (badge) {
    badge.textContent = `DAILY TASTE ENGINE • UPDATED TODAY (${todayStr})`;
  }

  const topG = (userTasteProfile?.topGenres || []).map(g => g.genre);
  const genreSummary = topG.length > 0 ? topG.slice(0, 3).join(", ") : "Bollywood, Romantic & Sufi";

  if (currentUser) {
    if (heading) heading.textContent = `Made For You, ${currentUser.displayName || currentUser.username}`;
    if (sub) sub.textContent = `Curated for ${todayStr} from your listening taste in ${genreSummary}`;
    if (authText) authText.textContent = "Account & Taste";
  } else {
    if (heading) heading.textContent = "Your Daily Music Taste Mix is Ready";
    if (sub) sub.textContent = `Curating today's rotation from ${genreSummary}. Log in to save your personal taste pattern!`;
    if (authText) authText.textContent = "Log In / Sign Up";
  }
}

// 2. Render 2x4 Quick Access Hero Grid (Personalized & updated everyday)
function renderHeroGrid() {
  const grid = document.getElementById("heroQuickGrid");
  if (!grid) return;
  grid.innerHTML = "";

  // Prioritize personalized tiles generated from customer's taste profile
  const tiles = (userDailyRecommendations.quickTiles && userDailyRecommendations.quickTiles.length === 8)
    ? userDailyRecommendations.quickTiles
    : [
        SPOTIFY_INDIAN_PLAYLISTS[0],
        SPOTIFY_INDIAN_PLAYLISTS[1],
        SPOTIFY_INDIAN_PLAYLISTS[2],
        SPOTIFY_INDIAN_PLAYLISTS[3],
        SPOTIFY_INDIAN_PLAYLISTS[4],
        SPOTIFY_INDIAN_PLAYLISTS[5],
        { id: "surah-55", name: "Surah Ar-Rahman", desc: "Mishary Alafasy", isSurah: 55, gradient: "linear-gradient(145deg, #1C2028 0%, #101217 100%)", emblem: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.9"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>' },
        SPOTIFY_INDIAN_PLAYLISTS[6]
      ];

  tiles.forEach(item => {
    const tile = document.createElement("div");
    tile.className = "hero-quick-card";
    const thumbContent = item.coverUrl
      ? `<img class="hero-quick-art" src="${escapeHtml(item.coverUrl)}" alt="${escapeHtml(item.name)}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"><div class="hero-quick-art" style="display:none; align-items:center; justify-content:center; background: var(--bg-card-elevated); color: var(--text-primary); border: 1px solid var(--border-subtle);">${item.emblem || DEFAULT_MUSIC_ICON}</div>`
      : `<div class="hero-quick-art" style="display:flex; align-items:center; justify-content:center; background: var(--bg-card-elevated); color: var(--text-primary); border: 1px solid var(--border-subtle);">${item.emblem || DEFAULT_MUSIC_ICON}</div>`;

    tile.innerHTML = `
      ${thumbContent}
      <span class="hero-quick-title">${escapeHtml(item.name)}</span>
      <button class="hero-quick-play" title="Play ${escapeHtml(item.name)}">
        <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
      </button>
    `;

    tile.addEventListener("click", (e) => {
      if (e.target.closest(".hero-quick-play")) {
        if (item.isSurah) {
          dispatchPlaySurah(item.isSurah);
        } else if (item.tracks && item.tracks.length > 0) {
          dispatchPlayPlaylist(item);
        } else {
          dispatchPlayPlaylist(item);
        }
      } else {
        if (item.isSurah) {
          dispatchPlaySurah(item.isSurah);
        } else {
          openPlaylist(item);
        }
      }
    });

    grid.appendChild(tile);
  });
}

// 3. Render Made For You • Daily Mixes Shelf
function renderDailyTasteMixes() {
  const grid = document.getElementById("gridDailyTasteMixes");
  if (!grid) return;
  grid.innerHTML = "";

  const mixes = userDailyRecommendations.dailyMixes || userDailyRecommendations.mixes || [];
  if (mixes.length === 0) {
    grid.innerHTML = `<div style="grid-column: 1/-1; padding: 20px; text-align: center; color: var(--text-subdued);">Generating today's personalized mixes...</div>`;
    return;
  }

  const titleBadge = document.getElementById("tasteMixesDateBadge");
  const todayVal = userDailyRecommendations.todayDate || userDailyRecommendations.date;
  if (titleBadge && todayVal) {
    titleBadge.textContent = `Updated Today (${todayVal}) • Tailored to You`;
  }

  mixes.forEach(mix => {
    const card = document.createElement("div");
    card.className = "spotify-card";
    card.innerHTML = `
      <div class="card-artwork">
        <span class="daily-mix-badge">${escapeHtml(mix.badge || "DAILY MIX")}</span>
        <img src="${escapeHtml(mix.coverUrl)}" alt="${escapeHtml(mix.name)}" loading="lazy" onerror="this.src='logo.png'">
        <button class="circle-play" title="Play ${escapeHtml(mix.name)}">
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        </button>
      </div>
      <span class="card-title">${escapeHtml(mix.name)}</span>
      <span class="card-desc">${escapeHtml(mix.desc || mix.description || (mix.tracks?.length + " curated tracks"))}</span>
    `;

    card.addEventListener("click", (e) => {
      if (e.target.closest(".circle-play")) {
        dispatchPlayPlaylist(mix);
      } else {
        openPlaylist(mix);
      }
    });

    grid.appendChild(card);
  });
  setTimeout(initShelfScrollButtons, 50);
}

// 4. Render "Because You Love [Artist / Genre]" Shelf
function renderBecauseYouLove() {
  const grid = document.getElementById("gridBecauseYouLove");
  const title = document.getElementById("becauseYouLoveTitle");
  const subtitle = document.getElementById("becauseYouLoveSubtitle");
  if (!grid) return;
  grid.innerHTML = "";

  const data = userDailyRecommendations.becauseYouLove;
  if (!data || !Array.isArray(data.tracks) || data.tracks.length === 0) {
    const sec = document.getElementById("sectionBecauseYouLove");
    if (sec) sec.style.display = "none";
    return;
  }

  const sec = document.getElementById("sectionBecauseYouLove");
  if (sec) sec.style.display = "block";

  if (title) title.textContent = data.title || `Because You Love ${data.artist || "Music"}`;
  if (subtitle) subtitle.textContent = data.subtitle || `Today's fresh selection tailored to your listening pattern`;

  data.tracks.forEach(track => {
    const card = document.createElement("div");
    card.className = "spotify-card";
    const artwork = track.artworkUrl || 'logo.png';
    card.innerHTML = `
      <div class="card-artwork">
        <span class="daily-mix-badge" style="color:#fff; background:rgba(0,0,0,0.75);">TODAY</span>
        <img src="${escapeHtml(artwork)}" alt="${escapeHtml(track.title)}" loading="lazy" onerror="this.src='logo.png'">
        <button class="circle-play" title="Play ${escapeHtml(track.title)}">
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        </button>
      </div>
      <span class="card-title">${escapeHtml(track.title)}</span>
      <span class="card-desc">${escapeHtml(track.artist || "Recommended Track")}</span>
    `;

    card.addEventListener("click", (e) => {
      const isLocal = isLocalChannel(activeSystemChannel);
      if (isLocal) {
        BrowserPlayer.playNow(track);
      }
      if (activeSystemChannel === "bot" || activeSystemChannel === "all") {
        sendAction("play_now", track.url, { targetChannel: "bot", immediate: true });
      }
    });

  });
  setTimeout(initShelfScrollButtons, 50);
}

// 5. Update Sidebar Taste Widget
function updateSidebarTasteCard() {
  const userTitle = document.getElementById("sidebarTasteUserTitle");
  const affinity = document.getElementById("sidebarTasteAffinity");
  if (!userTitle || !affinity) return;

  if (currentUser) {
    userTitle.textContent = `${currentUser.displayName || currentUser.username}'s Mix`;
  } else {
    userTitle.textContent = "Daily Music Taste";
  }

  if (userTasteProfile && userTasteProfile.topGenres && userTasteProfile.topGenres.length > 0) {
    const top2 = userTasteProfile.topGenres.slice(0, 2).map(g => g.genre).join(" • ");
    affinity.textContent = `Focused on ${top2}`;
  } else {
    affinity.textContent = "Updating daily from your listening taste";
  }
}

// ==========================================================================
// DAILY SPOTIFY TRENDING PLAYLISTS & CHARTS ENGINE
// ==========================================================================
let spotifyDailyTrending = {
  playlists: [],
  topTracks: [],
  lastUpdated: 0
};
window.spotifyDailyTrending = spotifyDailyTrending;

async function loadDailySpotifyTrending(forceRefresh = false) {
  const syncBtn = document.getElementById("btnRefreshSpotifyTrending");
  if (syncBtn && forceRefresh) syncBtn.classList.add("spinning");

  try {
    const endpoint = forceRefresh ? "/api/spotify-trending/refresh" : "/api/spotify-trending";
    const res = await fetch(endpoint, { method: forceRefresh ? "POST" : "GET" });
    const data = await res.json();
    if (data.success && Array.isArray(data.playlists) && data.playlists.length > 0) {
      spotifyDailyTrending = data;
      window.spotifyDailyTrending = data;
      renderDailyTrendingSpotify();
      renderHotTracksPills();
      renderSpotifyRadioStations();
      updateTrendingMetaBadge();
      renderSidebarLibrary("playlists");
      if (forceRefresh) {
        showToast("Latest Spotify trending playlists synced");
      }
    }
  } catch (err) {
    console.warn("Could not load daily Spotify trending:", err);
  } finally {
    if (syncBtn) syncBtn.classList.remove("spinning");
  }
}

function updateTrendingMetaBadge() {
  const badge = document.getElementById("spotifyTrendingMetaBadge");
  if (!badge) return;
  if (!spotifyDailyTrending.lastUpdated) {
    badge.textContent = "Spotify India Charts";
    return;
  }
  const dateStr = new Date(spotifyDailyTrending.lastUpdated).toLocaleDateString([], {
    month: "short",
    day: "numeric"
  });
  badge.textContent = `Updated Today (${dateStr}) • Spotify India`;
}

function renderDailyTrendingSpotify() {
  const grid = document.getElementById("gridDailyTrendingSpotify");
  if (!grid) return;
  grid.innerHTML = "";

  const playlists = spotifyDailyTrending.playlists || [];
  if (playlists.length === 0) {
    grid.innerHTML = `<div style="grid-column: 1/-1; padding: 24px; text-align: center; color: var(--text-subdued);">
      <span>Loading daily trending playlists from Spotify...</span>
    </div>`;
    return;
  }

  playlists.forEach(pl => {
    const card = document.createElement("div");
    card.className = "spotify-card";
    card.innerHTML = `
      <div class="card-artwork">
        <span class="card-top-badge">${escapeHtml(pl.badge || "Trending")}</span>
        <img src="${escapeHtml(pl.coverUrl)}" alt="${escapeHtml(pl.name)}" loading="lazy" onerror="this.src='logo.png'">
        <button class="circle-play" title="Play ${escapeHtml(pl.name)}">
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        </button>
      </div>
      <span class="card-title">${escapeHtml(pl.name)}</span>
      <span class="card-desc">${escapeHtml(pl.description || (pl.trackCount + " songs"))}</span>
    `;

    card.addEventListener("click", (e) => {
      if (e.target.closest(".circle-play")) {
        dispatchPlayPlaylist(pl);
      } else {
        openPlaylist(pl);
      }
    });

    grid.appendChild(card);
  });
  setTimeout(initShelfScrollButtons, 50);
}

const CURATED_RADIO_STATIONS = [
  {
    id: "radio_arijit",
    name: "Arijit Singh Radio",
    seedTitle: "Kesariya",
    seedArtist: "Arijit Singh",
    coverUrl: "https://c.saavncdn.com/artists/Arijit_Singh_002_20230323062147_500x500.jpg",
    desc: "Infinite soul melodies & chartbusters with Arijit Singh & friends",
    badge: "📻 Radio"
  },
  {
    id: "radio_atif",
    name: "Atif Aslam Radio",
    seedTitle: "Dil Diyan Gallan",
    seedArtist: "Atif Aslam",
    coverUrl: "https://c.saavncdn.com/artists/Atif_Aslam_500x500.jpg",
    desc: "Soulful romantic anthems & timeless nostalgic classics",
    badge: "📻 Radio"
  },
  {
    id: "radio_shreya",
    name: "Shreya Ghoshal Radio",
    seedTitle: "Deewani Mastani",
    seedArtist: "Shreya Ghoshal",
    coverUrl: "https://c.saavncdn.com/artists/Shreya_Ghoshal_500x500.jpg",
    desc: "Golden melodies with Shreya Ghoshal, Sunidhi Chauhan & Alka Yagnik",
    badge: "📻 Radio"
  },
  {
    id: "radio_pritam",
    name: "Pritam Hitmaker Radio",
    seedTitle: "Subhanallah",
    seedArtist: "Pritam",
    coverUrl: "https://c.saavncdn.com/artists/Pritam_500x500.jpg",
    desc: "Continuous Bollywood blockbuster hits composed by Pritam",
    badge: "📻 Hitmaker"
  },
  {
    id: "radio_lofi",
    name: "Lo-Fi Chill & Focus Radio",
    seedTitle: "Coffee Lofi Chill",
    seedArtist: "Lofi Beats",
    coverUrl: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=500&q=80",
    desc: "24/7 continuous relaxing beats for focus, work, coding & late nights",
    badge: "📻 Chill"
  },
  {
    id: "radio_bollywood_romance",
    name: "Bollywood Romance Radio",
    seedTitle: "Tum Hi Ho",
    seedArtist: "Mithoon",
    coverUrl: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&q=80",
    desc: "Unstoppable romantic stream of Indian cinema's greatest love hits",
    badge: "📻 Romance"
  },
  {
    id: "radio_punjabi",
    name: "Punjabi Banger Radio",
    seedTitle: "Softly",
    seedArtist: "Karan Aujla",
    coverUrl: "https://c.saavncdn.com/artists/Karan_Aujla_500x500.jpg",
    desc: "High energy Punjabi hip hop, beats, and basslines",
    badge: "📻 Banger"
  },
  {
    id: "radio_global_hits",
    name: "Global Top Hits Radio",
    seedTitle: "Blinding Lights",
    seedArtist: "The Weeknd",
    coverUrl: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=500&q=80",
    desc: "Worldwide Spotify & Billboard chart-toppers on continuous repeat",
    badge: "📻 Global"
  }
];

function renderSpotifyRadioStations() {
  const grid = document.getElementById("gridSpotifyRadioStations");
  if (!grid) return;
  grid.innerHTML = "";

  CURATED_RADIO_STATIONS.forEach(station => {
    const card = document.createElement("div");
    card.className = "spotify-card";
    card.innerHTML = `
      <div class="card-artwork">
        <span class="card-top-badge" style="background: rgba(30, 215, 96, 0.95); color: #000; font-weight: 800;">${escapeHtml(station.badge)}</span>
        <img src="${escapeHtml(station.coverUrl)}" alt="${escapeHtml(station.name)}" loading="lazy" onerror="this.src='logo.png'">
        <button class="circle-play" title="Tune in to ${escapeHtml(station.name)}">
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        </button>
      </div>
      <span class="card-title">${escapeHtml(station.name)}</span>
      <span class="card-desc">${escapeHtml(station.desc)}</span>
    `;

    card.addEventListener("click", () => {
      BrowserPlayer.startRadioForTrack({
        title: station.seedTitle,
        author: station.seedArtist,
        artworkUrl: station.coverUrl
      });
      if (typeof openExpandedPlayer === "function") {
        openExpandedPlayer();
      }
    });

    grid.appendChild(card);
  });
  setTimeout(initShelfScrollButtons, 50);
}


function renderHotTracksPills() {
  const grid = document.getElementById("gridTrendingTracksPills");
  if (!grid) return;
  grid.innerHTML = "";

  const tracks = (spotifyDailyTrending.topTracks || []).slice(0, 12);
  if (tracks.length === 0) {
    const section = document.getElementById("sectionTrendingTracksRow");
    if (section) section.style.display = "none";
    return;
  }
  const section = document.getElementById("sectionTrendingTracksRow");
  if (section) section.style.display = "block";

  tracks.forEach((t, idx) => {
    const pill = document.createElement("div");
    pill.className = "hot-track-pill";
    pill.innerHTML = `
      <span class="hot-track-rank">#${idx + 1}</span>
      <img class="hot-track-cover" src="${escapeHtml(t.artworkUrl || t.playlistCover || 'logo.png')}" alt="Cover" onerror="this.src='logo.png'">
      <div class="hot-track-info">
        <span class="hot-track-title">${escapeHtml(t.title)}</span>
        <span class="hot-track-artist">${escapeHtml(t.artist)}</span>
      </div>
      <div class="hot-track-actions">
        <span class="hot-track-duration">${escapeHtml(t.duration || '3:30')}</span>
        <button class="hot-track-play" title="Play Now">
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        </button>
      </div>
    `;

    pill.addEventListener("click", () => {
      dispatchPlayNow(t.query, "filterless");
    });

    grid.appendChild(pill);
  });
  setTimeout(initShelfScrollButtons, 50);
}

// Render Trending Indian Playlists Shelf
function renderPlaylistsGrid() {
  const grid = document.getElementById("gridIndianPlaylists");
  if (!grid) return;
  grid.innerHTML = "";

  SPOTIFY_INDIAN_PLAYLISTS.forEach(pl => {
    const card = document.createElement("div");
    card.className = "spotify-card";
    const artworkHtml = pl.coverUrl
      ? `<img src="${escapeHtml(pl.coverUrl)}" alt="${escapeHtml(pl.name)}" loading="lazy" style="width: 100%; height: 100%; object-fit: cover; border-radius: 6px;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"><div style="display:none; align-items:center; justify-content:center; width:100%; height:100%; font-size:48px;">${pl.emblem}</div>`
      : `<div style="display:flex; align-items:center; justify-content:center; width:100%; height:100%; font-size:48px;">${pl.emblem}</div>`;

    card.innerHTML = `
      <div class="card-artwork" style="background: ${pl.gradient || '#282828'};">
        <span class="card-top-badge">${escapeHtml(pl.badge || "Indian Curated")}</span>
        ${artworkHtml}
        <button class="circle-play" title="Play ${escapeHtml(pl.name)}">
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        </button>
      </div>
      <span class="card-title">${escapeHtml(pl.name)}</span>
      <span class="card-desc">${escapeHtml(pl.desc)}</span>
    `;

    card.addEventListener("click", (e) => {
      if (e.target.closest(".circle-play")) {
        dispatchPlayPlaylist(pl);
      } else {
        openPlaylist(pl.id);
      }
    });

    grid.appendChild(card);
  });
  setTimeout(initShelfScrollButtons, 50);
}

// Render Featured Quran Recitations Shelf
function renderFeaturedQuran() {
  const grid = document.getElementById("gridFeaturedQuran");
  if (!grid) return;
  grid.innerHTML = "";

  const featured = [
    { num: 1, name: "Al-Fatihah", ayahs: 7, desc: "The Opener" },
    { num: 36, name: "Ya-Sin", ayahs: 83, desc: "Heart of the Quran" },
    { num: 55, name: "Ar-Rahman", ayahs: 78, desc: "The Most Merciful" },
    { num: 56, name: "Al-Waqi'ah", ayahs: 96, desc: "The Inevitable" },
    { num: 67, name: "Al-Mulk", ayahs: 30, desc: "The Sovereignty" },
    { num: 112, name: "Al-Ikhlas", ayahs: 4, desc: "Sincerity / Oneness" }
  ];

  featured.forEach(s => {
    const card = document.createElement("div");
    card.className = "spotify-card";
    card.innerHTML = `
      <div class="card-artwork" style="background: linear-gradient(145deg, var(--bg-card-elevated) 0%, var(--bg-surface) 100%); border: 1px solid var(--border-subtle); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-primary);"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>
        <span style="font-size: 11px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em;">Surah ${s.num}</span>
        <button class="circle-play" title="Play Surah ${s.name}">
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        </button>
      </div>
      <span class="card-title">Surah ${s.name}</span>
      <span class="card-desc">${s.desc} • Mishary Alafasy</span>
    `;

    card.addEventListener("click", () => {
      dispatchPlaySurah(s.num);
    });

    grid.appendChild(card);
  });
  setTimeout(initShelfScrollButtons, 50);
}

// Render Islamic Status & Vibes Shelf
function renderIslamicVibes() {
  const grid = document.getElementById("gridIslamicVibes");
  if (!grid) return;
  grid.innerHTML = "";

  ISLAMIC_VIBES_ITEMS.forEach(item => {
    const card = document.createElement("div");
    card.className = "spotify-card";
    card.innerHTML = `
      <div class="card-artwork" style="background: linear-gradient(145deg, var(--bg-card-elevated) 0%, var(--bg-surface) 100%); border: 1px solid var(--border-subtle); display: flex; align-items: center; justify-content: center;">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-primary);"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
        <button class="circle-play" title="Play ${item.title}">
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        </button>
      </div>
      <span class="card-title">${item.title}</span>
      <span class="card-desc">${item.artist} • ${item.badge}</span>
    `;

    card.addEventListener("click", () => {
      dispatchPlayTrack(item.query, "strict");
    });

    grid.appendChild(card);
  });
  setTimeout(initShelfScrollButtons, 50);
}

// Render All 114 Surahs on Quran View
function renderAll114Surahs(filter = "") {
  const grid = document.getElementById("gridAll114Surahs");
  if (!grid) return;
  grid.innerHTML = "";

  const cleanFilter = filter.toLowerCase().trim();

  for (let i = 1; i <= 114; i++) {
    const sName = SURAH_NAMES[i] || `Surah ${i}`;
    if (cleanFilter && !sName.toLowerCase().includes(cleanFilter) && !String(i).includes(cleanFilter)) {
      continue;
    }

    const card = document.createElement("div");
    card.className = "spotify-card";
    card.innerHTML = `
      <div class="card-artwork" style="background: linear-gradient(135deg, #1f2937 0%, #111827 100%); display: flex; flex-direction: column; align-items: center; justify-content: center; border: 1px solid rgba(255, 255, 255, 0.08);">
        <span style="font-size: 22px; color: #1ed760; font-weight: 800;">${i}</span>
        <button class="circle-play" title="Play Surah ${i}">
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        </button>
      </div>
      <span class="card-title">Surah ${i}: ${sName}</span>
      <span class="card-desc">Mishary Rashid Alafasy</span>
    `;

    card.addEventListener("click", () => {
      dispatchPlaySurah(i);
    });

    grid.appendChild(card);
  }
}

// Render Sidebar Library List
function renderSidebarLibrary(filter = "all") {
  const list = document.getElementById("sidebarLibraryList");
  if (!list) return;
  list.innerHTML = "";

  if (filter === "all" || filter === "playlists") {
    // Render Daily Imported Spotify Trending Playlists
    (window.spotifyDailyTrending?.playlists || []).forEach(pl => {
      const item = document.createElement("div");
      item.className = "library-item";
      item.innerHTML = `
        <div class="item-thumb" style="display:flex; align-items:center; justify-content:center; overflow:hidden;">
          <img src="${escapeHtml(pl.coverUrl)}" style="width:100%;height:100%;border-radius:4px;object-fit:cover;" onerror="this.src='logo.png'">
        </div>
        <div class="item-info">
          <span class="item-title">${escapeHtml(pl.name)}</span>
          <span class="item-subtitle">${escapeHtml(pl.badge || "Trending")} • ${pl.trackCount} songs</span>
        </div>
      `;
      item.addEventListener("click", () => openPlaylist(pl));
      list.appendChild(item);
    });

    // Render custom imported Spotify playlists
    customPlaylists.forEach(pl => {
      const item = document.createElement("div");
      item.className = "library-item";
      item.innerHTML = `
        <div class="item-thumb">
          ${pl.coverUrl ? `<img src="${pl.coverUrl}" style="width:100%;height:100%;border-radius:4px;object-fit:cover;">` : DEFAULT_MUSIC_ICON}
        </div>
        <div class="item-info">
          <span class="item-title">${pl.name}</span>
          <span class="item-subtitle">Spotify Import • ${pl.tracksCount} songs</span>
        </div>
      `;
      item.addEventListener("click", () => openPlaylist(pl));
      list.appendChild(item);
    });

    SPOTIFY_INDIAN_PLAYLISTS.forEach(pl => {
      const item = document.createElement("div");
      item.className = "library-item";
      item.innerHTML = `
        <div class="item-thumb">
          ${pl.coverUrl ? `<img src="${pl.coverUrl}" style="width:100%;height:100%;border-radius:4px;object-fit:cover;">` : DEFAULT_MUSIC_ICON}
        </div>
        <div class="item-info">
          <span class="item-title">${pl.name}</span>
          <span class="item-subtitle">Playlist • ${pl.tracksCount} songs</span>
        </div>
      `;
      item.addEventListener("click", () => openPlaylist(pl.id));
      list.appendChild(item);
    });
  }

  if (filter === "all" || filter === "surahs") {
    [1, 36, 55, 67, 112].forEach(sNum => {
      const sName = SURAH_NAMES[sNum];
      const item = document.createElement("div");
      item.className = "library-item";
      item.innerHTML = `
        <div class="item-thumb" style="color: var(--text-primary);">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
        </div>
        <div class="item-info">
          <span class="item-title">Surah ${sNum}: ${sName}</span>
          <span class="item-subtitle">Sacred Quran • Alafasy</span>
        </div>
      `;
      item.addEventListener("click", () => dispatchPlaySurah(sNum));
      list.appendChild(item);
    });
  }

  if (filter === "all" || filter === "queue") {
    const queueList = BrowserPlayer.queue;
    if (filter === "queue") {
      if (queueList.length === 0) {
        const emptyItem = document.createElement("div");
        emptyItem.style.padding = "16px 10px";
        emptyItem.style.color = "var(--text-tertiary)";
        emptyItem.style.fontSize = "0.82rem";
        emptyItem.style.textAlign = "center";
        emptyItem.innerHTML = `No tracks in queue.<br><span style="color:var(--text-primary);cursor:pointer;margin-top:6px;display:inline-block;text-decoration:underline;" onclick="switchView('search')">Search songs to enqueue</span>`;
        list.appendChild(emptyItem);
      } else {
        queueList.forEach((t, i) => {
          const item = document.createElement("div");
          item.className = "library-item";
          item.innerHTML = `
            <div class="item-thumb">
              <img src="${t.artworkUrl || 'logo.png'}" style="width:100%;height:100%;border-radius:4px;object-fit:cover;">
            </div>
            <div class="item-info">
              <span class="item-title">${escapeHtml(t.title)}</span>
              <span class="item-subtitle">${escapeHtml(t.author || 'Artist')} • ${formatTime(t.duration)}</span>
            </div>
          `;
          item.addEventListener("click", () => {
            window.skipToBrowserQueueIndex(i);
          });
          list.appendChild(item);
        });
      }
    }
  }
}

// Universal Queue Badges Synchronizer
function updateAllQueueBadges() {
  const isLocal = isLocalChannel(activeSystemChannel);
  const queue = isLocal ? BrowserPlayer.queue : (currentState?.channels?.bot?.queue || currentState?.queue || []);
  const count = Array.isArray(queue) ? queue.length : 0;

  const bHome = document.getElementById("homeQueueBadge");
  if (bHome) {
    bHome.textContent = count;
    bHome.style.display = count > 0 ? "inline-flex" : "none";
  }
  const bTop = document.getElementById("topQueueBadge");
  if (bTop) {
    bTop.textContent = count;
    bTop.style.display = count > 0 ? "inline-flex" : "none";
  }
  const bSide = document.getElementById("sidebarQueueBadge");
  if (bSide) {
    bSide.textContent = count;
    bSide.style.display = count > 0 ? "inline-flex" : "none";
  }
}
window.updateAllQueueBadges = updateAllQueueBadges;

// Render Queue & History View
function renderQueueView() {
  updateAllQueueBadges();
  const tbody = document.getElementById("queueTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const isLocal = isLocalChannel(activeSystemChannel);
  const queue = isLocal ? BrowserPlayer.queue : (currentState?.channels?.bot?.queue || currentState?.queue || []);
  const history = isLocal ? BrowserPlayer.history : (currentState?.channels?.bot?.history || currentState?.history || []);

  // Update Now Playing card in Queue view
  const currentTrack = isLocal ? BrowserPlayer.currentTrack : (currentState?.channels?.bot?.current || currentState?.current);
  const nowCard = document.getElementById("queueNowPlayingCard");
  const nowArt = document.getElementById("queueNowPlayingArt");
  const nowTitle = document.getElementById("queueNowPlayingTitle");
  const nowAuthor = document.getElementById("queueNowPlayingAuthor");
  const nowTime = document.getElementById("queueNowPlayingTime");

  if (nowCard) {
    if (currentTrack) {
      nowCard.style.display = "block";
      if (nowArt) nowArt.src = currentTrack.artworkUrl || "logo.png";
      if (nowTitle) nowTitle.textContent = currentTrack.title || "Unknown Title";
      if (nowAuthor) nowAuthor.textContent = currentTrack.author || currentTrack.artist || "Unknown Artist";
      if (nowTime) nowTime.textContent = formatTime(currentTrack.duration);
    } else {
      nowCard.style.display = "none";
    }
  }

  // Update Section Header and Counter Badge
  const headerEl = document.getElementById("queueSectionHeader");
  const countBadge = document.getElementById("queueCountBadge");
  const clearBtn = document.getElementById("btnClearBrowserQueue");
  const radioBanner = document.getElementById("queueRadioStationBanner");
  const radioSub = document.getElementById("queueRadioStationSub");
  const radioTitle = document.getElementById("queueRadioStationTitle");
  const btnToggleAuto = document.getElementById("btnToggleAutoplay");

  // Sync Autoplay Toggle Button state
  if (btnToggleAuto) {
    btnToggleAuto.classList.toggle("active", BrowserPlayer.autoplayRadioEnabled);
    const txt = btnToggleAuto.querySelector("span:not(.radio-pulse-dot)");
    if (txt) txt.textContent = `Autoplay Radio: ${BrowserPlayer.autoplayRadioEnabled ? "On" : "Off"}`;
  }

  // Display Spotify Infinite Radio Banner when active
  const hasRadioTracks = currentTab === "queue" && (BrowserPlayer.isRadioActive || queue.some(t => t.isRadio));
  if (radioBanner) {
    if (hasRadioTracks) {
      radioBanner.style.display = "flex";
      if (radioTitle) {
        const seed = BrowserPlayer.activeRadioSeed || (BrowserPlayer.history.length > 0 ? BrowserPlayer.history[BrowserPlayer.history.length - 1] : null);
        radioTitle.textContent = `Playing songs related to "${seed?.title || "your music"}"`;
      }
      if (radioSub) {
        const count = queue.filter(t => t.isRadio).length;
        radioSub.textContent = `Infinite Stream • ${count} queued`;
      }
    } else {
      radioBanner.style.display = "none";
    }
  }

  const list = currentTab === "queue" ? queue : history;

  if (headerEl) {
    headerEl.textContent = currentTab === "queue" ? (hasRadioTracks ? "📻 Next in Radio Queue" : "Next in Queue") : "Recently Played";
  }
  if (countBadge) {
    countBadge.textContent = `${list.length} track${list.length === 1 ? "" : "s"}`;
  }
  if (clearBtn) {
    clearBtn.style.display = (isLocal && currentTab === "queue" && queue.length > 0) ? "inline-flex" : "none";
  }

  if (list.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; color: var(--text-subdued); padding: 48px 16px;">
          <div style="display:flex; justify-content:center; margin-bottom: 12px;">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.4;">
              <line x1="8" y1="6" x2="21" y2="6"></line>
              <line x1="8" y1="12" x2="21" y2="12"></line>
              <line x1="8" y1="18" x2="21" y2="18"></line>
              <line x1="3" y1="6" x2="3.01" y2="6"></line>
              <line x1="3" y1="12" x2="3.01" y2="12"></line>
              <line x1="3" y1="18" x2="3.01" y2="18"></line>
            </svg>
          </div>
          <div style="font-size: 1rem; color: var(--text-header); font-weight: 600; margin-bottom: 4px;">
            ${currentTab === "queue" ? "Your queue is empty" : "No recently played tracks"}
          </div>
          <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 14px;">
            ${currentTab === "queue" ? "Autoplay is active. When songs finish, continuous radio connects automatically." : "Tracks you play will appear here."}
          </div>
          ${currentTab === "queue" ? `
            <button type="button" class="btn-play-now-pill" onclick="switchView('search')" style="margin: 0 auto; display: inline-flex; align-items: center; gap: 6px;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <span>Browse & Add Songs</span>
            </button>
          ` : ""}
        </td>
      </tr>
    `;
    return;
  }

  list.forEach((t, i) => {
    const tr = document.createElement("tr");
    tr.className = "song-row";
    const title = t.title || t.info?.title || "Unknown Track";
    const author = t.author || t.artist || t.info?.author || "Artist";
    const dur = t.duration || t.info?.duration || 0;
    const art = t.artworkUrl || t.info?.artworkUrl || "logo.png";
    const isRadioTrack = Boolean(t.isRadio);

    tr.innerHTML = `
      <td class="td-num">${i + 1}</td>
      <td>
        <div class="song-info-cell">
          <img class="song-cell-art" src="${art}" alt="Track Art">
          <div class="song-title-group">
            <span class="song-title">
              ${escapeHtml(title)}
              ${isRadioTrack ? '<span class="badge-radio-tag" title="Auto-recommended continuous track">📻 Radio</span>' : ''}
            </span>
            <span class="song-artist">${escapeHtml(author)}</span>
          </div>
        </div>
      </td>
      <td class="song-album-cell">
        <div style="display: flex; gap: 8px; align-items: center;">
          ${currentTab === "queue" ? `
            <button class="btn-play-now-mini btn-queue-play" title="Play track now">▶ Play</button>
            ${isLocal ? `<button class="btn-queue-remove" title="Remove from queue" style="background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.3); color:#fca5a5; cursor:pointer; font-size:12px; border-radius:4px; padding:3px 8px;">✕</button>` : ""}
          ` : `
            <button class="btn-play-now-mini btn-queue-play" title="Play again">▶ Play</button>
            <button class="btn-play-now-mini btn-start-track-radio" title="Start continuous radio based on this track" style="background: rgba(30,215,96,0.14); border: 1px solid rgba(30,215,96,0.3); color: var(--emerald, #1ed760);">📻 Radio</button>
          `}
        </div>
      </td>
      <td class="song-time-cell">${formatTime(dur)}</td>
    `;

    tr.querySelector(".btn-start-track-radio")?.addEventListener("click", (e) => {
      e.stopPropagation();
      BrowserPlayer.startRadioForTrack(t);
    });

    tr.querySelector(".btn-queue-play")?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (isLocal && currentTab === "queue") {
        window.skipToBrowserQueueIndex(i);
      } else if (!isLocal && currentTab === "queue") {
        sendAction("play_queue_index", i, { targetChannel: "bot" });
      } else {
        dispatchPlayNow(t);
      }
    });

    tr.querySelector(".btn-queue-remove")?.addEventListener("click", (e) => {
      e.stopPropagation();
      window.removeFromBrowserQueue(i);
    });

    tr.addEventListener("click", () => {
      if (isLocal && currentTab === "queue") {
        window.skipToBrowserQueueIndex(i);
      } else if (!isLocal && currentTab === "queue") {
        sendAction("play_queue_index", i, { targetChannel: "bot" });
      } else {
        dispatchPlayNow(t);
      }
    });

    tbody.appendChild(tr);
  });
}

window.skipToBrowserQueueIndex = function(idx) {
  if (BrowserPlayer.queue.length > idx) {
    const target = BrowserPlayer.queue.splice(idx, 1)[0];
    if (BrowserPlayer.currentTrack) BrowserPlayer.history.push(BrowserPlayer.currentTrack);
    BrowserPlayer.playTrack(target);
    renderQueueView();
    renderSidebarLibrary("queue");
    if (typeof saveUserQueue === "function") saveUserQueue();
  }
};

window.removeFromBrowserQueue = function(idx) {
  if (BrowserPlayer.queue.length > idx) {
    const removed = BrowserPlayer.queue.splice(idx, 1)[0];
    showToast(`Removed from queue: ${removed.title}`);
    renderQueueView();
    renderSidebarLibrary("queue");
    if (typeof saveUserQueue === "function") saveUserQueue();
  }
};

window.clearBrowserQueue = function() {
  BrowserPlayer.queue = [];
  try {
    localStorage.removeItem("ahm_browser_queue");
  } catch(e) {}
  showToast("Cleared browser queue");
  renderQueueView();
  renderSidebarLibrary("queue");
  if (typeof saveUserQueue === "function") saveUserQueue();
};

// Render Search Genres
function renderSearchGenres() {
  const grid = document.getElementById("gridSearchGenres");
  if (!grid) return;
  grid.innerHTML = "";

  const genres = [
    { name: "Bollywood", query: "trending bollywood songs" },
    { name: "Punjabi 101", query: "punjabi top hits" },
    { name: "Arijit Singh", query: "arijit singh best songs" },
    { name: "Atif Aslam", query: "atif aslam hits" },
    { name: "Sufi & Qawwali", query: "sufi qawwali nusrat fateh ali khan" },
    { name: "Indie India", query: "indie india anuv jain" },
    { name: "South Hits", query: "anirudh ravichander songs" },
    { name: "Holy Quran", query: "surah ar rahman mishary" }
  ];

  genres.forEach(g => {
    const card = document.createElement("div");
    card.className = "genre-card";
    card.innerHTML = `
      <div style="display: flex; flex-direction: column; justify-content: space-between; height: 100%;">
        <span class="genre-card-title">${g.name}</span>
        <span style="font-size: 0.75rem; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.06em;">Explore</span>
      </div>
    `;
    card.addEventListener("click", () => {
      const searchInput = document.getElementById("masterSearchInput");
      if (searchInput) {
        searchInput.value = g.name;
        handleSearch(g.query);
      }
    });
    grid.appendChild(card);
  });
}

// ==========================================================================
// CENTRAL AUDIO DISPATCHER (ROUTES TO ACTIVE SYSTEM CHANNEL)
// ==========================================================================
// ==========================================================================
// CENTRAL AUDIO DISPATCHER (ROUTES TO ACTIVE SYSTEM CHANNEL)
// ==========================================================================
function dispatchPlayTrack(queryOrTrack, filterMode = currentFilterMode, immediate = true) {
  const isObj = typeof queryOrTrack === "object" && queryOrTrack !== null;
  const rawStr = isObj ? `${queryOrTrack.title || ""} ${queryOrTrack.author || queryOrTrack.artist || ""}`.trim() : String(queryOrTrack || "").trim();
  const cleanedStr = rawStr.replace(/^(!|\/)?(playnow|play-now|play\s+now|pn|play|now)\s+/i, "").trim();

  // If a raw string is a Spotify URL, redirect to full Spotify playlist/track import & play
  if (!isObj && isSpotifyUrl(cleanedStr)) {
    return importAndPlaySpotifyLink(cleanedStr, activeSystemChannel);
  }

  const isLocalPlayer = activeSystemChannel === "browser" || activeSystemChannel === "app" || activeSystemChannel === "all";

  if (isLocalPlayer) {
    if (isObj) {
      if (immediate) {
        BrowserPlayer.playNow(queryOrTrack, filterMode);
      } else {
        BrowserPlayer.enqueue(queryOrTrack, filterMode);
      }
    } else {
      BrowserPlayer.playQuery(cleanedStr, filterMode, immediate);
    }
  }

  if (activeSystemChannel === "bot" || activeSystemChannel === "all") {
    sendAction(immediate ? "play_now" : "play_query", cleanedStr, { targetChannel: "bot", filterMode, immediate });
  } else if (!isLocalPlayer) {
    sendAction(immediate ? "play_now" : "play_query", cleanedStr, { targetChannel: activeSystemChannel, filterMode, immediate });
  }
}

function dispatchPlayNow(queryOrTrack, filterMode = currentFilterMode) {
  const displayTitle = (typeof queryOrTrack === "object" && queryOrTrack !== null)
    ? queryOrTrack.title
    : String(queryOrTrack || "").replace(/^(!|\/)?(playnow|play-now|play\s+now|pn|play|now)\s+/i, "").trim();
  dispatchPlayTrack(queryOrTrack, filterMode, true);
  showToast(`Playing Now: ${displayTitle}`);
}

function dispatchEnqueue(queryOrTrack, filterMode = currentFilterMode) {
  const displayTitle = (typeof queryOrTrack === "object" && queryOrTrack !== null)
    ? queryOrTrack.title
    : String(queryOrTrack || "").replace(/^(!|\/)?(playnow|play-now|play\s+now|pn|play|now)\s+/i, "").trim();
  dispatchPlayTrack(queryOrTrack, filterMode, false);
  showToast(`Queued: ${displayTitle}`);
}

window.dispatchPlayNow = dispatchPlayNow;
window.dispatchEnqueue = dispatchEnqueue;

function dispatchPlaySurah(surahNum, immediate = true) {
  const isLocalPlayer = activeSystemChannel === "browser" || activeSystemChannel === "app" || activeSystemChannel === "all";
  if (isLocalPlayer) {
    BrowserPlayer.playSurah(surahNum, immediate);
  }
  if (activeSystemChannel === "bot" || activeSystemChannel === "all") {
    sendAction(immediate ? "play_now" : "play_surah", surahNum, { targetChannel: "bot", immediate });
  } else if (!isLocalPlayer) {
    sendAction(immediate ? "play_now" : "play_surah", surahNum, { targetChannel: activeSystemChannel, immediate });
  }
}

function dispatchPlayPlaylist(playlist, immediate = true) {
  const isLocalPlayer = activeSystemChannel === "browser" || activeSystemChannel === "app" || activeSystemChannel === "all";
  if (isLocalPlayer) {
    BrowserPlayer.playPlaylist(playlist);
  }
  if (activeSystemChannel === "bot" || activeSystemChannel === "all") {
    sendAction("play_playlist", null, {
      targetChannel: "bot",
      name: playlist.name,
      immediate,
      tracks: (playlist.tracks || []).map(t => `${t.title} ${t.artist}`)
    });
  } else if (!isLocalPlayer) {
    sendAction("play_playlist", null, {
      targetChannel: activeSystemChannel,
      name: playlist.name,
      immediate,
      tracks: (playlist.tracks || []).map(t => `${t.title} ${t.artist}`)
    });
  }
}

// ==========================================================================
// FAST MULTI-RESULT SEARCH ENGINE WITH ABORT CONTROLLER (Tracks & Playlists)
// ==========================================================================
let searchAbortController = null;
let searchDebounceTimer = null;

async function playSearchPlaylist(pl, immediate = true) {
  showToast(`▶ Loading: ${pl.title}...`);
  const targetUrl = pl.url || "";
  const targetId = pl.id || pl.rawId || "";
  let tracks = [];
  let playlistData = null;

  // 1. Primary: Remote API endpoint
  try {
    const res = await fetch(`/api/playlist-details?url=${encodeURIComponent(targetUrl)}&id=${encodeURIComponent(targetId)}`);
    const data = await res.json();
    if (data.success && data.playlist && data.playlist.tracks?.length) {
      playlistData = data.playlist;
      tracks = data.playlist.tracks;
    }
  } catch (err) {
    console.warn("[playSearchPlaylist] Primary resolver note:", err);
  }

  // 2. Secondary Fallback: Direct JioSaavn API query from client if remote API returned empty or errored
  if (tracks.length === 0 && (pl.source === "jiosaavn" || targetId.includes("saavn_") || targetUrl.includes("jiosaavn.com"))) {
    try {
      const rawParam = targetId.replace("saavn_pl_", "").replace("saavn_alb_", "") || targetUrl.split("/").filter(Boolean).pop();
      let d = null;
      if (pl.isAlbum || targetId.startsWith("saavn_alb_") || targetUrl.includes("/album/")) {
        const albUrl = `https://www.jiosaavn.com/api.php?__call=content.getAlbumDetails&_format=json&_marker=0&api_version=4&ctx=web6dot0&albumid=${encodeURIComponent(rawParam)}`;
        const r = await fetch(albUrl);
        d = await r.json();
      } else {
        const plUrl = `https://www.jiosaavn.com/api.php?__call=playlist.getDetails&_format=json&_marker=0&api_version=4&ctx=web6dot0&listid=${encodeURIComponent(rawParam)}`;
        const r = await fetch(plUrl);
        d = await r.json();
      }
      const list = (d && (d.list || d.songs)) || [];
      if (list.length > 0) {
        tracks = list.map(s => {
          const cleanTitle = (s.title || "").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'");
          const artistNames = s.more_info?.artistMap?.primary_artists?.map(a => a.name).join(", ") || s.subtitle || s.artist || pl.author || "Artist";
          const artwork = (s.image || "").replace("150x150", "500x500") || pl.artworkUrl || "logo.png";
          return {
            id: `saavn_${s.id}`,
            title: cleanTitle,
            artist: artistNames,
            duration: Math.round(parseFloat(s.more_info?.duration || 0) * 1000),
            artworkUrl: artwork,
            url: s.perma_url || `https://www.jiosaavn.com/song/${s.id}`,
            source: "jiosaavn"
          };
        });
        playlistData = {
          id: d.id ? `saavn_${pl.isAlbum ? 'alb' : 'pl'}_${d.id}` : pl.id,
          title: d.title || pl.title,
          description: d.header_desc || d.subtitle || pl.desc,
          author: d.artist || pl.author,
          artworkUrl: (d.image || "").replace("150x150", "500x500") || pl.artworkUrl || "logo.png"
        };
      }
    } catch (err2) {
      console.warn("[playSearchPlaylist] Direct JioSaavn fallback note:", err2);
    }
  }

  // 3. Tertiary Fallback: Search tracks by title
  if (tracks.length === 0) {
    try {
      const searchRes = await fetch(`/api/search?type=tracks&q=${encodeURIComponent(pl.title)}&filterMode=${encodeURIComponent(currentFilterMode)}`);
      const searchData = await searchRes.json();
      if (searchData.success && searchData.results?.length) {
        tracks = searchData.results;
        playlistData = { ...pl, tracks };
      }
    } catch (_) {}
  }

  if (tracks.length > 0) {
    const fullPl = {
      id: playlistData?.id || pl.id || `pl_${Date.now()}`,
      name: playlistData?.title || pl.title,
      desc: playlistData?.description || pl.desc || `Playlist by ${playlistData?.author || pl.author || 'Artist'}`,
      author: playlistData?.author || pl.author || "Artist",
      coverUrl: playlistData?.artworkUrl || pl.artworkUrl || "logo.png",
      tracksCount: tracks.length,
      badge: pl.isAlbum ? "Official Album" : "Playlist",
      tracks: tracks.map(t => ({
        id: t.id,
        title: t.title,
        artist: t.artist || t.author || "Artist",
        duration: typeof t.duration === "number" ? formatTime(t.duration) : (t.duration || "03:30"),
        query: `${t.title} ${t.artist || t.author || ""}`.trim(),
        artworkUrl: t.artworkUrl || pl.artworkUrl || "logo.png",
        streamUrl: t.streamUrl,
        rawStreamUrl: t.rawStreamUrl,
        source: t.source || "jiosaavn"
      }))
    };
    if (!customPlaylists.some(p => p.id === fullPl.id)) {
      customPlaylists.unshift(fullPl);
      renderSidebarLibrary("playlists");
    }
    dispatchPlayPlaylist(fullPl, immediate);
    showToast(`▶ Now Playing: ${fullPl.name} (${fullPl.tracks.length} tracks)`);
  } else {
    showToast(`Could not load tracks for "${pl.title}"`);
  }
}

async function loadAndOpenSearchPlaylist(pl) {
  showToast(`Loading: ${pl.title}...`);
  const targetUrl = pl.url || "";
  const targetId = pl.id || pl.rawId || "";
  let tracks = [];
  let playlistData = null;

  // 1. Primary: Remote API endpoint
  try {
    const res = await fetch(`/api/playlist-details?url=${encodeURIComponent(targetUrl)}&id=${encodeURIComponent(targetId)}`);
    const data = await res.json();
    if (data.success && data.playlist && data.playlist.tracks?.length) {
      playlistData = data.playlist;
      tracks = data.playlist.tracks;
    }
  } catch (err) {
    console.warn("[loadAndOpenSearchPlaylist] Primary resolver note:", err);
  }

  // 2. Secondary Fallback: Direct JioSaavn API query from client
  if (tracks.length === 0 && (pl.source === "jiosaavn" || targetId.includes("saavn_") || targetUrl.includes("jiosaavn.com"))) {
    try {
      const rawParam = targetId.replace("saavn_pl_", "").replace("saavn_alb_", "") || targetUrl.split("/").filter(Boolean).pop();
      let d = null;
      if (pl.isAlbum || targetId.startsWith("saavn_alb_") || targetUrl.includes("/album/")) {
        const albUrl = `https://www.jiosaavn.com/api.php?__call=content.getAlbumDetails&_format=json&_marker=0&api_version=4&ctx=web6dot0&albumid=${encodeURIComponent(rawParam)}`;
        const r = await fetch(albUrl);
        d = await r.json();
      } else {
        const plUrl = `https://www.jiosaavn.com/api.php?__call=playlist.getDetails&_format=json&_marker=0&api_version=4&ctx=web6dot0&listid=${encodeURIComponent(rawParam)}`;
        const r = await fetch(plUrl);
        d = await r.json();
      }
      const list = (d && (d.list || d.songs)) || [];
      if (list.length > 0) {
        tracks = list.map(s => {
          const cleanTitle = (s.title || "").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'");
          const artistNames = s.more_info?.artistMap?.primary_artists?.map(a => a.name).join(", ") || s.subtitle || s.artist || pl.author || "Artist";
          const artwork = (s.image || "").replace("150x150", "500x500") || pl.artworkUrl || "logo.png";
          return {
            id: `saavn_${s.id}`,
            title: cleanTitle,
            artist: artistNames,
            duration: Math.round(parseFloat(s.more_info?.duration || 0) * 1000),
            artworkUrl: artwork,
            url: s.perma_url || `https://www.jiosaavn.com/song/${s.id}`,
            source: "jiosaavn"
          };
        });
        playlistData = {
          id: d.id ? `saavn_${pl.isAlbum ? 'alb' : 'pl'}_${d.id}` : pl.id,
          title: d.title || pl.title,
          description: d.header_desc || d.subtitle || pl.desc,
          author: d.artist || pl.author,
          artworkUrl: (d.image || "").replace("150x150", "500x500") || pl.artworkUrl || "logo.png"
        };
      }
    } catch (err2) {
      console.warn("[loadAndOpenSearchPlaylist] Direct JioSaavn fallback note:", err2);
    }
  }

  // 3. Tertiary Fallback: Search tracks by title
  if (tracks.length === 0) {
    try {
      const searchRes = await fetch(`/api/search?type=tracks&q=${encodeURIComponent(pl.title)}&filterMode=${encodeURIComponent(currentFilterMode)}`);
      const searchData = await searchRes.json();
      if (searchData.success && searchData.results?.length) {
        tracks = searchData.results;
        playlistData = { ...pl, tracks };
      }
    } catch (_) {}
  }

  if (tracks.length > 0) {
    const fullPl = {
      id: playlistData?.id || pl.id || `pl_${Date.now()}`,
      name: playlistData?.title || pl.title,
      desc: playlistData?.description || pl.desc || `Playlist by ${playlistData?.author || pl.author || 'Artist'}`,
      author: playlistData?.author || pl.author || "Artist",
      coverUrl: playlistData?.artworkUrl || pl.artworkUrl || "logo.png",
      tracksCount: tracks.length,
      badge: pl.isAlbum ? "Official Album" : "Featured Playlist",
      gradient: "linear-gradient(135deg, #1db954 0%, #121212 100%)",
      tracks: tracks.map(t => ({
        id: t.id,
        title: t.title,
        artist: t.artist || t.author || "Artist",
        duration: typeof t.duration === "number" ? formatTime(t.duration) : (t.duration || "03:30"),
        query: `${t.title} ${t.artist || t.author || ""}`.trim(),
        artworkUrl: t.artworkUrl || pl.artworkUrl || "logo.png",
        streamUrl: t.streamUrl,
        rawStreamUrl: t.rawStreamUrl,
        source: t.source || "jiosaavn"
      }))
    };
    if (!customPlaylists.some(p => p.id === fullPl.id)) {
      customPlaylists.unshift(fullPl);
      renderSidebarLibrary("playlists");
    }
    openPlaylist(fullPl);
  } else {
    showToast(`Could not load details for "${pl.title}"`);
  }
}

// --------------------------------------------------------------------------
// PROGRESSIVE SEARCH: MODULAR RENDERERS (TRACKS & PLAYLISTS STREAMED)
// --------------------------------------------------------------------------
function renderSearchResultsPlaylists(playlists, q) {
  const searchPlaylistsSec = document.getElementById("searchPlaylistsSection");
  const searchPlaylistsGrid = document.getElementById("gridSearchPlaylists");
  const searchPlaylistsBadge = document.getElementById("searchPlaylistsCountBadge");
  if (!searchPlaylistsGrid) return;

  if (Array.isArray(playlists) && playlists.length > 0) {
    if (searchPlaylistsSec) searchPlaylistsSec.style.display = "block";
    if (searchPlaylistsBadge) searchPlaylistsBadge.textContent = `${playlists.length} Playlists`;
    searchPlaylistsGrid.innerHTML = "";

    playlists.forEach(pl => {
      const card = document.createElement("div");
      card.className = "spotify-card";
      card.title = pl.title;
      card.innerHTML = `
        <div class="card-artwork">
          <img src="${pl.artworkUrl || 'logo.png'}" alt="${escapeHtml(pl.title)}" onerror="this.src='logo.png'">
          <button class="circle-play" title="Play ${escapeHtml(pl.title)}">
            <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
          </button>
        </div>
        <span class="card-title">${escapeHtml(pl.title)}</span>
        <span class="card-desc">${escapeHtml(pl.author || "Featured Playlist")}${pl.trackCount ? ` • ${pl.trackCount} songs` : ''}</span>
      `;

      card.querySelector(".circle-play")?.addEventListener("click", (e) => {
        e.stopPropagation();
        playSearchPlaylist(pl, true);
      });

      card.addEventListener("click", () => {
        loadAndOpenSearchPlaylist(pl);
      });

      searchPlaylistsGrid.appendChild(card);
    });
    setTimeout(initShelfScrollButtons, 50);
  } else if (searchPlaylistsSec) {
    searchPlaylistsSec.style.display = "none";
  }
}

function renderSearchResultsTracks(results, q) {
  const searchBody = document.getElementById("searchResultsBody");
  const searchFilterBadge = document.getElementById("searchResultFilterBadge");
  if (!searchBody) return;

  if (Array.isArray(results) && results.length > 0) {
    if (searchFilterBadge) {
      searchFilterBadge.textContent = `${results.length} Tracks • High Fidelity`;
    }
    searchBody.innerHTML = "";
    results.forEach((t, idx) => {
      const isFav = isTrackFavorited(t);
      const tr = document.createElement("tr");
      tr.className = "song-row";
      tr.innerHTML = `
        <td class="td-num">${idx + 1}</td>
        <td>
          <div class="song-info-cell">
            <img class="song-cell-art" src="${t.artworkUrl || 'logo.png'}" onerror="this.src='logo.png'">
            <div class="song-title-group">
              <span class="song-title">${escapeHtml(t.title)}</span>
              <span class="song-artist">${escapeHtml(t.author || t.artist || "Artist")}</span>
            </div>
          </div>
        </td>
        <td class="song-album-cell">
          <div style="display: flex; gap: 8px; align-items: center;">
            <button class="btn-play-now-pill btn-search-play-now" title="Interrupt and play immediately">Play Now</button>
            <button class="btn-enqueue-pill btn-search-enqueue" title="Add to end of queue">Enqueue</button>
            <button class="btn-search-heart ${isFav ? 'liked' : ''}" title="${isFav ? 'Remove from Liked' : 'Save to Liked Songs'}" style="background:none; border:none; cursor:pointer; padding:4px; display:inline-flex; align-items:center;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            </button>
          </div>
        </td>
        <td class="song-time-cell">${formatTime(t.duration)}</td>
      `;

      const playWithQueue = () => {
        dispatchPlayNow(t);
        const upcoming = results.slice(idx + 1);
        if (upcoming.length > 0 && typeof BrowserPlayer !== "undefined") {
          BrowserPlayer.queue = upcoming.map(item => ({
            ...item,
            isRadio: false
          }));
          if (typeof renderQueueView === "function") renderQueueView();
          if (typeof saveUserQueue === "function") saveUserQueue();
        }
      };

      tr.querySelector(".btn-search-play-now")?.addEventListener("click", (e) => {
        e.stopPropagation();
        playWithQueue();
      });

      tr.querySelector(".btn-search-enqueue")?.addEventListener("click", (e) => {
        e.stopPropagation();
        dispatchEnqueue(t);
      });

      const heartBtn = tr.querySelector(".btn-search-heart");
      heartBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleTrackFavorite(t);
        const nowFav = !isFav;
        heartBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="${nowFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;
        heartBtn.classList.toggle('liked', nowFav);
      });

      tr.addEventListener("click", () => {
        playWithQueue();
      });

      searchBody.appendChild(tr);
    });
  } else {
    if (currentFilterMode !== "filterless") {
      searchBody.innerHTML = `
        <tr>
          <td colspan="4" style="color: var(--text-subdued); padding: 32px 16px; text-align: center;">
            <div style="display:flex; justify-content:center; margin-bottom: 10px;">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.6;"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
            </div>
            <div style="font-size: 1rem; color: var(--text-header); font-weight: 600; margin-bottom: 6px;">No tracks found for "${escapeHtml(q)}" in ${currentFilterMode === "strict" ? "Strict Halal (#)" : "Islamic Vibes (*)"} mode</div>
            <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 14px;">This track may be filtered by Halal rules. Switch to Filterless mode to search and play all songs without restriction.</div>
            <button type="button" class="btn-play-now-pill" onclick="window.switchFilterToFilterless('${escapeHtml(q)}')" style="margin: 0 auto; display: inline-flex;">
              Switch to Filterless Mode & Search "${escapeHtml(q)}"
            </button>
          </td>
        </tr>
      `;
    } else {
      searchBody.innerHTML = `<tr><td colspan="4" style="color: var(--text-subdued); padding: 24px; text-align: center;">No tracks found for "${escapeHtml(q)}"</td></tr>`;
    }
  }
}

async function handleSearch(query) {
  const q = (query || "").trim();
  const searchSec = document.getElementById("searchResultsSection");
  const searchBody = document.getElementById("searchResultsBody");
  const searchPlaylistsSec = document.getElementById("searchPlaylistsSection");
  const searchPlaylistsGrid = document.getElementById("gridSearchPlaylists");
  const searchPlaylistsBadge = document.getElementById("searchPlaylistsCountBadge");
  const searchFilterBadge = document.getElementById("searchResultFilterBadge");
  const browseCat = document.getElementById("browseCategoriesSection");

  if (!q) {
    if (searchSec) searchSec.style.display = "none";
    if (searchPlaylistsSec) searchPlaylistsSec.style.display = "none";
    if (browseCat) browseCat.style.display = "block";
    return;
  }

  // Cancel prior pending search request
  if (searchAbortController) {
    searchAbortController.abort();
  }
  searchAbortController = new AbortController();
  const currentSignal = searchAbortController.signal;

  if (searchSec) searchSec.style.display = "block";
  if (browseCat) browseCat.style.display = "none";

  // Provide instant feedback in both sections while parallel requests fetch
  if (searchPlaylistsSec) searchPlaylistsSec.style.display = "block";
  if (searchPlaylistsGrid) {
    searchPlaylistsGrid.innerHTML = `
      <div style="grid-column: 1 / -1; color: var(--text-subdued); padding: 18px 0; font-size: 0.9rem; display: flex; align-items: center; gap: 8px;">
        <span class="taste-pulse-dot"></span> Finding top playlists for "${escapeHtml(q)}"...
      </div>
    `;
  }
  if (searchBody) {
    searchBody.innerHTML = `<tr><td colspan="4" style="color: var(--text-subdued); padding: 24px; text-align: center;"><div style="display:inline-flex; align-items:center; gap:8px;"><span class="pulse-dot"></span> Searching for "${escapeHtml(q)}"...</div></td></tr>`;
  }

  // 1. FAST STREAM: Fetch Tracks in Parallel (Resolves instantly in ~150ms)
  fetch(resolveApiUrl(`/api/search?type=tracks&q=${encodeURIComponent(q)}&filterMode=${encodeURIComponent(currentFilterMode)}`), {
    signal: currentSignal
  })
    .then(r => r.json())
    .then(data => {
      if (currentSignal.aborted || data.dropped) return;
      if (data.success && Array.isArray(data.results)) {
        renderSearchResultsTracks(data.results, q);
      } else {
        renderSearchResultsTracks([], q);
      }
    })
    .catch(err => {
      if (err.name === "AbortError" || currentSignal.aborted) return;
      if (searchBody) searchBody.innerHTML = `<tr><td colspan="4" style="color: var(--text-subdued); padding: 24px; text-align: center;">Track search error: ${escapeHtml(err.message)}</td></tr>`;
    });

  // 2. PARALLEL STREAM: Fetch Playlists in Parallel (Resolves in ~180-250ms)
  fetch(resolveApiUrl(`/api/search?type=playlists&q=${encodeURIComponent(q)}&filterMode=${encodeURIComponent(currentFilterMode)}`), {
    signal: currentSignal
  })
    .then(r => r.json())
    .then(data => {
      if (currentSignal.aborted || data.dropped) return;
      if (data.success && Array.isArray(data.playlists)) {
        renderSearchResultsPlaylists(data.playlists, q);
      } else {
        renderSearchResultsPlaylists([], q);
      }
    })
    .catch(err => {
      if (err.name === "AbortError" || currentSignal.aborted) return;
      if (searchPlaylistsSec) searchPlaylistsSec.style.display = "none";
    });
}


window.switchFilterToFilterless = function(query) {
  currentFilterMode = "filterless";
  document.querySelectorAll(".filter-chip").forEach(c => {
    c.classList.toggle("active", c.getAttribute("data-mode") === "filterless");
  });
  showToast("Filter: Filterless (All Songs Allowed)");
  handleSearch(query);
};

// ==========================================================================
// USER AUTH, SAVED QUEUE & FAVORITE SONGS (LIKED SONGS)
// ==========================================================================
let currentUser = null;
try {
  const cachedUserStr = localStorage.getItem("ahm_cached_user");
  if (cachedUserStr) {
    currentUser = JSON.parse(cachedUserStr);
  }
} catch (e) {
  currentUser = null;
}
let userFavorites = [];
let favoriteTrackIds = new Set();

async function initUserAuth() {
  // Check URL params for OAuth redirect token
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has("token")) {
    const t = urlParams.get("token");
    localStorage.setItem("ahm_session_token", t);
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  let token = localStorage.getItem("ahm_session_token");

  // Restore immediate UI from cache so no blank state flickers
  try {
    const cachedUser = localStorage.getItem("ahm_cached_user");
    if (cachedUser) {
      currentUser = JSON.parse(cachedUser);
      updateUserProfileUI();
    }
  } catch(e) {}

  if (!token) {
    // If no token in key but vault exists, recover sessionToken from vault
    try {
      const vRaw = localStorage.getItem("ahm_user_vault");
      if (vRaw) {
        const v = JSON.parse(vRaw);
        if (v && v.sessionToken) {
          token = v.sessionToken;
          localStorage.setItem("ahm_session_token", token);
        }
      }
    } catch(e) {}
  }

  if (!token) {
    const vaultRaw = localStorage.getItem("ahm_user_vault");
    if (vaultRaw) {
      try {
        const vault = JSON.parse(vaultRaw);
        if (vault?.sessionToken) {
          token = vault.sessionToken;
          localStorage.setItem("ahm_session_token", token);
        } else if (vault?.user?.id) {
          // Rehydrate directly if token missing but vault present
          const rRes = await fetch("/api/user/rehydrate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ vault })
          });
          const rData = await rRes.json();
          if (rData.success && rData.user) {
            currentUser = rData.user;
            if (rData.token) {
              token = rData.token;
              localStorage.setItem("ahm_session_token", token);
            }
            localStorage.setItem("ahm_cached_user", JSON.stringify(rData.user));
            saveUserVault();
            showToast(`Session restored: Welcome back, ${currentUser.displayName || currentUser.username}!`);
          }
        }
      } catch (e) {
        console.warn("Vault recovery error:", e);
      }
    }
  }

  if (!token && !currentUser) {
    currentUser = null;
    localStorage.removeItem("ahm_cached_user");
    updateUserProfileUI();
    return;
  }

  if (!currentUser) {
    try {
      const headers = { "Authorization": `Bearer ${token}` };
      const res = await fetch("/api/user/me", { headers });
      const data = await res.json();
      if (data.authenticated && data.user) {
        currentUser = data.user;
        localStorage.setItem("ahm_cached_user", JSON.stringify(data.user));
        saveUserVault();
      } else if (data.sessionRevoked) {
        // Enforce: One sign in must be in one app!
        // Another app/device signed in with this account; close this session cleanly
        console.warn("Session revoked because user signed in on another device.");
        currentUser = null;
        localStorage.removeItem("ahm_session_token");
        localStorage.removeItem("ahm_cached_user");
        localStorage.removeItem("ahm_user_vault");
        updateUserProfileUI();
        showToast("Signed in on another device. This session has ended.");
      } else {
        // Server was redeployed or memory restarted: auto-rehydrate from local vault!
        const vaultRaw = localStorage.getItem("ahm_user_vault");
        if (vaultRaw) {
          try {
            const vault = JSON.parse(vaultRaw);
            if (vault && vault.user && vault.user.id) {
              console.log("Auto-rehydrating user session after server push/restart...");
              const rRes = await fetch("/api/user/rehydrate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ vault })
              });
              const rData = await rRes.json();
              if (rData.success && rData.user) {
                currentUser = rData.user;
                if (rData.token) localStorage.setItem("ahm_session_token", rData.token);
                localStorage.setItem("ahm_cached_user", JSON.stringify(rData.user));
                saveUserVault();
                showToast(`Session restored: Welcome back, ${currentUser.displayName || currentUser.username}!`);
              }
            }
          } catch(rErr) {
            console.warn("Auto-rehydrate error:", rErr);
          }
        }

        if (!currentUser) {
          currentUser = null;
          localStorage.removeItem("ahm_session_token");
          localStorage.removeItem("ahm_cached_user");
        }
      }
    } catch (e) {
      // Transient network or server reboot error: KEEP cached session so user is never abruptly logged out!
      console.warn("Could not reach auth server, keeping cached user session:", e.message);
    }
  }

  updateUserProfileUI();
  await loadUserFavorites();
  await loadUserQueue();
  if (currentUser) {
    await loadDailyRecommendations(false);
  }
}

// Resilient User Vault Persistence
function saveUserVault() {
  if (!currentUser) return;
  try {
    const vault = {
      user: currentUser,
      sessionToken: localStorage.getItem("ahm_session_token"),
      favorites: userFavorites || [],
      customPlaylists: customPlaylists || [],
      tasteProfile: userTasteProfile || currentUser.tasteProfile || null,
      updatedAt: Date.now()
    };
    localStorage.setItem("ahm_user_vault", JSON.stringify(vault));
  } catch (e) {}
}
window.saveUserVault = saveUserVault;

function updateUserProfileUI() {
  const avatarMini = document.getElementById("userAvatarMini");
  const nameMini = document.getElementById("userNameMini");
  const btnTopLogout = document.getElementById("btnTopLogout");
  const tasteTag = document.getElementById("userTasteStatusTag");
  const bannerAuthText = document.getElementById("btnBannerAuthText");

  if (currentUser) {
    if (avatarMini) {
      if (currentUser.avatar && currentUser.avatar !== "logo.png") {
        avatarMini.innerHTML = `<img src="${currentUser.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
      } else {
        avatarMini.textContent = (currentUser.displayName || currentUser.username || "U")[0].toUpperCase();
      }
    }
    if (nameMini) {
      nameMini.textContent = currentUser.displayName || currentUser.username;
    }
    if (btnTopLogout) {
      btnTopLogout.style.display = "inline-flex";
    }
    if (tasteTag) {
      tasteTag.textContent = currentUser.type === "customer" ? "✨ Customer Taste" : "✨ Member Taste";
      tasteTag.style.background = "rgba(30, 215, 96, 0.2)";
      tasteTag.style.color = "var(--spotify-green)";
    }
    if (bannerAuthText) {
      bannerAuthText.textContent = "Account & Taste";
    }
  } else {
    if (avatarMini) avatarMini.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>';
    if (nameMini) nameMini.textContent = "Log In / Sign Up";
    if (btnTopLogout) {
      btnTopLogout.style.display = "none";
    }
    if (tasteTag) {
      tasteTag.textContent = "✨ Taste AI";
      tasteTag.style.background = "rgba(255, 255, 255, 0.08)";
      tasteTag.style.color = "var(--text-secondary)";
    }
    if (bannerAuthText) {
      bannerAuthText.textContent = "Log In / Sign Up";
    }
  }

  // Also sync taste banner and sidebar card
  if (typeof renderDailyTasteBanner === "function") renderDailyTasteBanner();
  if (typeof updateSidebarTasteCard === "function") updateSidebarTasteCard();
}

async function handleLogout() {
  try {
    const token = localStorage.getItem("ahm_session_token");
    await fetch("/api/user/logout", {
      method: "POST",
      headers: token ? { "Authorization": `Bearer ${token}` } : {}
    });
  } catch(e) {}
  localStorage.removeItem("ahm_session_token");
  localStorage.removeItem("ahm_cached_user");
  localStorage.removeItem("ahm_user_vault");
  currentUser = null;
  userFavorites = [];
  favoriteTrackIds = new Set();
  updateUserProfileUI();
  updateFavoritesCounters();
  loadDailyRecommendations(false);
  closeProfileModal();
  showToast("Logged out successfully");
}
window.handleLogout = handleLogout;

async function loadUserFavorites() {
  // 1. Instant local restoration from vault
  try {
    const vRaw = localStorage.getItem("ahm_user_vault");
    if (vRaw) {
      const v = JSON.parse(vRaw);
      if (Array.isArray(v.favorites) && v.favorites.length > 0 && userFavorites.length === 0) {
        userFavorites = v.favorites;
        favoriteTrackIds = new Set(userFavorites.map(f => (f.title || "").trim().toLowerCase()));
        updateFavoritesCounters();
      }
    }
  } catch(e) {}

  try {
    const token = localStorage.getItem("ahm_session_token");
    const headers = token ? { "Authorization": `Bearer ${token}` } : {};
    const res = await fetch("/api/user/favorites", { headers });
    const data = await res.json();
    if (data.success && Array.isArray(data.favorites)) {
      if (data.favorites.length >= userFavorites.length) {
        userFavorites = data.favorites;
        favoriteTrackIds = new Set(data.favorites.map(f => (f.title || "").trim().toLowerCase()));
        updateFavoritesCounters();
        saveUserVault();
      }
    }
  } catch(e) {}
}

function updateFavoritesCounters() {
  const count = userFavorites.length;
  const libCount = document.getElementById("libLikedSongsCount");
  const heroCount = document.getElementById("likedHeroTracksCount");
  if (libCount) libCount.textContent = `${count} favorite song${count === 1 ? "" : "s"}`;
  if (heroCount) heroCount.textContent = `${count} song${count === 1 ? "" : "s"}`;
  updateHeartButtonStatus();
}

function isTrackFavorited(track) {
  if (!track) return false;
  const title = (track.title || "").trim().toLowerCase();
  return favoriteTrackIds.has(title);
}

async function toggleTrackFavorite(track) {
  if (!track || !track.title) return;
  const token = localStorage.getItem("ahm_session_token");
  try {
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch("/api/user/favorites/toggle", {
      method: "POST",
      headers,
      body: JSON.stringify({ track })
    });
    const data = await res.json();
    if (data.success) {
      userFavorites = data.favorites || [];
      favoriteTrackIds = new Set(userFavorites.map(f => (f.title || "").trim().toLowerCase()));
      updateFavoritesCounters();
      renderLikedSongsView();
      saveUserVault();
      if (data.isFavorite) {
        recordTrackTaste(track, "like");
      }
      showToast(data.isFavorite ? `Added to Liked Songs: ${track.title}` : `Removed from Liked Songs: ${track.title}`);
    }
  } catch (e) {
    showToast("Error updating favorite");
  }
}

async function saveUserQueue() {
  const isLocal = isLocalChannel(activeSystemChannel);
  const q = isLocal ? BrowserPlayer.queue : [];
  try {
    localStorage.setItem("ahm_browser_queue", JSON.stringify(q));
  } catch (e) {}
  if (!q) return;
  try {
    const token = localStorage.getItem("ahm_session_token");
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    await fetch("/api/user/queue", {
      method: "POST",
      headers,
      body: JSON.stringify({ queue: q })
    });
  } catch (e) {}
}

async function loadUserQueue() {
  // Restore from local cache for instant zero-latency loading
  try {
    const local = localStorage.getItem("ahm_browser_queue");
    if (local) {
      const parsed = JSON.parse(local);
      if (Array.isArray(parsed) && parsed.length > 0 && BrowserPlayer.queue.length === 0) {
        BrowserPlayer.queue = parsed;
        renderQueueView();
      }
    }
  } catch (e) {}

  // Sync with user account queue
  try {
    const token = localStorage.getItem("ahm_session_token");
    const headers = token ? { "Authorization": `Bearer ${token}` } : {};
    const res = await fetch("/api/user/queue", { headers });
    const data = await res.json();
    if (data.success && Array.isArray(data.queue) && data.queue.length > 0) {
      if (BrowserPlayer.queue.length === 0) {
        BrowserPlayer.queue = data.queue;
        renderQueueView();
      }
    }
  } catch(e) {}
}

function renderLikedSongsView() {
  const tbody = document.getElementById("likedSongsTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const heroAuthor = document.getElementById("likedHeroAuthor");
  if (heroAuthor) {
    heroAuthor.textContent = currentUser ? (currentUser.displayName || currentUser.username) : "Guest User";
  }

  if (userFavorites.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; color: var(--text-subdued); padding: 48px 0;">
          <div style="display:flex; justify-content:center; margin-bottom: 12px;">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.4;">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
          </div>
          <div style="font-size: 1.1rem; font-weight: 600; color: var(--text-header);">Songs you like will appear here</div>
          <div style="font-size: 0.9rem; color: var(--text-secondary); margin-top: 4px;">Save songs by tapping the heart icon on any search result or currently playing track.</div>
        </td>
      </tr>
    `;
    return;
  }

  userFavorites.forEach((track, idx) => {
    const tr = document.createElement("tr");
    tr.className = "song-row";
    tr.innerHTML = `
      <td class="td-num">${idx + 1}</td>
      <td>
        <div class="song-info-cell">
          <img class="song-cell-art" src="${track.artworkUrl || 'logo.png'}">
          <div class="song-title-group">
            <span class="song-title">${escapeHtml(track.title)}</span>
            <span class="song-artist">${escapeHtml(track.author)}</span>
          </div>
        </div>
      </td>
      <td class="song-artist-cell">${escapeHtml(track.author)}</td>
      <td class="song-album-cell">
        <div style="display: flex; gap: 8px; align-items: center;">
          <button class="btn-play-now-mini btn-row-play-now" title="Play immediately"><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> Play</button>
          <button class="btn-queue-mini btn-row-enqueue" title="Add to queue"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>
          <button class="btn-heart-toggle active" title="Remove from favorites" style="background: none; border: none; cursor: pointer; padding: 4px; display: inline-flex; align-items: center; color: var(--emerald-primary);">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          </button>
        </div>
      </td>
      <td class="song-time-cell">${formatTime(track.duration)}</td>
    `;

    tr.querySelector(".btn-row-play-now")?.addEventListener("click", (e) => {
      e.stopPropagation();
      dispatchPlayNow(track);
    });
    tr.querySelector(".btn-row-enqueue")?.addEventListener("click", (e) => {
      e.stopPropagation();
      dispatchEnqueue(track);
    });
    tr.querySelector(".btn-heart-toggle")?.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleTrackFavorite(track);
    });
    tr.addEventListener("click", () => {
      dispatchPlayNow(track);
    });

    tbody.appendChild(tr);
  });
}

function playAllLikedSongs() {
  if (!userFavorites || userFavorites.length === 0) {
    showToast("No liked songs yet. Tap the heart icon on any track to add.");
    return;
  }
  showToast(`Playing all ${userFavorites.length} Liked Songs...`);
  if (isLocalChannel(activeSystemChannel)) {
    BrowserPlayer.prime();
    const first = userFavorites[0];
    BrowserPlayer.playNow(first);
    BrowserPlayer.queue = userFavorites.slice(1);
    renderQueueView();
    saveUserQueue();
  }
  if (activeSystemChannel === "bot" || activeSystemChannel === "all") {
    sendAction("play_playlist", null, {
      targetChannel: "bot",
      name: "Liked Songs",
      immediate: true,
      tracks: userFavorites.map(f => `${f.title} ${f.author}`)
    });
  }
}

function updateHeartButtonStatus() {
  const cur = isLocalChannel(activeSystemChannel)
    ? BrowserPlayer.currentTrack
    : (currentState?.channels?.[activeSystemChannel]?.current || currentState?.current);
  const isLiked = isTrackFavorited(cur);

  const btnPlayerHeart = document.getElementById("btnPlayerHeart");
  const btnMobileHeart = document.getElementById("btnMobileHeart");
  const btnRightLike = document.getElementById("btnRightLike");
  const btnExpandedHeart = document.getElementById("btnExpandedHeart");

  const heartSvg = (filled) => `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
    </svg>`;

  if (btnPlayerHeart) {
    btnPlayerHeart.classList.toggle("liked", isLiked);
    btnPlayerHeart.innerHTML = heartSvg(isLiked);
  }
  if (btnMobileHeart) {
    btnMobileHeart.classList.toggle("liked", isLiked);
    btnMobileHeart.innerHTML = heartSvg(isLiked);
  }
  if (btnRightLike) {
    btnRightLike.classList.toggle("liked", isLiked);
    btnRightLike.innerHTML = heartSvg(isLiked);
  }
  if (btnExpandedHeart) {
    btnExpandedHeart.classList.toggle("liked", isLiked);
    btnExpandedHeart.innerHTML = heartSvg(isLiked);
  }
}

let regSelectedAvatar = "🎧";
let regSelectedGenres = new Set(["bollywood", "romantic", "sufi"]);

function openProfileModal() {
  const modal = document.getElementById("modalUserProfile");
  const body = document.getElementById("profileCardBody");
  if (!modal || !body) return;

  if (currentUser) {
    const isMember = currentUser.isServerMember;
    const isCustomer = currentUser.type === "customer";
    const tp = currentUser.tasteProfile || userTasteProfile || {};
    const topGenres = tp.topGenres || [];
    const topArtists = tp.topArtists || [];
    const listenedCount = tp.listenedCount || (tp.listenedTracks ? tp.listenedTracks.length : 0);

    let genresBarsHtml = "";
    if (topGenres.length > 0) {
      const maxScore = Math.max(...topGenres.map(g => g.score || 1), 1);
      genresBarsHtml = `
        <div style="background: var(--bg-card-elevated); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 14px; margin-bottom: 16px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <span style="font-size:0.85rem; font-weight:700; color:var(--text-header); display:flex; align-items:center; gap:6px;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2z"/></svg>
              <span>Your Music Taste Affinity</span>
            </span>
            <span style="font-size:0.72rem; color:var(--spotify-green); font-weight:700;">DAILY ADAPTIVE</span>
          </div>
          <div class="taste-breakdown-list">
            ${topGenres.slice(0, 5).map(g => {
              const pct = Math.min(100, Math.max(15, Math.round((g.score / maxScore) * 100)));
              return `
                <div class="taste-bar-row">
                  <span class="taste-bar-label">${escapeHtml(g.genre.toUpperCase())}</span>
                  <div class="taste-bar-track">
                    <div class="taste-bar-fill" style="width: ${pct}%;"></div>
                  </div>
                  <span class="taste-bar-count">${g.score} pts</span>
                </div>
              `;
            }).join("")}
          </div>
          ${topArtists.length > 0 ? `
            <div style="margin-top: 12px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 10px;">
              <span style="font-size: 0.74rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;">Top Artists Listened:</span>
              <div class="taste-artist-tags-wrap">
                ${topArtists.slice(0, 5).map(a => `
                  <span class="taste-artist-tag">🎵 ${escapeHtml(a.artist)} <small style="color:var(--text-secondary)">(${a.count})</small></span>
                `).join("")}
              </div>
            </div>
          ` : ""}
          <button type="button" id="btnModalTuneTaste" class="btn-save-taste" style="margin-top: 14px; font-size: 0.82rem; padding: 9px 12px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
            <span>Tune Music Taste & Preferred Genres</span>
          </button>
        </div>
      `;
    } else {
      genresBarsHtml = `
        <div style="background: var(--bg-card-elevated); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 14px; margin-bottom: 16px; text-align: center;">
          <div style="font-size: 0.85rem; font-weight: 700; color: var(--text-header); margin-bottom: 4px;">Taste Profile Initializing</div>
          <div style="font-size: 0.76rem; color: var(--text-secondary); margin-bottom: 12px;">Stream songs or like your favorite tracks to build your personalized taste pattern.</div>
          <button type="button" id="btnModalTuneTaste" class="btn-save-taste" style="font-size: 0.82rem; padding: 8px 12px;">
            <span>Tune Preferences Now</span>
          </button>
        </div>
      `;
    }

    body.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; text-align: center; gap: 12px; margin-bottom: 18px;">
        <div style="width: 76px; height: 76px; border-radius: 50%; overflow: hidden; background: var(--bg-card-elevated); border: 3px solid ${isCustomer ? 'var(--spotify-green)' : (isMember ? 'var(--emerald-primary)' : 'var(--discord-blurple)')}; display: flex; align-items: center; justify-content: center; font-size: 32px; color: var(--text-header); box-shadow: 0 4px 16px rgba(0,0,0,0.3);">
          ${currentUser.avatar && currentUser.avatar.length > 2 && currentUser.avatar !== "logo.png" ? `<img src="${currentUser.avatar}" style="width:100%;height:100%;object-fit:cover;">` : (currentUser.avatar || (currentUser.displayName || currentUser.username)[0].toUpperCase())}
        </div>
        <div>
          <h2 style="font-size: 1.35rem; font-weight: 800; color: var(--text-header); margin: 0;">${escapeHtml(currentUser.displayName || currentUser.username)}</h2>
          ${currentUser.email ? `<div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 3px;">✉️ ${escapeHtml(currentUser.email)}</div>` : ""}
          <div style="display: flex; align-items: center; justify-content: center; gap: 6px; margin-top: 6px;">
            <span style="font-size: 0.75rem; font-weight: 700; padding: 2px 8px; border-radius: 12px; background: rgba(30, 215, 96, 0.15); color: var(--spotify-green);">
              ${isCustomer ? "✨ Personalized Account" : (currentUser.type === "discord" ? "Discord Member" : "Local Account")}
            </span>
          </div>
        </div>
      </div>

      <!-- Quick Listening Stats -->
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 16px;">
        <div class="taste-profile-stat">
          <div class="taste-profile-stat-val">${userFavorites.length}</div>
          <div class="taste-profile-stat-label">Liked Songs</div>
        </div>
        <div class="taste-profile-stat">
          <div class="taste-profile-stat-val">${BrowserPlayer.queue.length}</div>
          <div class="taste-profile-stat-label">Queue</div>
        </div>
        <div class="taste-profile-stat">
          <div class="taste-profile-stat-val">${listenedCount}</div>
          <div class="taste-profile-stat-label">Played</div>
        </div>
      </div>

      <!-- Taste Profile Pattern breakdown -->
      ${genresBarsHtml}

      <!-- Theme Selection Preference (Separate Dark / Light) -->
      <div style="background: var(--bg-card-elevated); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 12px 14px; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between;">
        <div>
          <div style="font-size: 0.86rem; font-weight: 700; color: var(--text-primary);">Interface Theme</div>
          <div style="font-size: 0.74rem; color: var(--text-secondary);">Separate Dark & Light Mode</div>
        </div>
        <div class="theme-switch-group" role="group" aria-label="Theme Selection">
          <button type="button" class="theme-choice-btn ${document.documentElement.getAttribute('data-theme') !== 'light' ? 'active' : ''}" data-set-theme="dark">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
            <span>Dark</span>
          </button>
          <button type="button" class="theme-choice-btn ${document.documentElement.getAttribute('data-theme') === 'light' ? 'active' : ''}" data-set-theme="light">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
            <span>Light</span>
          </button>
        </div>
      </div>

      <!-- Continue Last Played Preference -->
      <div style="background: var(--bg-card-elevated); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 12px 14px; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between;">
        <div>
          <div style="font-size: 0.86rem; font-weight: 700; color: var(--text-primary);">Continue Last Played Music</div>
          <div style="font-size: 0.74rem; color: var(--text-secondary);">Resume last track on next app launch</div>
        </div>
        <label style="position: relative; display: inline-block; width: 44px; height: 24px; cursor: pointer; margin: 0;">
          <input type="checkbox" id="chkResumeOnLaunch" ${localStorage.getItem("ahm_resume_last_played") !== "false" ? "checked" : ""} style="opacity: 0; width: 0; height: 0; position: absolute;">
          <span style="position: absolute; cursor: pointer; inset: 0; background-color: ${localStorage.getItem("ahm_resume_last_played") !== "false" ? "var(--spotify-green)" : "rgba(255,255,255,0.2)"}; border-radius: 24px; transition: .2s;">
            <span style="position: absolute; content: ''; height: 18px; width: 18px; left: ${localStorage.getItem("ahm_resume_last_played") !== "false" ? "23px" : "3px"}; bottom: 3px; background-color: white; border-radius: 50%; transition: .2s;"></span>
          </span>
        </label>
      </div>

      <div style="margin-top: 14px;">
        <button id="modalBtnLogout" class="btn-modal-logout" type="button" title="Log out of this account">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
            <polyline points="16 17 21 12 16 7"></polyline>
            <line x1="21" y1="12" x2="9" y2="12"></line>
          </svg>
          <span>Log Out</span>
        </button>
      </div>
    `;

    document.getElementById("btnModalTuneTaste")?.addEventListener("click", () => {
      closeProfileModal();
      openTuneTasteModal();
    });

    document.getElementById("modalBtnLogout")?.addEventListener("click", handleLogout);

    document.getElementById("chkResumeOnLaunch")?.addEventListener("change", (e) => {
      localStorage.setItem("ahm_resume_last_played", e.target.checked ? "true" : "false");
      showToast(e.target.checked ? "Enabled: Continue music on launch" : "Disabled: Start fresh on launch");
      openProfileModal();
    });

  } else {
    // Log In / Create Account with Email & Password (Default) & Discord Tab
    body.innerHTML = `
      <div style="text-align: center; margin-bottom: 14px;">
        <div style="display:flex; justify-content:center; margin-bottom: 8px;">
          <div style="width:44px; height:44px; border-radius:12px; background:rgba(30,215,96,0.15); border:1px solid rgba(30,215,96,0.3); display:flex; align-items:center; justify-content:center; color:var(--spotify-green);">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
          </div>
        </div>
        <h2 style="font-size: 1.25rem; font-weight: 800; color: var(--text-header); margin: 0 0 4px 0;">Sign In to Spy Sec Music</h2>
        <p style="font-size: 0.8rem; color: var(--text-secondary); margin: 0;">
          Log in with your email and password to sync your taste pattern and customized daily mixes.
        </p>
      </div>

      <!-- Main Navigation Tabs: Email Account vs Discord -->
      <div class="auth-tabs-row" style="margin-bottom: 12px;">
        <button type="button" class="auth-tab-btn active" id="tabBtnCustomer">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
          <span>Email & Password</span>
        </button>
        <button type="button" class="auth-tab-btn" id="tabBtnDiscord">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
          <span>Discord Member</span>
        </button>
      </div>

      <!-- TAB 1 CONTENT: EMAIL & PASSWORD AUTH (SIGN IN OR CREATE ACCOUNT) -->
      <div id="tabContentCustomer" class="auth-form-card">
        <!-- Sub-Toggle: Sign In vs Create Account -->
        <div class="auth-switch-toggle">
          <button type="button" class="auth-switch-btn active" id="btnSwitchSignIn">Sign In</button>
          <button type="button" class="auth-switch-btn" id="btnSwitchCreate">Create Account</button>
        </div>

        <!-- FORM 1A: SIGN IN FORM -->
        <div id="formSignInContainer" style="display: flex; flex-direction: column; gap: 10px;">
          <div>
            <label class="auth-field-label">
              <span>Email Address</span>
            </label>
            <input type="email" id="inputSignInEmail" class="auth-text-input input-green" placeholder="name@example.com" autocomplete="email">
          </div>
          <div>
            <label class="auth-field-label">
              <span>Password</span>
            </label>
            <input type="password" id="inputSignInPassword" class="auth-text-input" placeholder="Enter your password..." autocomplete="current-password">
          </div>
          <div id="authSignInError" class="auth-error-notice" style="display:none;"></div>
          <button type="button" id="btnExecuteSignIn" class="btn-save-taste" style="margin-top: 4px;">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line></svg>
            <span>Log In with Email</span>
          </button>
          <div style="text-align: center; margin-top: 6px;">
            <span style="font-size: 0.78rem; color: var(--text-secondary);">Don't have an account? </span>
            <button type="button" id="btnLinkToCreate" style="background: none; border: none; color: var(--spotify-green); font-size: 0.78rem; font-weight: 700; cursor: pointer; text-decoration: underline; padding: 0;">Create one</button>
          </div>
        </div>

        <!-- FORM 1B: CREATE ACCOUNT FORM -->
        <div id="formCreateContainer" style="display: none; flex-direction: column; gap: 10px;">
          <div>
            <label class="auth-field-label">
              <span>Email Address *</span>
            </label>
            <input type="email" id="inputRegEmail" class="auth-text-input input-green" placeholder="you@example.com" autocomplete="email">
          </div>
          <div>
            <label class="auth-field-label">
              <span>Password (at least 6 characters) *</span>
            </label>
            <input type="password" id="inputRegPassword" class="auth-text-input" placeholder="Create a secure password..." autocomplete="new-password">
          </div>
          <div>
            <label class="auth-field-label">
              <span>Your Name / Display Name (Optional)</span>
            </label>
            <input type="text" id="inputRegDisplayName" class="auth-text-input" placeholder="e.g. Aswad, MusicLover...">
          </div>

          <!-- Avatar Selector -->
          <div>
            <label class="auth-field-label">
              <span>Pick Your Avatar</span>
            </label>
            <div class="avatar-pick-grid" id="regAvatarPicker">
              <button type="button" class="avatar-pick-item selected" data-avatar="🎧" title="Audiophile">🎧</button>
              <button type="button" class="avatar-pick-item" data-avatar="🌙" title="Sufi Soul">🌙</button>
              <button type="button" class="avatar-pick-item" data-avatar="⚡" title="Beatmaker">⚡</button>
              <button type="button" class="avatar-pick-item" data-avatar="🎵" title="Melodic">🎵</button>
              <button type="button" class="avatar-pick-item" data-avatar="🌟" title="Superfan">🌟</button>
              <button type="button" class="avatar-pick-item" data-avatar="🎙️" title="Vocalist">🎙️</button>
            </div>
          </div>

          <!-- Preferred Starting Genres Multi-Select -->
          <div>
            <label class="auth-field-label">
              <span>What music genres do you love? (Used for today's mix)</span>
            </label>
            <div class="genre-pick-grid" id="regGenrePicker">
              <button type="button" class="genre-pick-chip selected" data-genre="bollywood">Bollywood</button>
              <button type="button" class="genre-pick-chip selected" data-genre="romantic">Romantic</button>
              <button type="button" class="genre-pick-chip selected" data-genre="sufi">Sufi & Qawwali</button>
              <button type="button" class="genre-pick-chip" data-genre="punjabi">Punjabi</button>
              <button type="button" class="genre-pick-chip" data-genre="indie">Indie</button>
              <button type="button" class="genre-pick-chip" data-genre="lofi">Lo-Fi</button>
              <button type="button" class="genre-pick-chip" data-genre="quran">Quran & Tilawat</button>
            </div>
          </div>

          <div id="authRegError" class="auth-error-notice" style="display:none;"></div>
          <button type="button" id="btnExecuteRegister" class="btn-save-taste" style="margin-top: 4px;">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg>
            <span>Create Account & Save My Taste</span>
          </button>
          <div style="text-align: center; margin-top: 6px;">
            <span style="font-size: 0.78rem; color: var(--text-secondary);">Already have an account? </span>
            <button type="button" id="btnLinkToSignIn" style="background: none; border: none; color: var(--spotify-green); font-size: 0.78rem; font-weight: 700; cursor: pointer; text-decoration: underline; padding: 0;">Sign in</button>
          </div>
        </div>
      </div>

      <!-- TAB 2 CONTENT: DISCORD MEMBER VERIFICATION -->
      <div id="tabContentDiscord" class="auth-form-card" style="display: none;">
        <div>
          <label class="auth-field-label">
            <span>Discord User ID or Username</span>
          </label>
          <div style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 8px;">
            Directly verifies your membership in the Spy Sec Music server with instant bot permissions.
          </div>
          <input type="text" id="modalInputDiscordQuery" class="auth-text-input" placeholder="e.g. thruxun, painfuego, or 18-digit Discord ID...">
        </div>

        <div style="display: flex; flex-direction: column; gap: 6px;">
          <span style="font-size: 0.72rem; font-weight: 700; color: var(--text-secondary); text-transform: uppercase;">Quick Select Member:</span>
          <div class="server-members-scroll" id="serverMembersChipsList">
            <span style="font-size: 0.75rem; color: var(--text-subdued);">Loading members...</span>
          </div>
        </div>

        <div id="modalDiscordAuthErr" class="auth-error-notice" style="display:none;"></div>

        <button type="button" id="modalBtnDiscordSubmit" class="auth-submit-btn btn-discord">
          <span>Verify & Log In (Full Access)</span>
        </button>
      </div>
    `;

    // 1. Tab switching: Email Account vs Discord
    const tabCustomer = document.getElementById("tabBtnCustomer");
    const tabDiscord = document.getElementById("tabBtnDiscord");
    const contentCustomer = document.getElementById("tabContentCustomer");
    const contentDiscord = document.getElementById("tabContentDiscord");

    tabCustomer?.addEventListener("click", () => {
      tabCustomer.classList.add("active");
      tabDiscord.classList.remove("active");
      if (contentCustomer) contentCustomer.style.display = "flex";
      if (contentDiscord) contentDiscord.style.display = "none";
      document.getElementById("inputSignInEmail")?.focus();
    });

    tabDiscord?.addEventListener("click", () => {
      tabDiscord.classList.add("active");
      tabCustomer.classList.remove("active");
      if (contentCustomer) contentCustomer.style.display = "none";
      if (contentDiscord) contentDiscord.style.display = "flex";
      document.getElementById("modalInputDiscordQuery")?.focus();
    });

    // 2. Sub-Toggle: Sign In vs Create Account
    const btnSwitchSignIn = document.getElementById("btnSwitchSignIn");
    const btnSwitchCreate = document.getElementById("btnSwitchCreate");
    const formSignIn = document.getElementById("formSignInContainer");
    const formCreate = document.getElementById("formCreateContainer");

    const switchToSignIn = () => {
      btnSwitchSignIn?.classList.add("active");
      btnSwitchCreate?.classList.remove("active");
      if (formSignIn) formSignIn.style.display = "flex";
      if (formCreate) formCreate.style.display = "none";
      document.getElementById("inputSignInEmail")?.focus();
    };

    const switchToCreate = () => {
      btnSwitchCreate?.classList.add("active");
      btnSwitchSignIn?.classList.remove("active");
      if (formSignIn) formSignIn.style.display = "none";
      if (formCreate) formCreate.style.display = "flex";
      document.getElementById("inputRegEmail")?.focus();
    };

    btnSwitchSignIn?.addEventListener("click", switchToSignIn);
    btnSwitchCreate?.addEventListener("click", switchToCreate);
    document.getElementById("btnLinkToCreate")?.addEventListener("click", switchToCreate);
    document.getElementById("btnLinkToSignIn")?.addEventListener("click", switchToSignIn);

    // 3. Avatar Picker Handler
    document.querySelectorAll("#regAvatarPicker .avatar-pick-item").forEach(item => {
      item.addEventListener("click", () => {
        document.querySelectorAll("#regAvatarPicker .avatar-pick-item").forEach(i => i.classList.remove("selected"));
        item.classList.add("selected");
        regSelectedAvatar = item.getAttribute("data-avatar") || "🎧";
      });
    });

    // 4. Starting Genre Multi-Select Handler
    document.querySelectorAll("#regGenrePicker .genre-pick-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        const g = chip.getAttribute("data-genre");
        if (regSelectedGenres.has(g)) {
          regSelectedGenres.delete(g);
          chip.classList.remove("selected");
        } else {
          regSelectedGenres.add(g);
          chip.classList.add("selected");
        }
      });
    });

    // 5. Sign In Action (Email & Password)
    const executeCustomerLogin = async () => {
      const eInp = document.getElementById("inputSignInEmail");
      const pInp = document.getElementById("inputSignInPassword");
      const err = document.getElementById("authSignInError");
      const email = eInp ? eInp.value.trim() : "";
      const password = pInp ? pInp.value : "";

      if (!email) {
        if (err) {
          err.textContent = "Please enter your email address";
          err.style.display = "block";
        }
        return;
      }
      if (!password) {
        if (err) {
          err.textContent = "Please enter your password";
          err.style.display = "block";
        }
        return;
      }
      if (err) err.style.display = "none";

      let res, data;
      try {
        res = await fetch("/api/user/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password })
        });
        data = await res.json();
      } catch (e) {
        console.error("Login request error:", e);
        if (err) {
          err.textContent = "Network error connecting to server. Please ensure discord-bot is running and refresh the page.";
          err.style.display = "block";
        }
        return;
      }

      if (data && data.success && data.user) {
        try {
          if (data.token) localStorage.setItem("ahm_session_token", data.token);
          currentUser = data.user;
          localStorage.setItem("ahm_cached_user", JSON.stringify(data.user));
          updateUserProfileUI();
          await loadUserFavorites();
          await loadUserQueue();
          await loadDailyRecommendations(true);
          saveUserVault();
          closeProfileModal();
          showToast(`Welcome back, ${data.user.displayName || data.user.email}! Your daily taste mixes are loaded.`);
        } catch (postErr) {
          console.error("Post-login UI setup error:", postErr);
          closeProfileModal();
          showToast("Welcome back! Logged in successfully.");
        }
      } else {
        if (err) {
          err.textContent = (data && data.error) ? data.error : "Login failed. Please check your credentials.";
          err.style.display = "block";
        }
      }
    };

    document.getElementById("btnExecuteSignIn")?.addEventListener("click", executeCustomerLogin);
    document.getElementById("inputSignInPassword")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") executeCustomerLogin();
    });
    document.getElementById("inputSignInEmail")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") document.getElementById("inputSignInPassword")?.focus();
    });

    // 6. Registration Action (Email & Password)
    const executeCustomerRegister = async () => {
      const eInp = document.getElementById("inputRegEmail");
      const pInp = document.getElementById("inputRegPassword");
      const dInp = document.getElementById("inputRegDisplayName");
      const err = document.getElementById("authRegError");

      const email = eInp ? eInp.value.trim() : "";
      const password = pInp ? pInp.value : "";
      const displayName = dInp ? dInp.value.trim() : "";

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!email || !emailRegex.test(email)) {
        if (err) {
          err.textContent = "Please enter a valid email address (e.g. you@example.com).";
          err.style.display = "block";
        }
        return;
      }

      if (!password || password.length < 6) {
        if (err) {
          err.textContent = "Password must be at least 6 characters long.";
          err.style.display = "block";
        }
        return;
      }
      if (err) err.style.display = "none";

      let res, data;
      try {
        res = await fetch("/api/user/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password,
            displayName,
            avatar: regSelectedAvatar,
            preferredGenres: Array.from(regSelectedGenres)
          })
        });
        data = await res.json();
      } catch (e) {
        console.error("Registration request error:", e);
        if (err) {
          err.textContent = "Network error communicating with server. Please verify the server is running.";
          err.style.display = "block";
        }
        return;
      }

      if (data && data.success && data.user) {
        try {
          if (data.token) localStorage.setItem("ahm_session_token", data.token);
          currentUser = data.user;
          localStorage.setItem("ahm_cached_user", JSON.stringify(data.user));
          updateUserProfileUI();
          await loadUserFavorites();
          await loadUserQueue();
          await loadDailyRecommendations(true);
          saveUserVault();
          closeProfileModal();
          showToast(`Account created! Welcome, ${data.user.displayName || data.user.email}! Today's taste mix is ready.`);
        } catch (postErr) {
          console.error("Post-register UI setup error:", postErr);
          closeProfileModal();
          showToast("Account created successfully!");
        }
      } else {
        if (err) {
          err.textContent = (data && data.error) ? data.error : "Registration failed. Try a different email.";
          err.style.display = "block";
        }
      }
    };

    document.getElementById("btnExecuteRegister")?.addEventListener("click", executeCustomerRegister);
    document.getElementById("inputRegPassword")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") executeCustomerRegister();
    });
    document.getElementById("inputRegEmail")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") document.getElementById("inputRegPassword")?.focus();
    });

    // 7. Populate Discord Server Member Chips
    (async () => {
      try {
        const res = await fetch("/api/auth/server-members");
        const data = await res.json();
        const chipsContainer = document.getElementById("serverMembersChipsList");
        if (chipsContainer && data.success && Array.isArray(data.members) && data.members.length > 0) {
          chipsContainer.innerHTML = "";
          data.members.slice(0, 14).forEach(m => {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "server-member-chip";
            chip.innerHTML = `
              <img src="${m.avatar || 'logo.png'}">
              <span>${escapeHtml(m.displayName || m.username)}</span>
            `;
            chip.addEventListener("click", () => {
              const inp = document.getElementById("modalInputDiscordQuery");
              if (inp) {
                inp.value = m.id || m.username;
                executeDiscordAuth(m.id || m.username);
              }
            });
            chipsContainer.appendChild(chip);
          });
        }
      } catch(e) {}
    })();

    // 8. Discord Member Submit
    const executeDiscordAuth = async (queryVal) => {
      const inp = document.getElementById("modalInputDiscordQuery");
      const err = document.getElementById("modalDiscordAuthErr");
      const btn = document.getElementById("modalBtnDiscordSubmit");
      const q = queryVal || (inp ? inp.value.trim() : "");
      if (!q) {
        if (err) {
          err.textContent = "Please enter a Discord User ID or Username";
          err.style.display = "block";
        }
        return;
      }
      if (err) err.style.display = "none";
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Verifying membership...";
      }

      try {
        const res = await fetch("/api/auth/discord-verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q })
        });
        const data = await res.json();
        if (data.success && data.isServerMember) {
          if (data.token) localStorage.setItem("ahm_session_token", data.token);
          currentUser = data.user;
          localStorage.setItem("ahm_cached_user", JSON.stringify(data.user));
          updateUserProfileUI();
          await loadUserFavorites();
          await loadUserQueue();
          await loadDailyRecommendations(true);
          saveUserVault();
          closeProfileModal();
          showToast(`Welcome, ${data.user.displayName}! Verified server member.`);
        } else {
          if (err) {
            err.textContent = data.error || "User was not found in Discord server.";
            err.style.display = "block";
          }
        }
      } catch (e) {
        if (err) {
          err.textContent = "Network error communicating with server.";
          err.style.display = "block";
        }
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Verify & Log In (Full Access)";
        }
      }
    };

    document.getElementById("modalBtnDiscordSubmit")?.addEventListener("click", () => executeDiscordAuth());
    document.getElementById("modalInputDiscordQuery")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") executeDiscordAuth();
    });
  }

  // Mobile Server Link & Legal Information Section
  const serverBox = document.createElement("div");
  serverBox.style.cssText = "margin-top: 18px; border-top: 1px solid var(--border-subtle); padding-top: 14px;";
  serverBox.innerHTML = `
    <div style="background: var(--bg-card-elevated); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 14px; margin-bottom: 12px;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
        <span style="font-size: 0.84rem; font-weight: 700; color: var(--text-header); display: flex; align-items: center; gap: 8px;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12.55a11 11 0 0 1 14.08 0"></path><path d="M1.42 9a16 16 0 0 1 21.16 0"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>
          <span>Server Connection (Built-in Cloud)</span>
        </span>
        <span id="mobileServerStatusBadge" style="font-size: 0.72rem; font-weight: 700; padding: 3px 9px; border-radius: 12px; background: var(--emerald-soft); color: var(--emerald);">
          ● Connected
        </span>
      </div>
      <p style="font-size: 0.76rem; color: var(--text-secondary); margin: 0 0 10px 0; line-height: 1.45;">
        Built-in Server: <strong style="color: var(--emerald); font-family: monospace;">https://track-finder.onrender.com</strong>
        <br><span style="color: var(--text-subdued); font-size: 0.72rem;">Live streaming audio, queue sync, search, and playlists are pre-wired. No setup required.</span>
      </p>
      <div style="display: flex; gap: 8px; margin-bottom: 8px;">
        <input type="text" id="inputMobileServerUrl" placeholder="https://track-finder.onrender.com" value="${escapeHtml(localStorage.getItem('ahm_server_url') || '')}" style="flex: 1; background: var(--bg-surface); border: 1px solid var(--border-medium); color: var(--text-primary); padding: 7px 10px; border-radius: 6px; font-size: 0.78rem;">
        <button id="btnSaveMobileServerUrl" type="button" style="background: var(--text-primary); color: var(--bg-canvas); border: none; padding: 7px 12px; border-radius: 6px; font-weight: 700; font-size: 0.78rem; cursor: pointer; white-space: nowrap;">Save & Test</button>
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <button id="btnUseBuiltInServer" type="button" style="background: var(--bg-surface); border: 1px solid var(--border-medium); color: var(--text-primary); padding: 5px 10px; border-radius: 6px; font-size: 0.72rem; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px;">
          <span>⚡ Reset to Built-in Server</span>
        </button>
      </div>
    </div>

    <!-- Legal Links -->
    <div style="display: flex; justify-content: center; gap: 14px; font-size: 0.74rem; color: var(--text-subdued);">
      <a href="/terms-of-service" target="_blank" style="color: var(--text-subdued); text-decoration: none;">Terms of Service</a>
      <span style="color: var(--border-medium);">•</span>
      <a href="/privacy-policy" target="_blank" style="color: var(--text-subdued); text-decoration: none;">Privacy Policy</a>
    </div>
  `;
  body.appendChild(serverBox);

  async function testServerConnection() {
    const badge = document.getElementById("mobileServerStatusBadge");
    if (badge) {
      badge.textContent = "Testing...";
      badge.style.color = "var(--text-secondary)";
      badge.style.background = "var(--bg-surface)";
    }
    try {
      const res = await fetch("/api/state");
      if (res.ok) {
        if (badge) {
          badge.textContent = "● Connected";
          badge.style.color = "var(--emerald)";
          badge.style.background = "var(--emerald-soft)";
        }
      } else {
        if (badge) {
          badge.textContent = "▲ Error";
          badge.style.color = "var(--text-secondary)";
        }
      }
    } catch (err) {
      if (badge) {
        badge.textContent = "✕ Offline";
        badge.style.color = "var(--danger)";
        badge.style.background = "rgba(239, 68, 68, 0.15)";
      }
    }
  }

  document.getElementById("btnUseBuiltInServer")?.addEventListener("click", () => {
    localStorage.removeItem("ahm_server_url");
    const input = document.getElementById("inputMobileServerUrl");
    if (input) input.value = "";
    showToast("Connected to built-in server: https://track-finder.onrender.com");
    testServerConnection();
  });

  document.getElementById("btnSaveMobileServerUrl")?.addEventListener("click", async () => {
    const val = (document.getElementById("inputMobileServerUrl")?.value || "").trim();
    if (val) {
      if (!val.startsWith("http://") && !val.startsWith("https://")) {
        showToast("Invalid URL! Must start with http:// or https:// (e.g. https://track-finder.onrender.com). Do not paste terminal commands here.");
        const badge = document.getElementById("mobileServerStatusBadge");
        if (badge) {
          badge.textContent = "✕ Invalid URL";
          badge.style.color = "var(--danger)";
        }
        return;
      }
      localStorage.setItem("ahm_server_url", val.replace(/\/+$/, ""));
      showToast(`Server address saved: ${val}`);
    } else {
      localStorage.removeItem("ahm_server_url");
      showToast("Reverted to built-in server: https://track-finder.onrender.com");
    }
    await testServerConnection();
  });

  modal.style.display = "flex";
}

// ==========================================================================
// TUNE MUSIC TASTE MODAL (CUSTOMIZE GENRES & FAVORITE ARTISTS)
// ==========================================================================
let tuneTasteSelectedGenres = new Set();

function openTuneTasteModal() {
  const modal = document.getElementById("modalTuneTaste");
  const body = document.getElementById("tuneTasteModalBody");
  if (!modal || !body) return;

  // Initialize selected genres from cached storage, user taste profile or defaults
  let cachedPrefs = null;
  try {
    const raw = localStorage.getItem("ahm_user_taste_preferences");
    if (raw) cachedPrefs = JSON.parse(raw);
  } catch(e) {}
  const userPrefs = (Array.isArray(cachedPrefs?.preferredGenres) && cachedPrefs.preferredGenres.length > 0)
    ? cachedPrefs.preferredGenres
    : ((currentUser?.tasteProfile?.preferredGenres) || (userTasteProfile?.preferredGenres) || ["bollywood", "romantic", "sufi"]);
  tuneTasteSelectedGenres = new Set(userPrefs);

  const curArtists = cachedPrefs?.favoriteArtists?.join(", ") || (currentUser?.tasteProfile?.topArtists || userTasteProfile?.topArtists || []).map(a => a.artist || a.key || a).join(", ");

  body.innerHTML = `
    <div style="margin-bottom: 16px;">
      <div style="font-size: 0.88rem; font-weight: 700; color: var(--text-header); margin-bottom: 4px;">Choose Your Preferred Genres</div>
      <div style="font-size: 0.78rem; color: var(--text-secondary); margin-bottom: 12px;">
        Tap genres to include in your daily rotation. The engine recalibrates your homepage mixes immediately.
      </div>

      <div class="genre-pick-grid" id="tuneGenreChips">
        <button type="button" class="genre-pick-chip ${tuneTasteSelectedGenres.has('bollywood') ? 'selected' : ''}" data-genre="bollywood">Bollywood</button>
        <button type="button" class="genre-pick-chip ${tuneTasteSelectedGenres.has('romantic') ? 'selected' : ''}" data-genre="romantic">Romantic & Chill</button>
        <button type="button" class="genre-pick-chip ${tuneTasteSelectedGenres.has('sufi') ? 'selected' : ''}" data-genre="sufi">Sufi & Qawwali</button>
        <button type="button" class="genre-pick-chip ${tuneTasteSelectedGenres.has('punjabi') ? 'selected' : ''}" data-genre="punjabi">Punjabi Hits</button>
        <button type="button" class="genre-pick-chip ${tuneTasteSelectedGenres.has('indie') ? 'selected' : ''}" data-genre="indie">Indian Indie</button>
        <button type="button" class="genre-pick-chip ${tuneTasteSelectedGenres.has('lofi') ? 'selected' : ''}" data-genre="lofi">Lo-Fi Beats</button>
        <button type="button" class="genre-pick-chip ${tuneTasteSelectedGenres.has('quran') ? 'selected' : ''}" data-genre="quran">Quran & Tilawat</button>
        <button type="button" class="genre-pick-chip ${tuneTasteSelectedGenres.has('islamic') ? 'selected' : ''}" data-genre="islamic">Islamic Vocal</button>
      </div>
    </div>

    <div style="margin-bottom: 16px;">
      <label class="auth-field-label">
        <span>Favorite Artists (Optional, Comma Separated)</span>
      </label>
      <input type="text" id="tuneInputArtists" class="auth-text-input" placeholder="e.g. Arijit Singh, Atif Aslam, Pritam..." value="${escapeHtml(curArtists)}">
    </div>

    <div style="background: rgba(30, 215, 96, 0.08); border: 1px solid rgba(30, 215, 96, 0.2); border-radius: 8px; padding: 10px 12px; margin-bottom: 16px; font-size: 0.76rem; color: var(--text-secondary);">
      💡 <strong>Everyday Rotation</strong>: Your selected preferences weight your Daily Mix 1, Daily Discovery, and 2x4 Quick Access grid. Changes update immediately!
    </div>

    <button type="button" id="btnSaveTasteCalibration" class="btn-save-taste">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
      <span>Save Preferences & Update Homepage Tracks</span>
    </button>
  `;

  // Genre chip click handler
  document.querySelectorAll("#tuneGenreChips .genre-pick-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const g = chip.getAttribute("data-genre");
      if (tuneTasteSelectedGenres.has(g)) {
        tuneTasteSelectedGenres.delete(g);
        chip.classList.remove("selected");
      } else {
        tuneTasteSelectedGenres.add(g);
        chip.classList.add("selected");
      }
    });
  });

  // Save Taste Calibration
  document.getElementById("btnSaveTasteCalibration")?.addEventListener("click", async () => {
    const artistsVal = (document.getElementById("tuneInputArtists")?.value || "").trim();
    const artistsArr = artistsVal.split(",").map(a => a.trim()).filter(Boolean);
    const genresArr = Array.from(tuneTasteSelectedGenres);
    const token = localStorage.getItem("ahm_session_token");

    // Persist immediately in localStorage so client is always updated
    try {
      localStorage.setItem("ahm_user_taste_preferences", JSON.stringify({
        preferredGenres: genresArr,
        favoriteArtists: artistsArr
      }));
      if (userTasteProfile) {
        userTasteProfile.preferredGenres = genresArr;
      }
    } catch(e) {}

    closeTuneTasteModal();

    try {
      const res = await fetch("/api/user/taste/calibrate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "Authorization": `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          preferredGenres: genresArr,
          favoriteArtists: artistsArr
        })
      });
      const data = await res.json();
      if (data && data.success && data.recommendations) {
        userDailyRecommendations = data.recommendations;
        window.userDailyRecommendations = data.recommendations;
        if (data.tasteProfile) {
          userTasteProfile = data.tasteProfile;
          window.userTasteProfile = data.tasteProfile;
        }
        renderPersonalizedHomepage();
      } else {
        await loadDailyRecommendations(true);
      }
      showToast("Taste updated! Today's homepage mixes recalculated.");
    } catch (e) {
      await loadDailyRecommendations(true);
      showToast("Taste saved! Homepage mixes refreshed.");
    }
  });

  modal.style.display = "flex";
}

function closeTuneTasteModal() {
  const modal = document.getElementById("modalTuneTaste");
  if (modal) modal.style.display = "none";
}

function closeProfileModal() {
  const modal = document.getElementById("modalUserProfile");
  if (modal) modal.style.display = "none";
}

// ==========================================================================
// UI UPDATE ENGINES (PLAYER BAR, RIGHT PANEL, MOBILE PILL)
// ==========================================================================
function updateUIWithTrack(track, isPlaying = false) {
  const playerArt = document.getElementById("playerTrackImg");
  const playerTitle = document.getElementById("playerTrackTitle");
  const playerArtist = document.getElementById("playerTrackArtist");

  const rightArt = document.getElementById("rightTrackArt");
  const rightTitle = document.getElementById("rightTrackTitle");
  const rightArtist = document.getElementById("rightTrackAuthor");

  const mobileImg = document.getElementById("mobilePlayerImg");
  const mobileTitle = document.getElementById("mobilePlayerTitle");
  const mobileArtist = document.getElementById("mobilePlayerArtist");

  // Origin Island Live Notch Capsule Elements
  const vivoCapsule = document.getElementById("vivoOriginNotificationBar");
  const capsuleImg = document.getElementById("vivoCapsuleImg");
  const capsuleImgMini = document.getElementById("vivoCapsuleImgMini");
  const capsuleTitle = document.getElementById("vivoCapsuleTitle");
  const notchTitle = document.getElementById("notchCompactTitle");
  const capsuleArtist = document.getElementById("vivoCapsuleArtist");

  const expImg = document.getElementById("expandedTrackImg");
  const expTitle = document.getElementById("expandedTrackTitle");
  const expArtist = document.getElementById("expandedTrackArtist");
  const expBackdrop = document.getElementById("expandedBackdrop");

  if (track) {
    const title = track.title || track.info?.title || "Unknown Track";
    const author = track.author || track.info?.author || "Artist";
    const art = track.artworkUrl || track.info?.artworkUrl || "logo.png";

    if (playerArt) playerArt.src = art;
    if (playerTitle) playerTitle.textContent = title;
    if (playerArtist) playerArtist.textContent = author;

    if (rightArt) rightArt.src = art;
    if (rightTitle) rightTitle.textContent = title;
    if (rightArtist) rightArtist.textContent = author;

    if (mobileImg) mobileImg.src = art;
    if (mobileTitle) mobileTitle.textContent = title;
    if (mobileArtist) mobileArtist.textContent = author;

    if (capsuleImg) capsuleImg.src = art;
    if (capsuleImgMini) capsuleImgMini.src = art;
    if (capsuleTitle) capsuleTitle.textContent = title;
    if (notchTitle) notchTitle.textContent = title;
    if (capsuleArtist) capsuleArtist.textContent = author;

    if (expImg) expImg.src = art;
    if (expTitle) expTitle.textContent = title;
    if (expArtist) expArtist.textContent = author;
    if (expBackdrop) expBackdrop.style.backgroundImage = `url("${art}")`;

    if (vivoCapsule && !window._vivoCapsuleDismissed) {
      vivoCapsule.classList.add("visible");
    }

    // Dynamic browser tab title
    try {
      const cleanTitle = (title || "").replace(/\s+/g, " ").trim();
      const cleanAuthor = (author || "").replace(/\s+/g, " ").trim();
      document.title = `${isPlaying ? "▶ " : "⏸ "}${cleanTitle} • ${cleanAuthor} | Spy Sec Music`;
    } catch (_) {}
  } else {
    if (playerTitle) playerTitle.textContent = "Web Browser Ready";
    if (playerArtist) playerArtist.textContent = "Select a song or playlist";
    if (playerArt) playerArt.src = "logo.png";

    if (rightTitle) rightTitle.textContent = "Ready to Play";
    if (rightArtist) rightArtist.textContent = "Select a song or playlist";
    if (rightArt) rightArt.src = "logo.png";

    if (mobileTitle) mobileTitle.textContent = "Browser Ready";
    if (mobileArtist) mobileArtist.textContent = "Select a song";
    if (mobileImg) mobileImg.src = "logo.png";

    if (capsuleTitle) capsuleTitle.textContent = "Web Browser Ready";
    if (notchTitle) notchTitle.textContent = "Spy Sec Music";
    if (capsuleArtist) capsuleArtist.textContent = "Select a song";
    if (capsuleImg) capsuleImg.src = "logo.png";
    if (capsuleImgMini) capsuleImgMini.src = "logo.png";

    if (expTitle) expTitle.textContent = "Web Browser Ready";
    if (expArtist) expArtist.textContent = "Select a song or playlist";
    if (expImg) expImg.src = "logo.png";
    if (expBackdrop) expBackdrop.style.backgroundImage = `url("logo.png")`;

    if (vivoCapsule) {
      vivoCapsule.classList.remove("visible");
    }

    try {
      document.title = "Spy Sec Music — Free Sovereign Lossless Audio Player & Web Music Hub";
    } catch (_) {}
  }

  if (typeof updateRadioUI === "function") updateRadioUI();
  updatePlayPauseIcons(isPlaying);
}

function updateRadioUI() {
  const isRadio = Boolean(BrowserPlayer.isRadioActive);
  const isAutoplay = Boolean(BrowserPlayer.autoplayRadioEnabled);
  const seed = BrowserPlayer.activeRadioSeed;
  const current = BrowserPlayer.currentTrack;

  // 1. Expanded Header: Subhead indicator & Station Name
  const expSubhead = document.getElementById("expandedSubhead");
  const expSourceName = document.getElementById("expandedSourceName");
  if (expSubhead) {
    if (isRadio) {
      expSubhead.innerHTML = '<span class="radio-pulse-dot"></span> PLAYING FROM RADIO';
      expSubhead.style.color = "var(--emerald, #1ed760)";
    } else {
      expSubhead.textContent = "PLAYING FROM";
      expSubhead.style.color = "";
    }
  }
  if (expSourceName) {
    if (isRadio && seed) {
      const seedName = seed.title || seed.info?.title || "Artist";
      expSourceName.textContent = `${seedName} Radio`;
    } else if (!isRadio) {
      expSourceName.textContent = "Spy Sec Music Hub";
    }
  }

  // 2. Expanded Header Antenna / Radio Action Button
  const btnExpRadio = document.getElementById("btnExpandedRadio");
  if (btnExpRadio) {
    btnExpRadio.classList.toggle("active", isRadio);
    if (isRadio) {
      btnExpRadio.setAttribute("title", `Playing ${seed?.title || "Song"} Radio (Tap to change)`);
    } else {
      btnExpRadio.setAttribute("title", "Go to Song Radio (Spotify Infinite Radio)");
    }
  }

  // 3. Expanded Radio Quick-Launch Pill
  const btnExpRadioPill = document.getElementById("btnExpandedRadioPill");
  const expRadioPillText = document.getElementById("expandedRadioPillText");
  if (btnExpRadioPill) {
    btnExpRadioPill.classList.toggle("active", isRadio);
  }
  if (expRadioPillText) {
    if (isRadio && seed) {
      const shortName = seed.title ? (seed.title.length > 20 ? seed.title.substring(0, 18) + "…" : seed.title) : "Live";
      expRadioPillText.textContent = `🟢 Radio: ${shortName}`;
    } else if (current && current.title) {
      const shortTitle = current.title.length > 16 ? current.title.substring(0, 15) + "…" : current.title;
      expRadioPillText.textContent = `Start ${shortTitle} Radio`;
    } else {
      expRadioPillText.textContent = "Start Spotify Radio";
    }
  }

  // 4. Expanded Radio Autoplay Toggle Button & Status Text
  const btnExpAutoplay = document.getElementById("btnExpandedRadioAutoplay");
  const expAutoplayStatusText = document.getElementById("expandedAutoplayStatusText");
  if (btnExpAutoplay) {
    btnExpAutoplay.classList.toggle("active", isAutoplay);
  }
  if (expAutoplayStatusText) {
    expAutoplayStatusText.textContent = isAutoplay ? "Autoplay Radio: ON" : "Autoplay Radio: OFF";
  }

  // 5. Also sync bottom bar / queue view radio buttons if present
  const btnQueueAutoplay = document.getElementById("btnToggleAutoplay");
  if (btnQueueAutoplay) {
    btnQueueAutoplay.classList.toggle("active", isAutoplay);
    const span = btnQueueAutoplay.querySelector("span:not(.radio-pulse-dot)");
    if (span) span.textContent = `Autoplay Radio: ${isAutoplay ? "On" : "Off"}`;
  }
}
window.updateRadioUI = updateRadioUI;

function updatePlayPauseIcons(isPlaying) {
  const svg = document.getElementById("mainPlayPauseSvg");
  const mobileBtn = document.getElementById("btnMobilePlayPause");
  const capsuleSvg = document.getElementById("capsulePlayPauseSvg");
  const notchQuickSvg = document.getElementById("notchQuickPlaySvg");
  const expSvg = document.getElementById("expandedPlayPauseSvg");
  const expOverlay = document.getElementById("expandedNowPlayingOverlay");
  const visualizer = document.getElementById("rightVisualizerBars");

  // Origin Island Notch Vinyl Discs & Soundwave Equalizers
  const vinylDiscs = document.querySelectorAll(".vivo-vinyl-disc, .vivo-capsule-vinyl");
  const equalizers = document.querySelectorAll(".vivo-equalizer");
  const vivoCapsule = document.getElementById("vivoOriginNotificationBar");

  // Play button wrappers
  const mainBtn = document.getElementById("btnMainPlayPause");
  const capsuleBtn = document.getElementById("btnCapsulePlayPause");
  const notchBtn = document.getElementById("btnNotchQuickPlay");
  const expBtn = document.getElementById("btnExpandedPlayPause");
  const notchRingContainer = document.querySelector(".notch-progress-ring-container");

  const isBuffering = Boolean(BrowserPlayer.isBuffering);

  // Toggle buffering animation classes on all play buttons
  [mainBtn, mobileBtn, capsuleBtn, notchBtn, expBtn, notchRingContainer].forEach(el => {
    if (el) el.classList.toggle("is-buffering", isBuffering);
  });

  const spinnerPaths = '<circle class="spinner-track" cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="2.6" opacity="0.25"/><circle class="spinner-head" cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="59" stroke-dashoffset="40"/>';
  const pausePaths = '<path d="M2.7 1a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7H2.7zm8 0a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7h-2.6z"/>';
  const playPaths = '<path d="M3 1.713a.7.7 0 0 1 1.05-.607l10.89 6.288a.7.7 0 0 1 0 1.212L4.05 14.894A.7.7 0 0 1 3 14.288V1.713z"/>';

  if (isBuffering) {
    if (svg) {
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.classList.add("buffering-spinner-svg");
      svg.innerHTML = spinnerPaths;
    }
    if (mobileBtn) {
      mobileBtn.innerHTML = `<svg class="buffering-spinner-svg" viewBox="0 0 24 24" width="16" height="16">${spinnerPaths}</svg>`;
    }
    if (capsuleSvg) {
      capsuleSvg.setAttribute("viewBox", "0 0 24 24");
      capsuleSvg.classList.add("buffering-spinner-svg");
      capsuleSvg.innerHTML = spinnerPaths;
    }
    if (notchQuickSvg) {
      notchQuickSvg.setAttribute("viewBox", "0 0 24 24");
      notchQuickSvg.classList.add("buffering-spinner-svg");
      notchQuickSvg.innerHTML = spinnerPaths;
    }
    if (expSvg) {
      expSvg.setAttribute("viewBox", "0 0 24 24");
      expSvg.classList.add("buffering-spinner-svg");
      expSvg.innerHTML = spinnerPaths;
    }

    if (expOverlay) expOverlay.classList.remove("playing");
    if (visualizer) visualizer.classList.remove("playing");
    equalizers.forEach(eq => eq.classList.remove("playing"));

    // Pause vinyl disc rotation while waiting for audio network chunks
    vinylDiscs.forEach(d => {
      d.classList.remove("vivo-vinyl-spinning");
      d.classList.add("vivo-vinyl-paused");
    });

    if (vivoCapsule && !window._vivoCapsuleDismissed && (BrowserPlayer.currentTrack || Boolean(currentState?.channels?.bot?.current) || Boolean(currentState?.current))) {
      vivoCapsule.classList.add("visible");
    }
  } else if (isPlaying) {
    if (svg) {
      svg.setAttribute("viewBox", "0 0 16 16");
      svg.classList.remove("buffering-spinner-svg");
      svg.innerHTML = pausePaths;
    }
    if (mobileBtn) {
      mobileBtn.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14">${pausePaths}</svg>`;
    }
    if (capsuleSvg) {
      capsuleSvg.setAttribute("viewBox", "0 0 16 16");
      capsuleSvg.classList.remove("buffering-spinner-svg");
      capsuleSvg.innerHTML = pausePaths;
    }
    if (notchQuickSvg) {
      notchQuickSvg.setAttribute("viewBox", "0 0 16 16");
      notchQuickSvg.classList.remove("buffering-spinner-svg");
      notchQuickSvg.innerHTML = pausePaths;
    }
    if (expSvg) {
      expSvg.setAttribute("viewBox", "0 0 16 16");
      expSvg.classList.remove("buffering-spinner-svg");
      expSvg.innerHTML = pausePaths;
    }
    if (expOverlay) expOverlay.classList.add("playing");
    if (visualizer) visualizer.classList.add("playing");

    // Spin vinyl discs smoothly
    vinylDiscs.forEach(d => {
      d.classList.remove("vivo-vinyl-paused");
      d.classList.add("vivo-vinyl-spinning");
    });
    // Animate soundwave equalizer bars
    equalizers.forEach(eq => eq.classList.add("playing"));

    if (vivoCapsule && !window._vivoCapsuleDismissed && (BrowserPlayer.currentTrack || Boolean(currentState?.channels?.bot?.current) || Boolean(currentState?.current))) {
      vivoCapsule.classList.add("visible");
    }
  } else {
    if (svg) {
      svg.setAttribute("viewBox", "0 0 16 16");
      svg.classList.remove("buffering-spinner-svg");
      svg.innerHTML = playPaths;
    }
    if (mobileBtn) {
      mobileBtn.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14">${playPaths}</svg>`;
    }
    if (capsuleSvg) {
      capsuleSvg.setAttribute("viewBox", "0 0 16 16");
      capsuleSvg.classList.remove("buffering-spinner-svg");
      capsuleSvg.innerHTML = playPaths;
    }
    if (notchQuickSvg) {
      notchQuickSvg.setAttribute("viewBox", "0 0 16 16");
      notchQuickSvg.classList.remove("buffering-spinner-svg");
      notchQuickSvg.innerHTML = playPaths;
    }
    if (expSvg) {
      expSvg.setAttribute("viewBox", "0 0 16 16");
      expSvg.classList.remove("buffering-spinner-svg");
      expSvg.innerHTML = playPaths;
    }
    if (expOverlay) expOverlay.classList.remove("playing");
    if (visualizer) visualizer.classList.remove("playing");

    // Pause vinyl disc rotation in place
    vinylDiscs.forEach(d => {
      d.classList.remove("vivo-vinyl-spinning");
      d.classList.add("vivo-vinyl-paused");
    });
    // Pause equalizer animation
    equalizers.forEach(eq => eq.classList.remove("playing"));
  }
}

function updateProgressUI(curSec, durSec, pct) {
  const curLabel = document.getElementById("currentTimeLabel");
  const totLabel = document.getElementById("totalDurationLabel");
  const fill = document.getElementById("playbackProgressFill");
  const microFill = document.getElementById("mobileMicroFill");
  const capsuleFill = document.getElementById("vivoCapsuleFill");

  const expCurLabel = document.getElementById("expandedCurrentTime");
  const expTotLabel = document.getElementById("expandedTotalDuration");
  const expFill = document.getElementById("expandedProgressFill");

  // Origin Island Notch Elements
  const notchTime = document.getElementById("notchCompactTime");
  const ringCircle = document.getElementById("notchProgressRingCircle");
  const islandTimeCur = document.getElementById("islandTimeCurrent");
  const islandTimeTot = document.getElementById("islandTimeTotal");
  const islandSeekThumb = document.getElementById("islandSeekThumb");

  const timeStr = formatTime(curSec * 1000);
  const durStr = durSec > 0 ? formatTime(durSec * 1000) : "0:00";

  if (curLabel) curLabel.textContent = timeStr;
  if (totLabel && durSec > 0) totLabel.textContent = durStr;
  if (fill) fill.style.width = `${pct}%`;
  if (microFill) microFill.style.width = `${pct}%`;
  if (capsuleFill) capsuleFill.style.width = `${pct}%`;

  if (expCurLabel) expCurLabel.textContent = timeStr;
  if (expTotLabel && durSec > 0) expTotLabel.textContent = durStr;
  if (expFill) expFill.style.width = `${pct}%`;

  // Origin Island Notch Progress & Seekbar Updates
  if (notchTime) notchTime.textContent = timeStr;
  if (islandTimeCur) islandTimeCur.textContent = timeStr;
  if (islandTimeTot && durSec > 0) islandTimeTot.textContent = durStr;
  if (islandSeekThumb) islandSeekThumb.style.left = `${pct}%`;

  if (ringCircle) {
    // Circumference = 2 * PI * 11 ≈ 69.115
    const circumference = 69.115;
    const offset = Math.max(0, Math.min(circumference - (circumference * pct / 100), circumference));
    ringCircle.style.strokeDashoffset = offset.toFixed(2);
  }
}

function updateVolumeUI(percent) {
  const fill = document.getElementById("volumeFill");
  const expFill = document.getElementById("expandedVolFill");
  if (fill) fill.style.width = `${percent}%`;
  if (expFill) expFill.style.width = `${percent}%`;
}

function updateRepeatUI(mode) {
  const btn = document.getElementById("btnRepeat");
  if (!btn) return;
  btn.classList.toggle("active", mode !== "off");
  if (mode === "track") {
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M0 4.75A3.75 3.75 0 0 1 3.75 1h.75v1.5h-.75A2.25 2.25 0 0 0 1.5 4.75v5A2.25 2.25 0 0 0 3.75 12H5v1.5H3.75A3.75 3.75 0 0 1 0 9.75v-5ZM12.25 2.5a2.25 2.25 0 0 1 2.25 2.25v5A2.25 2.25 0 0 1 12.25 12H9.81l1.018-1.018a.75.75 0 0 0-1.06-1.06L6.939 12.75l2.829 2.828a.75.75 0 1 0 1.06-1.06L9.811 13.5h2.439A3.75 3.75 0 0 0 16 9.75v-5A3.75 3.75 0 0 0 12.25 1h-.75v1.5h.75Z"/>
        <path d="m8 1.85.77.694H6.095V1.488c.697-.051 1.2-.18 1.507-.385.316-.205.51-.51.583-.913h1.32V8H8V1.85Z"/>
      </svg>
    `;
  } else {
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M0 4.75A3.75 3.75 0 0 1 3.75 1h8.5A3.75 3.75 0 0 1 16 4.75v5a3.75 3.75 0 0 1-3.75 3.75H9.81l1.018 1.018a.75.75 0 1 1-1.06 1.06L6.939 12.75l2.829-2.828a.75.75 0 1 1 1.06 1.06L9.811 12h2.439a2.25 2.25 0 0 0 2.25-2.25v-5a2.25 2.25 0 0 0-2.25-2.25h-8.5A2.25 2.25 0 0 0 1.5 4.75v5A2.25 2.25 0 0 0 3.75 12H5v1.5H3.75A3.75 3.75 0 0 1 0 9.75v-5z"/>
      </svg>
    `;
  }
}

// Master UI Update from Polled State
function updateUI(state) {
  if (!state) return;
  const channels = state.channels || {};

  // Micro indicators on system channel tabs
  if (channels.browser) {
    const tab = document.getElementById("sysTabBrowser");
    const isP = BrowserPlayer.isPlaying() || channels.browser.isPlaying;
    tab?.classList.toggle("playing", Boolean(isP));
  }
  if (channels.app) {
    const tab = document.getElementById("sysTabApp");
    tab?.classList.toggle("playing", Boolean(channels.app.isPlaying));
  }
  if (channels.bot) {
    const tab = document.getElementById("sysTabBot");
    tab?.classList.toggle("playing", Boolean(channels.bot.isPlaying));
  }

  // Populate Announcement Channel Select Options (Grouped by Server)
  const announceSelect = document.getElementById("announcementChannelSelect");
  if (announceSelect && (Array.isArray(state.servers) || Array.isArray(state.availableTextChannels))) {
    const versionKey = `${state.channelsVersion || 0}_${state.announcementChannelId || ''}`;
    if (announceSelect.dataset.version !== versionKey && document.activeElement !== announceSelect) {
      announceSelect.dataset.version = versionKey;
      const activeVal = state.announcementChannelId || announceSelect.value || "1559799364732452915";
      announceSelect.innerHTML = "";

      if (Array.isArray(state.servers) && state.servers.length > 0) {
        state.servers.forEach(srv => {
          const group = document.createElement("optgroup");
          group.label = `Server: ${srv.guildName} (${srv.channels.length} channels)`;
          srv.channels.forEach(ch => {
            const opt = document.createElement("option");
            opt.value = ch.id;
            opt.textContent = `#${ch.name}${ch.category ? ` • ${ch.category}` : ''}`;
            if (ch.id === activeVal || (ch.name === "music" && !activeVal)) {
              opt.selected = true;
            }
            group.appendChild(opt);
          });
          announceSelect.appendChild(group);
        });
      } else if (Array.isArray(state.availableTextChannels)) {
        state.availableTextChannels.forEach(ch => {
          const opt = document.createElement("option");
          opt.value = ch.id;
          opt.textContent = `${ch.guildName ? `[${ch.guildName}] ` : ''}#${ch.name}`;
          if (ch.id === activeVal || ch.name === "music") opt.selected = true;
          announceSelect.appendChild(opt);
        });
      }

      if (activeVal) {
        announceSelect.value = activeVal;
      }
    } else if (state.announcementChannelId && document.activeElement !== announceSelect && announceSelect.value !== state.announcementChannelId) {
      announceSelect.value = state.announcementChannelId;
    }
  }

  // Dedicated local channel playback: Web uses 'browser', Mobile App uses 'app'
  const localChan = isMobileAppEnvironment ? "app" : "browser";
  if (activeSystemChannel === localChan || activeSystemChannel === "browser" || activeSystemChannel === "app") {
    updateUIWithTrack(BrowserPlayer.currentTrack, BrowserPlayer.isPlaying());
    return;
  }

  // Active channel is Discord Bot or Mobile App
  const activeChan = channels[activeSystemChannel] || channels.bot || state;
  const track = activeChan.current;
  const isPlaying = Boolean(activeChan.isPlaying && !activeChan.isPaused);
  updateUIWithTrack(track, isPlaying);

  if (!isScrubbing && track) {
    const cur = (activeChan.position || 0) / 1000;
    const dur = (track.duration || track.info?.duration || 0) / 1000;
    const pct = dur > 0 ? (cur / dur) * 100 : 0;
    updateProgressUI(cur, dur, pct);
  }
}

// Interactive API Dispatcher
async function sendAction(action, value = null, extra = {}) {
  try {
    const targetChannel = extra.targetChannel || activeSystemChannel;
    const token = localStorage.getItem("ahm_session_token") || "";
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch("/api/action", {
      method: "POST",
      headers,
      body: JSON.stringify({ targetChannel, action, value, ...extra })
    });
    const data = await res.json();
    if (res.status === 403 || data.requireDiscordAuth) {
      showToast("Discord server member verification required to control bot");
      openProfileModal();
      return data;
    }
    fetchState();
    return data;
  } catch (err) {
    console.error("Action error:", err);
  }
}

// Polling State Fetcher (Dedicated to local platform: 'app' for Mobile, 'browser' for Web)
async function fetchState() {
  try {
    const platform = isMobileAppEnvironment ? "app" : "browser";
    const token = localStorage.getItem("ahm_session_token") || "";
    const headers = token ? { "Authorization": `Bearer ${token}` } : {};
    const res = await fetch(`/api/state?channel=${platform}`, { headers });
    if (!res.ok) return;
    const state = await res.json();
    currentState = state;

    // Enforce: One sign in must be in one app!
    // Check if session was revoked because user signed in on another device
    if (token && state.sessionRevoked) {
      console.warn("Session revoked because user signed in on another device.");
      currentUser = null;
      localStorage.removeItem("ahm_session_token");
      localStorage.removeItem("ahm_cached_user");
      localStorage.removeItem("ahm_user_vault");
      updateUserProfileUI();
      showToast("Signed in on another device. This session has ended.");
      return;
    }

    if (state.currentUser) {
      currentUser = state.currentUser;
      updateUserProfileUI();
    }
    updateUI(state);

    // Midnight rollover detection: update total homepage track recommendations every day
    const todayDateStr = new Date().toISOString().slice(0, 10);
    if (lastLoadedRecommendationDate && lastLoadedRecommendationDate !== todayDateStr) {
      lastLoadedRecommendationDate = todayDateStr;
      loadDailyRecommendations(false);
    }
  } catch (err) {}
}

// Time Formatter
function formatTime(ms) {
  if (!ms || isNaN(ms)) return "0:00";
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

// Toast Notifier (Success, Error & Info with Emil Kowalski Micro-Motion)
function showToast(msg, type = null) {
  const toast = document.getElementById("toastNotification");
  if (!toast) return;

  // Auto-detect type if not explicitly supplied
  if (!type) {
    const lower = String(msg).toLowerCase();
    if (lower.includes("error") || lower.includes("failed") || lower.includes("could not") || lower.includes("invalid") || lower.includes("unavailable") || lower.includes("network error") || lower.includes("ended")) {
      type = "error";
    } else if (lower.includes("success") || lower.includes("loaded") || lower.includes("saved") || lower.includes("connected") || lower.includes("cleared") || lower.includes("added") || lower.includes("restored") || lower.includes("created") || lower.includes("playing")) {
      type = "success";
    } else {
      type = "info";
    }
  }

  toast.className = `toast-notification toast-${type}`;
  
  let iconHtml = "";
  if (type === "success") {
    iconHtml = `<span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:rgba(16,185,129,0.22);color:#10B981;font-size:11px;font-weight:900;flex-shrink:0;">✓</span>`;
  } else if (type === "error") {
    iconHtml = `<span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:rgba(239,68,68,0.22);color:#EF4444;font-size:11px;font-weight:900;flex-shrink:0;">⚠</span>`;
  } else {
    iconHtml = `<span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:rgba(255,255,255,0.12);color:#FFFFFF;font-size:11px;font-weight:700;flex-shrink:0;">ℹ</span>`;
  }

  toast.innerHTML = `${iconHtml}<span>${typeof escapeHtml === "function" ? escapeHtml(msg) : msg}</span>`;
  toast.classList.remove("hidden");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.classList.add("hidden");
  }, type === "error" ? 3400 : 2600);
}

// Theme Manager (Dedicated Separate Dark & Light Mode Support)
function initTheme() {
  const savedTheme = localStorage.getItem("spysec_theme") || "dark";
  applyTheme(savedTheme, false);

  // Dedicated Separate Buttons: Dark & Light
  const btnDark = document.getElementById("btnThemeDark");
  const btnLight = document.getElementById("btnThemeLight");

  if (btnDark) {
    btnDark.addEventListener("click", () => {
      applyTheme("dark", true);
    });
  }
  if (btnLight) {
    btnLight.addEventListener("click", () => {
      applyTheme("light", true);
    });
  }

  // Support click delegation for any [data-set-theme] element (e.g. settings modal, mobile nav)
  document.addEventListener("click", (e) => {
    const trigger = e.target.closest("[data-set-theme]");
    if (trigger && trigger.dataset.setTheme) {
      applyTheme(trigger.dataset.setTheme, true);
    }
  });

  // Legacy single toggle button fallback
  const btnToggle = document.getElementById("btnThemeToggle");
  if (btnToggle) {
    btnToggle.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") || "dark";
      const next = current === "dark" ? "light" : "dark";
      applyTheme(next, true);
    });
  }
}

function applyTheme(theme, showNotice = false) {
  const effectiveTheme = theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", effectiveTheme);
  localStorage.setItem("spysec_theme", effectiveTheme);

  // Update Separate Segmented Buttons state
  const btnDark = document.getElementById("btnThemeDark");
  const btnLight = document.getElementById("btnThemeLight");
  if (btnDark) {
    const isDark = effectiveTheme === "dark";
    btnDark.classList.toggle("active", isDark);
    btnDark.setAttribute("aria-pressed", isDark ? "true" : "false");
  }
  if (btnLight) {
    const isLight = effectiveTheme === "light";
    btnLight.classList.toggle("active", isLight);
    btnLight.setAttribute("aria-pressed", isLight ? "true" : "false");
  }

  // Update any other theme selectors in modals or settings
  document.querySelectorAll("[data-set-theme]").forEach(el => {
    const active = el.getAttribute("data-set-theme") === effectiveTheme;
    el.classList.toggle("active", active);
    el.setAttribute("aria-pressed", active ? "true" : "false");
  });

  // Fallback icon states if single toggle exists
  const sunIcon = document.querySelector("#btnThemeToggle .theme-icon-sun");
  const moonIcon = document.querySelector("#btnThemeToggle .theme-icon-moon");
  const label = document.getElementById("themeToggleText");
  if (effectiveTheme === "light") {
    if (sunIcon) sunIcon.style.display = "block";
    if (moonIcon) moonIcon.style.display = "none";
    if (label) label.textContent = "Light";
  } else {
    if (sunIcon) sunIcon.style.display = "none";
    if (moonIcon) moonIcon.style.display = "block";
    if (label) label.textContent = "Dark";
  }

  if (showNotice) {
    showToast(`Switched to ${effectiveTheme === "dark" ? "Dark" : "Light"} Mode`);
  }
}
window.applyTheme = applyTheme;

// ==========================================================================
// EXPANDED NOW PLAYING PLAYER (Full-Screen Visualizer, Vinyl & Controls)
// ==========================================================================
function openExpandedPlayer() {
  const overlay = document.getElementById("expandedNowPlayingOverlay");
  if (!overlay) return;

  // Sync current track metadata & art immediately
  const cur = isLocalChannel(activeSystemChannel)
    ? BrowserPlayer.currentTrack
    : (currentState?.channels?.[activeSystemChannel]?.current || currentState?.current);

  if (cur) {
    updateUIWithTrack(cur, isLocalChannel(activeSystemChannel) ? BrowserPlayer.isPlaying() : currentState?.playing);
  } else {
    updateUIWithTrack(null, false);
  }
  if (typeof updateRadioUI === "function") updateRadioUI();

  // Update repeat / shuffle / heart indicators on expanded controls
  if (typeof updateHeartButtonStatus === "function") updateHeartButtonStatus();

  const isShuffle = isLocalChannel(activeSystemChannel) ? BrowserPlayer.shuffle : false;
  const repeatMode = isLocalChannel(activeSystemChannel) ? BrowserPlayer.repeat : "off";
  document.getElementById("btnExpandedShuffle")?.classList.toggle("active", Boolean(isShuffle));
  document.getElementById("btnExpandedRepeat")?.classList.toggle("active", repeatMode !== "off");

  const routeLabel = document.getElementById("expandedRoutingText");
  if (routeLabel) {
    const routeNames = { browser: "Web Browser", app: "Mobile App", bot: "Discord Bot", all: "All Output" };
    routeLabel.textContent = routeNames[activeSystemChannel] || "Web Browser";
  }

  overlay.classList.add("active");
  overlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");

  // Push state to browser history so mobile hardware back or web back closes this overlay first
  try {
    if (window.location.hash !== "#now-playing") {
      window.history.pushState({ modal: "expanded-player" }, "", "#now-playing");
    }
  } catch (e) {}
}
window.openExpandedPlayer = openExpandedPlayer;

function closeExpandedPlayer() {
  const overlay = document.getElementById("expandedNowPlayingOverlay");
  if (!overlay || !overlay.classList.contains("active")) return;

  overlay.classList.remove("active");
  overlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");

  // Clean up URL hash if it was set to #now-playing
  try {
    if (window.location.hash === "#now-playing") {
      window.history.replaceState({ view: currentActiveView }, "", `#${currentActiveView}`);
    }
  } catch (e) {}
}
window.closeExpandedPlayer = closeExpandedPlayer;

function toggleExpandedPlayer() {
  const overlay = document.getElementById("expandedNowPlayingOverlay");
  if (overlay && overlay.classList.contains("active")) {
    closeExpandedPlayer();
  } else {
    openExpandedPlayer();
  }
}
window.toggleExpandedPlayer = toggleExpandedPlayer;

// ==========================================================================
// LAST PLAYED MUSIC PERSISTENCE & RESUME ENGINE
// ==========================================================================
function savePlaybackState() {
  try {
    const isEnabled = localStorage.getItem("ahm_resume_last_played") !== "false";
    if (!isEnabled) return;

    const cur = isLocalChannel(activeSystemChannel)
      ? BrowserPlayer.currentTrack
      : (currentState?.channels?.[activeSystemChannel]?.current || currentState?.current);

    if (!cur || !cur.title) return;

    let pos = 0;
    let dur = 0;
    if (isLocalChannel(activeSystemChannel)) {
      pos = BrowserPlayer.audio?.currentTime || (BrowserPlayer.savedPosition || 0);
      dur = BrowserPlayer.audio?.duration || (cur.duration ? cur.duration / 1000 : 0);
    } else {
      pos = (currentState?.position || 0) / 1000;
      dur = (currentState?.duration || 0) / 1000;
    }

    const stateToSave = {
      track: cur,
      position: Math.floor(pos),
      duration: Math.floor(dur),
      channel: activeSystemChannel,
      queue: (BrowserPlayer.queue || []).slice(0, 30),
      savedAt: Date.now()
    };

    localStorage.setItem("ahm_last_played_state", JSON.stringify(stateToSave));
  } catch (err) {
    console.warn("Could not save playback state:", err);
  }
}
window.savePlaybackState = savePlaybackState;

function restorePlaybackState() {
  try {
    const isEnabled = localStorage.getItem("ahm_resume_last_played") !== "false";
    if (!isEnabled) return;

    const raw = localStorage.getItem("ahm_last_played_state");
    if (!raw) return;

    const data = JSON.parse(raw);
    if (!data || !data.track || !data.track.title) return;

    const track = data.track;
    const pos = data.position || 0;
    const dur = data.duration || (track.duration ? Math.floor(track.duration / 1000) : 0);

    // Stage in BrowserPlayer so it's ready on first tap / play
    BrowserPlayer.currentTrack = track;
    BrowserPlayer.savedPosition = pos;
    if (data.queue && Array.isArray(data.queue) && data.queue.length > 0) {
      BrowserPlayer.queue = data.queue;
    }

    // Populate UI elements across the player
    updateUIWithTrack(track, false);
    if (dur > 0) {
      const pct = Math.min(100, Math.max(0, (pos / dur) * 100));
      updateProgressUI(pos, dur, pct);
    }

    // Populate and show the Continue Listening hero card
    const card = document.getElementById("resumeTrackCard");
    const titleEl = document.getElementById("resumeTrackTitle");
    const artistEl = document.getElementById("resumeTrackArtist");
    const coverEl = document.getElementById("resumeTrackCover");

    if (card && titleEl && artistEl) {
      titleEl.textContent = track.title;
      const formattedPos = formatTime(pos * 1000);
      const formattedDur = dur > 0 ? formatTime(dur * 1000) : "0:00";
      artistEl.textContent = `${track.author || track.artist || "Artist"} • Resume from ${formattedPos} / ${formattedDur}`;
      if (coverEl && track.artworkUrl) {
        coverEl.src = track.artworkUrl;
      }
      card.style.display = "flex";
      card.classList.add("visible");
    }
  } catch (err) {
    console.warn("Could not restore playback state:", err);
  }
}
window.restorePlaybackState = restorePlaybackState;

function resumeSavedPlayback() {
  const card = document.getElementById("resumeTrackCard");
  if (card) {
    card.style.display = "none";
    card.classList.remove("visible");
  }

  if (!BrowserPlayer.currentTrack) {
    showToast("No previous track found to resume");
    return;
  }

  const track = BrowserPlayer.currentTrack;
  const seekPos = BrowserPlayer.savedPosition || 0;

  showToast(`Resuming "${track.title}"...`);

  // If track has a direct audio stream URL or proxy
  let src = track.proxyStreamUrl || track.streamUrl || track.rawStreamUrl;
  if (src && !src.includes("googlevideo.com")) {
    BrowserPlayer.init();
    if (src && !src.startsWith("http://") && !src.startsWith("https://")) {
      src = resolveApiUrl(src);
    }
    BrowserPlayer.audio.src = src;
    BrowserPlayer.audio.currentTime = seekPos;
    const p = BrowserPlayer.audio.play();
    if (p !== undefined) {
      p.then(() => {
        BrowserPlayer.updateMediaSession(track);
        BrowserPlayer.reportState();
        updatePlayPauseIcons(true);
      }).catch(err => {
        console.warn("Resume play error:", err.message);
        showToast("Tap play button to resume playback");
      });
    }
  } else {
    // Resolve via query and seek to saved position
    const q = track.title + (track.author ? " " + track.author : "");
    BrowserPlayer.playQuery(q, track.filterMode || "filterless", true).then(() => {
      if (seekPos > 0 && BrowserPlayer.audio) {
        setTimeout(() => {
          BrowserPlayer.seek(seekPos);
        }, 600);
      }
    });
  }
}
window.resumeSavedPlayback = resumeSavedPlayback;

// ==========================================================================
// EVENT LISTENERS & SETUP
// ==========================================================================
function initEventListeners() {
  // Brand Logo clicks go to Home
  document.getElementById("brandLogoHome")?.addEventListener("click", () => switchView("home"));

  // Topbar Navigation Arrows (with custom App view history handling)
  document.getElementById("btnNavBack")?.addEventListener("click", () => {
    window.navigateAppBack();
  });
  document.getElementById("btnNavForward")?.addEventListener("click", () => {
    window.navigateAppForward();
  });

  // In-view Back Buttons (for search, playlist, liked, quran, queue)
  document.querySelectorAll(".view-back-nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      window.navigateAppBack();
    });
  });

  // Search input
  const searchInput = document.getElementById("masterSearchInput");
  const clearBtn = document.getElementById("btnSearchClear");

  // Spotify Link Import Modal Listeners
  const modalOverlay = document.getElementById("spotifyLinkModal");
  const modalInput = document.getElementById("spotifyModalInput");
  const btnOpenModal = document.getElementById("btnOpenSpotifyModal");
  const btnCloseModal = document.getElementById("btnCloseSpotifyModal");
  const btnPlayBrowser = document.getElementById("btnPlaySpotifyInBrowser");
  const btnPlayBot = document.getElementById("btnPlaySpotifyOnBot");

  const openSpotifyModal = () => {
    if (!modalOverlay) return;
    modalOverlay.classList.remove("hidden");
    if (modalInput) {
      modalInput.value = "";
      modalInput.focus();
    }
  };

  const closeSpotifyModal = () => {
    if (modalOverlay) modalOverlay.classList.add("hidden");
  };

  btnOpenModal?.addEventListener("click", openSpotifyModal);
  btnCloseModal?.addEventListener("click", closeSpotifyModal);
  modalOverlay?.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeSpotifyModal();
  });

  document.querySelectorAll(".btn-modal-sample").forEach(btn => {
    btn.addEventListener("click", () => {
      const sample = btn.getAttribute("data-sample");
      if (modalInput && sample) modalInput.value = sample;
    });
  });

  btnPlayBrowser?.addEventListener("click", () => {
    const url = modalInput?.value?.trim();
    if (!url) return showToast("Please paste a Spotify link");
    closeSpotifyModal();
    importAndPlaySpotifyLink(url, "browser");
  });

  btnPlayBot?.addEventListener("click", () => {
    const url = modalInput?.value?.trim();
    if (!url) return showToast("Please paste a Spotify link");
    closeSpotifyModal();
    importAndPlaySpotifyLink(url, "bot");
  });

  modalInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const url = modalInput.value.trim();
      if (url) {
        closeSpotifyModal();
        importAndPlaySpotifyLink(url, activeSystemChannel);
      }
    }
  });

  searchInput?.addEventListener("input", (e) => {
    const val = e.target.value.trim();
    clearBtn?.classList.toggle("visible", val.length > 0);

    // If user typed/pasted a Spotify URL, offer instant import
    if (isSpotifyUrl(val)) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        if (searchInput) searchInput.value = "";
        clearBtn?.classList.remove("visible");
        importAndPlaySpotifyLink(val, activeSystemChannel);
      }, 400);
      return;
    }

    if (!val) {
      clearTimeout(searchDebounceTimer);
      handleSearch("");
      return;
    }

    switchView("search");
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => handleSearch(val), 250);
  });

  // Dedicated In-Page / Mobile Search Bar Listeners
  const inPageSearch = document.getElementById("inPageSearchInput");
  const inPageClear = document.getElementById("btnInPageSearchClear");

  inPageSearch?.addEventListener("input", (e) => {
    const val = e.target.value.trim();
    if (inPageClear) inPageClear.style.display = val.length > 0 ? "inline-block" : "none";
    if (searchInput) searchInput.value = e.target.value;
    clearBtn?.classList.toggle("visible", val.length > 0);

    if (isSpotifyUrl(val)) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        if (inPageSearch) inPageSearch.value = "";
        if (inPageClear) inPageClear.style.display = "none";
        importAndPlaySpotifyLink(val, activeSystemChannel);
      }, 400);
      return;
    }

    if (!val) {
      clearTimeout(searchDebounceTimer);
      handleSearch("");
      return;
    }

    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => handleSearch(val), 250);
  });

  inPageClear?.addEventListener("click", () => {
    if (inPageSearch) inPageSearch.value = "";
    if (inPageClear) inPageClear.style.display = "none";
    if (searchInput) searchInput.value = "";
    clearBtn?.classList.remove("visible");
    handleSearch("");
  });

  // Mobile Filter Chips
  document.querySelectorAll(".mobile-filter-chip[data-filter]").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".mobile-filter-chip[data-filter]").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      const mode = chip.getAttribute("data-filter");
      currentFilterMode = mode;
      document.querySelectorAll(".filter-chip[data-mode]").forEach(dc => {
        if (dc.getAttribute("data-mode") === mode) dc.classList.add("active");
        else dc.classList.remove("active");
      });
      const q = inPageSearch?.value || searchInput?.value || "";
      if (q) handleSearch(q);
    });
  });

  searchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const val = (searchInput.value || "").trim();
      if (!val) return;
      if (isSpotifyUrl(val)) {
        searchInput.value = "";
        clearBtn?.classList.remove("visible");
        importAndPlaySpotifyLink(val, activeSystemChannel);
      } else {
        dispatchPlayNow(val, currentFilterMode);
      }
    }
  });

  clearBtn?.addEventListener("click", () => {
    if (searchInput) searchInput.value = "";
    clearBtn.classList.remove("visible");
    handleSearch("");
  });

  // Announcement Channel Selector
  const announceSelect = document.getElementById("announcementChannelSelect");
  announceSelect?.addEventListener("change", async (e) => {
    const chId = e.target.value;
    const selectedOpt = e.target.options[e.target.selectedIndex];
    const chName = selectedOpt?.text || `#${chId}`;
    const optGroup = selectedOpt?.closest("optgroup");
    const srvLabel = optGroup ? optGroup.label.replace(/^Server:\s*/, "") : "Discord Server";
    showToast(`Setting announcements to ${chName}...`);
    const res = await sendAction("set_announcement_channel", chId);
    if (res?.message) {
      showToast(res.message);
    } else {
      showToast(`Announcement channel set to ${chName} (${srvLabel})`);
    }
  });

  // Filter Mode Chips
  document.querySelectorAll(".filter-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".filter-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      currentFilterMode = chip.getAttribute("data-mode") || "filterless";
      showToast(`Filter: ${chip.textContent.trim()}`);
    });
  });

  // Sidebar Nav Links
  document.getElementById("navLinkHome")?.addEventListener("click", (e) => {
    e.preventDefault();
    switchView("home");
  });
  document.getElementById("navLinkSearch")?.addEventListener("click", (e) => {
    e.preventDefault();
    switchView("search");
  });
  document.getElementById("navLinkQuran")?.addEventListener("click", (e) => {
    e.preventDefault();
    switchView("quran");
  });

  // Sidebar Library Filter Pills
  document.querySelectorAll(".lib-pill[data-lib]").forEach(pill => {
    pill.addEventListener("click", () => {
      document.querySelectorAll(".lib-pill[data-lib]").forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      const mode = pill.getAttribute("data-lib");
      renderSidebarLibrary(mode);
      if (mode === "queue") {
        switchView("queue");
      }
    });
  });

  // Shelf See All buttons
  document.getElementById("btnSeeAllTrending")?.addEventListener("click", () => {
    switchView("home");
    const el = document.getElementById("sectionDailyTrendingSpotify");
    if (el) el.scrollIntoView({ behavior: "smooth" });
  });
  document.getElementById("btnRefreshSpotifyTrending")?.addEventListener("click", () => {
    loadDailySpotifyTrending(true);
  });
  document.getElementById("btnSeeAllPlaylists")?.addEventListener("click", () => switchView("search"));
  document.getElementById("btnSeeAllQuran")?.addEventListener("click", () => switchView("quran"));

  // Quran Filter Input
  document.getElementById("quranFilterInput")?.addEventListener("input", (e) => {
    renderAll114Surahs(e.target.value);
  });

  // Queue View Tabs & Clear Queue
  document.getElementById("tabQueueBtn")?.addEventListener("click", () => {
    currentTab = "queue";
    document.getElementById("tabQueueBtn")?.classList.add("active");
    document.getElementById("tabHistoryBtn")?.classList.remove("active");
    renderQueueView();
  });
  document.getElementById("tabHistoryBtn")?.addEventListener("click", () => {
    currentTab = "history";
    document.getElementById("tabHistoryBtn")?.classList.add("active");
    document.getElementById("tabQueueBtn")?.classList.remove("active");
    renderQueueView();
  });
  document.getElementById("btnClearBrowserQueue")?.addEventListener("click", () => {
    if (typeof window.clearBrowserQueue === "function") {
      window.clearBrowserQueue();
    }
  });

  // Main Play / Pause Controls (Unified across Desktop, Mobile Pill & Vivo OriginOS Capsule)
  const handlePlayPause = () => {
    const isLocal = activeSystemChannel === "browser" || activeSystemChannel === "app" || activeSystemChannel === "all";
    if (isLocal) {
      BrowserPlayer.playPause();
    }
    if (activeSystemChannel === "bot" || activeSystemChannel === "all") {
      sendAction("play_pause", null, { targetChannel: "bot" });
    }
  };

  const handleNextTrack = () => {
    if (activeSystemChannel === "browser" || activeSystemChannel === "app" || activeSystemChannel === "all") BrowserPlayer.next();
    if (activeSystemChannel === "bot") sendAction("next");
  };

  const handlePrevTrack = () => {
    if (activeSystemChannel === "browser" || activeSystemChannel === "app" || activeSystemChannel === "all") BrowserPlayer.prev();
    if (activeSystemChannel === "bot") sendAction("prev");
  };

  document.getElementById("btnMainPlayPause")?.addEventListener("click", handlePlayPause);
  document.getElementById("btnMobilePlayPause")?.addEventListener("click", handlePlayPause);
  document.getElementById("btnCapsulePlayPause")?.addEventListener("click", handlePlayPause);
  document.getElementById("btnPlaylistHeroPlay")?.addEventListener("click", () => {
    if (currentActivePlaylist) dispatchPlayPlaylist(currentActivePlaylist);
  });

  // Next & Previous (Desktop, Mobile Pill, Vivo OriginOS Capsule)
  document.getElementById("btnNextTrack")?.addEventListener("click", handleNextTrack);
  document.getElementById("btnMobileNext")?.addEventListener("click", handleNextTrack);
  document.getElementById("btnCapsuleNext")?.addEventListener("click", handleNextTrack);

  document.getElementById("btnPrevTrack")?.addEventListener("click", handlePrevTrack);
  document.getElementById("btnMobilePrev")?.addEventListener("click", handlePrevTrack);
  document.getElementById("btnCapsulePrev")?.addEventListener("click", handlePrevTrack);

  // Origin Island Live Notification Capsule Actions
  const vivoNotchBar = document.getElementById("vivoOriginNotificationBar");

  // Tap compact notch pill to expand into Origin Island Hub
  document.getElementById("originNotchCompactView")?.addEventListener("click", () => {
    if (vivoNotchBar) {
      vivoNotchBar.classList.remove("compact-mode");
      vivoNotchBar.classList.add("expanded-mode");
    }
  });

  // Tap minimize button to collapse back into compact notch pill
  document.getElementById("btnIslandMinimize")?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (vivoNotchBar) {
      vivoNotchBar.classList.remove("expanded-mode");
      vivoNotchBar.classList.add("compact-mode");
    }
  });

  // Quick play/pause on compact notch
  document.getElementById("btnNotchQuickPlay")?.addEventListener("click", (e) => {
    e.stopPropagation();
    handlePlayPause();
  });

  // Open full player from expanded island
  document.getElementById("btnOpenFromIsland")?.addEventListener("click", (e) => {
    e.stopPropagation();
    openExpandedPlayer();
  });

  // Close / hide island
  document.getElementById("btnCapsuleClose")?.addEventListener("click", (e) => {
    e.stopPropagation();
    window._vivoCapsuleDismissed = true;
    vivoNotchBar?.classList.remove("visible");
  });

  document.getElementById("vivoCapsuleExpandClick")?.addEventListener("click", () => {
    openExpandedPlayer();
  });

  // Live scrubbable seekbar in Origin Island Hub
  const islandSeekTrack = document.getElementById("islandSeekTrack");
  if (islandSeekTrack) {
    const handleIslandSeek = (e) => {
      const rect = islandSeekTrack.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const frac = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
      const dur = (Number.isFinite(BrowserPlayer.audio?.duration) && BrowserPlayer.audio.duration > 0)
        ? BrowserPlayer.audio.duration
        : (BrowserPlayer.currentTrack?.duration ? BrowserPlayer.currentTrack.duration / 1000 : 0);
      if (dur > 0) {
        BrowserPlayer.seek(frac * dur);
      }
    };
    islandSeekTrack.addEventListener("click", handleIslandSeek);
    islandSeekTrack.addEventListener("touchstart", (e) => {
      handleIslandSeek(e);
      const onMove = (ev) => handleIslandSeek(ev);
      const onEnd = () => {
        window.removeEventListener("touchmove", onMove);
        window.removeEventListener("touchend", onEnd);
      };
      window.addEventListener("touchmove", onMove, { passive: true });
      window.addEventListener("touchend", onEnd, { once: true });
    }, { passive: true });
  }

  // Native Android Media Action Dispatcher (Headset, Bluetooth, Lockscreen & Quick Settings Notification)
  window.handleAndroidMediaAction = function(action, value) {
    console.log("[Android System Media Action]:", action, value);
    if (action === "play") {
      BrowserPlayer.play();
    } else if (action === "pause") {
      BrowserPlayer.pause();
    } else if (action === "next") {
      handleNextTrack();
    } else if (action === "prev") {
      handlePrevTrack();
    } else if (action === "seek") {
      BrowserPlayer.seek(Number(value) || 0);
    } else if (action === "stop") {
      BrowserPlayer.pause();
    }
  };

  // Shuffle & Repeat
  document.getElementById("btnShuffle")?.addEventListener("click", () => {
    if (activeSystemChannel === "browser" || activeSystemChannel === "app" || activeSystemChannel === "all") BrowserPlayer.toggleShuffle();
    else showToast("Shuffle applied");
  });
  document.getElementById("btnRepeat")?.addEventListener("click", () => {
    if (activeSystemChannel === "browser" || activeSystemChannel === "app" || activeSystemChannel === "all") {
      BrowserPlayer.toggleRepeat();
    } else {
      sendAction("loop");
    }
  });

  // Spotify Infinite Radio & Autoplay Toggles
  const handleToggleAutoplay = () => {
    BrowserPlayer.toggleAutoplay();
  };
  document.getElementById("btnAutoplayRadio")?.addEventListener("click", handleToggleAutoplay);
  document.getElementById("btnToggleAutoplay")?.addEventListener("click", handleToggleAutoplay);

  // Scrubber / Progress Bar Click & Drag
  const progressTrack = document.getElementById("playbackProgressTrack");
  if (progressTrack) {
    const handleSeek = (e) => {
      const rect = progressTrack.getBoundingClientRect();
      const frac = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
      if (isLocalChannel(activeSystemChannel)) {
        const dur = BrowserPlayer.audio?.duration || 0;
        BrowserPlayer.seek(frac * dur);
      } else {
        const dur = (currentState?.duration || 0) / 1000;
        sendAction("seek", Math.round(frac * dur * 1000));
      }
    };

    progressTrack.addEventListener("click", handleSeek);
  }

  // Volume Slider Click
  const volumeTrack = document.getElementById("volumeTrack");
  if (volumeTrack) {
    volumeTrack.addEventListener("click", (e) => {
      const rect = volumeTrack.getBoundingClientRect();
      const frac = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
      BrowserPlayer.setVolume(Math.round(frac * 100));
    });
  }

  // Volume Mute Button
  document.getElementById("btnVolumeMute")?.addEventListener("click", () => {
    if (BrowserPlayer.volume > 0) {
      BrowserPlayer.setVolume(0);
    } else {
      BrowserPlayer.setVolume(100);
    }
  });

  // Heart / Like Buttons (Toggles Liked Songs for currently playing track)
  const toggleCurrentSongLike = () => {
    const cur = isLocalChannel(activeSystemChannel)
      ? BrowserPlayer.currentTrack
      : (currentState?.channels?.[activeSystemChannel]?.current || currentState?.current);
    if (cur) {
      toggleTrackFavorite(cur);
    } else {
      showToast("Play a song first to add it to Liked Songs");
    }
  };
  document.getElementById("btnPlayerHeart")?.addEventListener("click", toggleCurrentSongLike);
  document.getElementById("btnMobileHeart")?.addEventListener("click", toggleCurrentSongLike);
  document.getElementById("btnPlaylistHeroLike")?.addEventListener("click", toggleCurrentSongLike);
  document.getElementById("btnRightLike")?.addEventListener("click", toggleCurrentSongLike);

  // User Profile Modal & Logout Listeners
  document.getElementById("btnUserProfile")?.addEventListener("click", openProfileModal);
  document.getElementById("btnTopLogout")?.addEventListener("click", (e) => {
    e.stopPropagation();
    handleLogout();
  });
  document.getElementById("btnCloseProfileModal")?.addEventListener("click", closeProfileModal);
  document.getElementById("modalUserProfile")?.addEventListener("click", (e) => {
    if (e.target.id === "modalUserProfile") closeProfileModal();
  });

  // Tune Taste Modal & Taste Action Listeners
  document.getElementById("btnBannerTuneTaste")?.addEventListener("click", openTuneTasteModal);
  document.getElementById("btnBannerAuthTrigger")?.addEventListener("click", openProfileModal);
  document.getElementById("btnTuneTastePrefs")?.addEventListener("click", openTuneTasteModal);
  document.getElementById("btnSidebarTuneTaste")?.addEventListener("click", openTuneTasteModal);
  document.getElementById("btnRefreshDailyTaste")?.addEventListener("click", () => loadDailyRecommendations(true));
  document.getElementById("btnCloseTuneTasteModal")?.addEventListener("click", closeTuneTasteModal);
  document.getElementById("modalTuneTaste")?.addEventListener("click", (e) => {
    if (e.target.id === "modalTuneTaste") closeTuneTasteModal();
  });

  // Liked Songs Library Navigation & Play All
  document.getElementById("libLikedSongs")?.addEventListener("click", () => switchView("liked"));
  document.getElementById("btnPlayAllLiked")?.addEventListener("click", playAllLikedSongs);

  // Right Panel Toggle
  const rightPanel = document.getElementById("rightNowPlayingPanel");
  const rootApp = document.getElementById("spotifyAppRoot");
  const toggleRight = () => {
    if (!rightPanel) return;
    const isOpen = rightPanel.style.display !== "none";
    rightPanel.style.display = isOpen ? "none" : "flex";
    rootApp?.classList.toggle("has-right-panel", !isOpen);
  };
  document.getElementById("btnToggleRightView")?.addEventListener("click", toggleRight);
  document.getElementById("btnCloseRightPanel")?.addEventListener("click", toggleRight);
  document.getElementById("playerThumbClick")?.addEventListener("click", () => {
    if (window.innerWidth <= 900) {
      openExpandedPlayer();
    } else {
      toggleRight();
    }
  });
  document.getElementById("mobilePlayerMetaClick")?.addEventListener("click", () => {
    openExpandedPlayer();
  });
  document.getElementById("mobilePlayerPill")?.addEventListener("click", (e) => {
    if (e.target.closest("#btnMobilePlayPause") || e.target.closest("#btnMobilePrev") || e.target.closest("#btnMobileNext") || e.target.closest("#btnMobileQueue") || e.target.closest("#btnMobileHeart") || e.target.closest("#btnMobileExpandHint")) return;
    openExpandedPlayer();
  });
  document.getElementById("btnExpandPlayer")?.addEventListener("click", () => {
    openExpandedPlayer();
  });
  document.getElementById("btnMobileExpandHint")?.addEventListener("click", (e) => {
    e.stopPropagation();
    openExpandedPlayer();
  });
  document.getElementById("btnCollapseExpanded")?.addEventListener("click", () => {
    closeExpandedPlayer();
  });

  // Queue View Toggles (Desktop, Top Header, Homepage, Mobile Player Pill, Mobile Nav)
  document.getElementById("btnToggleQueueView")?.addEventListener("click", () => switchView("queue"));
  document.getElementById("btnHomeQueue")?.addEventListener("click", () => switchView("queue"));
  document.getElementById("navLinkQueue")?.addEventListener("click", () => switchView("queue"));
  document.getElementById("btnTopQueue")?.addEventListener("click", () => switchView("queue"));
  document.getElementById("btnMobileQueue")?.addEventListener("click", () => switchView("queue"));

  // Mobile Bottom Navigation (4 tabs)
  document.getElementById("mobileNavHome")?.addEventListener("click", () => switchView("home"));
  document.getElementById("mobileNavSearch")?.addEventListener("click", () => switchView("search"));
  document.getElementById("mobileNavQueue")?.addEventListener("click", () => switchView("queue"));
  document.getElementById("mobileNavLibrary")?.addEventListener("click", () => {
    switchView("liked");
  });

  // Spotify Feature 1: Time-Synced Karaoke Lyrics Listeners
  const handleOpenLyrics = () => {
    switchView("lyrics");
  };
  document.getElementById("btnLyricsToggle")?.addEventListener("click", handleOpenLyrics);
  document.getElementById("btnExpandedLyricsToggle")?.addEventListener("click", () => {
    closeExpandedPlayer();
    handleOpenLyrics();
  });
  document.getElementById("btnOpenFullLyricsFromExpanded")?.addEventListener("click", () => {
    closeExpandedPlayer();
    handleOpenLyrics();
  });
  document.getElementById("btnCloseLyricsView")?.addEventListener("click", () => {
    window.navigateAppBack();
  });
  if (typeof LyricsManager !== "undefined") LyricsManager.initScrollListener();

  // Spotify Feature 2: 6-Band Graphic Equalizer Listeners & Modal
  const openEqualizerModal = () => {
    const m = document.getElementById("modalEqualizer");
    if (m) m.style.display = "flex";
    EqualizerEngine.gains.forEach((g, idx) => {
      const s = document.getElementById(`eqBand${idx}`);
      const l = document.getElementById(`eqVal${idx}`);
      if (s) s.value = g;
      if (l) l.textContent = `${g > 0 ? "+" : ""}${g}dB`;
    });
    const chk = document.getElementById("chkEqualizerEnabled");
    if (chk) chk.checked = EqualizerEngine.isEnabled;
    document.querySelectorAll(".eq-preset-chip").forEach(c => {
      c.classList.toggle("active", c.getAttribute("data-preset") === EqualizerEngine.currentPreset);
    });
  };
  const closeEqualizerModal = () => {
    const m = document.getElementById("modalEqualizer");
    if (m) m.style.display = "none";
  };
  document.getElementById("btnEqualizerToggle")?.addEventListener("click", openEqualizerModal);
  document.getElementById("btnExpandedEqualizer")?.addEventListener("click", openEqualizerModal);
  document.getElementById("btnCloseEqualizerModal")?.addEventListener("click", closeEqualizerModal);
  document.getElementById("modalEqualizer")?.addEventListener("click", (e) => {
    if (e.target.id === "modalEqualizer") closeEqualizerModal();
  });
  document.getElementById("chkEqualizerEnabled")?.addEventListener("change", (e) => {
    EqualizerEngine.toggle(e.target.checked);
  });
  for (let b = 0; b < 6; b++) {
    document.getElementById(`eqBand${b}`)?.addEventListener("input", (e) => {
      EqualizerEngine.setBandGain(b, e.target.value);
    });
  }
  document.querySelectorAll(".eq-preset-chip").forEach(c => {
    c.addEventListener("click", () => {
      EqualizerEngine.applyPreset(c.getAttribute("data-preset"));
    });
  });
  document.getElementById("btnResetEq")?.addEventListener("click", () => {
    EqualizerEngine.applyPreset("flat");
  });

  // Spotify Feature 3: Sleep Timer Listeners & Modal
  const openSleepTimerModal = () => {
    const m = document.getElementById("modalSleepTimer");
    if (m) m.style.display = "flex";
  };
  const closeSleepTimerModal = () => {
    const m = document.getElementById("modalSleepTimer");
    if (m) m.style.display = "none";
  };
  document.getElementById("btnSleepTimerToggle")?.addEventListener("click", openSleepTimerModal);
  document.getElementById("btnExpandedSleepTimerToggle")?.addEventListener("click", openSleepTimerModal);
  document.getElementById("btnCloseSleepTimerModal")?.addEventListener("click", closeSleepTimerModal);
  document.getElementById("modalSleepTimer")?.addEventListener("click", (e) => {
    if (e.target.id === "modalSleepTimer") closeSleepTimerModal();
  });
  document.querySelectorAll(".sleep-timer-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const mins = btn.getAttribute("data-minutes");
      if (mins === "0") {
        SleepTimerEngine.cancel();
        showToast("🌙 Sleep timer turned off");
      } else {
        SleepTimerEngine.start(mins);
      }
      closeSleepTimerModal();
    });
  });

  // Spotify Feature 4: Audio Streaming Quality Listeners & Modal
  const openAudioQualityModal = () => {
    const m = document.getElementById("modalAudioQuality");
    if (m) m.style.display = "flex";
  };
  const closeAudioQualityModal = () => {
    const m = document.getElementById("modalAudioQuality");
    if (m) m.style.display = "none";
  };
  document.getElementById("btnAudioQualityToggle")?.addEventListener("click", openAudioQualityModal);
  document.getElementById("btnCloseAudioQualityModal")?.addEventListener("click", closeAudioQualityModal);
  document.getElementById("modalAudioQuality")?.addEventListener("click", (e) => {
    if (e.target.id === "modalAudioQuality") closeAudioQualityModal();
  });
  document.querySelectorAll(".quality-option-card").forEach(c => {
    c.addEventListener("click", () => {
      const q = c.getAttribute("data-quality");
      AudioQualityManager.set(q);
      closeAudioQualityModal();
    });
  });
  if (typeof AudioQualityManager !== "undefined") AudioQualityManager.init();

  // Proactive Audio Unlock on first user touch / pointer gesture anywhere
  const proactiveUnlock = () => {
    BrowserPlayer.prime();
    window.removeEventListener("pointerdown", proactiveUnlock);
    window.removeEventListener("touchstart", proactiveUnlock);
  };
  window.addEventListener("pointerdown", proactiveUnlock, { passive: true });
  window.addEventListener("touchstart", proactiveUnlock, { passive: true });

  // Mobile / Android APK Install Button Handler
  const installBtn = document.getElementById("btnInstallPwa");
  if (installBtn) {
    // If running inside Capacitor native Android app, hide the download button
    const isNativeApp = Boolean(
      window.Capacitor?.isNativePlatform?.() ||
      window.location?.protocol === "file:" ||
      (window.location?.origin && window.location.origin.includes("capacitor"))
    );
    if (isNativeApp) {
      installBtn.style.display = "none";
    } else {
      installBtn.style.display = "inline-flex";
    }

    installBtn.addEventListener("click", async (e) => {
      e.preventDefault();

      // Check if APK download link is set locally, in window object, or in localStorage
      let apkUrl = (window.AHM_APK_DOWNLOAD_URL || localStorage.getItem("ahm_apk_url") || "").trim();

      // Check with backend if not set locally
      if (!apkUrl) {
        try {
          const res = await fetch("/api/apk-link");
          if (res.ok) {
            const data = await res.json();
            if (data?.url) {
              apkUrl = data.url.trim();
              window.AHM_APK_DOWNLOAD_URL = apkUrl;
            }
          }
        } catch (err) {
          // Ignore network errors
        }
      }

      if (apkUrl && apkUrl !== "#" && apkUrl !== "PLACEHOLDER_APK_LINK") {
        if (typeof showToast === "function") {
          showToast("Starting Spy Sec Music Android APK download...");
        }
        const tempLink = document.createElement("a");
        tempLink.href = apkUrl;
        tempLink.setAttribute("download", "SpySec-Music.apk");
        tempLink.target = "_blank";
        tempLink.rel = "noopener noreferrer";
        document.body.appendChild(tempLink);
        tempLink.click();
        document.body.removeChild(tempLink);
        return;
      }

      // If PWA installation is supported as fallback
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
        if (outcome === "accepted") {
          if (typeof showToast === "function") showToast("App installed to home screen");
        }
        deferredInstallPrompt = null;
        return;
      }

      // If APK link hasn't been configured yet
      if (typeof showToast === "function") {
        showToast("Android APK link is being configured. Please check back shortly.");
      }
    });
  }

  // PWA Install Prompt Listener
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
  });

  // Expanded Player Controls
  document.getElementById("btnExpandedPlayPause")?.addEventListener("click", handlePlayPause);
  document.getElementById("btnExpandedPrev")?.addEventListener("click", () => {
    if (isLocalChannel(activeSystemChannel)) BrowserPlayer.prev();
    else sendAction("prev");
  });
  document.getElementById("btnExpandedNext")?.addEventListener("click", () => {
    if (isLocalChannel(activeSystemChannel)) BrowserPlayer.next();
    else sendAction("next");
  });
  document.getElementById("btnExpandedShuffle")?.addEventListener("click", () => {
    if (isLocalChannel(activeSystemChannel)) {
      BrowserPlayer.toggleShuffle();
      document.getElementById("btnExpandedShuffle")?.classList.toggle("active", BrowserPlayer.shuffle);
    } else {
      showToast("Shuffle applied");
    }
  });
  document.getElementById("btnExpandedRepeat")?.addEventListener("click", () => {
    if (isLocalChannel(activeSystemChannel)) {
      BrowserPlayer.toggleRepeat();
      document.getElementById("btnExpandedRepeat")?.classList.toggle("active", BrowserPlayer.repeat !== "off");
    } else {
      sendAction("loop");
    }
  });
  document.getElementById("btnExpandedHeart")?.addEventListener("click", toggleCurrentSongLike);

  // Spotify Infinite Radio quick-actions inside Expanded Player
  const handleLaunchRadio = () => {
    const track = BrowserPlayer.currentTrack || BrowserPlayer.activeRadioSeed || (BrowserPlayer.history.length > 0 ? BrowserPlayer.history[BrowserPlayer.history.length - 1] : null);
    if (track) {
      BrowserPlayer.startRadioForTrack(track);
    } else {
      const defaultStation = CURATED_RADIO_STATIONS[0];
      BrowserPlayer.startRadioForTrack({
        title: defaultStation.seedTitle,
        author: defaultStation.seedArtist,
        artworkUrl: defaultStation.coverUrl
      });
    }
  };

  document.getElementById("btnExpandedRadio")?.addEventListener("click", handleLaunchRadio);
  document.getElementById("btnExpandedRadioPill")?.addEventListener("click", handleLaunchRadio);

  document.getElementById("btnExpandedRadioAutoplay")?.addEventListener("click", () => {
    BrowserPlayer.toggleAutoplay();
  });

  document.getElementById("seeAllSpotifyRadio")?.addEventListener("click", (e) => {
    e.preventDefault();
    closeExpandedPlayer();
    switchView("home");
    const el = document.getElementById("sectionSpotifyRadioStations");
    if (el) el.scrollIntoView({ behavior: "smooth" });
  });
  document.getElementById("btnExpandedQueueToggle")?.addEventListener("click", () => {
    closeExpandedPlayer();
    switchView("queue");
  });

  // Expanded Scrubber Click & Drag
  const expProgressTrack = document.getElementById("expandedProgressTrack");
  if (expProgressTrack) {
    const handleExpSeek = (e) => {
      const rect = expProgressTrack.getBoundingClientRect();
      const frac = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
      if (isLocalChannel(activeSystemChannel)) {
        const dur = BrowserPlayer.audio?.duration || 0;
        BrowserPlayer.seek(frac * dur);
      } else {
        const dur = (currentState?.duration || 0) / 1000;
        sendAction("seek", Math.round(frac * dur * 1000));
      }
    };
    expProgressTrack.addEventListener("click", handleExpSeek);
  }

  // Expanded Volume Track & Mute
  const expVolTrack = document.getElementById("expandedVolTrack");
  if (expVolTrack) {
    expVolTrack.addEventListener("click", (e) => {
      const rect = expVolTrack.getBoundingClientRect();
      const frac = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
      BrowserPlayer.setVolume(Math.round(frac * 100));
    });
  }
  document.getElementById("btnExpandedVolMute")?.addEventListener("click", () => {
    if (BrowserPlayer.volume > 0) {
      BrowserPlayer.setVolume(0);
    } else {
      BrowserPlayer.setVolume(100);
    }
  });

  // Continue Listening Banner / Resume Card Listeners
  document.getElementById("btnResumePlay")?.addEventListener("click", (e) => {
    e.stopPropagation();
    resumeSavedPlayback();
  });
  document.getElementById("btnResumeDismiss")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const card = document.getElementById("resumeTrackCard");
    if (card) {
      card.style.display = "none";
      card.classList.remove("visible");
    }
  });
  document.getElementById("resumeCardClick")?.addEventListener("click", () => {
    resumeSavedPlayback();
  });

  // Emil Kowalski Smooth Swipe-Down gesture on Expanded Player (with spring feel)
  const expandedOverlay = document.getElementById("expandedNowPlayingOverlay");
  if (expandedOverlay) {
    let touchStartY = 0;
    let touchDiffY = 0;
    expandedOverlay.addEventListener("touchstart", (e) => {
      if (e.touches && e.touches[0]) {
        touchStartY = e.touches[0].clientY;
        touchDiffY = 0;
      }
    }, { passive: true });

    expandedOverlay.addEventListener("touchmove", (e) => {
      if (!touchStartY || !e.touches || !e.touches[0]) return;
      touchDiffY = e.touches[0].clientY - touchStartY;
      if (touchDiffY > 20 && expandedOverlay.scrollTop <= 5) {
        expandedOverlay.style.transform = `translateY(${Math.min(touchDiffY * 0.45, 120)}px)`;
      }
    }, { passive: true });

    expandedOverlay.addEventListener("touchend", () => {
      if (touchDiffY > 80 && expandedOverlay.scrollTop <= 10) {
        expandedOverlay.style.transform = "";
        closeExpandedPlayer();
      } else {
        expandedOverlay.style.transform = "";
      }
      touchStartY = 0;
      touchDiffY = 0;
    });
  }

  // Escape key collapses expanded player or mobile drawer
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const exp = document.getElementById("expandedNowPlayingOverlay");
      if (exp && exp.classList.contains("active")) {
        closeExpandedPlayer();
        e.preventDefault();
      }
      const mobileDrawer = document.getElementById("mobileMenuDrawer");
      if (mobileDrawer && mobileDrawer.style.display !== "none") {
        mobileDrawer.style.display = "none";
        document.body.style.overflow = "";
        e.preventDefault();
      }
    }
  });

  // Mobile Navigation Drawer open & close handlers
  const mobileDrawer = document.getElementById("mobileMenuDrawer");
  const openMobileDrawer = () => {
    if (!mobileDrawer) return;
    mobileDrawer.style.display = "flex";
    mobileDrawer.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  };
  const closeMobileDrawer = () => {
    if (!mobileDrawer) return;
    mobileDrawer.style.display = "none";
    mobileDrawer.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  };

  document.getElementById("btnMobileMenuToggle")?.addEventListener("click", openMobileDrawer);
  document.getElementById("mobileNavMenu")?.addEventListener("click", openMobileDrawer);
  document.getElementById("btnCloseMobileDrawer")?.addEventListener("click", closeMobileDrawer);
  document.getElementById("mobileDrawerScrim")?.addEventListener("click", closeMobileDrawer);

  // Drawer Navigation Links
  document.querySelectorAll("[data-drawer-view]").forEach(btn => {
    btn.addEventListener("click", () => {
      const view = btn.getAttribute("data-drawer-view");
      if (view) {
        switchView(view);
        closeMobileDrawer();
        document.getElementById("spotifyMainStage")?.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
  });

  // Drawer Tool Buttons
  document.getElementById("btnDrawerOpenEq")?.addEventListener("click", () => {
    closeMobileDrawer();
    openEqualizerModal();
  });
  document.getElementById("btnDrawerOpenSleep")?.addEventListener("click", () => {
    closeMobileDrawer();
    openSleepTimerModal();
  });
  document.getElementById("btnDrawerOpenQuality")?.addEventListener("click", () => {
    closeMobileDrawer();
    openAudioQualityModal();
  });
  document.getElementById("btnDrawerOpenTaste")?.addEventListener("click", () => {
    closeMobileDrawer();
    openTuneTasteModal();
  });
  document.getElementById("btnDrawerAuthAction")?.addEventListener("click", () => {
    closeMobileDrawer();
    openUserProfileModal();
  });

  // Brand Logo Clicks -> Smooth Navigate to Home & Scroll to Top
  const routeHomeAndScrollTop = () => {
    switchView("home");
    const stage = document.getElementById("spotifyMainStage");
    if (stage) stage.scrollTo({ top: 0, behavior: "smooth" });
  };
  document.getElementById("brandLogoHome")?.addEventListener("click", routeHomeAndScrollTop);
  document.getElementById("footerBrandLogo")?.addEventListener("click", routeHomeAndScrollTop);
  document.getElementById("drawerBrandLogo")?.addEventListener("click", () => {
    closeMobileDrawer();
    routeHomeAndScrollTop();
  });

  // Footer Navigation Links
  document.getElementById("footerNavHome")?.addEventListener("click", (e) => {
    e.preventDefault();
    routeHomeAndScrollTop();
  });
  document.getElementById("footerNavSearch")?.addEventListener("click", (e) => {
    e.preventDefault();
    switchView("search");
    document.getElementById("spotifyMainStage")?.scrollTo({ top: 0, behavior: "smooth" });
  });
  document.getElementById("footerNavQueue")?.addEventListener("click", (e) => {
    e.preventDefault();
    switchView("queue");
    document.getElementById("spotifyMainStage")?.scrollTo({ top: 0, behavior: "smooth" });
  });
  document.getElementById("footerNavLiked")?.addEventListener("click", (e) => {
    e.preventDefault();
    switchView("liked");
    document.getElementById("spotifyMainStage")?.scrollTo({ top: 0, behavior: "smooth" });
  });
  document.getElementById("footerNavQuran")?.addEventListener("click", (e) => {
    e.preventDefault();
    switchView("quran");
    document.getElementById("spotifyMainStage")?.scrollTo({ top: 0, behavior: "smooth" });
  });

  // Footer Audio Engine Modals
  document.getElementById("footerBtnEq")?.addEventListener("click", openEqualizerModal);
  document.getElementById("footerBtnSleep")?.addEventListener("click", openSleepTimerModal);
  document.getElementById("footerBtnQuality")?.addEventListener("click", openAudioQualityModal);
  document.getElementById("footerBtnTaste")?.addEventListener("click", openTuneTasteModal);
  document.getElementById("footerBtnInstallApk")?.addEventListener("click", () => {
    document.getElementById("btnInstallPwa")?.click();
  });

  // Wire previously unreferenced buttons
  document.getElementById("btnToggleLibrary")?.addEventListener("click", () => {
    if (window.innerWidth <= 900) {
      openMobileDrawer();
    } else {
      switchView("liked");
    }
  });
  document.getElementById("btnLibSearch")?.addEventListener("click", () => {
    const sInput = document.getElementById("masterSearchInput");
    if (sInput) {
      sInput.focus();
      sInput.select();
    }
    switchView("search");
  });
  document.getElementById("btnLibAdd")?.addEventListener("click", () => {
    openSpotifyModal();
  });

  // Dynamic Copyright Year
  const currentYear = new Date().getFullYear();
  const footerYear = document.getElementById("appCopyrightYear");
  if (footerYear) footerYear.textContent = currentYear;
  document.querySelectorAll(".dyn-year").forEach(el => el.textContent = currentYear);
}

// Greeting calculation
function updateGreeting() {
  const title = document.getElementById("stageGreetingTitle");
  if (!title) return;
  const hour = new Date().getHours();
  if (hour < 12) title.textContent = "Good morning";
  else if (hour < 18) title.textContent = "Good afternoon";
  else title.textContent = "Good evening";
}

// Service Worker Registration for PWA capability
function registerPwaServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").then((reg) => {
        reg.update().catch(() => {});
      }).catch(() => {});
    });
  }
}

// Audio unlock on user touch/click
function unlockAudio() {
  BrowserPlayer.prime();
}
window.addEventListener("click", unlockAudio, { once: true });
window.addEventListener("keydown", unlockAudio, { once: true });
window.addEventListener("touchstart", unlockAudio, { once: true });

// Universal scroll engine: ensures mouse wheel anywhere on the viewport smoothly scrolls the main stage
window.addEventListener("wheel", (e) => {
  const stage = document.getElementById("spotifyMainStage");
  if (!stage) return;
  // Let independent scrollable components scroll naturally
  if (e.target && e.target.closest && e.target.closest(".library-list, .spotify-modal-card, .spotify-link-modal-card, select, input, textarea")) {
    return;
  }
  stage.scrollTop += e.deltaY;
}, { passive: true });

// Hash Route Controller (Supports direct links like #quran, #search, #home, #queue, #liked, #nowplaying, #radio)
function handleHashRoute() {
  const hash = (window.location.hash || "").replace(/^#/, "").toLowerCase();
  if (hash === "nowplaying" || hash === "now-playing") {
    if (typeof openExpandedPlayer === "function") openExpandedPlayer();
    return;
  }
  if (hash === "radio") {
    if (typeof switchView === "function") switchView("home");
    const radioSec = document.getElementById("sectionSpotifyRadioStations");
    if (radioSec) radioSec.scrollIntoView({ behavior: "smooth" });
    return;
  }
  if (["home", "search", "quran", "queue", "liked"].includes(hash)) {
    if (typeof switchView === "function") switchView(hash);
  }
}
window.addEventListener("hashchange", handleHashRoute);

// Horizontal Shelf Scroll Buttons Engine (Right-to-Left / Left-to-Right Carousel Navigation)
function initShelfScrollButtons() {
  document.querySelectorAll(".shelf-scroll-btn").forEach(btn => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "true";

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const targetId = btn.getAttribute("data-target");
      if (!targetId) return;
      const shelf = document.getElementById(targetId);
      if (!shelf) return;

      const isNext = btn.classList.contains("btn-shelf-next");
      const scrollStep = Math.max(shelf.clientWidth * 0.75, 220);
      shelf.scrollBy({
        left: isNext ? scrollStep : -scrollStep,
        behavior: "smooth"
      });
    });
  });

  const updateShelfButtons = (shelf) => {
    const prevBtn = document.querySelector(`.btn-shelf-prev[data-target="${shelf.id}"]`);
    const nextBtn = document.querySelector(`.btn-shelf-next[data-target="${shelf.id}"]`);
    if (prevBtn) {
      prevBtn.classList.toggle("disabled", shelf.scrollLeft <= 5);
    }
    if (nextBtn) {
      const atEnd = shelf.scrollLeft + shelf.clientWidth >= shelf.scrollWidth - 5;
      nextBtn.classList.toggle("disabled", atEnd);
    }
  };

  const shelfContainers = document.querySelectorAll(".shelf-section .spotify-card-grid, .trending-tracks-pill-grid, #gridSearchPlaylists");
  shelfContainers.forEach(shelf => {
    if (!shelf.dataset.scrollBound) {
      shelf.dataset.scrollBound = "true";
      shelf.addEventListener("scroll", () => updateShelfButtons(shelf), { passive: true });
    }
    setTimeout(() => updateShelfButtons(shelf), 400);
  });
}
window.initShelfScrollButtons = initShelfScrollButtons;

// ==========================================================================
// DYNAMIC MOUSE MOVING HOVER EFFECTS (SPOTLIGHT & 3D KINETIC TILT)
// ==========================================================================
function initMouseHoverEffects() {
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
    return; // Touch devices don't need mouse hover tracking
  }

  const mainStage = document.getElementById("spotifyMainStage");
  if (!mainStage) return;

  // 1. Ambient Stage Cursor Follower Glow
  let ambientGlow = document.getElementById("stageCursorAmbientGlow");
  if (!ambientGlow) {
    ambientGlow = document.createElement("div");
    ambientGlow.id = "stageCursorAmbientGlow";
    ambientGlow.className = "stage-cursor-ambient-glow";
    mainStage.appendChild(ambientGlow);
  }

  let mouseX = -1000;
  let mouseY = -1000;
  let currentX = -1000;
  let currentY = -1000;
  let isMoving = false;
  let animId = null;

  function renderAmbient() {
    currentX += (mouseX - currentX) * 0.12;
    currentY += (mouseY - currentY) * 0.12;
    ambientGlow.style.transform = `translate3d(${currentX}px, ${currentY}px, 0) translate(-50%, -50%)`;

    if (Math.abs(mouseX - currentX) > 0.5 || Math.abs(mouseY - currentY) > 0.5) {
      animId = requestAnimationFrame(renderAmbient);
    } else {
      isMoving = false;
    }
  }

  mainStage.addEventListener("pointermove", (e) => {
    const rect = mainStage.getBoundingClientRect();
    mouseX = e.clientX - rect.left + mainStage.scrollLeft;
    mouseY = e.clientY - rect.top + mainStage.scrollTop;
    ambientGlow.style.opacity = "1";

    if (!isMoving) {
      isMoving = true;
      animId = requestAnimationFrame(renderAmbient);
    }
  }, { passive: true });

  mainStage.addEventListener("pointerleave", () => {
    ambientGlow.style.opacity = "0";
  });

  // 2. Interactive Card Mouse Movement (Spotlight + Subtle 3D Tilt)
  const trackedCards = new WeakSet();

  function attachCardHover(card) {
    if (trackedCards.has(card)) return;
    trackedCards.add(card);

    let rafId = null;

    card.addEventListener("pointerenter", () => {
      card.style.setProperty("--spotlight-opacity", "1");
      card.style.transition = "transform 0.12s ease-out, box-shadow 0.15s ease-out, border-color 0.2s ease-out";
    });

    card.addEventListener("pointermove", (e) => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const percentX = (x / rect.width) * 100;
        const percentY = (y / rect.height) * 100;

        card.style.setProperty("--mouse-x", `${percentX.toFixed(1)}%`);
        card.style.setProperty("--mouse-y", `${percentY.toFixed(1)}%`);

        // Subtle 3D perspective tilt (max 4.5deg)
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const rotateX = ((y - centerY) / centerY) * -4.5;
        const rotateY = ((x - centerX) / centerX) * 4.5;

        // Dynamic shadow shift away from light source
        const shadowX = -rotateY * 1.5;
        const shadowY = rotateX * 1.5 + 8;

        card.style.transform = `perspective(900px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) translateY(-4px) scale(1.015)`;
        card.style.boxShadow = `${shadowX.toFixed(1)}px ${shadowY.toFixed(1)}px 28px rgba(0, 0, 0, 0.55), 0 0 16px rgba(30, 215, 96, 0.08)`;
      });
    }, { passive: true });

    card.addEventListener("pointerleave", () => {
      if (rafId) cancelAnimationFrame(rafId);
      card.style.setProperty("--spotlight-opacity", "0");
      card.style.transition = "transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.4s ease-out, border-color 0.2s ease-out";
      card.style.transform = "perspective(900px) rotateX(0deg) rotateY(0deg) translateY(0px) scale(1)";
      card.style.boxShadow = "";
    });
  }

  function bindAllCards() {
    const cards = document.querySelectorAll(".spotify-card, .hero-quick-card, .hot-track-pill, .genre-card, .surah-card");
    cards.forEach(attachCardHover);
  }

  bindAllCards();

  // Watch for dynamically added cards (when shelves or playlists render)
  const observer = new MutationObserver(() => {
    bindAllCards();
  });
  observer.observe(mainStage, { childList: true, subtree: true });
}
window.initMouseHoverEffects = initMouseHoverEffects;

// ==========================================================================
// TACTILE MOUSE CLICK EFFECT ENGINE (Emil Kowalski Physics Ripple & Sparks)
// ==========================================================================
function initMouseClickEffect() {
  let container = document.getElementById("clickEffectContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "clickEffectContainer";
    container.className = "click-effect-container";
    document.body.appendChild(container);
  }

  // Use pointerdown for instant zero-lag tactile feedback
  window.addEventListener("pointerdown", (e) => {
    // Only trigger for primary button (left click or touch)
    if (e.button !== undefined && e.button !== 0) return;

    // Throttle container count to avoid DOM buildup
    if (container.children.length > 8) {
      container.removeChild(container.firstElementChild);
    }

    const ripple = document.createElement("div");
    ripple.className = "click-ripple";
    ripple.style.left = `${e.clientX}px`;
    ripple.style.top = `${e.clientY}px`;

    const ring = document.createElement("div");
    ring.className = "click-ripple-ring";
    ripple.appendChild(ring);

    const core = document.createElement("div");
    core.className = "click-ripple-core";
    ripple.appendChild(core);

    // Spawn 4 delicate micro-sparks radiating outwards
    const sparkCount = 4;
    for (let i = 0; i < sparkCount; i++) {
      const angle = (i * (360 / sparkCount) + (Math.random() * 25 - 12)) * (Math.PI / 180);
      const distance = 18 + Math.random() * 14;
      const tx = Math.cos(angle) * distance;
      const ty = Math.sin(angle) * distance;

      const spark = document.createElement("div");
      spark.className = "click-spark";
      spark.style.setProperty("--tx", `${tx.toFixed(1)}px`);
      spark.style.setProperty("--ty", `${ty.toFixed(1)}px`);
      ripple.appendChild(spark);
    }

    container.appendChild(ripple);

    // Auto cleanup
    setTimeout(() => {
      ripple.remove();
    }, 450);
  }, { passive: true });
}
window.initMouseClickEffect = initMouseClickEffect;

// Initialization on DOM ready
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  BrowserPlayer.init();
  restorePlaybackState();
  updateGreeting();
  updateUserProfileUI();
  loadDailySpotifyTrending(false);
  loadDailyRecommendations(false);
  renderHeroGrid();
  renderPlaylistsGrid();
  renderFeaturedQuran();
  renderIslamicVibes();
  renderSearchGenres();
  renderSidebarLibrary("all");
  renderSpotifyRadioStations();
  updateRadioUI();
  initEventListeners();
  initShelfScrollButtons();
  initMouseHoverEffects();
  initMouseClickEffect();
  initUserAuth();
  registerPwaServiceWorker();
  handleHashRoute();

  // Global user-gesture audio unlocker for Web Audio API & Media Elements
  const unlockGlobalAudio = () => {
    if (typeof EqualizerEngine !== "undefined" && EqualizerEngine.audioCtx && EqualizerEngine.audioCtx.state === "suspended") {
      EqualizerEngine.audioCtx.resume().catch(() => {});
    }
    if (BrowserPlayer && BrowserPlayer.audio) {
      BrowserPlayer.audio.muted = false;
      BrowserPlayer.audio.removeAttribute("muted");
      if (BrowserPlayer.audio.volume === 0) BrowserPlayer.setVolume(100);
    }
  };
  window.addEventListener("pointerdown", unlockGlobalAudio, { passive: true });
  window.addEventListener("keydown", unlockGlobalAudio, { passive: true });
  window.addEventListener("click", unlockGlobalAudio, { passive: true });

  fetchState();
  setInterval(fetchState, 1200);
});


