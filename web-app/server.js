const http = require("http");
const https = require("https");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const userStore = require("./userStore");
const spotifyTrending = require("./spotifyTrending");
const {
  checkBlocked,
  isIslamicText,
  isIslamicTrack,
  isIslamicQuery,
  sanitizeSearchQuery,
  validateByFilterMode
} = require("./islamicFilter");

let desModule = null;
try {
  desModule = require("des.js");
} catch (e) {
  console.warn("des.js optional note:", e.message);
}

function decryptSaavnMediaUrl(encUrl) {
  if (!encUrl || typeof encUrl !== "string") return null;
  // 1. Pure-JS DES ECB Decryption (Works everywhere without OpenSSL flags)
  if (desModule) {
    try {
      const key = Buffer.from("38346591", "utf8");
      const d = desModule.DES.create({ type: "decrypt", key });
      const b = Buffer.from(encUrl, "base64");
      const out1 = Buffer.from(d.update(b));
      const out2 = Buffer.from(d.final());
      const raw = Buffer.concat([out1, out2]).toString("utf8");
      if (raw.startsWith("http")) {
        return raw.replace(/_96\.mp4|_160\.mp4/, "_320.mp4");
      }
    } catch (e) {}
  }
  // 2. Fallback to Node crypto
  try {
    const crypto = require("crypto");
    const key = Buffer.from("38346591", "utf8");
    const decipher = crypto.createDecipheriv("des-ecb", key, "");
    decipher.setAutoPadding(true);
    let decrypted = decipher.update(encUrl, "base64", "utf8");
    decrypted += decipher.final("utf8");
    if (decrypted.startsWith("http")) {
      return decrypted.replace(/_96\.mp4|_160\.mp4/, "_320.mp4");
    }
  } catch (e) {}
  return null;
}

let spotifyUrlInfo = null;
try {
  spotifyUrlInfo = require("spotify-url-info")(fetch);
} catch (e) {
  console.warn("spotify-url-info optional module note:", e.message);
}

// Initialize trending data
spotifyTrending.initSpotifyTrending();

// Port configuration (Defaults to 3050)
const PORT = parseInt(process.env.PORT || "3050", 10);
const PUBLIC_DIR = path.join(__dirname, "public");

// ==========================================================================
// ULTRA-LOW LATENCY KEEP-ALIVE SOCKET POOL
// ==========================================================================
// Eliminates 200-400ms TLS handshake lag on streaming audio chunk requests
const httpsKeepAliveAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 64,
  maxFreeSockets: 16,
  timeout: 60000,
  freeSocketTimeout: 30000
});

const httpKeepAliveAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 64,
  maxFreeSockets: 16,
  timeout: 60000,
  freeSocketTimeout: 30000
});

// ==========================================================================
// SYSTEM CHANNEL PLAYBACK STATE (Browser & Mobile App)
// ==========================================================================
const systemChannels = {
  browser: {
    id: "browser",
    name: "Web Browser",
    icon: "🌐",
    badge: "Direct WebAudio Engine (Ultra-Low Latency)",
    volume: 100,
    isPlaying: false,
    isPaused: false,
    position: 0,
    duration: 0,
    current: null,
    queue: [],
    history: []
  },
  app: {
    id: "app",
    name: "Mobile App",
    icon: "📱",
    badge: "Capacitor Native Engine (Unthrottled)",
    volume: 100,
    isPlaying: false,
    isPaused: false,
    position: 0,
    duration: 0,
    current: null,
    queue: [],
    history: []
  },
  bot: {
    id: "bot",
    name: "Discord Bot Voice",
    icon: "🤖",
    badge: "Discord Voice Channel",
    volume: 100,
    isPlaying: false,
    isPaused: false,
    position: 0,
    duration: 0,
    current: null,
    queue: [],
    history: []
  }
};

// ==========================================================================
// IN-MEMORY CACHES (Sub-Millisecond 0ms Cache Hits)
// ==========================================================================
const searchCache = new Map();
const searchPlaylistCache = new Map();
const playlistTracksCache = new Map();
const directStreamCache = new Map();

// ==========================================================================
// SURAH DIRECT HIGH-FIDELITY AUDIO MAP
// ==========================================================================
const SURAH_NAMES = {
  1: "Al-Fatihah", 2: "Al-Baqarah", 3: "Ali 'Imran", 4: "An-Nisa", 5: "Al-Ma'idah",
  6: "Al-An'am", 7: "Al-A'raf", 8: "Al-Anfal", 9: "At-Tawbah", 10: "Yunus",
  18: "Al-Kahf", 36: "Ya-Sin", 55: "Ar-Rahman", 56: "Al-Waqi'ah", 67: "Al-Mulk",
  112: "Al-Ikhlas", 113: "Al-Falaq", 114: "An-Nas"
};

