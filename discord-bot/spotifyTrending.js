const fs = require("fs");
const path = require("path");

const CACHE_FILE = path.join(__dirname, "spotify_trending_cache.json");
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

/**
 * Format milliseconds into M:SS
 */
function formatDuration(ms) {
  if (!ms || isNaN(ms)) return "03:30";
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

// Curated Indian-First Spotify Playlists with Verified Track Data & Bespoke Covers
const CURATED_INDIAN_PLAYLISTS = [
  {
    id: "top50-india",
    name: "Top 50 - India",
    badge: "🔥 #1 India Trending",
    genre: "charts",
    description: "Your daily update of the most played tracks in India right now on Spotify Charts.",
    coverUrl: "covers/top50_india.jpg",
    tracks: [
      { id: "in_top_1", title: "Tauba Tauba", artist: "Karan Aujla & Badshah", duration: "03:26", durationMs: 206000, artworkUrl: "covers/top50_india.jpg", query: "Tauba Tauba Karan Aujla Badshah" },
      { id: "in_top_2", title: "Aaj Ki Raat", artist: "Sachin-Jigar, Madhubanti & Divya", duration: "03:48", durationMs: 228000, artworkUrl: "covers/top50_india.jpg", query: "Aaj Ki Raat Stree 2 Sachin Jigar" },
      { id: "in_top_3", title: "Chuttamalle", artist: "Anirudh Ravichander & Shilpa Rao", duration: "03:45", durationMs: 225000, artworkUrl: "covers/top50_india.jpg", query: "Chuttamalle Devara Anirudh Shilpa Rao" },
      { id: "in_top_4", title: "Sajni", artist: "Arijit Singh & Ram Sampath", duration: "02:50", durationMs: 170000, artworkUrl: "covers/top50_india.jpg", query: "Sajni Laapataa Ladies Arijit Singh" },
      { id: "in_top_5", title: "Illuminati", artist: "Sushin Shyam & Dabzee", duration: "03:12", durationMs: 192000, artworkUrl: "covers/top50_india.jpg", query: "Illuminati Aavesham Sushin Shyam" },
      { id: "in_top_6", title: "Ve Kamleya", artist: "Arijit Singh & Shreya Ghoshal", duration: "04:06", durationMs: 246000, artworkUrl: "covers/top50_india.jpg", query: "Ve Kamleya Arijit Singh Rocky Aur Rani" },
      { id: "in_top_7", title: "Husn", artist: "Anuv Jain", duration: "03:38", durationMs: 218000, artworkUrl: "covers/top50_india.jpg", query: "Husn Anuv Jain" },
      { id: "in_top_8", title: "O Sajni Re", artist: "Arijit Singh", duration: "03:25", durationMs: 205000, artworkUrl: "covers/top50_india.jpg", query: "O Sajni Re Arijit Singh" },
      { id: "in_top_9", title: "Tujhe Kitna Chahne Lage", artist: "Arijit Singh & Mithoon", duration: "04:44", durationMs: 284000, artworkUrl: "covers/top50_india.jpg", query: "Tujhe Kitna Chahne Lage Arijit Singh" },
      { id: "in_top_10", title: "Apna Bana Le", artist: "Arijit Singh & Sachin-Jigar", duration: "04:21", durationMs: 261000, artworkUrl: "covers/top50_india.jpg", query: "Apna Bana Le Bhediya Arijit Singh" },
      { id: "in_top_11", title: "Soulmate", artist: "Arijit Singh & Badshah", duration: "03:33", durationMs: 213000, artworkUrl: "covers/top50_india.jpg", query: "Soulmate Badshah Arijit Singh" },
      { id: "in_top_12", title: "Zinda Banda", artist: "Anirudh Ravichander", duration: "04:24", durationMs: 264000, artworkUrl: "covers/top50_india.jpg", query: "Zinda Banda Jawan Anirudh" }
    ]
  },
  {
    id: "bollywood-butter",
    name: "Bollywood Butter",
    badge: "🎬 Bollywood #1 Blockbusters",
    genre: "bollywood",
    description: "The ultimate Bollywood playlist packed with signature blockbusters and love anthems.",
    coverUrl: "covers/bollywood_butter.jpg",
    tracks: [
      { id: "bb_1", title: "Kesariya", artist: "Arijit Singh & Pritam (Brahmastra)", duration: "04:28", durationMs: 268000, artworkUrl: "covers/bollywood_butter.jpg", query: "Kesariya Brahmastra Arijit Singh" },
      { id: "bb_2", title: "Tum Hi Ho", artist: "Arijit Singh & Mithoon (Aashiqui 2)", duration: "04:22", durationMs: 262000, artworkUrl: "covers/bollywood_butter.jpg", query: "Tum Hi Ho Arijit Singh Aashiqui 2" },
      { id: "bb_3", title: "Tere Vaaste", artist: "Varun Jain & Sachin-Jigar", duration: "03:09", durationMs: 189000, artworkUrl: "covers/bollywood_butter.jpg", query: "Tere Vaaste Falak Se Zara Hatke Zara Bachke" },
      { id: "bb_4", title: "Dil Diyan Gallan", artist: "Atif Aslam & Vishal-Shekhar", duration: "04:20", durationMs: 260000, artworkUrl: "covers/bollywood_butter.jpg", query: "Dil Diyan Gallan Atif Aslam" },
      { id: "bb_5", title: "Raataan Lambiyan", artist: "Jubin Nautiyal & Asees Kaur", duration: "03:50", durationMs: 230000, artworkUrl: "covers/bollywood_butter.jpg", query: "Raataan Lambiyan Shershaah" },
      { id: "bb_6", title: "Ghungroo", artist: "Arijit Singh & Shilpa Rao (War)", duration: "05:02", durationMs: 302000, artworkUrl: "covers/bollywood_butter.jpg", query: "Ghungroo War Arijit Singh Shilpa Rao" },
      { id: "bb_7", title: "Pee Loon", artist: "Mohit Chauhan (OUATIM)", duration: "04:47", durationMs: 287000, artworkUrl: "covers/bollywood_butter.jpg", query: "Pee Loon Mohit Chauhan" },
      { id: "bb_8", title: "Shayad", artist: "Arijit Singh & Pritam", duration: "04:07", durationMs: 247000, artworkUrl: "covers/bollywood_butter.jpg", query: "Shayad Love Aaj Kal Arijit Singh" },
      { id: "bb_9", title: "Gerua", artist: "Arijit Singh & Antara Mitra", duration: "05:45", durationMs: 345000, artworkUrl: "covers/bollywood_butter.jpg", query: "Gerua Dilwale Arijit Singh" },
      { id: "bb_10", title: "Agar Tum Saath Ho", artist: "Alka Yagnik & Arijit Singh", duration: "05:41", durationMs: 341000, artworkUrl: "covers/bollywood_butter.jpg", query: "Agar Tum Saath Ho Tamasha" }
    ]
  },
  {
    id: "hot-hits-hindi",
    name: "Hot Hits Hindi",
    badge: "⚡ Fresh Hindi Chartbusters",
    genre: "hothits",
    description: "Catch the hottest Hindi tracks setting India on fire this week.",
    coverUrl: "covers/hot_hits_hindi.jpg",
    tracks: [
      { id: "hhh_1", title: "Naina", artist: "Crew - Diljit Dosanjh & Badshah", duration: "03:00", durationMs: 180000, artworkUrl: "covers/hot_hits_hindi.jpg", query: "Naina Crew Diljit Dosanjh Badshah" },
      { id: "hhh_2", title: "Pehle Bhi Main", artist: "Vishal Mishra & Harshavardhan (Animal)", duration: "04:10", durationMs: 250000, artworkUrl: "covers/hot_hits_hindi.jpg", query: "Pehle Bhi Main Animal Vishal Mishra" },
      { id: "hhh_3", title: "Satranga", artist: "Arijit Singh & Shreyas Puranik", duration: "04:31", durationMs: 271000, artworkUrl: "covers/hot_hits_hindi.jpg", query: "Satranga Animal Arijit Singh" },
      { id: "hhh_4", title: "Chaleya", artist: "Arijit Singh & Shilpa Rao (Jawan)", duration: "03:20", durationMs: 200000, artworkUrl: "covers/hot_hits_hindi.jpg", query: "Chaleya Jawan Arijit Singh Shilpa Rao" },
      { id: "hhh_5", title: "Heeriye", artist: "Jasleen Royal & Arijit Singh", duration: "03:15", durationMs: 195000, artworkUrl: "covers/hot_hits_hindi.jpg", query: "Heeriye Jasleen Royal Arijit Singh" },
      { id: "hhh_6", title: "Maan Meri Jaan", artist: "King", duration: "03:14", durationMs: 194000, artworkUrl: "covers/hot_hits_hindi.jpg", query: "Maan Meri Jaan King" },
      { id: "hhh_7", title: "Zihaal e Miskin", artist: "Vishal Mishra & Shreya Ghoshal", duration: "04:05", durationMs: 245000, artworkUrl: "covers/hot_hits_hindi.jpg", query: "Zihaal e Miskin Vishal Mishra" },
      { id: "hhh_8", title: "Besharam Rang", artist: "Shilpa Rao & Caralisa Monteiro", duration: "04:18", durationMs: 258000, artworkUrl: "covers/hot_hits_hindi.jpg", query: "Besharam Rang Pathaan Shilpa Rao" }
    ]
  },
  {
    id: "punjabi-101",
    name: "Punjabi 101",
    badge: "🚀 Urban Punjabi & Hip-Hop",
    genre: "punjabi",
    description: "The premier Punjabi anthem hub: Karan Aujla, Diljit Dosanjh, AP Dhillon, Shubh & Sidhu Moose Wala.",
    coverUrl: "covers/punjabi_101.jpg",
    tracks: [
      { id: "pj_1", title: "Softly", artist: "Karan Aujla & Ikky", duration: "02:35", durationMs: 155000, artworkUrl: "covers/punjabi_101.jpg", query: "Softly Karan Aujla Ikky" },
      { id: "pj_2", title: "Winning Speech", artist: "Karan Aujla & Mxrci", duration: "03:42", durationMs: 222000, artworkUrl: "covers/punjabi_101.jpg", query: "Winning Speech Karan Aujla" },
      { id: "pj_3", title: "GOAT", artist: "Diljit Dosanjh", duration: "03:43", durationMs: 223000, artworkUrl: "covers/punjabi_101.jpg", query: "GOAT Diljit Dosanjh" },
      { id: "pj_4", title: "Lover", artist: "Diljit Dosanjh & Intense", duration: "03:05", durationMs: 185000, artworkUrl: "covers/punjabi_101.jpg", query: "Lover Diljit Dosanjh MoonChild Era" },
      { id: "pj_5", title: "Cheques", artist: "Shubh", duration: "03:03", durationMs: 183000, artworkUrl: "covers/punjabi_101.jpg", query: "Cheques Shubh Still Rollin" },
      { id: "pj_6", title: "Elevated", artist: "Shubh", duration: "03:20", durationMs: 200000, artworkUrl: "covers/punjabi_101.jpg", query: "Elevated Shubh" },
      { id: "pj_7", title: "Brown Munde", artist: "AP Dhillon, Gurinder Gill & Shinda Kahlon", duration: "04:27", durationMs: 267000, artworkUrl: "covers/punjabi_101.jpg", query: "Brown Munde AP Dhillon" },
      { id: "pj_8", title: "295", artist: "Sidhu Moose Wala", duration: "04:30", durationMs: 270000, artworkUrl: "covers/punjabi_101.jpg", query: "295 Sidhu Moose Wala" },
      { id: "pj_9", title: "Excuses", artist: "AP Dhillon & Gurinder Gill", duration: "02:56", durationMs: 176000, artworkUrl: "covers/punjabi_101.jpg", query: "Excuses AP Dhillon Intense" }
    ]
  },
  {
    id: "arijit-singh-essentials",
    name: "Arijit Singh: King of Romance",
    badge: "🎤 Voice of India",
    genre: "arijit",
    description: "The definitive collection of soul-stirring masterpieces by India's #1 most streamed artist.",
    coverUrl: "covers/arijit_singh.jpg",
    tracks: [
      { id: "as_1", title: "Channa Mereya", artist: "Arijit Singh (Ae Dil Hai Mushkil)", duration: "04:49", durationMs: 289000, artworkUrl: "covers/arijit_singh.jpg", query: "Channa Mereya Arijit Singh" },
      { id: "as_2", title: "Tum Hi Ho", artist: "Arijit Singh (Aashiqui 2)", duration: "04:22", durationMs: 262000, artworkUrl: "covers/arijit_singh.jpg", query: "Tum Hi Ho Arijit Singh" },
      { id: "as_3", title: "Agar Tum Saath Ho", artist: "Arijit Singh & Alka Yagnik", duration: "05:41", durationMs: 341000, artworkUrl: "covers/arijit_singh.jpg", query: "Agar Tum Saath Ho Tamasha" },
      { id: "as_4", title: "Ilahi", artist: "Arijit Singh (YJHD)", duration: "03:49", durationMs: 229000, artworkUrl: "covers/arijit_singh.jpg", query: "Ilahi Yeh Jawaani Hai Deewani Arijit Singh" },
      { id: "as_5", title: "Hawayein", artist: "Arijit Singh & Pritam", duration: "04:50", durationMs: 290000, artworkUrl: "covers/arijit_singh.jpg", query: "Hawayein Arijit Singh" },
      { id: "as_6", title: "Kalank Title Track", artist: "Arijit Singh", duration: "05:11", durationMs: 311000, artworkUrl: "covers/arijit_singh.jpg", query: "Kalank Title Track Arijit Singh" },
      { id: "as_7", title: "Kabira", artist: "Arijit Singh & Harshdeep Kaur", duration: "04:11", durationMs: 251000, artworkUrl: "covers/arijit_singh.jpg", query: "Kabira Yeh Jawaani Hai Deewani" },
      { id: "as_8", title: "Mast Magan", artist: "Arijit Singh & Chinmayi", duration: "04:40", durationMs: 280000, artworkUrl: "covers/arijit_singh.jpg", query: "Mast Magan 2 States Arijit Singh" }
    ]
  },
  {
    id: "atif-aslam-essentials",
    name: "Atif Aslam: Soul Anthems",
    badge: "✨ Soul Anthems",
    genre: "atif",
    description: "Unforgettable vocal classics, romantic ballads and spiritual tributes from Atif Aslam.",
    coverUrl: "covers/atif_aslam.jpg",
    tracks: [
      { id: "aa_1", title: "Tajdar-e-Haram", artist: "Atif Aslam (Coke Studio)", duration: "10:28", durationMs: 628000, artworkUrl: "covers/atif_aslam.jpg", query: "Tajdar e Haram Atif Aslam Coke Studio" },
      { id: "aa_2", title: "Woh Lamhe", artist: "Atif Aslam (Zeher)", duration: "05:20", durationMs: 320000, artworkUrl: "covers/atif_aslam.jpg", query: "Woh Lamhe Atif Aslam Zeher" },
      { id: "aa_3", title: "Tera Hone Laga Hoon", artist: "Atif Aslam & Alisha Chinai", duration: "04:59", durationMs: 299000, artworkUrl: "covers/atif_aslam.jpg", query: "Tera Hone Laga Hoon Atif Aslam" },
      { id: "aa_4", title: "Jeena Jeena", artist: "Atif Aslam (Badlapur)", duration: "03:49", durationMs: 229000, artworkUrl: "covers/atif_aslam.jpg", query: "Jeena Jeena Badlapur Atif Aslam" },
      { id: "aa_5", title: "Pehli Nazar Mein", artist: "Atif Aslam (Race)", duration: "05:14", durationMs: 314000, artworkUrl: "covers/atif_aslam.jpg", query: "Pehli Nazar Mein Atif Aslam Race" },
      { id: "aa_6", title: "Tu Jaane Na", artist: "Atif Aslam", duration: "05:41", durationMs: 341000, artworkUrl: "covers/atif_aslam.jpg", query: "Tu Jaane Na Atif Aslam" },
      { id: "aa_7", title: "Aadat", artist: "Atif Aslam (Jal)", duration: "04:28", durationMs: 268000, artworkUrl: "covers/atif_aslam.jpg", query: "Aadat Atif Aslam Jal" }
    ]
  },
  {
    id: "tollywood-bangers",
    name: "Tollywood Bangers (Telugu)",
    badge: "🌟 Telugu Mass Beats",
    genre: "south",
    description: "High-octane mass beats and viral Telugu chartbusters setting cinema halls ablaze.",
    coverUrl: "covers/tollywood_bangers.jpg",
    tracks: [
      { id: "tl_1", title: "Kurchi Madathapetti", artist: "Thaman S & Mahesh Babu", duration: "03:36", durationMs: 216000, artworkUrl: "covers/tollywood_bangers.jpg", query: "Kurchi Madathapetti Guntur Kaaram Thaman" },
      { id: "tl_2", title: "Oo Antava Mava", artist: "Devi Sri Prasad & Indravathi (Pushpa)", duration: "03:48", durationMs: 228000, artworkUrl: "covers/tollywood_bangers.jpg", query: "Oo Antava Mava Pushpa Devi Sri Prasad" },
      { id: "tl_3", title: "Naatu Naatu", artist: "M.M. Keeravaani & Rahul Sipligunj (RRR)", duration: "03:36", durationMs: 216000, artworkUrl: "covers/tollywood_bangers.jpg", query: "Naatu Naatu RRR Keeravaani" },
      { id: "tl_4", title: "Samajavaragamana", artist: "Sid Sriram & Thaman S", duration: "04:34", durationMs: 274000, artworkUrl: "covers/tollywood_bangers.jpg", query: "Samajavaragamana Sid Sriram Ala Vaikunthapurramuloo" },
      { id: "tl_5", title: "Butta Bomma", artist: "Armaan Malik & Thaman S", duration: "03:18", durationMs: 198000, artworkUrl: "covers/tollywood_bangers.jpg", query: "Butta Bomma Armaan Malik" },
      { id: "tl_6", title: "Pushpa Pushpa", artist: "Devi Sri Prasad & Mika Singh", duration: "04:15", durationMs: 255000, artworkUrl: "covers/tollywood_bangers.jpg", query: "Pushpa Pushpa Pushpa 2 The Rule" }
    ]
  },
  {
    id: "kollywood-chartbusters",
    name: "Kollywood Chartbusters (Tamil)",
    badge: "⚡ Tamil Mass Hits",
    genre: "south",
    description: "Anirudh Ravichander and A.R. Rahman trending Tamil master tracks and high-energy anthems.",
    coverUrl: "covers/kollywood.jpg",
    tracks: [
      { id: "kl_1", title: "Hukum - Thalaivar Alappara", artist: "Anirudh Ravichander (Jailer)", duration: "03:27", durationMs: 207000, artworkUrl: "covers/kollywood.jpg", query: "Hukum Jailer Anirudh Ravichander" },
      { id: "kl_2", title: "Naa Ready", artist: "Anirudh Ravichander & Thalapathy Vijay (Leo)", duration: "04:08", durationMs: 248000, artworkUrl: "covers/kollywood.jpg", query: "Naa Ready Leo Anirudh Thalapathy Vijay" },
      { id: "kl_3", title: "Arabic Kuthu", artist: "Anirudh Ravichander & Jonita Gandhi", duration: "04:39", durationMs: 279000, artworkUrl: "covers/kollywood.jpg", query: "Arabic Kuthu Beast Anirudh" },
      { id: "kl_4", title: "Vaathi Coming", artist: "Anirudh Ravichander (Master)", duration: "03:50", durationMs: 230000, artworkUrl: "covers/kollywood.jpg", query: "Vaathi Coming Master Anirudh" },
      { id: "kl_5", title: "Kaavaalaa", artist: "Anirudh Ravichander & Shilpa Rao", duration: "03:10", durationMs: 190000, artworkUrl: "covers/kollywood.jpg", query: "Kaavaalaa Jailer Anirudh Shilpa Rao" },
      { id: "kl_6", title: "Badass", artist: "Anirudh Ravichander (Leo)", duration: "03:49", durationMs: 229000, artworkUrl: "covers/kollywood.jpg", query: "Badass Leo Anirudh" }
    ]
  },
  {
    id: "sufi-qawwali-mystics",
    name: "Sufi & Qawwali Mystics",
    badge: "🕊️ Divine Spiritual Trance",
    genre: "sufi",
    description: "Divine spiritual trance, sacred verses and timeless qawwalis connecting hearts to eternity.",
    coverUrl: "covers/sufi_mystics.jpg",
    tracks: [
      { id: "sq_1", title: "Dam Mast Qalandar", artist: "Nusrat Fateh Ali Khan", duration: "08:15", durationMs: 495000, artworkUrl: "covers/sufi_mystics.jpg", query: "https://www.youtube.com/watch?v=SKZAiWSquA0", url: "https://www.youtube.com/watch?v=SKZAiWSquA0", source: "youtube" },
      { id: "sq_2", title: "Afreen Afreen", artist: "Rahat Fateh Ali Khan & Momina Mustehsan", duration: "06:45", durationMs: 405000, artworkUrl: "covers/sufi_mystics.jpg", query: "Afreen Afreen Rahat Fateh Ali Khan Momina" },
      { id: "sq_3", title: "Kun Faya Kun", artist: "A.R. Rahman, Javed Ali & Mohit Chauhan", duration: "07:53", durationMs: 473000, artworkUrl: "covers/sufi_mystics.jpg", query: "Kun Faya Kun Rockstar AR Rahman" },
      { id: "sq_4", title: "Khwaja Mere Khwaja", artist: "A.R. Rahman (Jodhaa Akbar)", duration: "06:56", durationMs: 416000, artworkUrl: "covers/sufi_mystics.jpg", query: "Khwaja Mere Khwaja AR Rahman" },
      { id: "sq_5", title: "Chap Tilak Sab Cheen Li", artist: "Rahat Fateh Ali Khan", duration: "06:12", durationMs: 372000, artworkUrl: "covers/sufi_mystics.jpg", query: "Chhap Tilak Sab Cheen Li Rahat Fateh Ali Khan" },
      { id: "sq_6", title: "Bhar Do Jholi Meri", artist: "Adnan Sami (Bajrangi Bhaijaan)", duration: "08:19", durationMs: 499000, artworkUrl: "covers/sufi_mystics.jpg", query: "Bhar Do Jholi Meri Adnan Sami" },
      { id: "sq_7", title: "Mast Nazron Se Allah Bachaye", artist: "Nusrat Fateh Ali Khan", duration: "07:22", durationMs: 442000, artworkUrl: "covers/sufi_mystics.jpg", query: "Mast Nazron Se Allah Bachaye Nusrat Fateh Ali Khan" }
    ]
  }
];

// Live Spotify Playlists that are accessible via embed scraping without geoblocking
const LIVE_SPOTIFY_SOURCES = [
  {
    id: "37i9dQZF1DX5q67ZpWyRrZ",
    name: "Indie India Chill",
    badge: "🎸 Desi Acoustic & Pop",
    genre: "indie",
    fallbackDesc: "Acoustic melodies, poetic lyrics, and relaxing desi indie tunes.",
    fallbackCover: "https://i.scdn.co/image/ab67706f00000002656f14776fbb39aa2ae900f0",
    fallbackTracks: [
      { id: "ii_1", title: "Baarishein", artist: "Anuv Jain", duration: "03:27", durationMs: 207000, artworkUrl: "https://i.scdn.co/image/ab67706f00000002656f14776fbb39aa2ae900f0", query: "Baarishein Anuv Jain" },
      { id: "ii_2", title: "Alag Aasmaan", artist: "Anuv Jain", duration: "03:52", durationMs: 232000, artworkUrl: "https://i.scdn.co/image/ab67706f00000002656f14776fbb39aa2ae900f0", query: "Alag Aasmaan Anuv Jain" },
      { id: "ii_3", title: "Cold/Mess", artist: "Prateek Kuhad", duration: "04:45", durationMs: 285000, artworkUrl: "https://i.scdn.co/image/ab67706f00000002656f14776fbb39aa2ae900f0", query: "Cold Mess Prateek Kuhad" },
      { id: "ii_4", title: "Kasoor", artist: "Prateek Kuhad", duration: "03:16", durationMs: 196000, artworkUrl: "https://i.scdn.co/image/ab67706f00000002656f14776fbb39aa2ae900f0", query: "Kasoor Prateek Kuhad" },
      { id: "ii_5", title: "Khoj (Passing By)", artist: "When Chai Met Toast", duration: "03:40", durationMs: 220000, artworkUrl: "https://i.scdn.co/image/ab67706f00000002656f14776fbb39aa2ae900f0", query: "Khoj Passing By When Chai Met Toast" },
      { id: "ii_6", title: "Iraaday", artist: "Ruvii & Abdul Hannan", duration: "03:18", durationMs: 198000, artworkUrl: "https://i.scdn.co/image/ab67706f00000002656f14776fbb39aa2ae900f0", query: "Iraaday Abdul Hannan" }
    ]
  },
  {
    id: "37i9dQZF1DXcBWIGoYBM5M",
    name: "Today's Top Hits",
    badge: "🌍 Global Hits in India",
    genre: "pop",
    fallbackDesc: "The biggest global hits trending in India and worldwide.",
    fallbackCover: "https://i.scdn.co/image/ab67706f00000002526040498d89ec622e9d3495",
    fallbackTracks: []
  },
  {
    id: "37i9dQZEVXbMDoHDwVN2tF",
    name: "Top 50 - Global",
    badge: "📈 Worldwide Daily Chart",
    genre: "charts",
    fallbackDesc: "Daily update of the most played tracks around the globe.",
    fallbackCover: "https://i.scdn.co/image/ab67706f00000002526040498d89ec622e9d3495",
    fallbackTracks: []
  }
];

let inMemoryCache = {
  lastUpdated: 0,
  nextUpdate: 0,
  playlists: [],
  topTracks: []
};

let isUpdating = false;

/**
 * Fetch a single Spotify playlist's embed entity without authentication tokens
 */
async function fetchSpotifyPlaylistEmbed(playlistId) {
  const url = `https://open.spotify.com/embed/playlist/${playlistId}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
      }
    });

    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const html = await res.text();
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!match) throw new Error("Could not parse Spotify NEXT_DATA");

    const data = JSON.parse(match[1]);
    const entity = data.props?.pageProps?.state?.data?.entity;
    if (!entity) throw new Error("No entity object found in Spotify embed data");

    const coverUrl = entity.coverArt?.sources?.[0]?.url || "logo.png";
    const tracks = (entity.trackList || []).map((t, idx) => {
      const artist = t.subtitle || "Spotify Artist";
      const title = t.title || `Track ${idx + 1}`;
      const durationMs = t.duration || 180000;
      return {
        id: `sp_${playlistId}_${idx + 1}`,
        title,
        artist,
        duration: formatDuration(durationMs),
        durationMs,
        artworkUrl: coverUrl,
        query: `${artist} - ${title}`,
        previewUrl: t.audioPreview?.url || null,
        spotifyUri: t.uri || `spotify:track:unknown_${idx}`
      };
    });

    return {
      id: playlistId,
      name: entity.name || entity.title || "Spotify Playlist",
      description: entity.subtitle || `Spotify Official Playlist (${tracks.length} tracks)`,
      coverUrl,
      trackCount: tracks.length,
      tracks
    };
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

/**
 * Build the Indian-first top tracks collection for the homepage quick-play pills
 */
function buildIndianFirstTopTracks(playlists) {
  const topTracks = [];
  const seen = new Set();

  function addTrack(t, pl) {
    if (!t || !t.query) return;
    const key = t.query.toLowerCase().trim();
    if (!seen.has(key)) {
      seen.add(key);
      topTracks.push({
        ...t,
        playlistName: pl.name,
        playlistBadge: pl.badge,
        playlistCover: pl.coverUrl
      });
    }
  }

  // 1. Prioritize Top 50 India songs (#1 through #8)
  const top50India = playlists.find(p => p.id === "top50-india");
  if (top50India && Array.isArray(top50India.tracks)) {
    for (const t of top50India.tracks.slice(0, 8)) {
      addTrack(t, top50India);
    }
  }

  // 2. Bollywood Butter top hits (#9 through #12)
  const bollywood = playlists.find(p => p.id === "bollywood-butter");
  if (bollywood && Array.isArray(bollywood.tracks)) {
    for (const t of bollywood.tracks.slice(0, 4)) {
      addTrack(t, bollywood);
    }
  }

  // 3. Hot Hits Hindi & Punjabi 101 (#13 through #18)
  const hotHindi = playlists.find(p => p.id === "hot-hits-hindi");
  if (hotHindi && Array.isArray(hotHindi.tracks)) {
    for (const t of hotHindi.tracks.slice(0, 4)) {
      addTrack(t, hotHindi);
    }
  }
  const punjabi = playlists.find(p => p.id === "punjabi-101");
  if (punjabi && Array.isArray(punjabi.tracks)) {
    for (const t of punjabi.tracks.slice(0, 4)) {
      addTrack(t, punjabi);
    }
  }

  // 4. South Indian Bangers & Desi Indie (#19 through #24)
  const south = playlists.find(p => p.id === "tollywood-bangers") || playlists.find(p => p.id === "kollywood-chartbusters");
  if (south && Array.isArray(south.tracks)) {
    for (const t of south.tracks.slice(0, 3)) {
      addTrack(t, south);
    }
  }
  const indie = playlists.find(p => p.id === "37i9dQZF1DX5q67ZpWyRrZ" || p.id === "indie-india-chill");
  if (indie && Array.isArray(indie.tracks)) {
    for (const t of indie.tracks.slice(0, 3)) {
      addTrack(t, indie);
    }
  }

  // 5. Crossover Global Hits in India (#25 through #30)
  const globalHits = playlists.find(p => p.id === "37i9dQZF1DXcBWIGoYBM5M");
  if (globalHits && Array.isArray(globalHits.tracks)) {
    for (const t of globalHits.tracks.slice(0, 6)) {
      addTrack(t, globalHits);
    }
  }

  return topTracks;
}

/**
 * Refresh trending playlists from Spotify and update cache
 */
async function refreshTrending(force = false) {
  if (isUpdating) {
    return inMemoryCache;
  }

  const now = Date.now();
  if (!force && inMemoryCache.lastUpdated && (now - inMemoryCache.lastUpdated < TWENTY_FOUR_HOURS) && inMemoryCache.playlists.length > 0) {
    return inMemoryCache;
  }

  isUpdating = true;
  console.log("🇮🇳 [SPOTIFY TRENDING] Daily Indian-first Spotify trending import started...");

  // Start with verified Indian curated playlists
  const playlists = CURATED_INDIAN_PLAYLISTS.map(pl => ({
    ...pl,
    trackCount: pl.tracks.length,
    lastImported: now
  }));

  // Fetch live Spotify sources (Indie India, Today's Top Hits, Top 50 Global)
  for (const src of LIVE_SPOTIFY_SOURCES) {
    try {
      const pl = await fetchSpotifyPlaylistEmbed(src.id);
      playlists.push({
        ...pl,
        name: src.name,
        badge: src.badge,
        genre: src.genre,
        lastImported: now
      });
      console.log(`   ✅ Live Imported: "${src.name}" (${src.badge}) — ${pl.trackCount} tracks`);
    } catch (err) {
      console.warn(`   ⚠️ Live fetch note for ${src.name} (${src.id}): ${err.message}. Using high-quality curated data.`);
      if (src.fallbackTracks && src.fallbackTracks.length > 0) {
        playlists.push({
          id: src.id,
          name: src.name,
          badge: src.badge,
          genre: src.genre,
          description: src.fallbackDesc,
          coverUrl: src.fallbackCover,
          trackCount: src.fallbackTracks.length,
          tracks: src.fallbackTracks,
          lastImported: now
        });
      }
    }
  }

  const topTracks = buildIndianFirstTopTracks(playlists);

  inMemoryCache = {
    lastUpdated: now,
    nextUpdate: now + TWENTY_FOUR_HOURS,
    playlists: playlists,
    topTracks: topTracks
  };

  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(inMemoryCache, null, 2), "utf8");
    console.log(`✅ [SPOTIFY TRENDING] Cached ${playlists.length} Indian-prioritized trending playlists (${topTracks.length} top tracks) to ${path.basename(CACHE_FILE)}`);
  } catch (e) {
    console.error("Failed to write spotify_trending_cache.json:", e);
  }

  isUpdating = false;
  return inMemoryCache;
}

/**
 * Initialize daily trending service
 */
function initSpotifyTrending() {
  let needsInitialFetch = true;

  // 1. Try to load existing cache from disk
  if (fs.existsSync(CACHE_FILE)) {
    try {
      const raw = fs.readFileSync(CACHE_FILE, "utf8");
      const parsed = JSON.parse(raw);
      // Validate that cache contains Indian-first playlists
      const hasIndianTop50 = Array.isArray(parsed?.playlists) && parsed.playlists.some(p => p.id === "top50-india" || p.name.includes("India"));
      if (hasIndianTop50 && parsed.playlists.length >= 8) {
        inMemoryCache = parsed;
        const ageHours = ((Date.now() - (parsed.lastUpdated || 0)) / (1000 * 60 * 60)).toFixed(1);
        console.log(`📦 [SPOTIFY TRENDING] Loaded ${parsed.playlists.length} Indian trending playlists from disk (cached ${ageHours}h ago).`);
        needsInitialFetch = (Date.now() - (parsed.lastUpdated || 0) >= TWENTY_FOUR_HOURS);
      } else {
        console.log("📦 [SPOTIFY TRENDING] Old non-Indian cache detected. Rebuilding Indian trending catalog...");
      }
    } catch (err) {
      console.warn("Failed reading spotify_trending_cache.json, will refetch:", err.message);
    }
  }

  // 2. Refresh immediately if needed
  if (needsInitialFetch || inMemoryCache.playlists.length === 0) {
    refreshTrending(true).catch(e => console.error("Initial Indian Spotify trending import error:", e));
  }

  // 3. Setup recurring 24-hour interval
  setInterval(() => {
    console.log("⏰ [SPOTIFY TRENDING] 24-hour scheduled daily update triggered...");
    refreshTrending(true).catch(e => console.error("Scheduled Spotify trending import error:", e));
  }, TWENTY_FOUR_HOURS);
}

/**
 * Get current trending data
 */
function getTrendingData() {
  if (!inMemoryCache.playlists || inMemoryCache.playlists.length === 0) {
    // Synchronous immediate fallback
    const playlists = CURATED_INDIAN_PLAYLISTS.map(pl => ({
      ...pl,
      trackCount: pl.tracks.length,
      lastImported: Date.now()
    }));
    return {
      lastUpdated: Date.now(),
      nextUpdate: Date.now() + TWENTY_FOUR_HOURS,
      playlists: playlists,
      topTracks: buildIndianFirstTopTracks(playlists)
    };
  }
  return inMemoryCache;
}

module.exports = {
  initSpotifyTrending,
  refreshTrending,
  getTrendingData,
  CURATED_INDIAN_PLAYLISTS
};
