const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// In-memory data store with disk persistence & optional MongoDB Atlas cloud persistence
let users = {};
const sessions = new Map(); // token -> { userId, expiresAt }

// Optional Cloud Database Support (MongoDB Atlas Free Tier - Zero Credit Card Required)
let mongoClient = null;
let mongoDb = null;
const MONGODB_URI = process.env.MONGODB_URI || process.env.DATABASE_URL;

async function initMongo() {
  if (!MONGODB_URI) return;
  try {
    const { MongoClient } = require("mongodb");
    mongoClient = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000
    });
    await mongoClient.connect();
    mongoDb = mongoClient.db("track_finder");
    console.log("✅ Successfully connected to persistent MongoDB Atlas cluster!");

    // Load users from Mongo & merge with local
    const usersColl = mongoDb.collection("users");
    const dbUsers = await usersColl.find({}).toArray();
    for (const u of dbUsers) {
      if (u && u.id) {
        users[u.id] = { ...users[u.id], ...u };
      }
    }
    saveUsers(false); // sync locally

    // Load active sessions from Mongo
    const sessColl = mongoDb.collection("sessions");
    const dbSessions = await sessColl.find({ expiresAt: { $gt: Date.now() } }).toArray();
    for (const s of dbSessions) {
      if (s && s.token && s.userId) {
        sessions.set(s.token, { userId: s.userId, expiresAt: s.expiresAt });
      }
    }
    saveSessions(false); // sync locally
  } catch (err) {
    console.warn("MongoDB Atlas connection notice (running on local JSON & Vault rehydration fallback):", err.message);
  }
}

// Load users from disk
function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = fs.readFileSync(USERS_FILE, "utf-8");
      users = JSON.parse(data || "{}");
    } else {
      users = {};
      saveUsers(false);
    }
  } catch (err) {
    console.error("Error loading users.json:", err.message);
    users = {};
  }
}

// Save users to disk and sync to MongoDB Atlas if connected
function saveUsers(syncMongo = true) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");
  } catch (err) {
    console.error("Error saving users.json:", err.message);
  }

  if (syncMongo && mongoDb) {
    (async () => {
      try {
        const usersColl = mongoDb.collection("users");
        const ops = Object.values(users).map(u => ({
          replaceOne: {
            filter: { id: u.id },
            replacement: u,
            upsert: true
          }
        }));
        if (ops.length > 0) await usersColl.bulkWrite(ops);
      } catch (e) {
        console.warn("Mongo users sync note:", e.message);
      }
    })();
  }
}

// Load sessions from disk
function loadSessions() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const data = fs.readFileSync(SESSIONS_FILE, "utf-8");
      const obj = JSON.parse(data || "{}");
      const now = Date.now();
      for (const [token, sess] of Object.entries(obj)) {
        if (sess && sess.expiresAt && sess.expiresAt > now && sess.userId) {
          sessions.set(token, sess);
        }
      }
    }
  } catch (err) {
    console.error("Error loading sessions.json:", err.message);
  }
}

// Save sessions to disk and sync to MongoDB Atlas if connected
function saveSessions(syncMongo = true) {
  try {
    const obj = {};
    const now = Date.now();
    for (const [token, sess] of sessions.entries()) {
      if (sess && sess.expiresAt > now) {
        obj[token] = sess;
      }
    }
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj, null, 2), "utf-8");
  } catch (err) {
    console.error("Error saving sessions.json:", err.message);
  }

  if (syncMongo && mongoDb) {
    (async () => {
      try {
        const sessColl = mongoDb.collection("sessions");
        const now = Date.now();
        const docs = [];
        for (const [token, sess] of sessions.entries()) {
          if (sess && sess.expiresAt > now) {
            docs.push({ token, userId: sess.userId, expiresAt: sess.expiresAt });
          }
        }
        if (docs.length > 0) {
          const ops = docs.map(d => ({
            replaceOne: {
              filter: { token: d.token },
              replacement: d,
              upsert: true
            }
          }));
          await sessColl.bulkWrite(ops);
        }
      } catch (e) {
        console.warn("Mongo sessions sync note:", e.message);
      }
    })();
  }
}

// Initialize on startup
loadUsers();
loadSessions();
initMongo();

/**
 * Rehydrates a user and session from a client-provided vault
 * (Called when the server was restarted or redeployed from a push so user accounts & likes are never lost)
 */
function rehydrateUser(vault) {
  if (!vault || !vault.user || !vault.user.id) {
    return { success: false, error: "Invalid user vault data" };
  }
  const u = vault.user;
  const id = u.id;

  // Restore user into in-memory store
  if (!users[id]) {
    users[id] = {
      ...u,
      favorites: Array.isArray(vault.favorites) && vault.favorites.length > 0 ? vault.favorites : (u.favorites || []),
      queue: Array.isArray(vault.queue) ? vault.queue : (u.queue || []),
      tasteProfile: vault.tasteProfile || u.tasteProfile || {
        listenedTracks: [],
        artistAffinity: {},
        genreAffinity: {},
        preferredGenres: ["bollywood", "romantic"],
        lastUpdatedDate: "",
        dailyMixes: [],
        historyCount: 0
      },
      lastActive: Date.now()
    };
  } else {
    // Merge favorites & taste profile if vault has newer data
    if (Array.isArray(vault.favorites) && vault.favorites.length > (users[id].favorites?.length || 0)) {
      users[id].favorites = vault.favorites;
    }
    if (vault.tasteProfile) {
      users[id].tasteProfile = { ...users[id].tasteProfile, ...vault.tasteProfile };
    }
    users[id].lastActive = Date.now();
  }

  // Single active sign-in enforcement ("one sign in must be in one app"):
  // Invalidate any other active sessions for this user across all apps/devices
  for (const [existingToken, sess] of sessions.entries()) {
    if (sess && sess.userId === id) {
      sessions.delete(existingToken);
    }
  }

  // Restore session token with 60-day longevity
  const token = vault.sessionToken || vault.token || generateToken();
  sessions.set(token, {
    userId: id,
    expiresAt: Date.now() + 60 * 24 * 60 * 60 * 1000 // 60 days
  });

  saveUsers();
  saveSessions();

  return {
    success: true,
    user: users[id],
    token
  };
}

/**
 * Generates a secure random session token
 */
function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Computes salted password hash
 */
function hashPassword(password, salt) {
  if (!password || !salt) return "";
  return crypto.pbkdf2Sync(password, salt, 1000, 32, "sha256").toString("hex");
}

/**
 * Creates or retrieves a user profile
 */