// ==========================================================================
// RESILIENT YT-DLP RUNNER (Windows, Linux, Docker, Render)
// ==========================================================================
function executeYtDlp(args, options, callback) {
  const localBinary = path.join(__dirname, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
  if (fs.existsSync(localBinary)) {
    return execFile(localBinary, args, options, callback);
  }

  const pythonCmd = process.env.PYTHON_PATH || (process.platform === "win32" ? "python" : "python3");
  execFile(pythonCmd, ["-m", "yt_dlp", ...args], options, (err, stdout, stderr) => {
    if (err && (err.code === "ENOENT" || err.message?.includes("ENOENT"))) {
      return execFile("yt-dlp", args, options, (err2, stdout2, stderr2) => {
        if (err2 && process.platform !== "win32") {
          return execFile("python", ["-m", "yt_dlp", ...args], options, callback);
        }
        callback(err2, stdout2, stderr2);
      });
    }
    callback(err, stdout, stderr);
  });
}

// ==========================================================================
// MULTI-SOURCE SEARCH & RESILIENT AUDIO ENGINE (JIOSAAVN + LAVALINK + YT-DLP)
// ==========================================================================

// Fast JioSaavn Search (Instant ~150ms response, zero datacenter IP bans, 320kbps audio)
async function searchJioSaavn(query, limit = 10) {
  try {
    const url = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&api_version=4&ctx=web6dot0&n=${limit}&p=1&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    const results = data.results || [];
    return results
      .filter(r => r && r.title)
      .map(r => {
        const encUrl = r.more_info?.encrypted_media_url;
        const streamUrl = encUrl ? decryptSaavnMediaUrl(encUrl) : null;
        const artwork = (r.image || "").replace("150x150", "500x500");
        const cleanTitle = (r.title || "")
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&')
          .replace(/&#039;/g, "'")
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>');
        const artistNames = r.more_info?.artistMap?.primary_artists?.map(a => a.name).join(", ") || r.subtitle || "Music Artist";
        return {
          id: `saavn_${r.id}`,
          title: cleanTitle,
          author: artistNames,
          duration: Math.round(parseFloat(r.more_info?.duration || 0) * 1000),
          artworkUrl: artwork || "logo.png",
          url: r.perma_url || `https://www.jiosaavn.com/song/${r.id}`,
          streamUrl: streamUrl,
          rawStreamUrl: streamUrl,
          source: "jiosaavn"
        };
      });
  } catch (err) {
    return [];
  }
}

// Fast Lavalink Search
async function searchLavalinkTracks(query, limit = 15) {
  try {
    const lavalinkUrl = process.env.LAVALINK_URL || "http://lavalink.jirayu.net:13592";
    const lavalinkAuth = process.env.LAVALINK_AUTH || "youshallnotpass";
    const res = await fetch(`${lavalinkUrl}/v4/loadtracks?identifier=ytsearch:${encodeURIComponent(query)}`, {
      headers: { Authorization: lavalinkAuth },
      signal: AbortSignal.timeout(2800)
    });
    const d = await res.json();
    const tracks = d.data?.length ? d.data : (d.data?.tracks || []);
    if (Array.isArray(tracks) && tracks.length > 0) {
      return tracks
        .filter(t => t && t.info && t.info.title)
        .map(t => ({
          id: t.info.identifier,
          title: t.info.title,
          author: t.info.author || "YouTube Music",
          duration: t.info.length || 0,
          artworkUrl: t.info.artworkUrl || `https://i.ytimg.com/vi/${t.info.identifier}/hqdefault.jpg`,
          url: t.info.uri || `https://www.youtube.com/watch?v=${t.info.identifier}`,
          encoded: t.encoded,
          source: "youtube"
        })).slice(0, limit);
    }
  } catch (lavalinkErr) {}
  return [];
}

// Multi-Source Search (JioSaavn + Lavalink + yt-dlp)
async function searchYouTubeMulti(query, limit = 20) {
  const cacheKey = (query || "").trim().toLowerCase();
  if (searchCache.has(cacheKey)) {
    const cached = searchCache.get(cacheKey);
    if (Date.now() - cached.time < 3600000 && Array.isArray(cached.results) && cached.results.length >= limit) {
      return cached.results.slice(0, limit);
    }
  }

  // Execute JioSaavn and Lavalink in parallel for ultra-low latency (<300ms)
  const [saavnResults, lavalinkResults] = await Promise.all([
    searchJioSaavn(query, Math.min(limit, 12)),
    searchLavalinkTracks(query, Math.min(limit, 15))
  ]);

  let combined = [];
  if (saavnResults.length > 0) {
    combined.push(...saavnResults);
  }
  if (lavalinkResults.length > 0) {
    // Deduplicate against JioSaavn by checking title similarity
    const existingTitles = new Set(combined.map(r => r.title.toLowerCase().replace(/[^a-z0-9]/g, "")));
    for (const t of lavalinkResults) {
      const simplified = t.title.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!existingTitles.has(simplified)) {
        combined.push(t);
      }
    }
  }

  if (combined.length >= 4) {
    searchCache.set(cacheKey, { time: Date.now(), results: combined });
    return combined.slice(0, limit);
  }

  // Fallback to yt-dlp flat playlist search with android client
  const fetchLimit = Math.max(limit + 5, 25);
  return new Promise((resolve) => {
    executeYtDlp(
      ["--flat-playlist", "-J", "--no-warnings", "--extractor-args", "youtube:player_client=android", `ytsearch${fetchLimit}:${query}`],
      { timeout: 12000, maxBuffer: 15 * 1024 * 1024 },
      (err, stdout) => {
        if (!err && stdout) {
          try {
            const data = JSON.parse(stdout);
            const entries = data.entries || [];
            const allValid = entries
              .filter(e => e && e.title && !e.id?.startsWith("UC") && !e.url?.includes("/channel/") && !e.url?.includes("/user/"))
              .map(e => ({
                id: e.id,
                title: e.title,
                author: e.uploader || e.channel || "YouTube Music",
                duration: Math.round((e.duration || 0) * 1000),
                artworkUrl: (e.thumbnails && e.thumbnails.length > 0) ? e.thumbnails[e.thumbnails.length - 1].url : `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`,
                url: (e.url && e.url.startsWith("http")) ? e.url : `https://www.youtube.com/watch?v=${e.id}`,
                source: "youtube"
              }));
            if (allValid.length > 0) {
              combined.push(...allValid);
            }
          } catch (e) {}
        }
        searchCache.set(cacheKey, { time: Date.now(), results: combined });
        resolve(combined.slice(0, limit));
      }
    );
  });
}

// Fast Playlist Search
async function searchPlaylistsMulti(query, limit = 5) {
  const cacheKey = (query || "").trim().toLowerCase();
  if (searchPlaylistCache.has(cacheKey)) {
    const cached = searchPlaylistCache.get(cacheKey);
    if (Date.now() - cached.time < 3600000 && Array.isArray(cached.results) && cached.results.length >= limit) {
      return cached.results.slice(0, limit);
    }
  }

  const fetchLimit = limit + 4;
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAw%3D%3D`;

  return new Promise((resolve) => {
    executeYtDlp(
      ["--flat-playlist", "-J", "--no-warnings", "--playlist-end", String(fetchLimit), "--extractor-args", "youtube:player_client=android", url],
      { timeout: 10000, maxBuffer: 15 * 1024 * 1024 },
      (err, stdout) => {
        if (err || !stdout) return resolve([]);
        try {
          const data = JSON.parse(stdout);
          const entries = data.entries || [];
          const playlists = entries
            .filter(e => e && e.title && !e.id?.startsWith("UC") && (e.url?.includes("list=") || e.id?.startsWith("PL") || e.id?.startsWith("OL") || e.id?.startsWith("RD") || e.id?.startsWith("UU") || e._type === "url"))
            .map(e => ({
              id: e.id,
              title: e.title,
              author: e.channel || e.uploader || "YouTube Playlist",
              trackCount: e.playlist_count || null,
              artworkUrl: (e.thumbnails && e.thumbnails.length > 0) ? e.thumbnails[e.thumbnails.length - 1].url : "logo.png",
              url: (e.url && e.url.startsWith("http")) ? e.url : `https://www.youtube.com/playlist?list=${e.id}`
            }));
          if (playlists.length > 0) {
            searchPlaylistCache.set(cacheKey, { time: Date.now(), results: playlists });
          }
          resolve(playlists.slice(0, limit));
        } catch (e) {
          resolve([]);
        }
      }
    );
  });
}

// ==========================================================================
// RESILIENT MULTI-SOURCE AUDIO STREAM EXTRACTOR
// ==========================================================================
async function extractYouTubeStream(queryOrUrl) {
  const cleanKey = (queryOrUrl || "").trim().toLowerCase();
  if (directStreamCache.has(cleanKey)) {
    const cached = directStreamCache.get(cleanKey);
    if (Date.now() - cached.time < 14400000) { // 4 hour cache
      return cached.data;
    }
  }

  let streamMeta = null;
  let target = (queryOrUrl || "").trim();
  const isUrl = target.startsWith("http://") || target.startsWith("https://");

  // Fast Path 1: Direct CDN / Saavn URLs
  if (isUrl && (target.includes("saavncdn.com") || target.match(/\.(mp3|m4a|mp4|webm|aac|ogg)(\?.*)?$/i))) {
    const data = {
      title: "Audio Stream",
      author: "Direct Audio",
      duration: 0,
      streamUrl: target,
      artworkUrl: "logo.png"
    };
    directStreamCache.set(cleanKey, { time: Date.now(), data });
    return data;
  }

  // Fast Path 2: If query is plain text, check JioSaavn first (~150ms instant CD-quality 320kbps stream!)
  if (!isUrl) {
    try {
      const saavnResults = await searchJioSaavn(target, 3);
      if (saavnResults.length > 0 && saavnResults[0].streamUrl) {
        const top = saavnResults[0];
        const data = {
          title: top.title,
          author: top.author,
          duration: top.duration,
          streamUrl: top.streamUrl,
          artworkUrl: top.artworkUrl
        };
        directStreamCache.set(cleanKey, { time: Date.now(), data });
        return data;
      }
    } catch (e) {}
  }

  // Fast Path 3: Single-step yt-dlp android extraction
  if (!isUrl) {
    const cachedSearch = searchCache.get(cleanKey);
    if (cachedSearch && Array.isArray(cachedSearch.results) && cachedSearch.results.length > 0) {
      streamMeta = cachedSearch.results[0];
      target = streamMeta.url || `https://www.youtube.com/watch?v=${streamMeta.id}`;
    } else {
      target = `ytsearch1:${target}`;
    }
  }

  return new Promise((resolve) => {
    executeYtDlp(
      ["-g", "-f", "ba[ext=webm]/251/ba[ext=m4a]/140/ba/best", "--no-playlist", "--no-warnings", "--extractor-args", "youtube:player_client=android", target],
      { timeout: 12000 },
      async (err, stdout) => {
        if (!err && stdout && stdout.trim()) {
          const directUrl = stdout.trim().split("\n")[0].trim();
          if (directUrl.startsWith("http")) {
            const data = {
              title: streamMeta?.title || "Audio Track",
              author: streamMeta?.author || "Trending Music",
              duration: streamMeta?.duration || 0,
              streamUrl: directUrl,
              artworkUrl: streamMeta?.artworkUrl || "logo.png"
            };
            directStreamCache.set(cleanKey, { time: Date.now(), data });
            if (target && target.startsWith("http")) {
              directStreamCache.set(target.toLowerCase(), { time: Date.now(), data });
            }
            return resolve(data);
          }
        }

        // If yt-dlp extraction failed (e.g. YouTube datacenter IP block on Render),
        // fallback to searching JioSaavn for the clean query/title so audio NEVER drops!
        const searchQuery = streamMeta?.title || queryOrUrl.replace(/^https?:\/\/[^\s]+/i, "").trim() || queryOrUrl;
        if (searchQuery && searchQuery.length > 1) {
          try {
            const saavnFallback = await searchJioSaavn(searchQuery, 3);
            if (saavnFallback.length > 0 && saavnFallback[0].streamUrl) {
              const top = saavnFallback[0];
              const data = {
                title: streamMeta?.title || top.title,
                author: streamMeta?.author || top.author,
                duration: streamMeta?.duration || top.duration,
                streamUrl: top.streamUrl,
                artworkUrl: streamMeta?.artworkUrl || top.artworkUrl
              };
              directStreamCache.set(cleanKey, { time: Date.now(), data });
              return resolve(data);
            }
          } catch (e) {}
        }

        // Final Fallback: JSON metadata extraction
        executeYtDlp(
          ["-j", "-f", "ba[ext=webm]/251/ba[ext=m4a]/140/ba/best", "--no-playlist", "--no-warnings", "--extractor-args", "youtube:player_client=android", target],
          { maxBuffer: 15 * 1024 * 1024, timeout: 12000 },
          (err2, stdout2) => {
            if (err2 || !stdout2) return resolve(null);
            try {
              const info = JSON.parse(stdout2.trim().split("\n")[0]);
              if (info && info.url) {
                const data = {
                  title: streamMeta?.title || info.title || "Audio Track",
                  author: streamMeta?.author || info.uploader || info.channel || "YouTube",
                  duration: streamMeta?.duration || Math.round((info.duration || 0) * 1000),
                  streamUrl: info.url,
                  artworkUrl: streamMeta?.artworkUrl || info.thumbnail || "logo.png"
                };
                directStreamCache.set(cleanKey, { time: Date.now(), data });
                return resolve(data);
              }
            } catch (e) {}
            resolve(null);
          }
        );
      }
    );
  });
}