function getOrCreateUser(profileData) {
  const id = profileData.id || profileData.discordId || `user_${Date.now()}`;
  if (!users[id]) {
    users[id] = {
      id,
      username: profileData.username || "Guest",
      displayName: profileData.displayName || profileData.username || "Guest",
      avatar: profileData.avatar || "logo.png",
      type: profileData.type || "local",
      discordId: profileData.discordId || null,
      isServerMember: Boolean(profileData.isServerMember),
      roles: profileData.roles || [],
      favorites: [],
      queue: [],
      tasteProfile: {
        listenedTracks: [],
        artistAffinity: {},
        genreAffinity: {},
        preferredGenres: profileData.preferredGenres || ["bollywood", "romantic"],
        lastUpdatedDate: "",
        dailyMixes: [],
        historyCount: 0
      },
      createdAt: Date.now(),
      lastActive: Date.now()
    };
  } else {
    // Update existing user properties
    if (profileData.username) users[id].username = profileData.username;
    if (profileData.displayName) users[id].displayName = profileData.displayName;
    if (profileData.avatar) users[id].avatar = profileData.avatar;
    if (profileData.discordId) users[id].discordId = profileData.discordId;
    if (profileData.isServerMember !== undefined) users[id].isServerMember = Boolean(profileData.isServerMember);
    if (profileData.roles) users[id].roles = profileData.roles;
    if (!users[id].tasteProfile) {
      users[id].tasteProfile = {
        listenedTracks: [],
        artistAffinity: {},
        genreAffinity: {},
        preferredGenres: ["bollywood", "romantic"],
        lastUpdatedDate: "",
        dailyMixes: [],
        historyCount: 0
      };
    }
    users[id].lastActive = Date.now();
  }
  saveUsers();
  return users[id];
}

/**
 * Creates an active session for a user (persisted to disk for 60 days)
 */
function createSession(user) {
  if (!user || !user.id) return null;
  // Single active sign-in enforcement ("one sign in must be in one app"):
  // Invalidate any other active sessions for this user across all apps/devices
  for (const [existingToken, sess] of sessions.entries()) {
    if (sess && sess.userId === user.id) {
      sessions.delete(existingToken);
    }
  }
  const token = generateToken();
  sessions.set(token, {
    userId: user.id,
    createdAt: Date.now(),
    expiresAt: Date.now() + 60 * 24 * 60 * 60 * 1000 // 60 days
  });
  saveSessions();
  return token;
}

/**
 * Retrieves a user from a session token
 */
function getUserByToken(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    saveSessions();
    return null;
  }
  return users[session.userId] || null;
}

/**
 * Invalidates a session token
 */
function removeSession(token) {
  if (token && sessions.has(token)) {
    sessions.delete(token);
    saveSessions();
  }
}

/**
 * Toggles a song in user's favorites
 */