// Media Track Resolver
async function resolveMediaTrack(queryOrUrl, forcedFilterMode = null) {
  let query = (queryOrUrl || "").trim();
  let filterMode = forcedFilterMode || "filterless";

  // Check Surah query
  const surahMatch = query.match(/surah\s*(\d+)/i) || (query.match(/^\d+$/) ? [, query] : null);
  if (surahMatch) {
    const sNum = parseInt(surahMatch[1], 10);
    if (sNum >= 1 && sNum <= 114) {
      const padded = String(sNum).padStart(3, "0");
      const sName = SURAH_NAMES[sNum] || `Surah ${sNum}`;
      return {
        title: `Surah ${sNum}: ${sName}`,
        author: "Mishary Rashid Alafasy",
        duration: 180000,
        streamUrl: `https://download.quranicaudio.com/quran/mishaari_raashid_al_3afaasee/${padded}.mp3`,
        rawStreamUrl: `https://download.quranicaudio.com/quran/mishaari_raashid_al_3afaasee/${padded}.mp3`,
        artworkUrl: "logo.png",
        filterMode: "strict"
      };
    }
  }

  // Direct MP3 URL
  if ((query.startsWith("http://") || query.startsWith("https://")) && (query.includes("quranicaudio.com") || query.match(/\.(mp3|m4a|wav|aac|flac|ogg)(\?.*)?$/i))) {
    const filename = path.basename(new URL(query).pathname);
    return {
      title: decodeURIComponent(filename).replace(/\.[^/.]+$/, ""),
      author: query.includes("quranicaudio") ? "Mishary Rashid Alafasy" : "Direct Audio Stream",
      duration: 0,
      streamUrl: query,
      rawStreamUrl: query,
      artworkUrl: "logo.png",
      filterMode
    };
  }

  try {
    const streamInfo = await extractYouTubeStream(query);
    if (streamInfo && streamInfo.streamUrl) {
      return {
        title: streamInfo.title || "Audio Track",
        author: streamInfo.author || "Trending Music",
        duration: streamInfo.duration || 0,
        streamUrl: streamInfo.streamUrl,
        rawStreamUrl: streamInfo.streamUrl,
        artworkUrl: streamInfo.artworkUrl || "logo.png",
        filterMode
      };
    }
  } catch (err) {
    console.error("resolveMediaTrack error:", err.message);
  }
  return null;
}

// User Session Extraction Helper
function getSessionUser(req) {
  let token = null;
  const authHeader = req.headers["authorization"];
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7).trim();
  } else if (req.headers.cookie) {
    const m = req.headers.cookie.match(/ahm_auth_token=([^;]+)/);
    if (m) token = decodeURIComponent(m[1].trim());
  }
  if (!token) {
    try {
      const pUrl = new URL(req.url, `http://localhost:${PORT}`);
      token = pUrl.searchParams.get("token");
    } catch (e) {}
  }
  return token ? userStore.getUserByToken(token) : null;
}

// ==========================================================================
// HTTP SERVER (DEDICATED EVENT LOOP FOR WEB & MOBILE APP)
// ==========================================================================
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".webm": "audio/webm"
};

const server = http.createServer(async (req, res) => {
  // CORS & Streaming Headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range, Authorization");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsedUrl.pathname;

  // --------------------------------------------------------------------------
  // API: Instant Audio Stream Proxy (Low-Latency TCP Nodelay + Persistent TLS)
  // --------------------------------------------------------------------------
  if (pathname === "/api/stream-audio") {
    const targetChannel = parsedUrl.searchParams.get("channel") || "browser";
    const directUrl = parsedUrl.searchParams.get("url");

    let uri = directUrl;
    if (!uri) {
      if (targetChannel === "browser") uri = systemChannels.browser.current?.streamUrl;
      else if (targetChannel === "app") uri = systemChannels.app.current?.streamUrl;
    }

    if (!uri || (!uri.startsWith("http://") && !uri.startsWith("https://"))) {
      res.writeHead(404, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ error: `No active audio stream for channel: ${targetChannel}` }));
    }

    try {
      const targetUrl = new URL(uri);
      const isHttps = targetUrl.protocol === "https:";
      const clientLib = isHttps ? https : http;
      const agent = isHttps ? httpsKeepAliveAgent : httpKeepAliveAgent;

      // Disable Nagle's algorithm on client socket for instant audio packet delivery
      if (res.socket) res.socket.setNoDelay(true);

      if (req.method === "HEAD") {
        const ext = targetUrl.pathname.toLowerCase();
        const inferredType = ext.includes(".mp4") || ext.includes(".m4a") ? "audio/mp4" : (ext.includes(".mp3") ? "audio/mpeg" : "audio/webm");
        res.writeHead(200, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
          "Content-Type": inferredType,
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=14400"
        });
        return res.end();
      }

      const proxyReqHeaders = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Accept-Encoding": "identity"
      };
      if (req.headers.range) {
        proxyReqHeaders["range"] = req.headers.range;
      }

      const proxyReq = clientLib.request(targetUrl, { method: "GET", headers: proxyReqHeaders, agent }, (proxyRes) => {
        proxyReq.setNoDelay(true);

        // Handle HTTP redirects (301, 302, 307)
        if ((proxyRes.statusCode === 301 || proxyRes.statusCode === 302 || proxyRes.statusCode === 307) && proxyRes.headers.location) {
          try {
            const redirectUrl = new URL(proxyRes.headers.location, targetUrl);
            const redLib = redirectUrl.protocol === "https:" ? https : http;
            const redAgent = redirectUrl.protocol === "https:" ? httpsKeepAliveAgent : httpKeepAliveAgent;
            const redReq = redLib.request(redirectUrl, { method: "GET", headers: proxyReqHeaders, agent: redAgent }, (redRes) => {
              redReq.setNoDelay(true);
              const resHeaders = {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
                "Content-Type": redRes.headers["content-type"] || "audio/webm",
                "Accept-Ranges": "bytes",
                "Connection": "keep-alive",
                "Cache-Control": "public, max-age=14400"
              };
              if (redRes.headers["content-length"]) resHeaders["Content-Length"] = redRes.headers["content-length"];
              if (redRes.headers["content-range"]) resHeaders["Content-Range"] = redRes.headers["content-range"];
              res.writeHead(redRes.statusCode || 200, resHeaders);
              redRes.pipe(res);
            });
            redReq.on("error", () => {
              if (!res.headersSent) res.writeHead(502);
              res.end();
            });
            req.on("close", () => redReq.destroy());
            redReq.end();
            return;
          } catch (e) {}
        }

        const resHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
          "Content-Type": proxyRes.headers["content-type"] || "audio/webm",
          "Accept-Ranges": "bytes",
          "Connection": "keep-alive",
          "Cache-Control": "public, max-age=14400"
        };
        if (proxyRes.headers["content-length"]) resHeaders["Content-Length"] = proxyRes.headers["content-length"];
        if (proxyRes.headers["content-range"]) resHeaders["Content-Range"] = proxyRes.headers["content-range"];

        res.writeHead(proxyRes.statusCode || 200, resHeaders);
        proxyRes.pipe(res);
      });

      proxyReq.setNoDelay(true);
      proxyReq.on("error", (err) => {
        console.error("Direct audio stream proxy error:", err.message);
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });

      req.on("close", () => {
        proxyReq.destroy();
      });
      proxyReq.end();
      return;
    } catch (e) {
      res.writeHead(400, { "Access-Control-Allow-Origin": "*" });
      return res.end("Invalid audio URI");
    }
  }

  // --------------------------------------------------------------------------
  // API: Instant Track Resolver
  // --------------------------------------------------------------------------
  if (pathname === "/api/resolve-track") {
    const q = parsedUrl.searchParams.get("q") || "";
    const filterMode = parsedUrl.searchParams.get("filterMode") || "filterless";
    const targetChannel = parsedUrl.searchParams.get("channel") || "browser";
    const forceSaavn = parsedUrl.searchParams.get("forceSaavn") === "true";

    if (!q) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ success: false, error: "Missing query" }));
    }

    try {
      if (forceSaavn) {
        try {
          const saavnResults = await searchJioSaavn(q, 3);
          if (saavnResults.length > 0 && saavnResults[0].streamUrl) {
            const top = saavnResults[0];
            const track = {
              title: top.title,
              author: top.author,
              duration: top.duration,
              streamUrl: top.streamUrl,
              rawStreamUrl: top.streamUrl,
              artworkUrl: top.artworkUrl,
              filterMode
            };
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({
              success: true,
              channel: targetChannel,
              track: {
                ...track,
                proxyStreamUrl: `/api/stream-audio?channel=${targetChannel}&url=${encodeURIComponent(track.streamUrl)}`
              }
            }));
          }
        } catch (e) {}
      }

      const track = await resolveMediaTrack(q, filterMode);
      if (track) {
        const shouldSet = parsedUrl.searchParams.get("set") === "true";
        if (shouldSet && systemChannels[targetChannel]) {
          systemChannels[targetChannel].current = track;
          systemChannels[targetChannel].isPlaying = true;
          systemChannels[targetChannel].isPaused = false;
          systemChannels[targetChannel].position = 0;
          if (track.duration) systemChannels[targetChannel].duration = track.duration;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({
          success: true,
          channel: targetChannel,
          track: {
            ...track,
            proxyStreamUrl: `/api/stream-audio?channel=${targetChannel}&url=${encodeURIComponent(track.streamUrl)}`
          }
        }));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ success: false, error: `Track not found for: ${q}` }));
      }
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ success: false, error: e.message }));
    }
  }

  // --------------------------------------------------------------------------
  // API: Search Endpoint (Multi-Track & Playlists)
  // --------------------------------------------------------------------------
  if (pathname === "/api/search") {
    const q = parsedUrl.searchParams.get("q") || "";
    const filterMode = parsedUrl.searchParams.get("filterMode") || "filterless";
    if (!q) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ success: false, error: "Missing search query" }));
    }

    try {
      const [rawResults, rawPlaylists] = await Promise.all([
        searchYouTubeMulti(q, 20),
        searchPlaylistsMulti(q, 5)
      ]);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({
        success: true,
        query: q,
        filterMode,
        results: rawResults,
        playlists: rawPlaylists
      }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ success: false, error: e.message }));
    }
  }

  // --------------------------------------------------------------------------
  // API: Spotify Trending Playlists & Refresh
  // --------------------------------------------------------------------------
  if (pathname === "/api/spotify-trending") {
    const data = spotifyTrending.getTrendingData();
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ success: true, ...data }));
  }

  if (pathname === "/api/spotify-trending/refresh") {
    try {
      const data = await spotifyTrending.refreshTrending(true);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ success: true, ...data }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ success: false, error: err.message }));
    }
  }

  // --------------------------------------------------------------------------
  // API: Real-time Player State
  // --------------------------------------------------------------------------
  if (pathname === "/api/state") {
    const chanBrowser = systemChannels.browser;
    const chanApp = systemChannels.app;

    const payload = {
      connected: true,
      authenticated: false,
      user: null,
      playing: chanBrowser.isPlaying,
      paused: chanBrowser.isPaused,
      position: chanBrowser.position,
      duration: chanBrowser.duration,
      volume: chanBrowser.volume,
      current: chanBrowser.current,
      queue: chanBrowser.queue || [],
      channels: {
        browser: {
          id: "browser",
          name: "Web Browser",
          icon: "🌐",
          badge: "Direct WebAudio Engine",
          isPlaying: chanBrowser.isPlaying,
          isPaused: chanBrowser.isPaused,
          position: chanBrowser.position,
          duration: chanBrowser.duration,
          volume: chanBrowser.volume,
          current: chanBrowser.current,
          queue: chanBrowser.queue || []
        },
        app: {
          id: "app",
          name: "Mobile App",
          icon: "📱",
          badge: "Capacitor Native Engine",
          isPlaying: chanApp.isPlaying,
          isPaused: chanApp.isPaused,
          position: chanApp.position,
          duration: chanApp.duration,
          volume: chanApp.volume,
          current: chanApp.current,
          queue: chanApp.queue || []
        }
      }
    };

    const sessionUser = getSessionUser(req);
    if (sessionUser) {
      payload.authenticated = true;
      payload.user = {
        id: sessionUser.id,
        username: sessionUser.username,
        displayName: sessionUser.displayName,
        avatar: sessionUser.avatar,
        type: sessionUser.type
      };
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(payload));
  }

  // --------------------------------------------------------------------------
  // API: User Action Controller (play_now, set_track, play_pause, etc.)
  // --------------------------------------------------------------------------
  if (pathname === "/api/action" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const parsed = JSON.parse(body || "{}");
        const action = parsed.action;
        const targetChannel = parsed.targetChannel || "browser";
        const chan = systemChannels[targetChannel] || systemChannels.browser;

        if (action === "play_now" || action === "play_query") {
          const q = parsed.value || parsed.query || "";
          if (q) {
            const tr = await resolveMediaTrack(q, parsed.filterMode);
            if (tr) {
              chan.current = tr;
              chan.isPlaying = true;
              chan.isPaused = false;
              chan.position = 0;
            }
          }
        } else if (action === "set_track") {
          if (parsed.track) {
            chan.current = parsed.track;
            chan.isPlaying = true;
            chan.isPaused = false;
          }
        } else if (action === "play_pause") {
          chan.isPaused = !chan.isPaused;
          chan.isPlaying = !chan.isPaused;
        } else if (action === "report_state") {
          if (parsed.position !== undefined) chan.position = parsed.position;
          if (parsed.duration !== undefined) chan.duration = parsed.duration;
          if (parsed.paused !== undefined) {
            chan.isPaused = parsed.paused;
            chan.isPlaying = !parsed.paused;
          }
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ success: true, message: `Action ${action} executed` }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // --------------------------------------------------------------------------
  // API: User Authentication (Login, Register, Logout, Me)
  // --------------------------------------------------------------------------
  if (pathname === "/api/user/login" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const { email, username, password, displayName } = JSON.parse(body || "{}");
        const result = userStore.loginCustomer({ email: email || username || displayName, password });
        if (result.success) {
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Set-Cookie": `ahm_auth_token=${encodeURIComponent(result.token)}; Path=/; Max-Age=2592000; SameSite=Lax`
          });
          return res.end(JSON.stringify(result));
        } else {
          res.writeHead(401, { "Content-Type": "application/json" });
          return res.end(JSON.stringify(result));
        }
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  if (pathname === "/api/user/register" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const { email, password, username, displayName, avatar, preferredGenres } = JSON.parse(body || "{}");
        const result = userStore.registerCustomer({ email, password, username, displayName, avatar, preferredGenres });
        if (result.success) {
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Set-Cookie": `ahm_auth_token=${encodeURIComponent(result.token)}; Path=/; Max-Age=2592000; SameSite=Lax`
          });
          return res.end(JSON.stringify(result));
        } else {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify(result));
        }
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  if (pathname === "/api/user/logout" && req.method === "POST") {
    const sessionUser = getSessionUser(req);
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Set-Cookie": `ahm_auth_token=; Path=/; Max-Age=0; SameSite=Lax`
    });
    return res.end(JSON.stringify({ success: true }));
  }

  if (pathname === "/api/user/me") {
    const user = getSessionUser(req);
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ success: true, authenticated: Boolean(user), user: user || null }));
  }

  if (pathname === "/api/user/rehydrate" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const { vault } = JSON.parse(body || "{}");
        const result = userStore.rehydrateUser(vault);
        if (result.success) {
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Set-Cookie": `ahm_auth_token=${encodeURIComponent(result.token)}; Path=/; Max-Age=2592000; SameSite=Lax`
          });
          return res.end(JSON.stringify(result));
        } else {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify(result));
        }
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // --------------------------------------------------------------------------
  // API: User Favorites, Queue, & Taste Profiles
  // --------------------------------------------------------------------------
  if (pathname === "/api/user/favorites") {
    const user = getSessionUser(req);
    const userId = user ? user.id : "local_default";
    const favs = userStore.getFavorites(userId);
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ success: true, favorites: favs }));
  }

  if (pathname === "/api/user/favorites/toggle" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const { track } = JSON.parse(body || "{}");
        const user = getSessionUser(req);
        const userId = user ? user.id : "local_default";
        const result = userStore.toggleFavorite(userId, track);
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ success: true, ...result }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  if (pathname === "/api/user/queue") {
    const user = getSessionUser(req);
    const userId = user ? user.id : "local_default";
    const q = userStore.getQueue(userId);
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ success: true, queue: q }));
  }

  if (pathname === "/api/user/queue/save" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const { queue } = JSON.parse(body || "{}");
        const user = getSessionUser(req);
        const userId = user ? user.id : "local_default";
        userStore.saveQueue(userId, queue);
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  if (pathname === "/api/user/recommendations") {
    const user = getSessionUser(req);
    const userId = user ? user.id : "local_default";
    const force = parsedUrl.searchParams.get("refresh") === "true";
    const recs = userStore.getDailyRecommendations(userId, force);
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ success: true, recommendations: recs }));
  }

  if (pathname === "/api/apk-link") {
    const apkUrl = (process.env.APK_DOWNLOAD_URL || "").trim();
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ success: true, url: apkUrl }));
  }

  // --------------------------------------------------------------------------
  // STATIC ASSET SERVER (Aggressive In-Memory / File Streaming)
  // --------------------------------------------------------------------------
  let filePath = path.join(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname);

  // If path doesn't have an extension, try .html
  if (!path.extname(filePath)) {
    if (fs.existsSync(filePath + ".html")) {
      filePath += ".html";
    }
  }

  // Security guard against directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback for SPA routing to index.html
      const indexPath = path.join(PUBLIC_DIR, "index.html");
      fs.readFile(indexPath, (err2, indexData) => {
        if (err2) {
          res.writeHead(404);
          return res.end("File Not Found");
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(indexData);
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const isCacheable = ext !== ".html" && ext !== ".webmanifest" && !filePath.endsWith("sw.js");

    const headers = {
      "Content-Type": contentType,
      "Content-Length": stats.size,
      "Access-Control-Allow-Origin": "*"
    };
    if (isCacheable) {
      headers["Cache-Control"] = "public, max-age=86400, immutable";
    } else {
      headers["Cache-Control"] = "no-cache";
    }

    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
});

// Launch Standalone Server
server.listen(PORT, "0.0.0.0", () => {
  console.log("================================================================");
  console.log(" 🚀 SPY SEC MUSIC - STANDALONE ULTRA-LOW LATENCY AUDIO ENGINE");
  console.log(` 🌐 Web Player & Mobile Server Live: http://localhost:${PORT}`);
  console.log(" ⚡ Dedicated Event Loop: 100% CPU dedicated to Audio & Streaming");
  console.log(" ⚡ TLS Keep-Alive & TCP NoDelay Active (0ms Overhead)");
  console.log("================================================================");
});