function toggleFavorite(userId, track) {
  if (!userId || !users[userId] || !track) return { isFavorite: false, favorites: [] };
  const user = users[userId];
  if (!Array.isArray(user.favorites)) user.favorites = [];

  const trackTitle = (track.title || "").trim().toLowerCase();
  const existingIdx = user.favorites.findIndex(f => 
    (f.id && track.id && f.id === track.id) ||
    (f.title && f.title.trim().toLowerCase() === trackTitle)
  );

  let isFavorite = false;
  if (existingIdx !== -1) {
    user.favorites.splice(existingIdx, 1);
    isFavorite = false;
  } else {
    user.favorites.unshift({
      id: track.id || `fav_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      title: track.title || "Unknown Song",
      author: track.author || track.artist || "Artist",
      duration: Number(track.duration) || 0,
      artworkUrl: track.artworkUrl || "logo.png",
      streamUrl: track.streamUrl || null,
      filterMode: track.filterMode || "filterless",
      addedAt: Date.now()
    });
    isFavorite = true;
  }

  user.lastActive = Date.now();
  saveUsers();
  return { isFavorite, favorites: user.favorites };
}

/**
 * Gets user's favorite tracks
 */
function getFavorites(userId) {
  if (!userId || !users[userId]) return [];
  return users[userId].favorites || [];
}

/**
 * Saves user's browser queue
 */
function saveQueue(userId, queue) {
  if (!userId || !users[userId] || !Array.isArray(queue)) return [];
  users[userId].queue = queue.slice(0, 100).map(t => ({
    id: t.id || null,
    title: t.title || "Track",
    author: t.author || t.artist || "Artist",
    duration: Number(t.duration) || 0,
    artworkUrl: t.artworkUrl || "logo.png",
    streamUrl: t.streamUrl || null,
    filterMode: t.filterMode || "filterless"
  }));
  users[userId].lastActive = Date.now();
  saveUsers();
  return users[userId].queue;
}

/**
 * Gets user's saved queue
 */
function getQueue(userId) {
  if (!userId || !users[userId]) return [];
  return users[userId].queue || [];
}

// ==========================================================================
// TASTE PATTERN ENGINE & DAILY RECOMMENDATION CATALOG
// ==========================================================================

const MASTER_GENRE_CATALOG = {
  bollywood: [
    { title: "Kesariya", artist: "Arijit Singh & Pritam", duration: "04:28", artworkUrl: "covers/bollywood_butter.jpg", query: "Kesariya Arijit Singh Brahmastra" },
    { title: "Tum Hi Ho", artist: "Arijit Singh & Mithoon", duration: "04:22", artworkUrl: "covers/arijit_singh.jpg", query: "Tum Hi Ho Aashiqui 2" },
    { title: "Channa Mereya", artist: "Arijit Singh", duration: "04:49", artworkUrl: "covers/arijit_singh.jpg", query: "Channa Mereya Ae Dil Hai Mushkil" },
    { title: "Chaleya", artist: "Arijit Singh & Shilpa Rao", duration: "03:20", artworkUrl: "covers/hot_hits_hindi.jpg", query: "Chaleya Jawan Arijit Singh" },
    { title: "Shayad", artist: "Arijit Singh & Pritam", duration: "04:07", artworkUrl: "covers/bollywood_butter.jpg", query: "Shayad Love Aaj Kal Arijit Singh" },
    { title: "Raataan Lambiyan", artist: "Jubin Nautiyal & Asees Kaur", duration: "03:50", artworkUrl: "covers/bollywood_butter.jpg", query: "Raataan Lambiyan Shershaah" },
    { title: "Satranga", artist: "Arijit Singh (Animal)", duration: "04:31", artworkUrl: "covers/hot_hits_hindi.jpg", query: "Satranga Animal Arijit Singh" },
    { title: "Pee Loon", artist: "Mohit Chauhan & Pritam", duration: "04:47", artworkUrl: "covers/bollywood_butter.jpg", query: "Pee Loon Mohit Chauhan" },
    { title: "Agar Tum Saath Ho", artist: "Arijit Singh & Alka Yagnik", duration: "05:41", artworkUrl: "covers/arijit_singh.jpg", query: "Agar Tum Saath Ho Tamasha" },
    { title: "Hawayein", artist: "Arijit Singh & Pritam", duration: "04:50", artworkUrl: "covers/arijit_singh.jpg", query: "Hawayein Jab Harry Met Sejal" }
  ],
  romantic: [
    { title: "Tum Hi Ho", artist: "Arijit Singh", duration: "04:22", artworkUrl: "covers/arijit_singh.jpg", query: "Tum Hi Ho Arijit Singh" },
    { title: "Pehli Nazar Mein", artist: "Atif Aslam", duration: "05:14", artworkUrl: "covers/atif_aslam.jpg", query: "Pehli Nazar Mein Atif Aslam" },
    { title: "Jeena Jeena", artist: "Atif Aslam", duration: "03:49", artworkUrl: "covers/atif_aslam.jpg", query: "Jeena Jeena Badlapur Atif Aslam" },
    { title: "Tera Hone Laga Hoon", artist: "Atif Aslam & Alisha Chinai", duration: "04:59", artworkUrl: "covers/atif_aslam.jpg", query: "Tera Hone Laga Hoon Atif Aslam" },
    { title: "Ve Kamleya", artist: "Arijit Singh & Shreya Ghoshal", duration: "04:06", artworkUrl: "covers/top50_india.jpg", query: "Ve Kamleya Arijit Singh" },
    { title: "O Sajni Re", artist: "Arijit Singh", duration: "03:25", artworkUrl: "covers/top50_india.jpg", query: "O Sajni Re Arijit Singh" },
    { title: "Heeriye", artist: "Jasleen Royal & Arijit Singh", duration: "03:15", artworkUrl: "covers/hot_hits_hindi.jpg", query: "Heeriye Jasleen Royal Arijit Singh" },
    { title: "Tu Jaane Na", artist: "Atif Aslam", duration: "05:41", artworkUrl: "covers/atif_aslam.jpg", query: "Tu Jaane Na Atif Aslam" },
    { title: "Apna Bana Le", artist: "Arijit Singh & Sachin-Jigar", duration: "04:21", artworkUrl: "covers/top50_india.jpg", query: "Apna Bana Le Arijit Singh" },
    { title: "Mast Magan", artist: "Arijit Singh & Chinmayi", duration: "04:40", artworkUrl: "covers/arijit_singh.jpg", query: "Mast Magan 2 States Arijit Singh" }
  ],
  sufi: [
    { title: "Tajdar-e-Haram", artist: "Atif Aslam (Coke Studio)", duration: "10:28", artworkUrl: "covers/atif_aslam.jpg", query: "Tajdar e Haram Atif Aslam Coke Studio" },
    { title: "Dam Mast Qalandar", artist: "Nusrat Fateh Ali Khan", duration: "08:15", artworkUrl: "covers/sufi_mystics.jpg", query: "https://www.youtube.com/watch?v=SKZAiWSquA0", url: "https://www.youtube.com/watch?v=SKZAiWSquA0", source: "youtube" },
    { title: "Afreen Afreen", artist: "Rahat Fateh Ali Khan & Momina", duration: "06:45", artworkUrl: "covers/sufi_mystics.jpg", query: "Afreen Afreen Rahat Fateh Ali Khan" },
    { title: "Kun Faya Kun", artist: "A.R. Rahman, Javed Ali & Mohit Chauhan", duration: "07:53", artworkUrl: "covers/sufi_mystics.jpg", query: "Kun Faya Kun Rockstar A.R. Rahman" },
    { title: "Khwaja Mere Khwaja", artist: "A.R. Rahman", duration: "06:56", artworkUrl: "covers/sufi_mystics.jpg", query: "Khwaja Mere Khwaja Jodhaa Akbar" },
    { title: "Chap Tilak Sab Cheen Li", artist: "Rahat Fateh Ali Khan", duration: "06:12", artworkUrl: "covers/sufi_mystics.jpg", query: "Chhaap Tilak Sab Cheen Li Rahat Fateh Ali Khan" },
    { title: "Bhar Do Jholi Meri", artist: "Adnan Sami", duration: "08:19", artworkUrl: "covers/sufi_mystics.jpg", query: "Bhar Do Jholi Meri Adnan Sami" },
    { title: "Mast Nazron Se Allah Bachaye", artist: "Nusrat Fateh Ali Khan", duration: "07:22", artworkUrl: "covers/sufi_mystics.jpg", query: "Mast Nazron Se Allah Bachaye Nusrat" }
  ],
  punjabi: [
    { title: "Tauba Tauba", artist: "Karan Aujla & Badshah", duration: "03:26", artworkUrl: "covers/top50_india.jpg", query: "Tauba Tauba Karan Aujla Badshah" },
    { title: "Winning Speech", artist: "Karan Aujla & Mxrci", duration: "03:42", artworkUrl: "covers/punjabi_101.jpg", query: "Winning Speech Karan Aujla" },
    { title: "Softly", artist: "Karan Aujla & Ikky", duration: "02:35", artworkUrl: "covers/punjabi_101.jpg", query: "Softly Karan Aujla" },
    { title: "GOAT", artist: "Diljit Dosanjh", duration: "03:43", artworkUrl: "covers/punjabi_101.jpg", query: "GOAT Diljit Dosanjh" },
    { title: "Lover", artist: "Diljit Dosanjh", duration: "03:05", artworkUrl: "covers/punjabi_101.jpg", query: "Lover Diljit Dosanjh" },
    { title: "Cheques", artist: "Shubh", duration: "03:03", artworkUrl: "covers/punjabi_101.jpg", query: "Cheques Shubh" },
    { title: "Elevated", artist: "Shubh", duration: "03:20", artworkUrl: "covers/punjabi_101.jpg", query: "Elevated Shubh" },
    { title: "Brown Munde", artist: "AP Dhillon & Gurinder Gill", duration: "04:27", artworkUrl: "covers/punjabi_101.jpg", query: "Brown Munde AP Dhillon" },
    { title: "295", artist: "Sidhu Moose Wala", duration: "04:30", artworkUrl: "covers/punjabi_101.jpg", query: "295 Sidhu Moose Wala" }
  ],
  indie: [
    { title: "Baarishein", artist: "Anuv Jain", duration: "03:27", artworkUrl: "covers/top50_india.jpg", query: "Baarishein Anuv Jain" },
    { title: "Husn", artist: "Anuv Jain", duration: "03:38", artworkUrl: "covers/top50_india.jpg", query: "Husn Anuv Jain" },
    { title: "Alag Aasmaan", artist: "Anuv Jain", duration: "03:52", artworkUrl: "covers/top50_india.jpg", query: "Alag Aasmaan Anuv Jain" },
    { title: "Cold/Mess", artist: "Prateek Kuhad", duration: "04:45", artworkUrl: "covers/bollywood_butter.jpg", query: "Cold Mess Prateek Kuhad" },
    { title: "Kasoor", artist: "Prateek Kuhad", duration: "03:16", artworkUrl: "covers/bollywood_butter.jpg", query: "Kasoor Prateek Kuhad" },
    { title: "Mishri", artist: "Anuv Jain", duration: "03:18", artworkUrl: "covers/top50_india.jpg", query: "Mishri Anuv Jain" }
  ],
  lofi: [
    { title: "Kesariya (Midnight Lofi Chill)", artist: "Lofi Fruits Music & Arijit", duration: "03:15", artworkUrl: "covers/bollywood_butter.jpg", query: "Kesariya lofi chill" },
    { title: "Pasoori (Slowed & Reverb Lofi)", artist: "Ali Sethi & Shae Gill", duration: "04:12", artworkUrl: "covers/sufi_mystics.jpg", query: "Pasoori slowed reverb" },
    { title: "Tu Jaane Na (Late Night Lofi)", artist: "Atif Aslam", duration: "04:30", artworkUrl: "covers/atif_aslam.jpg", query: "Tu Jaane Na lofi remix" },
    { title: "Kabira (Acoustic Rain Lofi)", artist: "Arijit Singh", duration: "03:55", artworkUrl: "covers/arijit_singh.jpg", query: "Kabira lofi acoustic" },
    { title: "Channa Mereya (Lo-Fi Nostalgia)", artist: "Arijit Singh", duration: "04:20", artworkUrl: "covers/arijit_singh.jpg", query: "Channa Mereya lofi chill" }
  ],
  quran: [
    { title: "Surah Ar-Rahman (The Most Merciful)", artist: "Mishary Rashid Alafasy", duration: "16:40", isSurah: 55, artworkUrl: "logo.png", query: "Surah Ar-Rahman Mishary Alafasy" },
    { title: "Surah Ya-Sin (Heart of Quran)", artist: "Mishary Rashid Alafasy", duration: "18:22", isSurah: 36, artworkUrl: "logo.png", query: "Surah Ya-Sin Mishary Alafasy" },
    { title: "Surah Al-Mulk (The Sovereignty)", artist: "Mishary Rashid Alafasy", duration: "08:15", isSurah: 67, artworkUrl: "logo.png", query: "Surah Al-Mulk Mishary Alafasy" },
    { title: "Surah Al-Waqi'ah (The Inevitable)", artist: "Mishary Rashid Alafasy", duration: "11:05", isSurah: 56, artworkUrl: "logo.png", query: "Surah Al-Waqiah Mishary Alafasy" },
    { title: "Surah Al-Fatihah & Ayat al-Kursi", artist: "Mishary Rashid Alafasy", duration: "04:15", isSurah: 1, artworkUrl: "logo.png", query: "Surah Al-Fatihah Mishary Alafasy" }
  ],
  islamic: [
    { title: "Hasbi Rabbi Jallallah", artist: "Sami Yusuf", duration: "04:15", artworkUrl: "logo.png", query: "Hasbi Rabbi Jallallah Sami Yusuf" },
    { title: "Maula Ya Salli Wa Sallim", artist: "Qari Rizwan", duration: "05:12", artworkUrl: "logo.png", query: "Maula Ya Salli Wa Sallim" },
    { title: "Durood-e-Taj Shareef", artist: "Owais Raza Qadri", duration: "07:45", artworkUrl: "logo.png", query: "Durood e Taj Shareef" },
    { title: "Faaslon Ko Takalluf Hai Humse", artist: "Qari Waheed Zafar", duration: "06:10", artworkUrl: "logo.png", query: "Faaslon Ko Takalluf Qari Waheed Zafar" },
    { title: "Lab Pe Aati Hai Dua", artist: "Sufi Ensemble", duration: "04:30", artworkUrl: "logo.png", query: "Lab Pe Aati Hai Dua" }
  ]
};

/**
 * Classifies track into canonical artist and genre tags
 */
function classifyTrack(track) {
  if (!track) return { artist: "Artist", genres: ["bollywood", "romantic"] };
  const title = (track.title || "").toLowerCase();
  const author = (track.author || track.artist || "").toLowerCase();
  const text = `${title} ${author}`;

  const genres = new Set();

  if (text.includes("quran") || text.includes("surah") || text.includes("ayah") || text.includes("alafasy") || text.includes("tilawat") || text.includes("mishary") || text.includes("sudais")) {
    genres.add("quran");
    genres.add("islamic");
  }
  if (text.includes("nasheed") || text.includes("naat") || text.includes("hamd") || text.includes("sami yusuf") || text.includes("maher zain") || text.includes("hasbi rabbi") || text.includes("bayan") || text.includes("durood")) {
    genres.add("islamic");
  }
  if (text.includes("sufi") || text.includes("qawwali") || text.includes("nusrat") || text.includes("rahat") || text.includes("kun faya kun") || text.includes("tajdar") || text.includes("khwaja") || text.includes("afreen") || text.includes("sabri") || text.includes("abida")) {
    genres.add("sufi");
  }
  if (text.includes("punjabi") || text.includes("karan aujla") || text.includes("diljit") || text.includes("ap dhillon") || text.includes("shubh") || text.includes("sidhu") || text.includes("bhangra") || text.includes("badshah") || text.includes("honey singh") || text.includes("brown munde") || text.includes("tauba")) {
    genres.add("punjabi");
  }
  if (text.includes("anuv jain") || text.includes("prateek kuhad") || text.includes("indie") || text.includes("acoustic") || text.includes("baarishein") || text.includes("cold/mess") || text.includes("kasoor") || text.includes("husn")) {
    genres.add("indie");
  }
  if (text.includes("lofi") || text.includes("lo-fi") || text.includes("slowed") || text.includes("reverb") || text.includes("chill")) {
    genres.add("lofi");
  }
  if (text.includes("arijit") || text.includes("pritam") || text.includes("atif") || text.includes("shreya") || text.includes("jubin") || text.includes("kesariya") || text.includes("tum hi ho") || text.includes("chaleya") || text.includes("bollywood") || text.includes("love") || text.includes("romantic") || text.includes("dil") || text.includes("tere")) {
    genres.add("bollywood");
    genres.add("romantic");
  }

  if (genres.size === 0) {
    genres.add("bollywood");
    genres.add("romantic");
  }

  let primaryArtist = track.author || track.artist || "Artist";
  if (primaryArtist.includes("&")) primaryArtist = primaryArtist.split("&")[0].trim();
  if (primaryArtist.includes(",")) primaryArtist = primaryArtist.split(",")[0].trim();
  if (primaryArtist.includes("feat")) primaryArtist = primaryArtist.split("feat")[0].trim();
  if (primaryArtist.includes("(")) primaryArtist = primaryArtist.split("(")[0].trim();

  return {
    artist: primaryArtist.trim() || "Artist",
    genres: Array.from(genres)
  };
}

/**
 * Returns top keys sorted by score descending
 */
function getTopAffinities(obj, limit = 3) {
  if (!obj || typeof obj !== "object") return [];
  return Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(entry => ({ key: entry[0], count: entry[1] }));
}

/**
 * Deterministic day seed for daily rotation
 */
function getDaySeed(dateStr) {
  const d = dateStr || new Date().toISOString().split("T")[0];
  let hash = 0;
  for (let i = 0; i < d.length; i++) {
    hash = (hash << 5) - hash + d.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * Records an individual listening or preference taste event
 */
function recordTasteEvent(userId, event) {
  if (!event || !event.track) return null;
  const user = (userId && users[userId]) ? users[userId] : (users["local_guest_default"] || getOrCreateUser({
    id: "local_guest_default",
    username: "Guest Listener",
    displayName: "Guest Listener",
    type: "local"
  }));
  if (!user.tasteProfile) {
    user.tasteProfile = {
      listenedTracks: [],
      artistAffinity: {},
      genreAffinity: {},
      preferredGenres: ["bollywood", "romantic"],
      lastUpdatedDate: "",
      dailyMixes: [],
      historyCount: 0
    };
  }

  const { artist, genres } = classifyTrack(event.track);
  const weight = event.type === "like" ? 4 : (event.type === "queue" ? 2 : 1);

  if (artist && artist !== "Artist" && artist !== "Unknown") {
    user.tasteProfile.artistAffinity[artist] = (user.tasteProfile.artistAffinity[artist] || 0) + weight;
  }

  genres.forEach(g => {
    user.tasteProfile.genreAffinity[g] = (user.tasteProfile.genreAffinity[g] || 0) + weight;
  });

  if (!Array.isArray(user.tasteProfile.listenedTracks)) user.tasteProfile.listenedTracks = [];
  user.tasteProfile.listenedTracks.unshift({
    title: event.track.title || "Track",
    artist: artist,
    genres: genres,
    duration: Number(event.track.duration) || 0,
    artworkUrl: event.track.artworkUrl || "logo.png",
    type: event.type || "play",
    timestamp: Date.now()
  });

  if (user.tasteProfile.listenedTracks.length > 100) {
    user.tasteProfile.listenedTracks = user.tasteProfile.listenedTracks.slice(0, 100);
  }

  user.tasteProfile.historyCount = (user.tasteProfile.historyCount || 0) + 1;
  user.lastActive = Date.now();
  saveUsers();

  return {
    success: true,
    historyCount: user.tasteProfile.historyCount,
    topGenres: getTopAffinities(user.tasteProfile.genreAffinity, 3),
    topArtists: getTopAffinities(user.tasteProfile.artistAffinity, 3)
  };
}

/**
 * Retrieves user's complete taste profile pattern
 */
function getUserTasteProfile(userId) {
  const user = (userId && users[userId]) ? users[userId] : (users["local_guest_default"] || getOrCreateUser({
    id: "local_guest_default",
    username: "Guest Listener",
    displayName: "Guest Listener",
    type: "local"
  }));
  const profile = user.tasteProfile || {
    listenedTracks: [],
    artistAffinity: {},
    genreAffinity: {},
    preferredGenres: ["bollywood", "romantic"],
    lastUpdatedDate: "",
    dailyMixes: [],
    historyCount: 0
  };

  const topArtists = getTopAffinities(profile.artistAffinity, 5);
  const topGenres = getTopAffinities(profile.genreAffinity, 5);

  return {
    userId: user.id,
    displayName: user.displayName || user.username,
    avatar: user.avatar,
    type: user.type,
    historyCount: profile.historyCount || profile.listenedTracks?.length || 0,
    topArtists,
    topGenres,
    preferredGenres: profile.preferredGenres || ["bollywood", "romantic"],
    lastUpdatedDate: profile.lastUpdatedDate,
    recentTracks: (profile.listenedTracks || []).slice(0, 10)
  };
}

/**
 * Generates personalized daily mixes and homepage shelves that refresh EVERY DAY
 */
function generateDailyRecommendations(user, forceRefresh = false) {
  if (!user) return null;
  const todayDate = new Date().toISOString().split("T")[0];

  if (!user.tasteProfile) {
    user.tasteProfile = {
      listenedTracks: [],
      artistAffinity: {},
      genreAffinity: {},
      preferredGenres: ["bollywood", "romantic"],
      lastUpdatedDate: "",
      dailyMixes: [],
      historyCount: 0
    };
  }

  const profile = user.tasteProfile;
  if (!forceRefresh && profile.lastUpdatedDate === todayDate && Array.isArray(profile.dailyMixes) && profile.dailyMixes.length > 0) {
    return profile.dailyMixesPackage;
  }

  const topGenresList = getTopAffinities(profile.genreAffinity, 4).map(e => e.key);
  const preferred = profile.preferredGenres || ["bollywood", "romantic"];
  const primaryGenre = topGenresList[0] || preferred[0] || "bollywood";
  const secondaryGenre = topGenresList[1] || preferred[1] || (primaryGenre === "sufi" ? "bollywood" : "sufi");
  const topArtistsList = getTopAffinities(profile.artistAffinity, 3).map(e => e.key);
  const topArtistName = topArtistsList[0] || (primaryGenre === "sufi" ? "Atif Aslam" : "Arijit Singh");

  const seed = getDaySeed(todayDate) + (user.id ? getDaySeed(user.id) : 42);

  // Helper to rotate tracks deterministically per day
  const pickTracksForDay = (genreKey, count = 8, offsetMultiplier = 1) => {
    const list = MASTER_GENRE_CATALOG[genreKey] || MASTER_GENRE_CATALOG.bollywood;
    const startIdx = (seed * offsetMultiplier) % list.length;
    const result = [];
    for (let i = 0; i < count; i++) {
      result.push(list[(startIdx + i) % list.length]);
    }
    return result;
  };

  const genreNames = {
    bollywood: "Bollywood Melodies",
    romantic: "Heartfelt Romance",
    sufi: "Soulful Sufi & Mystics",
    punjabi: "Punjabi Bangers",
    indie: "Desi Acoustic & Indie",
    lofi: "Midnight Lofi Chill",
    quran: "Quran Tilawat",
    islamic: "Islamic Vibes"
  };

  const genreGradients = {
    bollywood: "linear-gradient(145deg, #2D1A36 0%, #150C1B 100%)",
    romantic: "linear-gradient(145deg, #331A26 0%, #170C12 100%)",
    sufi: "linear-gradient(145deg, #1C2638 0%, #0E141E 100%)",
    punjabi: "linear-gradient(145deg, #332717 0%, #17110A 100%)",
    indie: "linear-gradient(145deg, #1A312B 0%, #0D1916 100%)",
    lofi: "linear-gradient(145deg, #252238 0%, #12101E 100%)",
    quran: "linear-gradient(145deg, #1A2E26 0%, #0D1713 100%)",
    islamic: "linear-gradient(145deg, #1D2A33 0%, #0E151A 100%)"
  };

  // 1. Daily Mix 1: Primary Genre
  const dailyMix1Tracks = pickTracksForDay(primaryGenre, 8, 1);
  const mix1Cover = dailyMix1Tracks[0]?.artworkUrl || "covers/bollywood_butter.jpg";
  const dailyMix1 = {
    id: `daily-mix-1-${todayDate}`,
    name: `Daily Mix 1 • ${genreNames[primaryGenre] || "Top Taste"}`,
    desc: `Curated today for ${user.displayName || user.username} • Featuring ${topArtistName} and more`,
    badge: "Updated Today",
    genre: primaryGenre,
    gradient: genreGradients[primaryGenre] || "linear-gradient(145deg, #2D1A36 0%, #150C1B 100%)",
    coverUrl: mix1Cover,
    tracksCount: dailyMix1Tracks.length,
    tracks: dailyMix1Tracks
  };

  // 2. Daily Mix 2: Secondary Genre
  const dailyMix2Tracks = pickTracksForDay(secondaryGenre, 8, 3);
  const mix2Cover = dailyMix2Tracks[0]?.artworkUrl || "covers/sufi_mystics.jpg";
  const dailyMix2 = {
    id: `daily-mix-2-${todayDate}`,
    name: `Daily Mix 2 • ${genreNames[secondaryGenre] || "Deep Vibes"}`,
    desc: `Curated today for ${user.displayName || user.username} • ${genreNames[secondaryGenre]} favorites`,
    badge: "Updated Today",
    genre: secondaryGenre,
    gradient: genreGradients[secondaryGenre] || "linear-gradient(145deg, #1C2638 0%, #0E141E 100%)",
    coverUrl: mix2Cover,
    tracksCount: dailyMix2Tracks.length,
    tracks: dailyMix2Tracks
  };

  // 3. Daily Discovery: Fresh Discovery Rotation
  const discoveryGenre = preferred.find(g => g !== primaryGenre && g !== secondaryGenre) || "indie";
  const discoveryTracks = pickTracksForDay(discoveryGenre, 8, 7);
  const dailyDiscovery = {
    id: `daily-discovery-${todayDate}`,
    name: "Daily Discovery • Fresh Picks",
    desc: `Fresh acoustic & discovery gems matching your mood for ${new Date().toLocaleDateString([], { month: "short", day: "numeric" })}`,
    badge: "Daily Discovery",
    genre: discoveryGenre,
    gradient: "linear-gradient(145deg, #1C332B 0%, #0C1A15 100%)",
    coverUrl: discoveryTracks[0]?.artworkUrl || "covers/top50_india.jpg",
    tracksCount: discoveryTracks.length,
    tracks: discoveryTracks
  };

  // 4. Repeat Rewind (User's Favorites & Most Played)
  const userFavs = user.favorites || [];
  const repeatTracks = userFavs.length > 0 ? userFavs.slice(0, 8) : pickTracksForDay("romantic", 8, 5);
  const repeatRewind = {
    id: `repeat-rewind-${todayDate}`,
    name: "Repeat Rewind • On Repeat",
    desc: "Your most replayed classics and personal favorites kept on deck",
    badge: "On Repeat",
    genre: "favorites",
    gradient: "linear-gradient(145deg, #332029 0%, #170E13 100%)",
    coverUrl: repeatTracks[0]?.artworkUrl || "logo.png",
    tracksCount: repeatTracks.length,
    tracks: repeatTracks
  };

  const dailyMixes = [dailyMix1, dailyMix2, dailyDiscovery, repeatRewind];

  // 5. 8 Personalized Hero 2x4 Quick Access Tiles
  const quickTiles = [
    { id: dailyMix1.id, name: dailyMix1.name.split("•")[1]?.trim() || "Daily Mix 1", coverUrl: dailyMix1.coverUrl, gradient: dailyMix1.gradient, playlistObj: dailyMix1 },
    { id: dailyMix2.id, name: dailyMix2.name.split("•")[1]?.trim() || "Daily Mix 2", coverUrl: dailyMix2.coverUrl, gradient: dailyMix2.gradient, playlistObj: dailyMix2 },
    { id: "liked-songs-quick", name: "Liked Songs", coverUrl: "covers/bollywood_butter.jpg", isLiked: true, gradient: "linear-gradient(135deg, #450af5, #c4efd9)" },
    { id: "top-artist-quick", name: `${topArtistName} Essentials`, coverUrl: mix1Cover, query: `${topArtistName} greatest hits`, gradient: dailyMix1.gradient },
    { id: dailyDiscovery.id, name: "Daily Discovery", coverUrl: dailyDiscovery.coverUrl, gradient: dailyDiscovery.gradient, playlistObj: dailyDiscovery },
    { id: "surah-rahman-quick", name: "Surah Ar-Rahman", desc: "Mishary Alafasy", isSurah: 55, gradient: "linear-gradient(145deg, #1A2E26 0%, #0D1713 100%)", coverUrl: "logo.png" },
    { id: "top50-india-quick", name: "Top 50 India", coverUrl: "covers/top50_india.jpg", playlistId: "top50-india" },
    { id: "repeat-rewind-quick", name: "Repeat Rewind", coverUrl: repeatRewind.coverUrl, gradient: repeatRewind.gradient, playlistObj: repeatRewind }
  ];

  // 6. "Because You Listen To [Top Artist / Genre]" Shelf
  const becauseYouLove = {
    title: `Because You Love ${topArtistName}`,
    subtitle: `Recommendations based on your repeated listening to ${topArtistName} & ${genreNames[primaryGenre] || "Hindi Hits"}`,
    tracks: pickTracksForDay(primaryGenre, 8, 2)
  };

  const packageResult = {
    todayDate,
    daySeed: seed,
    userDisplayName: user.displayName || user.username,
    topGenre: primaryGenre,
    topGenreName: genreNames[primaryGenre] || "Bollywood",
    topArtist: topArtistName,
    dailyMixes,
    quickTiles,
    becauseYouLove
  };

  profile.lastUpdatedDate = todayDate;
  profile.dailyMixes = dailyMixes;
  profile.dailyMixesPackage = packageResult;
  saveUsers();

  return packageResult;
}

/**
 * Gets daily recommendations for given user (or default guest fallback)
 */
function getDailyRecommendations(userId, forceRefresh = false) {
  let user = null;
  if (userId && users[userId]) {
    user = users[userId];
  } else {
    // Return or create a default guest profile
    user = users["local_guest_default"] || getOrCreateUser({
      id: "local_guest_default",
      username: "Guest Listener",
      displayName: "Guest Listener",
      type: "local"
    });
  }
  return generateDailyRecommendations(user, forceRefresh);
}

/**
 * Registers a new customer with individual email, password, and taste preferences
 */
function registerCustomer({ email, password, username, displayName, avatar, preferredGenres }) {
  const cleanEmail = (email || "").trim().toLowerCase();
  const cleanUser = (username || "").trim();

  // Validate Email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!cleanEmail || !emailRegex.test(cleanEmail)) {
    return { success: false, error: "Please enter a valid email address (e.g. you@example.com)" };
  }

  // Validate Password (min 6 chars)
  if (!password || password.trim().length < 6) {
    return { success: false, error: "Password must be at least 6 characters long" };
  }

  // Check if an existing account already uses this email
  const existingByEmail = Object.values(users).find(u => u.email && u.email.toLowerCase() === cleanEmail);
  if (existingByEmail) {
    if (existingByEmail.passwordHash) {
      const testHash = hashPassword(password.trim(), existingByEmail.passwordSalt);
      if (testHash === existingByEmail.passwordHash) {
        const token = createSession(existingByEmail);
        return { success: true, token, user: existingByEmail, message: "Welcome back! Logged in with existing account." };
      }
    }
    return { success: false, error: "An account with this email already exists. Please sign in with your password." };
  }

  const userId = `customer_${cleanEmail.replace(/[^a-z0-9]/g, "_")}`;
  const derivedUsername = cleanUser || cleanEmail.split("@")[0].replace(/[^a-z0-9_]/g, "_");
  const friendlyName = displayName && displayName.trim() ? displayName.trim() : derivedUsername;

  const passwordSalt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashPassword(password.trim(), passwordSalt);

  const initialGenres = (preferredGenres && preferredGenres.length > 0)
    ? preferredGenres
    : ["bollywood", "romantic"];

  const userObj = {
    id: userId,
    email: cleanEmail,
    username: derivedUsername,
    displayName: friendlyName,
    avatar: avatar || "🎧",
    type: "customer",
    passwordHash,
    passwordSalt,
    discordId: null,
    isServerMember: false,
    roles: [],
    favorites: [],
    queue: [],
    tasteProfile: {
      listenedTracks: [],
      artistAffinity: {},
      genreAffinity: {},
      preferredGenres: initialGenres,
      lastUpdatedDate: "",
      dailyMixes: [],
      historyCount: 0
    },
    createdAt: Date.now(),
    lastActive: Date.now()
  };

  initialGenres.forEach(g => {
    userObj.tasteProfile.genreAffinity[g] = 5;
  });

  users[userId] = userObj;
  saveUsers();

  generateDailyRecommendations(userObj, true);

  const token = createSession(userObj);
  return {
    success: true,
    token,
    user: userObj
  };
}

/**
 * Customer login with email & password (or username fallback)
 */
function loginCustomer({ email, username, password }) {
  const identifier = (email || username || "").trim().toLowerCase();
  if (!identifier) {
    return { success: false, error: "Please enter your email address and password" };
  }
  if (!password || !password.trim()) {
    return { success: false, error: "Please enter your password" };
  }

  let matchedUser = Object.values(users).find(u => 
    (u.email && u.email.toLowerCase() === identifier) ||
    (u.username && u.username.toLowerCase() === identifier) ||
    u.id.toLowerCase() === identifier ||
    u.id.toLowerCase() === `customer_${identifier}` ||
    u.id.toLowerCase() === `customer_${identifier.replace(/[^a-z0-9]/g, "_")}` ||
    u.id.toLowerCase() === `local_${identifier}`
  );

  if (!matchedUser) {
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
    if (isEmail) {
      return { success: false, error: "No account found for this email. Click 'Create Account' to register." };
    }
    return { success: false, error: "Account not found. Please check your email or create a new account." };
  }

  if (matchedUser.passwordHash) {
    const testHash = hashPassword(password.trim(), matchedUser.passwordSalt);
    if (testHash !== matchedUser.passwordHash) {
      return { success: false, error: "Incorrect password. Please verify and try again." };
    }
  }

  matchedUser.lastActive = Date.now();
  if (!matchedUser.tasteProfile) {
    matchedUser.tasteProfile = {
      listenedTracks: [],
      artistAffinity: {},
      genreAffinity: {},
      preferredGenres: ["bollywood", "romantic"],
      lastUpdatedDate: "",
      dailyMixes: [],
      historyCount: 0
    };
  }

  generateDailyRecommendations(matchedUser, false);
  saveUsers();

  const token = createSession(matchedUser);
  return {
    success: true,
    token,
    user: matchedUser
  };
}

/**
 * Initiates password recovery for customer by email
 */
function forgotPasswordCustomer({ email }) {
  const identifier = (email || "").trim().toLowerCase();
  if (!identifier) {
    return { success: false, error: "Please enter your email address." };
  }

  const matchedUser = Object.values(users).find(u =>
    (u.email && u.email.toLowerCase() === identifier) ||
    (u.username && u.username.toLowerCase() === identifier)
  );

  if (!matchedUser) {
    return { 
      success: false, 
      error: "No active account found registered with that email address." 
    };
  }

  const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
  matchedUser.resetCode = resetCode;
  matchedUser.resetCodeExpires = Date.now() + 15 * 60 * 1000;
  saveUsers();

  return {
    success: true,
    message: "A 6-digit security recovery code has been generated.",
    code: resetCode,
    email: matchedUser.email || identifier
  };
}

/**
 * Resets user password using recovery code
 */
function resetPasswordCustomer({ email, code, newPassword }) {
  const identifier = (email || "").trim().toLowerCase();
  const resetCode = (code || "").trim();
  const pwd = (newPassword || "").trim();

  if (!identifier) return { success: false, error: "Email address is required." };
  if (!resetCode) return { success: false, error: "Please enter the 6-digit verification code." };
  if (!pwd || pwd.length < 8) return { success: false, error: "New password must be at least 8 characters long." };

  const matchedUser = Object.values(users).find(u =>
    (u.email && u.email.toLowerCase() === identifier) ||
    (u.username && u.username.toLowerCase() === identifier)
  );

  if (!matchedUser) {
    return { success: false, error: "Account not found." };
  }

  if (!matchedUser.resetCode || matchedUser.resetCode !== resetCode) {
    return { success: false, error: "Invalid verification code. Please check and try again." };
  }

  if (Date.now() > (matchedUser.resetCodeExpires || 0)) {
    return { success: false, error: "Verification code has expired. Please request a new one." };
  }

  const salt = crypto.randomBytes(16).toString("hex");
  matchedUser.passwordSalt = salt;
  matchedUser.passwordHash = hashPassword(pwd, salt);
  delete matchedUser.resetCode;
  delete matchedUser.resetCodeExpires;
  saveUsers();

  return {
    success: true,
    message: "Password reset successful! You may now sign in with your new credentials."
  };
}

/**
 * Handles social OAuth sign-in / registration (Google, Apple)
 */
function oauthLoginCustomer({ provider, email, name, avatar, providerId }) {
  const prov = (provider || "google").toLowerCase();
  const userEmail = (email || "").trim().toLowerCase();
  if (!userEmail) {
    return { success: false, error: "Valid email is required from social provider." };
  }

  let matchedUser = Object.values(users).find(u =>
    (u.email && u.email.toLowerCase() === userEmail) ||
    (u.oauthProvider === prov && u.oauthId === providerId)
  );

  if (!matchedUser) {
    const userId = `customer_${userEmail.replace(/[^a-z0-9]/g, "_")}`;
    matchedUser = {
      id: userId,
      email: userEmail,
      username: userEmail.split("@")[0],
      displayName: name || (userEmail.split("@")[0].charAt(0).toUpperCase() + userEmail.split("@")[0].slice(1)),
      avatar: avatar || (prov === "apple" ? "🍎" : "🎧"),
      type: "customer",
      oauthProvider: prov,
      oauthId: providerId || Date.now().toString(),
      isServerMember: false,
      createdAt: Date.now(),
      lastActive: Date.now(),
      tasteProfile: {
        listenedTracks: [],
        artistAffinity: {},
        genreAffinity: {},
        preferredGenres: ["cyberpunk", "electronic", "lofi"],
        lastUpdatedDate: "",
        dailyMixes: [],
        historyCount: 0
      }
    };
    users[userId] = matchedUser;
  } else {
    matchedUser.lastActive = Date.now();
    if (name && !matchedUser.displayName) matchedUser.displayName = name;
    if (avatar && (!matchedUser.avatar || matchedUser.avatar === "logo.png")) matchedUser.avatar = avatar;
  }

  generateDailyRecommendations(matchedUser, false);
  saveUsers();

  const token = createSession(matchedUser);
  return {
    success: true,
    token,
    user: matchedUser
  };
}

/**
 * Calibrates customer taste preferences directly
 */
function calibrateUserTaste(userId, { preferredGenres, favoriteArtists }) {
  const user = (userId && users[userId]) ? users[userId] : (users["local_guest_default"] || getOrCreateUser({
    id: "local_guest_default",
    username: "Guest Listener",
    displayName: "Guest Listener",
    type: "local"
  }));
  if (!user.tasteProfile) {
    user.tasteProfile = {
      listenedTracks: [],
      artistAffinity: {},
      genreAffinity: {},
      preferredGenres: [],
      lastUpdatedDate: "",
      dailyMixes: [],
      historyCount: 0
    };
  }

  if (Array.isArray(preferredGenres) && preferredGenres.length > 0) {
    user.tasteProfile.preferredGenres = preferredGenres;
    preferredGenres.forEach(g => {
      user.tasteProfile.genreAffinity[g] = (user.tasteProfile.genreAffinity[g] || 0) + 6;
    });
  }

  if (Array.isArray(favoriteArtists) && favoriteArtists.length > 0) {
    favoriteArtists.forEach(a => {
      user.tasteProfile.artistAffinity[a] = (user.tasteProfile.artistAffinity[a] || 0) + 6;
    });
  }

  user.lastActive = Date.now();
  const refreshed = generateDailyRecommendations(user, true);
  saveUsers();
  return refreshed;
}

const DISCORD_API_URL = "https://discord.com/api/v10";
let cachedGuildMembers = [];
let lastMemberCacheTime = 0;

/**
 * Fetches all guild members via Discord REST API (bypasses Gateway Intent limits, 0 external dependencies)
 */
async function fetchGuildMembersViaRest(guildId) {
  const now = Date.now();
  if (cachedGuildMembers.length > 0 && (now - lastMemberCacheTime < 300000)) {
    return cachedGuildMembers;
  }

  const token = (process.env.DISCORD_TOKEN || "").trim();
  if (!token) return cachedGuildMembers;

  try {
    const res = await fetch(`${DISCORD_API_URL}/guilds/${guildId}/members?limit=100`, {
      headers: {
        Authorization: `Bot ${token}`,
        "User-Agent": "SpySecMusicBot (1.0.0)"
      }
    });
    if (res.ok) {
      const members = await res.json();
      if (Array.isArray(members) && members.length > 0) {
        cachedGuildMembers = members;
        lastMemberCacheTime = now;
        return cachedGuildMembers;
      }
    } else {
      console.warn("fetchGuildMembersViaRest response error:", res.status, await res.text().catch(() => ""));
    }
  } catch (err) {
    console.warn("fetchGuildMembersViaRest warning:", err.message);
  }
  return cachedGuildMembers;
}

/**
 * Returns a clean list of server members for autocomplete / quick-login chips
 */
async function getServerMembers(guildId) {
  const members = await fetchGuildMembersViaRest(guildId);
  return members.map(m => {
    const u = m.user || {};
    const dName = m.nick || u.global_name || u.username;
    const avatar = u.avatar
      ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png`
      : "logo.png";
    return {
      id: u.id,
      username: u.username,
      displayName: dName,
      avatar,
      isBot: Boolean(u.bot)
    };
  }).filter(m => !m.isBot); // Exclude bots
}

/**
 * Verifies if a user is a member of the Spy Sec Music Discord Guild
 */
async function verifyDiscordServerMember(client, guildId, query) {
  if (!guildId || !query) return { isMember: false, error: "Please enter a Discord User ID or Username" };

  const rawClean = query.trim().replace(/^@/, "");
  const cleanQ = rawClean.toLowerCase();
  const token = (process.env.DISCORD_TOKEN || "").trim();
  const members = await fetchGuildMembersViaRest(guildId);
  let matched = null;

  // 1. Direct Discord ID lookup (17-20 digits)
  if (rawClean.match(/^\d{17,20}$/)) {
    matched = members.find(m => m.user && m.user.id === rawClean);
    if (!matched && token) {
      try {
        const res = await fetch(`${DISCORD_API_URL}/guilds/${guildId}/members/${rawClean}`, {
          headers: { Authorization: `Bot ${token}`, "User-Agent": "SpySecMusicBot (1.0.0)" }
        });
        if (res.ok) {
          matched = await res.json();
        }
      } catch(e) {}
    }
  }

  // 2. Owner or workspace developer aliases
  if (!matched && (cleanQ === "owner" || cleanQ === "admin" || cleanQ === "mdasw" || cleanQ === "developer")) {
    matched = members.find(m => m.user && m.user.id === "1215714832997949481") || members[0];
  }

  // 3. Exact username, nickname, or global name match
  if (!matched) {
    matched = members.find(m => {
      const u = m.user || {};
      return (u.username && u.username.toLowerCase() === cleanQ) ||
             (u.global_name && u.global_name.toLowerCase() === cleanQ) ||
             (m.nick && m.nick.toLowerCase() === cleanQ);
    });
  }

  // 4. Prefix or fuzzy contains match
  if (!matched && cleanQ.length >= 3) {
    matched = members.find(m => {
      const u = m.user || {};
      const uName = (u.username || "").toLowerCase();
      const gName = (u.global_name || "").toLowerCase();
      const nName = (m.nick || "").toLowerCase();
      return uName.startsWith(cleanQ) || gName.startsWith(cleanQ) || nName.startsWith(cleanQ) ||
             uName.includes(cleanQ) || gName.includes(cleanQ) || nName.includes(cleanQ);
    });
  }

  // 5. Discord Guild Member Search REST API (finds user on guild even if outside cache)
  if (!matched && token && cleanQ.length >= 2) {
    try {
      const sRes = await fetch(`${DISCORD_API_URL}/guilds/${guildId}/members/search?query=${encodeURIComponent(rawClean)}&limit=5`, {
        headers: { Authorization: `Bot ${token}`, "User-Agent": "SpySecMusicBot (1.0.0)" }
      });
      if (sRes.ok) {
        const results = await sRes.json();
        if (Array.isArray(results) && results.length > 0) {
          matched = results[0];
        }
      }
    } catch(e) {}
  }

  if (matched && matched.user) {
    const u = matched.user;
    const avatar = u.avatar
      ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png`
      : "logo.png";
    const displayName = matched.nick || u.global_name || u.username;

    const userObj = getOrCreateUser({
      id: `discord_${u.id}`,
      username: u.username,
      displayName: displayName,
      avatar,
      type: "discord",
      discordId: u.id,
      isServerMember: true,
      roles: matched.roles || []
    });

    const sessionToken = createSession(userObj);
    return {
      isMember: true,
      user: userObj,
      token: sessionToken
    };
  }

  // 6. Persistent Known Members Fallback (Guaranteed verification for known members like cyber_spy.404)
  const knownMember = Object.values(users).find(u => {
    if (!u || u.type !== "discord") return false;
    const uName = (u.username || "").toLowerCase();
    const dName = (u.displayName || "").toLowerCase();
    const dId = String(u.discordId || u.id || "");
    return dId === rawClean || dId === `discord_${rawClean}` || uName === cleanQ || dName === cleanQ || (cleanQ.length >= 3 && uName.includes(cleanQ));
  });

  if (knownMember) {
    const sessionToken = createSession(knownMember);
    return {
      isMember: true,
      user: knownMember,
      token: sessionToken
    };
  }

  return {
    isMember: false,
    error: `User "${rawClean}" was not found in the Discord server members list.`
  };
}

module.exports = {
  getOrCreateUser,
  createSession,
  getUserByToken,
  removeSession,
  toggleFavorite,
  getFavorites,
  saveQueue,
  getQueue,
  verifyDiscordServerMember,
  getServerMembers,
  classifyTrack,
  recordTasteEvent,
  getUserTasteProfile,
  generateDailyRecommendations,
  getDailyRecommendations,
  registerCustomer,
  loginCustomer,
  forgotPasswordCustomer,
  resetPasswordCustomer,
  oauthLoginCustomer,
  calibrateUserTaste,
  hashPassword,
  rehydrateUser,
  initMongo,
  MASTER_GENRE_CATALOG
};

