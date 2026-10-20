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
  validateByFilterMode,
  SURAH_NAMES,
  SURAH_ALIASES,
  resolveSurahInfo
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

const spotifyLinkCache = new Map();

function isSpotifyUrl(url) {
  if (!url || typeof url !== "string") return false;
  return /open\.spotify\.com\/(?:intl-[a-zA-Z]{2,5}\/)?(?:user\/[^/]+\/)?(playlist|album|track|artist|show|episode)\/([a-zA-Z0-9]+)/i.test(url) ||
         /spotify:(playlist|album|track|artist|show|episode):([a-zA-Z0-9]+)/i.test(url) ||
         /(?:spotify\.link|spotify\.app\.link)\/[a-zA-Z0-9_-]+/i.test(url);
}

function extractSpotifyUrl(text) {
  if (!text || typeof text !== "string") return null;
  const match = text.match(/https?:\/\/open\.spotify\.com\/(?:intl-[a-zA-Z]{2,5}\/)?(?:user\/[^/]+\/)?(playlist|album|track|artist|show|episode)\/[a-zA-Z0-9]+(\?[^\s]*)?/i) ||
                text.match(/spotify:(playlist|album|track|artist|show|episode):[a-zA-Z0-9]+/i) ||
                text.match(/https?:\/\/(?:spotify\.link|spotify\.app\.link)\/[a-zA-Z0-9_-]+(\?[^\s]*)?/i);
  return match ? match[0] : null;
}

function isYouTubeUrl(url) {
  if (!url || typeof url !== "string") return false;
  return /(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?v=[a-zA-Z0-9_-]+|embed\/[a-zA-Z0-9_-]+|v\/[a-zA-Z0-9_-]+|shorts\/[a-zA-Z0-9_-]+|playlist\?list=[a-zA-Z0-9_-]+)|youtu\.be\/[a-zA-Z0-9_-]+)/i.test(url.trim());
}

function extractYouTubeUrl(text) {
  if (!text || typeof text !== "string") return null;
  const match = text.match(/https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?v=[a-zA-Z0-9_-]+[^\s]*|playlist\?list=[a-zA-Z0-9_-]+[^\s]*|shorts\/[a-zA-Z0-9_-]+)|youtu\.be\/[a-zA-Z0-9_-]+(\?[^\s]*)?)/i);
  return match ? match[0] : null;
}

function extractYouTubePlaylistId(urlOrId) {
  if (!urlOrId || typeof urlOrId !== "string") return null;
  const str = urlOrId.trim();
  if (/^[a-zA-Z0-9_-]{10,64}$/.test(str) && (str.startsWith("PL") || str.startsWith("OL") || str.startsWith("RD") || str.startsWith("UU") || str.startsWith("FL") || str.startsWith("TL"))) {
    return str;
  }
  try {
    const urlObj = new URL(str.startsWith("http") ? str : `https://${str}`);
    const list = urlObj.searchParams.get("list");
    if (list) return list;
  } catch (e) {}
  const match = str.match(/[?&]list=([a-zA-Z0-9_-]+)/i);
  if (match) return match[1];
  return null;
}

/**
 * Resolves full Spotify playlist/album/track metadata & tracklist without user credentials.
 */
async function resolveSpotifyLink(url) {
  if (!spotifyUrlInfo) return null;
  let cleanUrl = (url || "").trim();
  if (!cleanUrl) return null;

  // Handle spotify.link / spotify.app.link redirect
  if (cleanUrl.includes("spotify.link") || cleanUrl.includes("spotify.app.link")) {
    try {
      const headRes = await fetch(cleanUrl, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(4000) });
      if (headRes.url && headRes.url.includes("spotify.com")) {
        cleanUrl = headRes.url;
      }
    } catch (_) {}
  }

  // Normalize internationalization /intl-xx/ and legacy /user/.../playlist paths
  cleanUrl = cleanUrl
    .replace(/\/intl-[a-zA-Z]{2,5}\//i, "/")
    .replace(/\/user\/[^/]+\/playlist\//i, "/playlist/");

  const cacheKey = cleanUrl.toLowerCase();
  if (spotifyLinkCache.has(cacheKey)) {
    const cached = spotifyLinkCache.get(cacheKey);
    if (Date.now() - cached.time < 7200000) { // 2 hour cache
      return cached.data;
    }
  }

  try {
    let details = null;
    try {
      details = await spotifyUrlInfo.getDetails(cleanUrl);
    } catch (e1) {
      try {
        const [preview, rawTracks] = await Promise.all([
          spotifyUrlInfo.getPreview(cleanUrl).catch(() => null),
          spotifyUrlInfo.getTracks(cleanUrl).catch(() => [])
        ]);
        if (preview || (rawTracks && rawTracks.length > 0)) {
          details = { preview, tracks: rawTracks };
        }
      } catch (e2) {}
    }

    if (!details) return null;

    const preview = details.preview || {};
    const type = preview.type || (cleanUrl.includes("/track/") ? "track" : cleanUrl.includes("/album/") ? "album" : cleanUrl.includes("/episode/") ? "episode" : cleanUrl.includes("/show/") ? "show" : "playlist");
    const rawTracks = (Array.isArray(details.tracks) && details.tracks.length > 0)
      ? details.tracks
      : (preview.title ? [{ name: preview.title, artist: preview.artist, duration: 180000, previewUrl: preview.audio }] : []);

    const tracks = rawTracks.map((t, idx) => {
      const name = (t.name || t.title || `Track ${idx + 1}`)
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&#039;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\u00A0/g, ' ')
        .replace(/\u200B/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      const artist = (t.artist || preview.artist || "Spotify Artist")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&#039;/g, "'")
        .replace(/\u00A0/g, ' ')
        .replace(/\u200B/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      const cleanTitle = name.replace(/\(.*?\)|\[.*?\]/g, "").trim();
      const primaryArtist = artist.split(/[,&x/]|feat\.|ft\./i)[0].trim();
      const cleanQ = primaryArtist ? `${cleanTitle} ${primaryArtist}` : `${cleanTitle} ${artist}`.trim();
      const spotifyTrackId = (t.uri && t.uri.startsWith("spotify:track:")) ? t.uri.split(":").pop() : null;
      const canonicalTrackUrl = spotifyTrackId ? `https://open.spotify.com/track/${spotifyTrackId}` : (t.url || null);
      return {
        id: spotifyTrackId ? `sp_${spotifyTrackId}` : `sp_${Date.now()}_${idx + 1}`,
        title: name,
        artist: artist,
        duration: t.duration || 180000,
        artworkUrl: preview.image || "logo.png",
        query: cleanQ,
        url: canonicalTrackUrl,
        previewUrl: t.previewUrl || (idx === 0 ? preview.audio : null),
        source: "spotify"
      };
    });

    const result = {
      id: `spotify_${cleanUrl.replace(/[^a-zA-Z0-9]/g, "_")}`,
      type: type,
      title: preview.title || (type === "track" ? tracks[0]?.title : "Spotify Playlist"),
      description: preview.description || `Spotify ${type} • ${tracks.length} tracks`,
      author: preview.artist || (tracks[0]?.artist || "Spotify Official"),
      artworkUrl: preview.image || "logo.png",
      image: preview.image || "logo.png",
      tracks: tracks,
      trackCount: tracks.length
    };

    spotifyLinkCache.set(cacheKey, { time: Date.now(), data: result });
    return result;
  } catch (err) {
    console.error("Error resolving Spotify link:", err.message);
    return null;
  }
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

// Full 114 Surah Map & Resolver imported from ./islamicFilter

// ==========================================================================
// RESILIENT YT-DLP RUNNER (Windows, Linux, Docker, Render)
// ==========================================================================
function executeYtDlp(args, options, callback) {
  const localBinary = path.join(__dirname, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
  if (fs.existsSync(localBinary)) {
    return execFile(localBinary, args, options, (err, stdout, stderr) => {
      if (options?.signal?.aborted || err?.name === "AbortError") {
        return callback(new Error("Request aborted"), "", "");
      }
      callback(err, stdout, stderr);
    });
  }

  const pythonCmd = process.env.PYTHON_PATH || (process.platform === "win32" ? "python" : "python3");
  execFile(pythonCmd, ["-m", "yt_dlp", ...args], options, (err, stdout, stderr) => {
    if (options?.signal?.aborted || err?.name === "AbortError") {
      return callback(new Error("Request aborted"), "", "");
    }
    if (err && (err.code === "ENOENT" || err.message?.includes("ENOENT"))) {
      return execFile("yt-dlp", args, options, (err2, stdout2, stderr2) => {
        if (options?.signal?.aborted || err2?.name === "AbortError") {
          return callback(new Error("Request aborted"), "", "");
        }
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

function cleanMusicQuery(q) {
  if (!q || typeof q !== "string") return "";
  let clean = q
    .replace(/\u00A0/g, " ")
    .replace(/\u200B/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
  clean = clean.replace(/\(.*?\)|\[.*?\]/g, "");
  if (clean.includes(" - ")) {
    const parts = clean.split(" - ");
    const artist = parts[0].split(/[,&x/]|feat\.|ft\./i)[0].trim();
    const title = parts.slice(1).join(" ").trim();
    clean = `${title} ${artist}`.trim();
  }
  return clean.replace(/[,;&]/g, " ").replace(/\s+/g, " ").trim();
}

function isJioSaavnResultRelevant(query, saavnTitle, expectedTitle = "", expectedArtist = "") {
  if (!saavnTitle) return false;
  const cleanStr = (s) => (s || "")
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const stopWords = new Set(["the", "a", "an", "and", "or", "in", "on", "of", "to", "for", "with", "feat", "ft", "official", "video", "audio", "song", "lyrics", "full", "remix", "version", "original", "coke", "studio", "season", "ost", "from"]);
  const getTokens = (s) => cleanStr(s).split(" ").filter(w => w.length >= 2 && !stopWords.has(w));

  const candTitleTokens = getTokens(saavnTitle);
  const candSet = new Set(candTitleTokens);

  let target = (expectedTitle || "").trim();
  if (!target) {
    let q = (query || "").trim();
    if (q.includes(" - ")) {
      target = q.split(" - ")[0].trim();
    } else if (expectedArtist) {
      const artTokens = getTokens(expectedArtist);
      const parts = q.split(/\s+/).filter(w => !artTokens.includes(w.toLowerCase()));
      if (parts.length > 0) target = parts.join(" ");
      else target = q;
    } else {
      target = q;
    }
  }

  const targetTokens = getTokens(target);
  if (targetTokens.length === 0) return true;

  if (targetTokens.length >= 2) {
    const leadTokens = targetTokens.slice(0, Math.min(3, Math.ceil(targetTokens.length / 2)));
    const hasLeadMatch = leadTokens.some(lt => 
      candSet.has(lt) || candTitleTokens.some(ct => (lt.length >= 4 && ct.includes(lt)) || (ct.length >= 4 && lt.includes(ct)))
    );
    if (!hasLeadMatch) return false;
  }

  let matches = 0;
  for (const tok of targetTokens) {
    if (candSet.has(tok)) {
      matches++;
    } else {
      for (const ct of candTitleTokens) {
        if ((tok.length >= 4 && ct.includes(tok)) || (ct.length >= 4 && tok.includes(ct))) {
          matches++;
          break;
        }
      }
    }
  }

  if (targetTokens.length === 1) return matches >= 1;
  const ratio = matches / targetTokens.length;
  return matches >= 2 || ratio >= 0.5;
}

// Fast JioSaavn Search (Instant ~150ms response, zero datacenter IP bans, 320kbps audio)
async function searchJioSaavn(query, limit = 10, signal = null) {
  if (signal?.aborted) return [];
  const cleanQ = cleanMusicQuery(query);
  try {
    const fetchResults = async (qStr) => {
      const url = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&api_version=4&ctx=web6dot0&n=${limit}&p=1&q=${encodeURIComponent(qStr)}`;
      const timeoutSignal = AbortSignal.timeout(3000);
      const fetchSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
      const res = await fetch(url, { signal: fetchSignal });
      const data = await res.json();
      return (data.results || []).filter(r => r && r.title);
    };

    let rawList = await fetchResults(cleanQ || query);
    if ((!rawList || rawList.length === 0) && cleanQ && cleanQ !== query) {
      rawList = await fetchResults(query);
    }
    if ((!rawList || rawList.length === 0) && cleanQ) {
      const stripped = cleanQ.replace(/\b(live|remix|official|video|audio|lyrics|hd|4k|extended|version|mix)\b/gi, "").trim();
      if (stripped && stripped !== cleanQ) {
        rawList = await fetchResults(stripped);
      }
    }
    if (signal?.aborted) return [];
    const results = rawList || [];
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
async function searchLavalinkTracks(query, limit = 15, signal = null) {
  if (signal?.aborted) return [];
  try {
    const lavalinkUrl = process.env.LAVALINK_URL || "http://lavalink.jirayu.net:13592";
    const lavalinkAuth = process.env.LAVALINK_AUTH || "youshallnotpass";
    const timeoutSignal = AbortSignal.timeout(2800);
    const fetchSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    const res = await fetch(`${lavalinkUrl}/v4/loadtracks?identifier=ytsearch:${encodeURIComponent(query)}`, {
      headers: { Authorization: lavalinkAuth },
      signal: fetchSignal
    });
    const d = await res.json();
    if (signal?.aborted) return [];
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
async function searchYouTubeMulti(query, limit = 20, signal = null) {
  if (signal?.aborted) return [];
  const cacheKey = (query || "").trim().toLowerCase();
  if (searchCache.has(cacheKey)) {
    const cached = searchCache.get(cacheKey);
    if (Date.now() - cached.time < 3600000 && Array.isArray(cached.results) && cached.results.length >= limit) {
      return cached.results.slice(0, limit);
    }
  }

  const surah = resolveSurahInfo(query);
  const isQueryIslamic = isIslamicQuery(query) || Boolean(surah);

  let combined = [];
  if (surah) {
    const padded = String(surah.number).padStart(3, "0");
    const quranUrl = `https://download.quranicaudio.com/quran/mishaari_raashid_al_3afaasee/${padded}.mp3`;
    combined.push({
      id: `quran_surah_${surah.number}`,
      title: `Surah ${surah.number}: ${surah.name}`,
      author: "Mishary Rashid Alafasy",
      artist: "Mishary Rashid Alafasy",
      duration: surah.number === 2 ? 7200000 : 300000,
      streamUrl: quranUrl,
      rawStreamUrl: quranUrl,
      artworkUrl: "logo.png",
      source: "quran",
      filterMode: "strict"
    });
  }

  // Execute JioSaavn (for secular music only) and Lavalink in parallel
  const [saavnResults, lavalinkResults] = await Promise.all([
    isQueryIslamic ? Promise.resolve([]) : searchJioSaavn(query, Math.min(limit, 12), signal),
    searchLavalinkTracks(query, Math.min(limit, 15), signal)
  ]);

  if (signal?.aborted) return [];

  if (saavnResults.length > 0) {
    combined.push(...saavnResults);
  }
  if (lavalinkResults.length > 0) {
    // Deduplicate against existing results by checking title similarity
    const existingTitles = new Set(combined.map(r => r.title.toLowerCase().replace(/[^a-z0-9]/g, "")));
    for (const t of lavalinkResults) {
      if (isQueryIslamic && !isIslamicTrack(t) && !isIslamicText(t.title)) continue;
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

  if (signal?.aborted) return [];

  // Fallback to yt-dlp flat playlist search with android client
  const fetchLimit = Math.max(limit + 5, 25);
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve([]);
    executeYtDlp(
      ["--flat-playlist", "-J", "--no-warnings", "--extractor-args", "youtube:player_client=android", `ytsearch${fetchLimit}:${query}`],
      { timeout: 12000, maxBuffer: 15 * 1024 * 1024, signal },
      (err, stdout) => {
        if (signal?.aborted) return resolve([]);
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

// Fast JioSaavn Playlist Search (Instant ~150ms response, zero rate-limits)
async function searchJioSaavnPlaylists(query, limit = 5, signal = null) {
  if (signal?.aborted) return [];
  try {
    const url = `https://www.jiosaavn.com/api.php?__call=search.getPlaylistResults&_format=json&_marker=0&api_version=4&ctx=web6dot0&n=${limit}&p=1&q=${encodeURIComponent(query)}`;
    const timeoutSignal = AbortSignal.timeout(2800);
    const fetchSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    const res = await fetch(url, { signal: fetchSignal });
    const data = await res.json();
    if (signal?.aborted) return [];
    const results = data.results || [];
    return results
      .filter(r => r && r.title)
      .map(r => {
        const cleanT = (r.title || "")
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&')
          .replace(/&#039;/g, "'")
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>');
        const cleanSub = (r.subtitle || "").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'");
        const author = r.more_info?.firstname || r.more_info?.artist_name?.join(", ") || cleanSub || "Featured Playlist";
        const songCount = parseInt(r.more_info?.song_count || r.subtitle || "0", 10) || null;
        return {
          id: `saavn_pl_${r.id}`,
          rawId: r.id,
          title: cleanT,
          author: author,
          trackCount: songCount,
          artworkUrl: (r.image || "").replace("150x150", "500x500") || "logo.png",
          url: r.perma_url || `https://www.jiosaavn.com/featured/${r.id}`,
          source: "jiosaavn"
        };
      });
  } catch (e) {
    return [];
  }
}

// Fast JioSaavn Album Search (Albums are commonly searched as playlists)
async function searchJioSaavnAlbums(query, limit = 3, signal = null) {
  if (signal?.aborted) return [];
  try {
    const url = `https://www.jiosaavn.com/api.php?__call=search.getAlbumResults&_format=json&_marker=0&api_version=4&ctx=web6dot0&n=${limit}&p=1&q=${encodeURIComponent(query)}`;
    const timeoutSignal = AbortSignal.timeout(2800);
    const fetchSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    const res = await fetch(url, { signal: fetchSignal });
    const data = await res.json();
    if (signal?.aborted) return [];
    const results = data.results || [];
    return results
      .filter(r => r && r.title)
      .map(r => {
        const cleanT = (r.title || "")
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&')
          .replace(/&#039;/g, "'")
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>');
        const cleanArtist = (r.artist || r.subtitle || "").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'");
        const songCount = parseInt(r.more_info?.song_count || "0", 10) || null;
        return {
          id: `saavn_alb_${r.id}`,
          rawId: r.id,
          isAlbum: true,
          title: `${cleanT} (Album)`,
          author: cleanArtist || "Official Album",
          trackCount: songCount,
          artworkUrl: (r.image || "").replace("150x150", "500x500") || "logo.png",
          url: r.perma_url || `https://www.jiosaavn.com/album/${r.id}`,
          source: "jiosaavn"
        };
      });
  } catch (e) {
    return [];
  }
}

// Match Curated & Spotify Trending Playlists
function searchSpotifyLocalPlaylists(query) {
  const qLower = (query || "").trim().toLowerCase();
  if (!qLower) return [];
  const results = [];
  try {
    const trending = spotifyTrending.getTrendingData();
    const allPlaylists = trending?.playlists || [];
    for (const pl of allPlaylists) {
      const name = (pl.name || pl.title || "").toLowerCase();
      const desc = (pl.desc || pl.description || "").toLowerCase();
      const genre = (pl.genre || "").toLowerCase();
      if (name.includes(qLower) || desc.includes(qLower) || genre.includes(qLower)) {
        results.push({
          id: pl.id || `spotify_${Date.now()}`,
          title: pl.name || pl.title,
          author: "Spotify Official",
          trackCount: pl.tracks?.length || pl.tracksCount || 8,
          artworkUrl: pl.coverUrl || "logo.png",
          url: `spotify:playlist:${pl.id}`,
          source: "spotify"
        });
      }
    }
  } catch (e) {}
  return results;
}

// Multi-Source Playlist Search (JioSaavn + Albums + Spotify + Lavalink/YouTube Fallback)
async function searchPlaylistsMulti(query, limit = 5, signal = null) {
  if (signal?.aborted) return [];
  const cacheKey = (query || "").trim().toLowerCase();
  if (searchPlaylistCache.has(cacheKey)) {
    const cached = searchPlaylistCache.get(cacheKey);
    if (Date.now() - cached.time < 3600000 && Array.isArray(cached.results) && cached.results.length >= limit) {
      return cached.results.slice(0, limit);
    }
  }

  // 1. Parallel Fast Search: JioSaavn Playlists, JioSaavn Albums & Spotify Local Playlists (~150ms)
  const [saavnPlaylists, saavnAlbums] = await Promise.all([
    searchJioSaavnPlaylists(query, Math.min(limit, 5), signal),
    searchJioSaavnAlbums(query, Math.min(limit, 3), signal)
  ]);

  const spotifyMatches = searchSpotifyLocalPlaylists(query);

  const combined = [];
  // Prioritize verified Spotify match if exact match, otherwise JioSaavn playlists
  if (spotifyMatches.length > 0) combined.push(...spotifyMatches);
  if (saavnPlaylists.length > 0) combined.push(...saavnPlaylists);
  if (saavnAlbums.length > 0) combined.push(...saavnAlbums);

  if (combined.length >= 2) {
    searchPlaylistCache.set(cacheKey, { time: Date.now(), results: combined });
    return combined.slice(0, limit);
  }

  if (signal?.aborted) return combined;

  // 2. Fallback: Fast YouTube / Lavalink Playlist Search with strict timeout (2.5s)
  const fetchLimit = limit + 3;
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAw%3D%3D`;

  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(combined.slice(0, limit));
    const ytTimeout = setTimeout(() => resolve(combined.slice(0, limit)), 2500);

    executeYtDlp(
      ["--flat-playlist", "-J", "--no-warnings", "--playlist-end", String(fetchLimit), "--extractor-args", "youtube:player_client=android", url],
      { timeout: 3500, maxBuffer: 10 * 1024 * 1024, signal },
      (err, stdout) => {
        clearTimeout(ytTimeout);
        if (signal?.aborted) return resolve(combined.slice(0, limit));
        if (!err && stdout) {
          try {
            const data = JSON.parse(stdout);
            const entries = data.entries || [];
            const ytPlaylists = entries
              .filter(e => e && e.title && !e.id?.startsWith("UC") && (e.url?.includes("list=") || e.id?.startsWith("PL") || e.id?.startsWith("OL") || e.id?.startsWith("RD") || e.id?.startsWith("UU") || e._type === "url"))
              .map(e => ({
                id: e.id,
                title: e.title,
                author: e.channel || e.uploader || "YouTube Playlist",
                trackCount: e.playlist_count || null,
                artworkUrl: (e.thumbnails && e.thumbnails.length > 0) ? e.thumbnails[e.thumbnails.length - 1].url : "logo.png",
                url: (e.url && e.url.startsWith("http")) ? e.url : `https://www.youtube.com/playlist?list=${e.id}`,
                source: "youtube"
              }));
            combined.push(...ytPlaylists);
          } catch (e) {}
        }
        if (combined.length > 0) {
          searchPlaylistCache.set(cacheKey, { time: Date.now(), results: combined });
        }
        resolve(combined.slice(0, limit));
      }
    );
  });
}

// In-memory cache for full playlist tracks resolver
async function resolvePlaylistTracks(playlistUrlOrId, limit = 50, signal = null) {
  const clean = String(playlistUrlOrId || "").trim();
  const cacheKey = clean.toLowerCase();
  if (playlistTracksCache.has(cacheKey)) {
    const cached = playlistTracksCache.get(cacheKey);
    if (Date.now() - cached.time < 3600000) return cached.data;
  }

  // Case 1: JioSaavn Playlist
  if (clean.startsWith("saavn_pl_") || clean.includes("jiosaavn.com/featured/") || clean.includes("jiosaavn.com/s/playlist/") || clean.includes("jiosaavn.com/playlist/") || /^\d{6,15}$/.test(clean)) {
    const rawParam = clean.replace("saavn_pl_", "").split("/").filter(Boolean).pop();
    try {
      let d = null;
      if (/^\d+$/.test(rawParam)) {
        const url = `https://www.jiosaavn.com/api.php?__call=playlist.getDetails&_format=json&_marker=0&api_version=4&ctx=web6dot0&listid=${encodeURIComponent(rawParam)}`;
        const timeoutSignal = AbortSignal.timeout(4500);
        const res = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal });
        d = await res.json();
      } else {
        // Alpha-numeric token fallback: resolve via webapi.get and extract listid
        const tokenUrl = `https://www.jiosaavn.com/api.php?__call=webapi.get&_format=json&_marker=0&api_version=4&ctx=web6dot0&type=playlist&token=${encodeURIComponent(rawParam)}`;
        const timeoutSignal = AbortSignal.timeout(4500);
        const res = await fetch(tokenUrl, { signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal });
        d = await res.json();
        if (d && d.id && /^\d+$/.test(String(d.id))) {
          try {
            const fullUrl = `https://www.jiosaavn.com/api.php?__call=playlist.getDetails&_format=json&_marker=0&api_version=4&ctx=web6dot0&listid=${encodeURIComponent(d.id)}`;
            const fullRes = await fetch(fullUrl, { signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal });
            const fullD = await fullRes.json();
            if (fullD && Array.isArray(fullD.list) && fullD.list.length > 0) {
              d = fullD;
            }
          } catch (_) {}
        }
      }

      const list = (d && (d.list || d.songs)) || [];
      if (list.length > 0) {
        const tracks = list.slice(0, limit).map(s => {
          const encUrl = s.more_info?.encrypted_media_url;
          const streamUrl = encUrl ? decryptSaavnMediaUrl(encUrl) : null;
          const artwork = (s.image || "").replace("150x150", "500x500");
          const cleanTitle = (s.title || "").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'");
          const artistNames = s.more_info?.artistMap?.primary_artists?.map(a => a.name).join(", ") || s.subtitle || "Artist";
          return {
            id: `saavn_${s.id}`,
            title: cleanTitle,
            artist: artistNames,
            duration: Math.round(parseFloat(s.more_info?.duration || 0) * 1000),
            artworkUrl: artwork || "logo.png",
            streamUrl: streamUrl,
            rawStreamUrl: streamUrl,
            url: s.perma_url || `https://www.jiosaavn.com/song/${s.id}`,
            source: "jiosaavn"
          };
        });
        const result = {
          id: `saavn_pl_${d.id || rawParam}`,
          title: (d.title || "JioSaavn Playlist").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'"),
          description: d.header_desc || d.subtitle || "Featured Playlist",
          author: d.more_info?.firstname || d.subtitle || "JioSaavn",
          artworkUrl: (d.image || "").replace("150x150", "500x500") || "logo.png",
          tracks: tracks
        };
        playlistTracksCache.set(cacheKey, { time: Date.now(), data: result });
        return result;
      }
    } catch (e) {}
  }

  // Case 2: JioSaavn Album
  if (clean.startsWith("saavn_alb_") || clean.includes("jiosaavn.com/album/")) {
    const albParam = clean.replace("saavn_alb_", "").split("/").filter(Boolean).pop();
    try {
      let d = null;
      if (/^\d+$/.test(albParam)) {
        const url = `https://www.jiosaavn.com/api.php?__call=content.getAlbumDetails&_format=json&_marker=0&api_version=4&ctx=web6dot0&albumid=${encodeURIComponent(albParam)}`;
        const timeoutSignal = AbortSignal.timeout(4500);
        const res = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal });
        d = await res.json();
      } else {
        const tokenUrl = `https://www.jiosaavn.com/api.php?__call=webapi.get&_format=json&_marker=0&api_version=4&ctx=web6dot0&type=album&token=${encodeURIComponent(albParam)}`;
        const timeoutSignal = AbortSignal.timeout(4500);
        const res = await fetch(tokenUrl, { signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal });
        d = await res.json();
        if (d && d.id && /^\d+$/.test(String(d.id))) {
          try {
            const fullUrl = `https://www.jiosaavn.com/api.php?__call=content.getAlbumDetails&_format=json&_marker=0&api_version=4&ctx=web6dot0&albumid=${encodeURIComponent(d.id)}`;
            const fullRes = await fetch(fullUrl, { signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal });
            const fullD = await fullRes.json();
            if (fullD && (Array.isArray(fullD.list) || Array.isArray(fullD.songs))) {
              d = fullD;
            }
          } catch (_) {}
        }
      }

      const list = (d && (d.list || d.songs)) || [];
      if (list.length > 0) {
        const tracks = list.slice(0, limit).map(s => {
          const encUrl = s.more_info?.encrypted_media_url;
          const streamUrl = encUrl ? decryptSaavnMediaUrl(encUrl) : null;
          const artwork = (s.image || "").replace("150x150", "500x500");
          const cleanTitle = (s.title || "").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'");
          const artistNames = s.more_info?.artistMap?.primary_artists?.map(a => a.name).join(", ") || s.subtitle || s.artist || "Artist";
          return {
            id: `saavn_${s.id}`,
            title: cleanTitle,
            artist: artistNames,
            duration: Math.round(parseFloat(s.more_info?.duration || 0) * 1000),
            artworkUrl: artwork || "logo.png",
            streamUrl: streamUrl,
            rawStreamUrl: streamUrl,
            url: s.perma_url || `https://www.jiosaavn.com/song/${s.id}`,
            source: "jiosaavn"
          };
        });
        const result = {
          id: `saavn_alb_${d.id || albParam}`,
          title: (d.title || "Album").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'"),
          description: d.header_desc || d.subtitle || "Album",
          author: d.artist || d.more_info?.artist_name?.join(", ") || "Artist",
          artworkUrl: (d.image || "").replace("150x150", "500x500") || "logo.png",
          tracks: tracks
        };
        playlistTracksCache.set(cacheKey, { time: Date.now(), data: result });
        return result;
      }
    } catch (e) {}
  }

  // Case 3A: Direct Spotify Playlist / Album / Track Link
  if (isSpotifyUrl(clean) || (clean.startsWith("http") && clean.includes("spotify.com"))) {
    try {
      if (signal?.aborted) return null;
      const spData = await resolveSpotifyLink(clean);
      if (spData && spData.tracks && spData.tracks.length > 0) {
        const result = {
          id: spData.id,
          title: spData.title,
          description: spData.description,
          author: spData.author,
          artworkUrl: spData.artworkUrl,
          tracks: spData.tracks,
          trackCount: spData.trackCount
        };
        playlistTracksCache.set(cacheKey, { time: Date.now(), data: result });
        return result;
      }
    } catch (e) {}
  }

  // Case 3B: Spotify Curated Playlist Match
  if (clean.startsWith("spotify:playlist:") || clean.startsWith("spotify_") || clean.startsWith("spotify-")) {
    const plId = clean.replace("spotify:playlist:", "").replace("spotify_", "").replace("spotify-", "");
    const trending = spotifyTrending.getTrendingData();
    const found = (trending?.playlists || []).find(p => p.id === plId);
    if (found) {
      const result = {
        id: found.id,
        title: found.name,
        description: found.desc || found.description,
        author: "Spotify Official",
        artworkUrl: found.coverUrl || "logo.png",
        tracks: (found.tracks || []).map(t => ({
          title: t.title,
          artist: t.artist,
          duration: t.durationMs || 210000,
          url: `https://www.youtube.com/results?search_query=${encodeURIComponent(`${t.title} ${t.artist}`)}`,
          artworkUrl: t.artworkUrl || found.coverUrl || "logo.png"
        })),
        trackCount: found.tracks ? found.tracks.length : 0
      };
      playlistTracksCache.set(cacheKey, { time: Date.now(), data: result });
      return result;
    }
  }

  // Case 4: YouTube Playlist via Lavalink or yt-dlp
  const ytPlaylistId = extractYouTubePlaylistId(clean);
  let url = clean;
  if (ytPlaylistId) {
    url = `https://www.youtube.com/playlist?list=${ytPlaylistId}`;
  } else if (!clean.startsWith("http")) {
    url = `https://www.youtube.com/playlist?list=${clean}`;
  }

  return new Promise((resolve) => {
    executeYtDlp(
      [
        "--flat-playlist",
        "-J",
        "--no-warnings",
        "--yes-playlist",
        "--extractor-args", "youtube:player_client=ios,android,web",
        "--playlist-end", String(Math.max(limit, 1000)),
        url
      ],
      { timeout: 35000, maxBuffer: 50 * 1024 * 1024, signal },
      (err, stdout) => {
        if (err || !stdout) return resolve(null);
        try {
          const data = JSON.parse(stdout);
          const entries = (data.entries || []).filter(e => e && e.title && e.title !== "[Deleted video]" && e.title !== "[Private video]" && !e.id?.startsWith("UC"));
          const isPlaylistIslamic = isIslamicText(data.title || "") || isIslamicText(data.description || "") || isIslamicText(data.uploader || "") || entries.some(e => isIslamicText(e?.title || ""));
          const tracks = entries.map((e, idx) => {
            const author = e.uploader || e.channel || data.title || "YouTube";
            const duration = Math.round((e.duration || 0) * 1000) || 180000;
            const videoId = e.id || (e.url ? (e.url.match(/[?&]v=([a-zA-Z0-9_-]{11})/i) || [])[1] : null);
            const videoUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : ((e.url && e.url.startsWith("http")) ? e.url.split("&list=")[0].split("?list=")[0] : null);
            const isItemIslamic = isPlaylistIslamic || isIslamicText(e.title || "");

            return {
              id: videoId ? `yt-${videoId}` : `yt_${idx}`,
              title: e.title,
              artist: author,
              author: author,
              duration: duration,
              durationMs: duration,
              artworkUrl: (e.thumbnails && e.thumbnails.length > 0) ? e.thumbnails[e.thumbnails.length - 1].url : (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : "logo.png"),
              url: videoUrl,
              query: videoUrl || `${e.title} ${author}`.trim(),
              streamUrl: null,
              rawStreamUrl: null,
              source: "youtube",
              filterMode: isItemIslamic ? "strict" : "filterless"
            };
          });
          const pl = {
            id: data.id || ytPlaylistId || `yt_${Date.now()}`,
            name: data.title || (isPlaylistIslamic ? "Holy Quran Recitation" : "YouTube Playlist"),
            title: data.title || (isPlaylistIslamic ? "Holy Quran Recitation" : "YouTube Playlist"),
            author: isPlaylistIslamic ? "Mishary Rashid Alafasy" : (data.uploader || data.channel || "YouTube"),
            description: data.description || `Playlist with ${tracks.length} tracks`,
            artworkUrl: (data.thumbnails && data.thumbnails.length > 0) ? data.thumbnails[data.thumbnails.length - 1].url : (tracks[0]?.artworkUrl || "logo.png"),
            coverUrl: (data.thumbnails && data.thumbnails.length > 0) ? data.thumbnails[data.thumbnails.length - 1].url : (tracks[0]?.artworkUrl || "logo.png"),
            tracks: tracks,
            trackCount: tracks.length,
            filterMode: isPlaylistIslamic ? "strict" : "filterless"
          };
          if (tracks.length > 0) {
            playlistTracksCache.set(cacheKey, { time: Date.now(), data: pl });
          }
          resolve(pl);
        } catch (e) {
          resolve(null);
        }
      }
    );
  });
}

const resolvePlaylistDetails = resolvePlaylistTracks;


// ==========================================================================
// RESILIENT MULTI-SOURCE AUDIO STREAM EXTRACTOR
// ==========================================================================
async function extractYouTubeStream(queryOrUrl, signal = null) {
  if (signal?.aborted) return null;
  const cleanKey = (queryOrUrl || "").trim().toLowerCase();
  if (directStreamCache.has(cleanKey)) {
    const cached = directStreamCache.get(cleanKey);
    if (Date.now() - cached.time < 14400000) { // 4 hour cache
      return cached.data;
    }
  }

  let streamMeta = null;
  let target = (queryOrUrl || "").trim();
  let isUrl = target.startsWith("http://") || target.startsWith("https://");

  // Fast Path 0.5: Surah / Quran Direct CDN (Instant <10ms High-Fidelity Audio for text queries only, NOT YouTube URLs)
  if (!isUrl) {
    const directSurah = resolveSurahInfo(target);
    if (directSurah) {
      const padded = String(directSurah.number).padStart(3, "0");
      const quranUrl = `https://download.quranicaudio.com/quran/mishari_rashid_al_3afasy/${padded}.mp3`;
      const data = {
        title: `Surah ${directSurah.number}: ${directSurah.name}`,
        author: "Mishary Rashid Alafasy",
        duration: directSurah.number === 2 ? 7200000 : 300000,
        streamUrl: quranUrl,
        rawStreamUrl: quranUrl,
        artworkUrl: "logo.png",
        filterMode: "strict",
        source: "quran"
      };
      directStreamCache.set(cleanKey, { time: Date.now(), data });
      return data;
    }
  }

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

  // Fast Path 1.5: Spotify URL normalization (yt-dlp does not support open.spotify.com)
  if (isSpotifyUrl(target) || (isUrl && target.includes("spotify.com"))) {
    try {
      const spData = await resolveSpotifyLink(target);
      if (spData && spData.tracks && spData.tracks.length > 0) {
        const first = spData.tracks[0];
        target = first.query || `${first.title} ${first.artist}`.trim();
      }
    } catch (_) {}
    isUrl = target.startsWith("http://") || target.startsWith("https://");
  }

  // Fast Path 2: Instant YouTube oEmbed metadata extraction (<100ms) for high-accuracy title & author
  if (isUrl && (target.includes("youtube.com") || target.includes("youtu.be"))) {
    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(target)}&format=json`;
      const oeRes = await fetch(oembedUrl, { signal: AbortSignal.timeout(3000) });
      if (oeRes.ok) {
        const oeData = await oeRes.json();
        if (oeData && oeData.title) {
          const ytTitle = (oeData.title || "").trim();
          const ytAuthor = (oeData.author_name || "").replace(/ - Topic$/i, "").trim();

          streamMeta = {
            title: ytTitle,
            author: ytAuthor,
            duration: 0,
            artworkUrl: oeData.thumbnail_url
          };
        }
      }
    } catch (e) {}
  }

  if (signal?.aborted) return null;

  // Fast Path 4: Single-step yt-dlp android extraction
  if (!isUrl) {
    const cachedSearch = searchCache.get(target.toLowerCase());
    if (cachedSearch && Array.isArray(cachedSearch.results) && cachedSearch.results.length > 0) {
      streamMeta = cachedSearch.results[0];
      target = streamMeta.url || `https://www.youtube.com/watch?v=${streamMeta.id}`;
    } else {
      target = `ytsearch1:${target}`;
    }
  }

  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(null);
    executeYtDlp(
      ["-g", "--get-title", "--get-duration", "-f", "ba[ext=webm]/251/ba[ext=m4a]/140/ba/18/b/best", "--no-playlist", "--no-warnings", "--extractor-args", "youtube:player_client=ios,android,web", target],
      { timeout: 15000, signal },
      async (err, stdout) => {
        if (signal?.aborted) return resolve(null);
        if (!err && stdout && stdout.trim()) {
          const lines = stdout.trim().split("\n").map(l => l.trim()).filter(Boolean);
          let directUrl = null;
          let detectedDuration = 0;
          let detectedTitle = null;

          for (const line of lines) {
            if (line.startsWith("http://") || line.startsWith("https://")) {
              directUrl = line;
            } else if (/^(\d+:)?\d+:\d+$/.test(line)) {
              const parts = line.split(":").map(p => parseInt(p, 10));
              if (parts.length === 2) {
                detectedDuration = (parts[0] * 60 + parts[1]) * 1000;
              } else if (parts.length === 3) {
                detectedDuration = (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
              }
            } else if (/^\d+(\.\d+)?$/.test(line)) {
              detectedDuration = Math.round(parseFloat(line) * 1000);
            } else if (!detectedTitle) {
              detectedTitle = line;
            }
          }

          if (directUrl) {
            const vMatch = target.match(/[?&]v=([a-zA-Z0-9_-]{11})/i) || target.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/i);
            const derivedThumb = (vMatch && vMatch[1]) ? `https://i.ytimg.com/vi/${vMatch[1]}/hqdefault.jpg` : null;
            const data = {
              title: streamMeta?.title || detectedTitle || "YouTube Audio",
              author: streamMeta?.author || "YouTube Music",
              duration: detectedDuration || streamMeta?.duration || 0,
              streamUrl: directUrl,
              artworkUrl: streamMeta?.artworkUrl || derivedThumb || "logo.png"
            };
            directStreamCache.set(cleanKey, { time: Date.now(), data });
            if (target && target.startsWith("http")) {
              directStreamCache.set(target.toLowerCase(), { time: Date.now(), data });
            }
            return resolve(data);
          }
        }

        if (signal?.aborted) return resolve(null);
        // Only fallback to JioSaavn if target was a plain text search query AND not an Islamic or Surah query.
        // Direct YouTube URLs and Islamic tracks should NEVER be substituted with an unrelated secular music cut.
        const isSearchIslamic = isIslamicQuery(queryOrUrl) || isIslamicText(streamMeta?.title || "") || Boolean(resolveSurahInfo(queryOrUrl) || resolveSurahInfo(streamMeta?.title || ""));
        if (!isUrl && !isSearchIslamic) {
          const searchQuery = streamMeta?.title || queryOrUrl.replace(/^https?:\/\/[^\s]+/i, "").trim() || queryOrUrl;
          if (searchQuery && searchQuery.length > 1) {
            try {
              const saavnFallback = await searchJioSaavn(searchQuery, 3, signal);
              if (signal?.aborted) return resolve(null);
              const relevantSaavn = (saavnFallback || []).find(r => r && r.streamUrl && isJioSaavnResultRelevant(searchQuery, r.title, streamMeta?.title || "", streamMeta?.author || ""));
              if (relevantSaavn) {
                const data = {
                  title: streamMeta?.title || relevantSaavn.title,
                  author: streamMeta?.author || relevantSaavn.author,
                  duration: streamMeta?.duration || relevantSaavn.duration,
                  streamUrl: relevantSaavn.streamUrl,
                  artworkUrl: streamMeta?.artworkUrl || relevantSaavn.artworkUrl
                };
                directStreamCache.set(cleanKey, { time: Date.now(), data });
                return resolve(data);
              }
            } catch (e) {}
          }
        }

        if (signal?.aborted) return resolve(null);
        // Final Fallback: full JSON metadata extraction with yt-dlp
        executeYtDlp(
          ["-j", "-f", "ba[ext=webm]/251/ba[ext=m4a]/140/ba/18/b/best", "--no-playlist", "--no-warnings", "--extractor-args", "youtube:player_client=ios,android,web", target],
          { maxBuffer: 15 * 1024 * 1024, timeout: 15000, signal },
          (err2, stdout2) => {
            if (signal?.aborted) return resolve(null);
            if (err2 || !stdout2) return resolve(null);
            try {
              const info = JSON.parse(stdout2.trim().split("\n")[0]);
              if (info && info.url) {
                const vMatch = target.match(/[?&]v=([a-zA-Z0-9_-]{11})/i) || target.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/i);
                const derivedThumb = (vMatch && vMatch[1]) ? `https://i.ytimg.com/vi/${vMatch[1]}/hqdefault.jpg` : null;
                const data = {
                  title: streamMeta?.title || info.title || "YouTube Audio",
                  author: streamMeta?.author || info.uploader || info.channel || "YouTube",
                  duration: Math.round((info.duration || 0) * 1000) || streamMeta?.duration || 0,
                  streamUrl: info.url,
                  artworkUrl: streamMeta?.artworkUrl || info.thumbnail || derivedThumb || "logo.png"
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
async function resolveMediaTrack(queryOrUrl, forcedFilterMode = null, signal = null, expectedTitle = "", expectedArtist = "") {
  if (signal?.aborted) return null;
  let query = (queryOrUrl || "").trim();
  let filterMode = forcedFilterMode || "filterless";
  const isExplicitYt = Boolean(query && (query.includes("youtube.com/watch") || query.includes("youtu.be/") || query.includes("youtube.com/shorts/")));

  // Direct YouTube URL: Always extract the exact YouTube video requested!
  if (isExplicitYt) {
    try {
      if (signal?.aborted) return null;
      const streamInfo = await extractYouTubeStream(query, signal);
      if (streamInfo && streamInfo.streamUrl) {
        return {
          title: streamInfo.title || expectedTitle || "YouTube Audio",
          author: streamInfo.author || expectedArtist || "YouTube",
          duration: streamInfo.duration || 0,
          streamUrl: streamInfo.streamUrl,
          rawStreamUrl: streamInfo.streamUrl,
          artworkUrl: streamInfo.artworkUrl || "logo.png",
          filterMode: isIslamicText(expectedTitle) ? "strict" : filterMode,
          source: "youtube"
        };
      }
    } catch (err) {
      console.warn("Direct YouTube stream extraction error in resolveMediaTrack:", err.message);
    }
  }

  // Check Surah query by number, name, or title (for non-YouTube queries)
  const surahInfo = resolveSurahInfo(query) || (!isExplicitYt ? resolveSurahInfo(expectedTitle) : null);
  if (surahInfo) {
    const sNum = surahInfo.number;
    const padded = String(sNum).padStart(3, "0");
    const sName = surahInfo.name;
    let reciter = "Mishary Rashid Alafasy";
    let quranUrl = `https://download.quranicaudio.com/quran/mishari_rashid_al_3afasy/${padded}.mp3`;
    const checkText = `${query} ${expectedTitle} ${expectedArtist}`.toLowerCase();
    if (checkText.includes("sudais") || checkText.includes("abdurrahmaan")) {
      reciter = "Abdurrahman As-Sudais";
      quranUrl = `https://download.quranicaudio.com/quran/abdurrahmaan_as-sudays/${padded}.mp3`;
    } else if (checkText.includes("abdul basit") || checkText.includes("abdus samad") || checkText.includes("abdulbasit")) {
      reciter = "Abdul Basit Abdus Samad";
      quranUrl = `https://download.quranicaudio.com/quran/abdulbaset_mujawwad/${padded}.mp3`;
    } else if (checkText.includes("ghamdi") || checkText.includes("saad al ghamdi")) {
      reciter = "Saad Al-Ghamdi";
      quranUrl = `https://download.quranicaudio.com/quran/sa3d_al-ghaamidi/complete/${padded}.mp3`;
    } else if (checkText.includes("muaiqly") || checkText.includes("maher")) {
      reciter = "Maher Al-Muaiqly";
      quranUrl = `https://download.quranicaudio.com/quran/maher_almu3aiqly/year1440/${padded}.mp3`;
    } else if (checkText.includes("minshawi")) {
      reciter = "Mohamed Siddiq Al-Minshawi";
      quranUrl = `https://download.quranicaudio.com/quran/muhammad_siddeeq_al-menshaawi/${padded}.mp3`;
    } else if (checkText.includes("hussary") || checkText.includes("husary")) {
      reciter = "Mahmoud Khalil Al-Hussary";
      quranUrl = `https://download.quranicaudio.com/quran/mahmood_khaleel_al-husaree_dour/${padded}.mp3`;
    }
    return {
      title: `Surah ${sNum}: ${sName}`,
      author: reciter,
      duration: sNum === 2 ? 7200000 : 300000,
      streamUrl: quranUrl,
      rawStreamUrl: quranUrl,
      artworkUrl: "logo.png",
      filterMode: "strict",
      source: "quran"
    };
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

  // Spotify Link Resolution (Extract single track or first track of playlist/album)
  const spotifyUrl = extractSpotifyUrl(query);
  if (spotifyUrl) {
    try {
      const spData = await resolveSpotifyLink(spotifyUrl);
      if (spData && spData.tracks && spData.tracks.length > 0) {
        let chosenIdx = 0;
        const indexMatch = query.match(/[?&]index=(\d+)/i);
        if (indexMatch && indexMatch[1]) {
          const parsed = parseInt(indexMatch[1], 10) - 1;
          if (parsed >= 0 && parsed < spData.tracks.length) chosenIdx = parsed;
        }
        const spTrackMatch = query.match(/\/track\/([a-zA-Z0-9]+)/i) || query.match(/spotify:track:([a-zA-Z0-9]+)/i);
        if (spTrackMatch && spTrackMatch[1]) {
          const fIdx = spData.tracks.findIndex(t => (t.url && t.url.includes(spTrackMatch[1])) || (t.id && t.id.includes(spTrackMatch[1])));
          if (fIdx >= 0) chosenIdx = fIdx;
        }
        if (expectedTitle) {
          const cleanExp = expectedTitle.toLowerCase().trim();
          const fIdx = spData.tracks.findIndex(t => t.title && t.title.toLowerCase().includes(cleanExp));
          if (fIdx >= 0) chosenIdx = fIdx;
        }

        for (let i = chosenIdx; i < Math.min(spData.tracks.length, chosenIdx + 5); i++) {
          const topTrack = spData.tracks[i];
          const searchQ = topTrack.query || `${topTrack.title} ${topTrack.artist}`.trim();
          const saavnMatch = await searchJioSaavn(searchQ, 3, signal);
          const relevantSpotifyMatch = (saavnMatch || []).find(r => r && r.streamUrl && isJioSaavnResultRelevant(searchQ, r.title, topTrack.title, topTrack.artist));
          if (relevantSpotifyMatch && relevantSpotifyMatch.streamUrl) {
            return {
              title: topTrack.title || relevantSpotifyMatch.title,
              author: topTrack.artist || relevantSpotifyMatch.author,
              duration: topTrack.duration || relevantSpotifyMatch.duration,
              streamUrl: relevantSpotifyMatch.streamUrl,
              rawStreamUrl: relevantSpotifyMatch.streamUrl,
              artworkUrl: topTrack.artworkUrl || relevantSpotifyMatch.artworkUrl || "logo.png",
              filterMode
            };
          }
        }
        const targetTrack = spData.tracks[chosenIdx] || spData.tracks[0];
        query = targetTrack.query || `${targetTrack.title} ${targetTrack.artist}`.trim();
      }
    } catch (e) {}
    if (isSpotifyUrl(query) || (query.startsWith("http") && query.includes("spotify.com"))) {
      if (expectedTitle) {
        query = expectedArtist ? `${expectedTitle} ${expectedArtist}`.trim() : expectedTitle.trim();
      }
    }
  }

  // Fast Path 1: Check JioSaavn first for secular tracks (<100ms instant 320kbps CD-quality audio)
  const isTargetIslamic = isIslamicQuery(query) || isIslamicText(expectedTitle) || Boolean(surahInfo) || filterMode === "strict";
  if (!isTargetIslamic && !query.startsWith("http://") && !query.startsWith("https://")) {
    try {
      if (signal?.aborted) return null;
      const saavnResults = await searchJioSaavn(query, 5, signal);
      if (signal?.aborted) return null;
      const relevantMatch = (saavnResults || []).find(r => r && r.streamUrl && isJioSaavnResultRelevant(query, r.title, expectedTitle, expectedArtist));
      if (relevantMatch && relevantMatch.streamUrl) {
        return {
          title: relevantMatch.title,
          author: relevantMatch.author,
          duration: relevantMatch.duration,
          streamUrl: relevantMatch.streamUrl,
          rawStreamUrl: relevantMatch.streamUrl,
          artworkUrl: relevantMatch.artworkUrl,
          filterMode
        };
      }
    } catch (e) {}
  }

  // Fast Path 2: Resilient yt-dlp direct stream extractor
  try {
    if (signal?.aborted) return null;
    const streamInfo = await extractYouTubeStream(query, signal);
    if (signal?.aborted) return null;
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
    if (signal?.aborted) return null;
    console.error("resolveMediaTrack error:", err.message);
  }
  return null;
}

// ==========================================================================
// SPOTIFY INFINITE RADIO & AUTOPLAY GENERATION ENGINE
// ==========================================================================
async function generateRadioStation(seedTitle, seedArtist, filterMode = "filterless", limit = 15, signal = null, channel = "browser") {
  if (signal?.aborted) return [];
  const normTitle = (seedTitle || "").trim().toLowerCase();
  const normArtist = (seedArtist || "").trim();

  // 1. Quran Surah Progressive Recitation Radio
  const seedSurah = resolveSurahInfo(seedTitle);
  if (seedSurah || normTitle.includes("surah")) {
    const startNum = seedSurah ? seedSurah.number : ((normTitle.match(/surah\s*(\d+)/i) ? parseInt(normTitle.match(/surah\s*(\d+)/i)[1], 10) : 1));
    const radio = [];
    for (let i = 1; i <= limit; i++) {
      const nextNum = ((startNum - 1 + i) % 114) + 1;
      const padded = String(nextNum).padStart(3, "0");
      const name = SURAH_NAMES[nextNum] || `Surah ${nextNum}`;
      const quranUrl = `https://download.quranicaudio.com/quran/mishaari_raashid_al_3afaasee/${padded}.mp3`;
      radio.push({
        id: `quran_surah_${nextNum}`,
        title: `Surah ${nextNum}: ${name}`,
        author: normArtist || "Mishary Rashid Alafasy",
        duration: 180000,
        artworkUrl: "logo.png",
        streamUrl: quranUrl,
        rawStreamUrl: quranUrl,
        proxyStreamUrl: `/api/stream-audio?channel=${encodeURIComponent(channel)}&url=${encodeURIComponent(quranUrl)}`,
        source: "quran",
        isRadio: true,
        radioSeed: seedTitle
      });
    }
    return radio;
  }

  // 2. Music Radio via Multi-Query JioSaavn Engine (Guaranteed 320kbps CD-Quality Streams)
  const isGenericArtist = !normArtist || /^(youtube music|trending music|music artist|artist|unknown|various artists|cyberspy 404)$/i.test(normArtist);
  const primaryArtist = isGenericArtist ? "" : normArtist.split(/[,&x/]|feat\.|ft\./i)[0].trim();
  const cleanTitle = (seedTitle || "").replace(/\(.*?\)|\[.*?\]/g, "").replace(/^track\s*\d+/i, "").trim();
  const normalizedSeed = cleanTitle.toLowerCase().replace(/[^a-z0-9]/g, "");

  const searchQueries = [];
  if (primaryArtist) {
    searchQueries.push(primaryArtist); // Artist top catalog
    if (cleanTitle) searchQueries.push(`${cleanTitle} ${primaryArtist}`);
    searchQueries.push(`${primaryArtist} hits`);
  } else if (cleanTitle) {
    searchQueries.push(cleanTitle);
    searchQueries.push(`${cleanTitle} song`);
    searchQueries.push(`${cleanTitle} hits`);
  } else {
    searchQueries.push("Top Trending Songs");
  }

  const searchPromises = searchQueries.map(q => searchJioSaavn(q, Math.min(limit, 12), signal).catch(() => []));
  const queryResults = await Promise.all(searchPromises);

  if (signal?.aborted) return [];

  const rawList = queryResults.flat();
  const seen = new Set();
  const tracks = [];

  for (const t of rawList) {
    if (!t || !t.title || !t.streamUrl) continue;
    const tNorm = t.title.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (normalizedSeed && (tNorm.includes(normalizedSeed) || normalizedSeed.includes(tNorm))) continue;
    if (seen.has(tNorm)) continue;
    seen.add(tNorm);

    const validation = validateByFilterMode(filterMode, t);
    if (!validation.allowed) continue;

    tracks.push({
      ...t,
      isRadio: true,
      radioSeed: seedTitle,
      proxyStreamUrl: `/api/stream-audio?channel=${encodeURIComponent(channel)}&url=${encodeURIComponent(t.streamUrl)}`
    });

    if (tracks.length >= limit) break;
  }

  // If still fewer than limit tracks found, broaden search
  if (tracks.length < limit && !signal?.aborted) {
    try {
      const fallbackQuery = primaryArtist ? `${primaryArtist} best` : "Trending Hindi Songs";
      const extraTracks = await searchJioSaavn(fallbackQuery, limit - tracks.length + 5, signal);
      for (const t of extraTracks) {
        if (!t || !t.title || !t.streamUrl) continue;
        const tNorm = t.title.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (seen.has(tNorm)) continue;
        seen.add(tNorm);
        const validation = validateByFilterMode(filterMode, t);
        if (!validation.allowed) continue;
        tracks.push({
          ...t,
          isRadio: true,
          radioSeed: seedTitle,
          proxyStreamUrl: `/api/stream-audio?channel=${encodeURIComponent(channel)}&url=${encodeURIComponent(t.streamUrl)}`
        });
        if (tracks.length >= limit) break;
      }
    } catch (e) {}
  }

  return tracks;
}

// ==========================================================================
// TIME-SYNCED KARAOKE LYRICS RESOLVER (SPOTIFY MUSIXMATCH EQUIVALENT)
// ==========================================================================
const lyricsCache = new Map();

async function resolveTrackLyrics(title, artist, duration = 0, signal = null) {
  if (signal?.aborted) return null;
  const cleanTitle = (title || "").replace(/\(.*?\)|\[.*?\]/g, "").trim();
  const cleanArtist = (artist || "").split(/[,&x/]|feat\.|ft\./i)[0].trim();
  const cacheKey = `${cleanTitle.toLowerCase()}_${cleanArtist.toLowerCase()}`;
  if (lyricsCache.has(cacheKey)) {
    return lyricsCache.get(cacheKey);
  }

  // 1. Quran Surah English Translation / Guidance
  if (cleanTitle.toLowerCase().includes("surah")) {
    const match = cleanTitle.match(/surah\s*(\d+)/i);
    const surahNum = match ? parseInt(match[1], 10) : 1;
    const surahName = SURAH_NAMES[surahNum] || `Surah ${surahNum}`;
    const quranData = {
      isQuran: true,
      title: `Surah ${surahNum}: ${surahName}`,
      artist: cleanArtist || "Mishary Rashid Alafasy",
      plainLyrics: `بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ\n\nSurah ${surahNum}: ${surahName}\nRecited by ${cleanArtist || "Mishary Rashid Alafasy"}\n\nListen attentively to the recitation of the Noble Quran.`,
      syncedLyrics: null
    };
    lyricsCache.set(cacheKey, quranData);
    return quranData;
  }

  // 2. Fetch from LRCLIB (Open Source Synced Lyrics API)
  try {
    const durSec = Math.round(duration > 1000 ? duration / 1000 : duration);
    let lrcUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(cleanArtist)}`;
    if (durSec > 10) lrcUrl += `&duration=${durSec}`;

    const res = await fetch(lrcUrl, {
      headers: { "User-Agent": "TrackFinder/4.6 (https://track-finder.onrender.com)" },
      signal: signal || AbortSignal.timeout(6000)
    });
    if (res.ok) {
      const data = await res.json();
      if (data && (data.syncedLyrics || data.plainLyrics)) {
        const result = {
          title: data.trackName || title,
          artist: data.artistName || artist,
          syncedLyrics: data.syncedLyrics || null,
          plainLyrics: data.plainLyrics || null,
          instrumental: Boolean(data.instrumental)
        };
        lyricsCache.set(cacheKey, result);
        return result;
      }
    }
  } catch (e) {}

  // 3. Fallback search on LRCLIB
  try {
    const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(`${cleanTitle} ${cleanArtist}`.trim())}`;
    const res = await fetch(searchUrl, {
      headers: { "User-Agent": "TrackFinder/4.6" },
      signal: signal || AbortSignal.timeout(6000)
    });
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list) && list.length > 0) {
        const best = list[0];
        const result = {
          title: best.trackName || title,
          artist: best.artistName || artist,
          syncedLyrics: best.syncedLyrics || null,
          plainLyrics: best.plainLyrics || null,
          instrumental: Boolean(best.instrumental)
        };
        lyricsCache.set(cacheKey, result);
        return result;
      }
    }
  } catch (e) {}

  return null;
}

// User Session Extraction Helper
function getSessionToken(req) {
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
  return token;
}

function getSessionUser(req) {
  const token = getSessionToken(req);
  return token ? userStore.getUserByToken(token) : null;
}

// ==========================================================================
// CLIENT PLATFORM IDENTIFIER (Web App vs Mobile App vs Discord Bot)
// ==========================================================================
function getClientPlatform(req, parsedUrl) {
  // 1. Explicit query parameter (?platform=app|browser|bot or ?channel=app|browser|bot)
  const qPlatform = parsedUrl?.searchParams?.get("platform") || parsedUrl?.searchParams?.get("channel");
  if (qPlatform === "app" || qPlatform === "mobile") return "app";
  if (qPlatform === "bot") return "bot";
  if (qPlatform === "browser" || qPlatform === "web") return "browser";

  // 2. Custom headers (X-Client-Platform or X-Target-Channel)
  const headerPlatform = (req.headers["x-client-platform"] || req.headers["x-target-channel"] || "").toLowerCase();
  if (headerPlatform.includes("mobile") || headerPlatform.includes("app") || headerPlatform.includes("android") || headerPlatform.includes("capacitor")) return "app";
  if (headerPlatform.includes("bot") || headerPlatform.includes("discord")) return "bot";
  if (headerPlatform.includes("web") || headerPlatform.includes("browser")) return "browser";

  // 3. Dedicated sub-path (/api/mobile/..., /api/web/..., /api/bot/...)
  const p = parsedUrl?.pathname || "";
  if (p.startsWith("/api/mobile/") || p.startsWith("/mobile/")) return "app";
  if (p.startsWith("/api/bot/") || p.startsWith("/bot/")) return "bot";
  if (p.startsWith("/api/web/") || p.startsWith("/web/")) return "browser";

  // 4. User-Agent / Capacitor heuristics
  const ua = (req.headers["user-agent"] || "").toLowerCase();
  if (ua.includes("capacitor") || ua.includes("wv") || (ua.includes("android") && ua.includes("version/"))) {
    return "app";
  }

  return "browser";
}

// ==========================================================================
// IP REQUEST REGULATOR (SEPARATED PER CLIENT PLATFORM)
// ==========================================================================
const inFlightRequests = new Map(); // slotKey -> { id, clientIp, platform, slotKey, category, req, res, abortController, createdAt }
const ipInFlightSlots = new Map();  // ipPlatformKey -> Set<slotKey>
let requestCounter = 0;

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded && typeof forwarded === "string") {
    const first = forwarded.split(",")[0].trim();
    if (first) return first;
  }
  const realIp = req.headers["x-real-ip"];
  if (realIp && typeof realIp === "string" && realIp.trim()) {
    return realIp.trim();
  }
  return req.socket?.remoteAddress || "127.0.0.1";
}

function getRequestCategory(pathname, parsedUrl) {
  if (pathname.includes("/search")) return "search";
  if (pathname.includes("/resolve-track") || pathname.includes("/resolve")) return "resolve";
  if (pathname.includes("/radio")) return "radio";
  if (pathname.includes("/stream-audio") || pathname.includes("/stream")) {
    const channel = parsedUrl.searchParams.get("channel") || "browser";
    return `stream:${channel}`;
  }
  if (pathname.includes("/action")) return "action";
  if (pathname.includes("/state")) return "state";
  if (pathname.startsWith("/api/user/")) return "user";
  if (pathname.startsWith("/api/auth/")) return "auth";
  if (pathname.startsWith("/api/spotify-")) return "spotify";
  if (pathname.startsWith("/api/playlist-")) return "playlist";
  if (pathname.startsWith("/api/")) return `api:${pathname.slice(5)}`;
  return "static";
}

function dropInFlightRequest(entry, reason) {
  if (!entry) return;
  try {
    // 1. Abort any associated child processes (yt-dlp) or network fetch signals
    if (entry.abortController && !entry.abortController.signal.aborted) {
      entry.abortController.abort();
    }

    // 2. End HTTP response if not already sent
    if (!entry.res.headersSent) {
      entry.res.writeHead(499, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "X-Dropped-Reason": reason
      });
      entry.res.end(JSON.stringify({
        success: false,
        dropped: true,
        error: `Request dropped: ${reason}`
      }));
    } else {
      entry.res.destroy();
    }
  } catch (err) {
    // Ignore socket termination errors
  }
}

function registerIncomingRequest(req, res, pathname, parsedUrl) {
  if (req.method === "OPTIONS") {
    return { abortController: null };
  }

  const category = getRequestCategory(pathname, parsedUrl);
  // Static assets (CSS, JS, images, icons, HTML) load in parallel and must never drop
  if (category === "static") {
    return { abortController: null };
  }

  const clientIp = getClientIp(req);
  const platform = getClientPlatform(req, parsedUrl);
  const slotKey = `${clientIp}::${platform}::${category}`;
  const reqId = ++requestCounter;
  const abortController = new AbortController();

  // 1. Per-Platform Per-Slot Single-and-Last Policy:
  // Drop any older in-flight request from this IP for this specific platform in the same category
  if (inFlightRequests.has(slotKey)) {
    const prev = inFlightRequests.get(slotKey);
    dropInFlightRequest(prev, "newer request received in platform slot");
  }

  // 2. Heavy Compute Operations Guard (isolated per platform):
  if (category === "search" || category === "resolve") {
    const heavySlotKey = `${clientIp}::${platform}::heavy`;
    if (inFlightRequests.has(heavySlotKey)) {
      const prevHeavy = inFlightRequests.get(heavySlotKey);
      dropInFlightRequest(prevHeavy, "newer heavy compute request received from platform");
    }
  }

  // 3. Platform In-Flight Concurrency Guard Per IP (Max 4 concurrent active API requests per platform)
  const MAX_PER_PLATFORM = 4;
  const platformIpKey = `${clientIp}::${platform}`;
  let activeSlots = ipInFlightSlots.get(platformIpKey);
  if (!activeSlots) {
    activeSlots = new Set();
    ipInFlightSlots.set(platformIpKey, activeSlots);
  }

  if (activeSlots.size >= MAX_PER_PLATFORM) {
    let oldest = null;
    for (const key of activeSlots) {
      const entry = inFlightRequests.get(key);
      if (entry && (!oldest || entry.createdAt < oldest.createdAt)) {
        oldest = entry;
      }
    }
    if (oldest) {
      dropInFlightRequest(oldest, "concurrency limit exceeded for platform, holding single latest");
    }
  }

  // Register current request
  const entry = {
    id: reqId,
    clientIp,
    slotKey,
    category,
    req,
    res,
    abortController,
    createdAt: Date.now()
  };

  inFlightRequests.set(slotKey, entry);
  if (category === "search" || category === "resolve") {
    inFlightRequests.set(`${clientIp}::heavy`, entry);
  }
  activeSlots.add(slotKey);

  // Auto-cleanup on finish or client disconnect
  const cleanup = () => {
    if (inFlightRequests.get(slotKey)?.id === reqId) {
      inFlightRequests.delete(slotKey);
    }
    if (inFlightRequests.get(`${clientIp}::heavy`)?.id === reqId) {
      inFlightRequests.delete(`${clientIp}::heavy`);
    }
    activeSlots.delete(slotKey);
    if (activeSlots.size === 0) {
      ipInFlightSlots.delete(clientIp);
    }
  };

  res.on("finish", cleanup);
  res.on("close", cleanup);

  return { abortController, clientIp, slotKey, category };
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
  const reqOrigin = req.headers.origin;
  res.setHeader("Access-Control-Allow-Origin", reqOrigin || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD, PUT, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range, Authorization, Accept, Origin, X-Requested-With, X-Client-Platform, X-Target-Channel, *");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": reqOrigin || "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS, HEAD, PUT, DELETE",
      "Access-Control-Allow-Headers": "Content-Type, Range, Authorization, Accept, Origin, X-Requested-With, X-Client-Platform, X-Target-Channel, *",
      "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
      "Access-Control-Max-Age": "86400"
    });
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = parsedUrl.pathname;
  if (pathname.length > 1 && pathname.endsWith("/")) {
    pathname = pathname.replace(/\/+$/, "");
  }

  // IP Request Regulation: Hold Single & Last Request Per IP
  const { abortController } = registerIncomingRequest(req, res, pathname, parsedUrl);
  if (abortController?.signal?.aborted || res.headersSent) return;

  // --------------------------------------------------------------------------
  // API: Instant Audio Stream Proxy (Low-Latency TCP Nodelay + Persistent TLS)
  // --------------------------------------------------------------------------
  if (pathname === "/api/stream-audio" || pathname === "/api/web/stream" || pathname === "/api/mobile/stream") {
    const defaultPlatform = pathname === "/api/mobile/stream" ? "app" : (pathname === "/api/web/stream" ? "browser" : getClientPlatform(req, parsedUrl));
    const targetChannel = parsedUrl.searchParams.get("channel") || defaultPlatform;
    const directUrl = parsedUrl.searchParams.get("url");

    let uri = directUrl;
    if (!uri) {
      if (targetChannel === "browser") uri = systemChannels.browser.current?.streamUrl || systemChannels.browser.current?.rawStreamUrl || systemChannels.browser.current?.url;
      else if (targetChannel === "app") uri = systemChannels.app.current?.streamUrl || systemChannels.app.current?.rawStreamUrl || systemChannels.app.current?.url;
    }

    // 1. YouTube Webpage URL: Extract playable audio stream before proxying!
    if (uri && (uri.includes("youtube.com/watch") || uri.includes("youtu.be/") || uri.includes("youtube.com/shorts/"))) {
      try {
        const streamInfo = await extractYouTubeStream(uri, abortController?.signal);
        if (streamInfo && streamInfo.streamUrl && streamInfo.streamUrl.startsWith("http")) {
          uri = streamInfo.streamUrl;
        }
      } catch (e) {
        console.warn("[StreamProxy] YouTube stream extract error:", e.message);
      }
    } else if (!uri || (!uri.startsWith("http://") && !uri.startsWith("https://"))) {
      const curTitle = systemChannels[targetChannel]?.current?.title || "";
      const surahCheck = resolveSurahInfo(curTitle);
      if (surahCheck) {
        const padded = String(surahCheck.number).padStart(3, "0");
        uri = `https://download.quranicaudio.com/quran/mishari_rashid_al_3afasy/${padded}.mp3`;
      }
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
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Range, Authorization, Accept, Origin, X-Requested-With",
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
            if (abortController?.signal) {
              abortController.signal.addEventListener("abort", () => redReq.destroy(), { once: true });
            }
            redReq.end();
            return;
          } catch (e) {}
        }

        const resHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Range, Authorization, Accept, Origin, X-Requested-With",
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
      if (abortController?.signal) {
        abortController.signal.addEventListener("abort", () => proxyReq.destroy(), { once: true });
      }
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
    if (abortController?.signal?.aborted || res.headersSent) return;
    let q = parsedUrl.searchParams.get("q") || "";
    const listParam = parsedUrl.searchParams.get("list");
    if (listParam && !q.includes("list=")) {
      q = q ? (q.includes("?") ? `${q}&list=${listParam}` : `${q}?list=${listParam}`) : `https://www.youtube.com/playlist?list=${listParam}`;
    }
    const filterMode = parsedUrl.searchParams.get("filterMode") || "filterless";
    const defaultPlatform = getClientPlatform(req, parsedUrl);
    const targetChannel = parsedUrl.searchParams.get("channel") || defaultPlatform;
    const forceSaavn = parsedUrl.searchParams.get("forceSaavn") === "true";
    const titleParam = parsedUrl.searchParams.get("title") || "";
    const artistParam = parsedUrl.searchParams.get("artist") || "";

    if (!q) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ success: false, error: "Missing query" }));
    }

    try {
      // 1. Direct Spotify link resolution (tracks or playlists)
      const spotifyUrl = extractSpotifyUrl(q);
      if (spotifyUrl) {
        try {
          const spData = await resolveSpotifyLink(spotifyUrl);
          if (spData && spData.tracks && spData.tracks.length > 0) {
            let chosenIndex = 0;

            // Check if URL specifies index parameter (&index=15)
            const indexMatch = q.match(/[?&]index=(\d+)/i);
            if (indexMatch && indexMatch[1]) {
              const parsedIdx = parseInt(indexMatch[1], 10) - 1;
              if (parsedIdx >= 0 && parsedIdx < spData.tracks.length) {
                chosenIndex = parsedIdx;
              }
            }

            // Check if URL specifies a track ID (open.spotify.com/track/ID or spotify:track:ID)
            const spTrackMatch = q.match(/\/track\/([a-zA-Z0-9]+)/i) || q.match(/spotify:track:([a-zA-Z0-9]+)/i);
            if (spTrackMatch && spTrackMatch[1]) {
              const tId = spTrackMatch[1];
              const fIdx = spData.tracks.findIndex(t => (t.url && t.url.includes(tId)) || (t.id && t.id.includes(tId)));
              if (fIdx >= 0) chosenIndex = fIdx;
            }

            // Check if titleParam / artistParam was provided
            if (titleParam) {
              const cleanTParam = titleParam.toLowerCase().trim();
              const fIdx = spData.tracks.findIndex(t => t.title && t.title.toLowerCase().includes(cleanTParam));
              if (fIdx >= 0) chosenIndex = fIdx;
            }

            let resolvedFirst = null;
            const maxAttempts = Math.min(spData.tracks.length, chosenIndex + 5);
            for (let i = chosenIndex; i < maxAttempts; i++) {
              const cand = spData.tracks[i];
              const candQ = cand.query || `${cand.title} ${cand.artist}`;
              resolvedFirst = await resolveMediaTrack(candQ, filterMode, abortController?.signal, cand.title, cand.artist);
              if (resolvedFirst) {
                chosenIndex = i;
                break;
              }
            }
            if (!resolvedFirst && chosenIndex > 0) {
              for (let i = 0; i < Math.min(chosenIndex, 5); i++) {
                const cand = spData.tracks[i];
                const candQ = cand.query || `${cand.title} ${cand.artist}`;
                resolvedFirst = await resolveMediaTrack(candQ, filterMode, abortController?.signal, cand.title, cand.artist);
                if (resolvedFirst) {
                  chosenIndex = i;
                  break;
                }
              }
            }
            if (resolvedFirst) {
              res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
              return res.end(JSON.stringify({
                success: true,
                channel: targetChannel,
                isPlaylist: spData.type !== "track",
                playlist: spData,
                startIndex: chosenIndex,
                track: {
                  ...resolvedFirst,
                  proxyStreamUrl: `/api/stream-audio?channel=${targetChannel}&url=${encodeURIComponent(resolvedFirst.streamUrl)}`
                }
              }));
            }
          }
        } catch (e) {}
      }

      // 2. Direct YouTube link resolution (Video or Playlist)
      const ytUrl = extractYouTubeUrl(q) || (isYouTubeUrl(q) ? q.trim() : null);
      if (ytUrl) {
        try {
          // Check if URL specifies an individual video ID (watch?v=..., youtu.be/..., shorts/...)
          const vMatch = ytUrl.match(/[?&]v=([a-zA-Z0-9_-]{11})/i) ||
                         ytUrl.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/i) ||
                         ytUrl.match(/\/shorts\/([a-zA-Z0-9_-]{11})/i);
          const hasVideoId = Boolean(vMatch && vMatch[1]);
          const ytPlaylistId = extractYouTubePlaylistId(ytUrl);
          const isYtPlaylist = Boolean(ytPlaylistId || ytUrl.includes("playlist?list=") || ytUrl.includes("&list=") || ytUrl.includes("?list="));

          if (isYtPlaylist) {
            const plData = await resolvePlaylistTracks(ytUrl, 500, abortController?.signal);
            if (plData && plData.tracks && plData.tracks.length > 0) {
              let chosenIndex = 0;
              const indexMatch = ytUrl.match(/[?&]index=(\d+)/i);
              if (indexMatch && indexMatch[1]) {
                const parsedIdx = parseInt(indexMatch[1], 10) - 1;
                if (parsedIdx >= 0 && parsedIdx < plData.tracks.length) {
                  chosenIndex = parsedIdx;
                }
              }

              let foundIdx = -1;
              if (hasVideoId && vMatch[1]) {
                foundIdx = plData.tracks.findIndex(t => t.id === vMatch[1] || (t.url && t.url.includes(vMatch[1])));
                if (foundIdx >= 0) chosenIndex = foundIdx;
              }

              let resolvedFirst = null;

              // If a specific video ID was requested but not found in the playlist tracks (e.g. beyond limit or unlisted track),
              // resolve the specific video directly rather than falling back to Track 0!
              if (hasVideoId && vMatch[1] && foundIdx === -1) {
                try {
                  const directTrack = await resolveMediaTrack(`https://www.youtube.com/watch?v=${vMatch[1]}`, filterMode, abortController?.signal, titleParam, artistParam);
                  if (directTrack) {
                    resolvedFirst = directTrack;
                    plData.tracks.unshift({
                      id: vMatch[1],
                      title: directTrack.title,
                      artist: directTrack.author,
                      author: directTrack.author,
                      duration: directTrack.duration,
                      durationMs: directTrack.duration,
                      streamUrl: directTrack.streamUrl,
                      artworkUrl: directTrack.artworkUrl,
                      url: `https://www.youtube.com/watch?v=${vMatch[1]}`,
                      source: "youtube"
                    });
                    chosenIndex = 0;
                  }
                } catch (e) {}
              }

              if (!resolvedFirst) {
                const maxAttempts = Math.min(plData.tracks.length, chosenIndex + 5);
                for (let i = chosenIndex; i < maxAttempts; i++) {
                  const cand = plData.tracks[i];
                  if (cand.streamUrl && cand.streamUrl.startsWith("http") && !cand.streamUrl.includes("youtube.com/watch")) {
                    resolvedFirst = cand;
                    chosenIndex = i;
                    break;
                  }
                  const candUrl = cand.url || (cand.id ? `https://www.youtube.com/watch?v=${cand.id}` : null);
                  const candQ = candUrl || cand.query || `${cand.title} ${cand.artist}`;
                  resolvedFirst = await resolveMediaTrack(candQ, filterMode, abortController?.signal, cand.title, cand.artist);
                  if (resolvedFirst) {
                    chosenIndex = i;
                    break;
                  }
                }
              }
              if (!resolvedFirst && chosenIndex > 0) {
                for (let i = 0; i < Math.min(chosenIndex, 5); i++) {
                  const cand = plData.tracks[i];
                  if (cand.streamUrl && cand.streamUrl.startsWith("http") && !cand.streamUrl.includes("youtube.com/watch")) {
                    resolvedFirst = cand;
                    chosenIndex = i;
                    break;
                  }
                  const candUrl = cand.url || (cand.id ? `https://www.youtube.com/watch?v=${cand.id}` : null);
                  const candQ = candUrl || cand.query || `${cand.title} ${cand.artist}`;
                  resolvedFirst = await resolveMediaTrack(candQ, filterMode, abortController?.signal, cand.title, cand.artist);
                  if (resolvedFirst) {
                    chosenIndex = i;
                    break;
                  }
                }
              }
              if (!resolvedFirst && plData.tracks.length > 0) {
                const cand = plData.tracks[chosenIndex] || plData.tracks[0];
                const candUrl = cand.url || (cand.id ? `https://www.youtube.com/watch?v=${cand.id}` : null);
                const candThumb = cand.id ? `https://i.ytimg.com/vi/${cand.id}/hqdefault.jpg` : null;
                resolvedFirst = {
                  id: cand.id,
                  title: cand.title,
                  author: cand.artist || cand.author || "YouTube",
                  artist: cand.artist || cand.author || "YouTube",
                  duration: cand.duration || 180000,
                  streamUrl: candUrl || ytUrl,
                  artworkUrl: cand.artworkUrl || candThumb || plData.artworkUrl || "logo.png",
                  source: "youtube"
                };
              }

              if (resolvedFirst) {
                res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
                return res.end(JSON.stringify({
                  success: true,
                  channel: targetChannel,
                  isPlaylist: true,
                  playlist: plData,
                  startIndex: chosenIndex,
                  track: {
                    ...resolvedFirst,
                    proxyStreamUrl: resolvedFirst.streamUrl ? `/api/stream-audio?channel=${targetChannel}&url=${encodeURIComponent(resolvedFirst.streamUrl)}` : null
                  }
                }));
              }
            }
          }

          // Single video track: use canonical video URL to avoid parameter contamination
          const singleTrackTarget = (hasVideoId && vMatch[1]) ? `https://www.youtube.com/watch?v=${vMatch[1]}` : ytUrl;
          const ytTrack = await resolveMediaTrack(singleTrackTarget, filterMode, abortController?.signal, titleParam, artistParam);
          if (ytTrack) {
            const shouldSet = parsedUrl.searchParams.get("set") === "true";
            if (shouldSet && systemChannels[targetChannel]) {
              systemChannels[targetChannel].current = ytTrack;
              systemChannels[targetChannel].isPlaying = true;
              systemChannels[targetChannel].isPaused = false;
              systemChannels[targetChannel].position = 0;
              if (ytTrack.duration) systemChannels[targetChannel].duration = ytTrack.duration;
            }
            res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
            return res.end(JSON.stringify({
              success: true,
              channel: targetChannel,
              track: {
                ...ytTrack,
                proxyStreamUrl: `/api/stream-audio?channel=${targetChannel}&url=${encodeURIComponent(ytTrack.streamUrl)}`
              }
            }));
          }
        } catch (ytErr) {
          console.warn("[ResolveTrack] YouTube direct resolve error:", ytErr.message);
        }
      }

      // 3. Fast JioSaavn Check (<100ms instant 320kbps CD-quality audio) with relevance verification (Secular music only)
      const isQIslamic = isIslamicQuery(q) || isIslamicText(titleParam) || Boolean(resolveSurahInfo(q) || resolveSurahInfo(titleParam)) || filterMode === "strict";
      if (!isQIslamic) {
        try {
          if (abortController?.signal?.aborted || res.headersSent) return;
          const saavnResults = await searchJioSaavn(q, 5, abortController?.signal);
          if (abortController?.signal?.aborted || res.headersSent) return;
          const relevantMatch = (saavnResults || []).find(r => r && r.streamUrl && isJioSaavnResultRelevant(q, r.title, titleParam, artistParam));
          if (relevantMatch && relevantMatch.streamUrl) {
            const track = {
              title: relevantMatch.title,
              author: relevantMatch.author,
              duration: relevantMatch.duration,
              streamUrl: relevantMatch.streamUrl,
              rawStreamUrl: relevantMatch.streamUrl,
              artworkUrl: relevantMatch.artworkUrl,
              filterMode
            };
            const shouldSet = parsedUrl.searchParams.get("set") === "true";
            if (shouldSet && systemChannels[targetChannel]) {
              systemChannels[targetChannel].current = track;
              systemChannels[targetChannel].isPlaying = true;
              systemChannels[targetChannel].isPaused = false;
              systemChannels[targetChannel].position = 0;
              if (track.duration) systemChannels[targetChannel].duration = track.duration;
            }
            res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
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

      if (abortController?.signal?.aborted || res.headersSent) return;
      const track = await resolveMediaTrack(q, filterMode, abortController?.signal, titleParam, artistParam);
      if (abortController?.signal?.aborted || res.headersSent) return;
      if (track) {
        const shouldSet = parsedUrl.searchParams.get("set") === "true";
        if (shouldSet && systemChannels[targetChannel]) {
          systemChannels[targetChannel].current = track;
          systemChannels[targetChannel].isPlaying = true;
          systemChannels[targetChannel].isPaused = false;
          systemChannels[targetChannel].position = 0;
          if (track.duration) systemChannels[targetChannel].duration = track.duration;
        }
        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        return res.end(JSON.stringify({
          success: true,
          channel: targetChannel,
          track: {
            ...track,
            proxyStreamUrl: `/api/stream-audio?channel=${targetChannel}&url=${encodeURIComponent(track.streamUrl)}`
          }
        }));
      } else {
        res.writeHead(404, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        return res.end(JSON.stringify({ success: false, error: `Track not found for: ${q}` }));
      }
    } catch (e) {
      if (abortController?.signal?.aborted || res.headersSent) return;
      res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ success: false, error: e.message }));
    }
  }

  // --------------------------------------------------------------------------
  // API: Search Endpoints (Progressive Multi-Track & Playlists)
  // --------------------------------------------------------------------------
  if (pathname === "/api/search" || pathname === "/api/search/tracks" || pathname === "/api/search/playlists") {
    if (abortController?.signal?.aborted || res.headersSent) return;
    const q = parsedUrl.searchParams.get("q") || "";
    const filterMode = parsedUrl.searchParams.get("filterMode") || "filterless";
    const type = parsedUrl.searchParams.get("type") || (pathname.includes("tracks") ? "tracks" : pathname.includes("playlists") ? "playlists" : "all");

    if (!q) {
      res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ success: false, error: "Missing search query" }));
    }

    try {
      if (type === "tracks") {
        const rawResults = await searchYouTubeMulti(q, 20, abortController?.signal);
        if (abortController?.signal?.aborted || res.headersSent) return;
        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        return res.end(JSON.stringify({
          success: true,
          query: q,
          filterMode,
          results: rawResults
        }));
      } else if (type === "playlists") {
        const rawPlaylists = await searchPlaylistsMulti(q, 6, abortController?.signal);
        if (abortController?.signal?.aborted || res.headersSent) return;
        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        return res.end(JSON.stringify({
          success: true,
          query: q,
          filterMode,
          playlists: rawPlaylists
        }));
      } else {
        // Fast parallel fetch for combined request (<250ms)
        const [rawResults, rawPlaylists] = await Promise.all([
          searchYouTubeMulti(q, 20, abortController?.signal),
          searchPlaylistsMulti(q, 6, abortController?.signal)
        ]);
        if (abortController?.signal?.aborted || res.headersSent) return;
        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        return res.end(JSON.stringify({
          success: true,
          query: q,
          filterMode,
          results: rawResults,
          playlists: rawPlaylists
        }));
      }
    } catch (e) {
      if (abortController?.signal?.aborted || res.headersSent) return;
      res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ success: false, error: e.message }));
    }
  }

  // --------------------------------------------------------------------------
  // API: Playlist Details Endpoint (Full Track Resolution for JioSaavn / Spotify / YouTube)
  // --------------------------------------------------------------------------
  if (pathname === "/api/playlist-details") {
    if (abortController?.signal?.aborted || res.headersSent) return;
    const targetUrl = parsedUrl.searchParams.get("url");
    const targetId = parsedUrl.searchParams.get("id");
    const primaryTarget = targetUrl || targetId;
    if (!primaryTarget) {
      res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ success: false, error: "Missing playlist url or id" }));
    }

    try {
      let plData = await resolvePlaylistTracks(primaryTarget, 500, abortController?.signal);
      if ((!plData || !plData.tracks || plData.tracks.length === 0) && targetId && targetId !== primaryTarget) {
        plData = await resolvePlaylistTracks(targetId, 500, abortController?.signal);
      }
      if (abortController?.signal?.aborted || res.headersSent) return;
      if (plData && plData.tracks && plData.tracks.length > 0) {
        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        return res.end(JSON.stringify({ success: true, playlist: plData }));
      } else {
        res.writeHead(404, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        return res.end(JSON.stringify({ success: false, error: "Could not fetch playlist tracks" }));
      }
    } catch (err) {
      if (abortController?.signal?.aborted || res.headersSent) return;
      res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ success: false, error: err.message }));
    }
  }


  // --------------------------------------------------------------------------
  // API: Dedicated Endpoint - Resolve Spotify Playlists, Albums, & Tracks
  // --------------------------------------------------------------------------
  if (pathname === "/api/spotify-playlist") {
    if (abortController?.signal?.aborted || res.headersSent) return;
    let urlParam = parsedUrl.searchParams.get("url") || parsedUrl.searchParams.get("link") || parsedUrl.searchParams.get("q");

    if (!urlParam && req.method === "POST") {
      let body = "";
      req.on("data", chunk => body += chunk);
      await new Promise(r => req.on("end", r));
      try {
        const b = JSON.parse(body);
        urlParam = b.url || b.link || b.query;
      } catch(e) {}
    }

    if (!urlParam) {
      res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ success: false, error: "Please provide a valid Spotify or YouTube playlist URL" }));
    }

    // Auto-detect YouTube playlist / link if passed to /api/spotify-playlist!
    const ytUrl = extractYouTubeUrl(urlParam) || (isYouTubeUrl(urlParam) ? urlParam.trim() : null);
    const ytPlId = extractYouTubePlaylistId(urlParam);
    if (ytUrl || ytPlId) {
      try {
        const ytData = await resolvePlaylistTracks(ytUrl || urlParam, 500, abortController?.signal);
        if (ytData && ytData.tracks?.length) {
          res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
          return res.end(JSON.stringify({ success: true, playlist: ytData }));
        }
      } catch (err) {
        console.warn("/api/spotify-playlist YouTube fallback error:", err.message);
      }
    }

    if (!isSpotifyUrl(urlParam) && !extractSpotifyUrl(urlParam)) {
      res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ success: false, error: "Please provide a valid Spotify URL (playlist, album, or track)" }));
    }

    const cleanSpotifyUrl = extractSpotifyUrl(urlParam) || urlParam.trim();

    try {
      const spotifyData = await resolveSpotifyLink(cleanSpotifyUrl);
      if (!spotifyData || !spotifyData.tracks?.length) {
        res.writeHead(404, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        return res.end(JSON.stringify({ success: false, error: "Could not fetch tracks for this Spotify link. Please ensure it is public." }));
      }

      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ success: true, playlist: spotifyData }));
    } catch (err) {
      if (abortController?.signal?.aborted || res.headersSent) return;
      res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ success: false, error: err.message }));
    }
  }

  // --------------------------------------------------------------------------
  // API: Dedicated Endpoint - Resolve YouTube Playlists & Mixes
  // --------------------------------------------------------------------------
  if (pathname === "/api/youtube-playlist") {
    if (abortController?.signal?.aborted || res.headersSent) return;
    let urlParam = parsedUrl.searchParams.get("url") || parsedUrl.searchParams.get("link") || parsedUrl.searchParams.get("id") || parsedUrl.searchParams.get("q");
    const listParam = parsedUrl.searchParams.get("list");
    if (listParam && (!urlParam || !urlParam.includes("list="))) {
      urlParam = urlParam ? (urlParam.includes("?") ? `${urlParam}&list=${listParam}` : `${urlParam}?list=${listParam}`) : `https://www.youtube.com/playlist?list=${listParam}`;
    }

    if (!urlParam && req.method === "POST") {
      let body = "";
      req.on("data", chunk => body += chunk);
      await new Promise(r => req.on("end", r));
      try {
        const b = JSON.parse(body);
        urlParam = b.url || b.link || b.id || b.query;
      } catch(e) {}
    }

    if (!urlParam) {
      res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ success: false, error: "Please provide a valid YouTube playlist URL or ID" }));
    }

    try {
      const plData = await resolvePlaylistTracks(urlParam, 500, abortController?.signal);
      if (!plData || !plData.tracks?.length) {
        res.writeHead(404, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        return res.end(JSON.stringify({ success: false, error: "Could not fetch tracks for this YouTube playlist. Please ensure it is public." }));
      }

      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ success: true, playlist: plData }));
    } catch (err) {
      if (abortController?.signal?.aborted || res.headersSent) return;
      res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ success: false, error: err.message }));
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
  // --------------------------------------------------------------------------
  // API: Real-time Player State (Separated Response Engine for Web, Mobile & Bot)
  // --------------------------------------------------------------------------
  if (pathname === "/api/state" || pathname === "/api/web/state" || pathname === "/api/mobile/state" || pathname === "/api/bot/state") {
    const platform = pathname === "/api/mobile/state" ? "app" : (pathname === "/api/bot/state" ? "bot" : (pathname === "/api/web/state" ? "browser" : getClientPlatform(req, parsedUrl)));

    const chanBrowser = systemChannels.browser;
    const chanApp = systemChannels.app;

    // Check if local bot worker is running on port 3051
    let botData = null;
    try {
      const botRes = await fetch("http://127.0.0.1:3051/api/state", { signal: AbortSignal.timeout(350) });
      if (botRes.ok) {
        botData = await botRes.json();
      }
    } catch (e) {}

    const sessionToken = getSessionToken(req);
    const sessionUser = sessionToken ? userStore.getUserByToken(sessionToken) : null;
    const sessionRevoked = Boolean(sessionToken && !sessionUser);
    const botChannelState = botData?.channels?.bot || {
      id: "bot",
      name: "Discord Bot",
      icon: "🤖",
      badge: "Discord Voice Engine",
      isPlaying: false,
      isPaused: false,
      position: 0,
      duration: 0,
      volume: 100,
      current: null,
      queue: [],
      history: [],
      voiceChannel: "General",
      announcementChannelName: "music",
      streamUrl: null
    };

    // Dedicated channel response state tailored to the caller's platform
    const activeChan = platform === "app" ? chanApp : (platform === "bot" ? botChannelState : chanBrowser);

    const payload = {
      connected: true,
      serverType: "separated-response-engine",
      platform: platform,
      targetChannel: platform === "app" ? "app" : (platform === "bot" ? "bot" : "browser"),
      authenticated: Boolean(sessionUser),
      sessionRevoked: sessionRevoked,
      user: sessionUser ? {
        id: sessionUser.id,
        username: sessionUser.username,
        displayName: sessionUser.displayName,
        avatar: sessionUser.avatar,
        type: sessionUser.type,
        isServerMember: Boolean(sessionUser.isServerMember)
      } : null,
      currentUser: sessionUser ? {
        id: sessionUser.id,
        username: sessionUser.username,
        displayName: sessionUser.displayName,
        avatar: sessionUser.avatar,
        isServerMember: Boolean(sessionUser.isServerMember),
        favoriteCount: sessionUser.favorites?.length || 0,
        queueCount: sessionUser.queue?.length || 0
      } : null,
      // Dedicated platform playback state
      playing: activeChan.isPlaying,
      paused: activeChan.isPaused,
      position: activeChan.position,
      duration: activeChan.duration,
      volume: activeChan.volume,
      current: activeChan.current,
      queue: activeChan.queue || [],
      history: activeChan.history || [],
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
        },
        bot: botChannelState
      },
      servers: botData?.servers || [],
      availableTextChannels: botData?.availableTextChannels || [],
      channelsVersion: botData?.channelsVersion || Date.now(),
      announcementChannelId: botData?.announcementChannelId || null,
      announcementChannelName: botData?.announcementChannelName || "music"
    };

    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "X-Server-Platform": platform });
    return res.end(JSON.stringify(payload));
  }

  // --------------------------------------------------------------------------
  // API: User Action Controller (play_now, set_track, play_pause, etc.)
  // --------------------------------------------------------------------------
  if (pathname === "/api/action" || pathname === "/api/web/action" || pathname === "/api/mobile/action" || pathname === "/api/bot/action") {
    if (abortController?.signal?.aborted || res.headersSent) return;
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      if (abortController?.signal?.aborted || res.headersSent) return;
      try {
        const parsed = JSON.parse(body || "{}");
        const action = parsed.action;
        const defaultPlatform = pathname === "/api/mobile/action" ? "app" : (pathname === "/api/bot/action" ? "bot" : (pathname === "/api/web/action" ? "browser" : getClientPlatform(req, parsedUrl)));
        const targetChannel = parsed.targetChannel || parsed.channel || defaultPlatform;

        // Route Discord Bot actions to the bot worker process
        if (targetChannel === "bot" || action === "send" || action === "set_announcement_channel") {
          const sessionUser = getSessionUser(req);
          if (!sessionUser || !sessionUser.isServerMember) {
            if (abortController?.signal?.aborted || res.headersSent) return;
            res.writeHead(403, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
            return res.end(JSON.stringify({
              success: false,
              error: "Authentication required: You must be logged in with Discord and a verified member of the Spy Sec Music server to control the bot.",
              requireDiscordAuth: true
            }));
          }

          try {
            const authHeader = req.headers["authorization"] || "";
            const forwardHeaders = { "Content-Type": "application/json" };
            if (authHeader) forwardHeaders["Authorization"] = authHeader;
            if (req.headers.cookie) forwardHeaders["Cookie"] = req.headers.cookie;

            const botRes = await fetch("http://127.0.0.1:3051/api/action", {
              method: "POST",
              headers: forwardHeaders,
              body: body,
              signal: AbortSignal.timeout(6000)
            });
            const botJson = await botRes.json();
            if (abortController?.signal?.aborted || res.headersSent) return;
            res.writeHead(botRes.status || 200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
            return res.end(JSON.stringify(botJson));
          } catch (botErr) {
            if (abortController?.signal?.aborted || res.headersSent) return;
            res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
            return res.end(JSON.stringify({
              success: false,
              error: "Discord bot is connecting to voice gateway. Please wait a moment and try again."
            }));
          }
        }

        const chan = systemChannels[targetChannel] || systemChannels.browser;

        if (action === "play_now" || action === "play_query") {
          const q = parsed.value || parsed.query || "";
          if (q) {
            const tr = await resolveMediaTrack(q, parsed.filterMode, abortController?.signal);
            if (abortController?.signal?.aborted || res.headersSent) return;
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
        } else if (action === "stop") {
          chan.isPlaying = false;
          chan.isPaused = false;
          chan.position = 0;
          chan.current = null;
        }

        if (abortController?.signal?.aborted || res.headersSent) return;
        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "X-Server-Platform": defaultPlatform });
        return res.end(JSON.stringify({ success: true, platform: defaultPlatform, channel: targetChannel, message: `Action ${action} executed for ${targetChannel}` }));
      } catch (err) {
        if (abortController?.signal?.aborted || res.headersSent) return;
        res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // --------------------------------------------------------------------------
  // API: User Authentication (Login, Register, Logout, Me, Forgot/Reset, OAuth)
  // Supports standard and aliased routes (/api/user/..., /api/..., /api/auth/...)
  // --------------------------------------------------------------------------
  const isLoginRoute = pathname === "/api/user/login" || pathname === "/api/login" || pathname === "/api/auth/login";
  if (isLoginRoute) {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ success: false, error: "Method not allowed. Use POST for authentication." }));
    }
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const { email, username, password, displayName } = JSON.parse(body || "{}");
        const result = userStore.loginCustomer({ email: email || username || displayName, password });
        if (result.success) {
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Set-Cookie": `ahm_auth_token=${encodeURIComponent(result.token)}; Path=/; Max-Age=2592000; SameSite=Lax`
          });
          return res.end(JSON.stringify(result));
        } else {
          res.writeHead(401, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
          return res.end(JSON.stringify(result));
        }
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  const isRegisterRoute = pathname === "/api/user/register" || pathname === "/api/register" || pathname === "/api/auth/register";
  if (isRegisterRoute) {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ success: false, error: "Method not allowed. Use POST for registration." }));
    }
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const { email, password, username, displayName, avatar, preferredGenres } = JSON.parse(body || "{}");
        const result = userStore.registerCustomer({ email, password, username, displayName, avatar, preferredGenres });
        if (result.success) {
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Set-Cookie": `ahm_auth_token=${encodeURIComponent(result.token)}; Path=/; Max-Age=2592000; SameSite=Lax`
          });
          return res.end(JSON.stringify(result));
        } else {
          res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
          return res.end(JSON.stringify(result));
        }
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  const isForgotPassRoute = pathname === "/api/user/forgot-password" || pathname === "/api/forgot-password" || pathname === "/api/auth/forgot-password";
  if (isForgotPassRoute) {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ success: false, error: "Method not allowed. Use POST." }));
    }
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const { email } = JSON.parse(body || "{}");
        const result = userStore.forgotPasswordCustomer({ email });
        res.writeHead(result.success ? 200 : 400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        return res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  const isResetPassRoute = pathname === "/api/user/reset-password" || pathname === "/api/reset-password" || pathname === "/api/auth/reset-password";
  if (isResetPassRoute) {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ success: false, error: "Method not allowed. Use POST." }));
    }
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const { email, code, newPassword } = JSON.parse(body || "{}");
        const result = userStore.resetPasswordCustomer({ email, code, newPassword });
        res.writeHead(result.success ? 200 : 400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        return res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  const isOAuthLoginRoute = pathname === "/api/user/oauth-login" || pathname === "/api/oauth-login" || pathname === "/api/auth/oauth-login";
  if (isOAuthLoginRoute) {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ success: false, error: "Method not allowed. Use POST." }));
    }
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const { provider, email, name, avatar, providerId } = JSON.parse(body || "{}");
        const result = userStore.oauthLoginCustomer({ provider, email, name, avatar, providerId });
        if (result.success) {
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Set-Cookie": `ahm_auth_token=${encodeURIComponent(result.token)}; Path=/; Max-Age=2592000; SameSite=Lax`
          });
          return res.end(JSON.stringify(result));
        } else {
          res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
          return res.end(JSON.stringify(result));
        }
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  const isLogoutRoute = pathname === "/api/user/logout" || pathname === "/api/logout" || pathname === "/api/auth/logout";
  if (isLogoutRoute && (req.method === "POST" || req.method === "GET")) {
    const sessionUser = getSessionUser(req);
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Set-Cookie": `ahm_auth_token=; Path=/; Max-Age=0; SameSite=Lax`
    });
    return res.end(JSON.stringify({ success: true }));
  }

  const isMeRoute = pathname === "/api/user/me" || pathname === "/api/me" || pathname === "/api/auth/me";
  if (isMeRoute) {
    const sessionToken = getSessionToken(req);
    const user = sessionToken ? userStore.getUserByToken(sessionToken) : null;
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    if (user) {
      return res.end(JSON.stringify({
        authenticated: true,
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          avatar: user.avatar,
          type: user.type,
          discordId: user.discordId,
          isServerMember: Boolean(user.isServerMember),
          roles: user.roles || [],
          favoriteCount: user.favorites?.length || 0,
          queueCount: user.queue?.length || 0,
          tasteProfile: userStore.getUserTasteProfile ? userStore.getUserTasteProfile(user.id) : null
        }
      }));
    } else {
      return res.end(JSON.stringify({
        authenticated: false,
        sessionRevoked: Boolean(sessionToken),
        user: null
      }));
    }
  }

  // Discord Server Member Verification Endpoint (Validates against guild 1553640111047180448)
  if (pathname === "/api/auth/discord-verify" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const { query } = JSON.parse(body || "{}");
        if (!query) {
          res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
          return res.end(JSON.stringify({ success: false, error: "Please provide a Discord User ID or Username" }));
        }

        const GUILD_ID = "1553640111047180448";
        const result = await userStore.verifyDiscordServerMember(null, GUILD_ID, query);
        if (result.isMember) {
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Set-Cookie": `ahm_auth_token=${encodeURIComponent(result.token)}; Path=/; Max-Age=2592000; SameSite=Lax`
          });
          return res.end(JSON.stringify({
            success: true,
            isServerMember: true,
            token: result.token,
            user: result.user
          }));
        } else {
          res.writeHead(403, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
          return res.end(JSON.stringify({
            success: false,
            isServerMember: false,
            error: result.error || "User is not a member of the Spy Sec Music server"
          }));
        }
      } catch(err) {
        res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Get Discord Server Members List for Quick Login
  if (pathname === "/api/auth/server-members" && req.method === "GET") {
    const GUILD_ID = "1553640111047180448";
    const members = await userStore.getServerMembers(GUILD_ID);
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    return res.end(JSON.stringify({ success: true, count: members.length, members }));
  }

  // Discord OAuth2 Redirect
  if (pathname === "/auth/discord") {
    const origin = `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host || "localhost:" + PORT}`;
    const redirectUri = `${origin}/auth/discord/callback`;
    const clientId = process.env.CLIENT_ID || "1559615126406168646";
    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=identify%20guilds`;
    res.writeHead(302, { "Location": discordAuthUrl });
    return res.end();
  }

  // Discord OAuth2 Callback
  if (pathname === "/auth/discord/callback") {
    const code = parsedUrl.searchParams.get("code");
    const clientSecret = process.env.CLIENT_SECRET;
    const clientId = process.env.CLIENT_ID || "1559615126406168646";
    const origin = `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host || "localhost:" + PORT}`;
    const redirectUri = `${origin}/auth/discord/callback`;

    if (code && clientSecret) {
      try {
        const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: "authorization_code",
            code: code,
            redirect_uri: redirectUri
          })
        });
        const tokenData = await tokenRes.json();
        if (tokenData.access_token) {
          const userRes = await fetch("https://discord.com/api/users/@me", {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
          });
          const discordUser = await userRes.json();
          const GUILD_ID = "1553640111047180448";
          const verifyResult = await userStore.verifyDiscordServerMember(null, GUILD_ID, discordUser.id);

          if (verifyResult.isMember) {
            res.writeHead(302, {
              "Location": `/discord?token=${verifyResult.token}`,
              "Set-Cookie": `ahm_auth_token=${encodeURIComponent(verifyResult.token)}; Path=/; Max-Age=2592000; SameSite=Lax`
            });
            return res.end();
          } else {
            res.writeHead(302, { "Location": "/discord?error=not_in_server" });
            return res.end();
          }
        }
      } catch(e) {
        console.error("OAuth callback error:", e);
      }
    }
    res.writeHead(302, { "Location": `/discord?verify_prompt=true` });
    return res.end();
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

  if (pathname === "/api/user/daily-recommendations" || pathname === "/api/user/recommendations") {
    const user = getSessionUser(req);
    const userId = user ? user.id : "local_guest_default";
    const force = parsedUrl.searchParams.get("refresh") === "true";
    const recs = userStore.getDailyRecommendations(userId, force);
    const tasteProfile = userStore.getUserTasteProfile ? userStore.getUserTasteProfile(userId) : null;
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    });
    return res.end(JSON.stringify({ success: true, recommendations: recs, tasteProfile }));
  }

  if (pathname === "/api/user/taste/calibrate" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const { preferredGenres, favoriteArtists } = JSON.parse(body || "{}");
        const user = getSessionUser(req);
        const userId = user ? user.id : "local_guest_default";
        const refreshed = userStore.calibrateUserTaste(userId, { preferredGenres, favoriteArtists });
        const tasteProfile = userStore.getUserTasteProfile ? userStore.getUserTasteProfile(userId) : null;
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        });
        return res.end(JSON.stringify({
          success: true,
          recommendations: refreshed,
          tasteProfile
        }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  if (pathname === "/api/user/taste/record" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const { track, eventType } = JSON.parse(body || "{}");
        const user = getSessionUser(req);
        const userId = user ? user.id : "local_guest_default";
        const result = userStore.recordTasteEvent(userId, { track, eventType });
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        });
        return res.end(JSON.stringify({ success: true, taste: result }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  if (pathname === "/api/radio") {
    const seedTitle = (parsedUrl.searchParams.get("seedTitle") || "").trim();
    const seedArtist = (parsedUrl.searchParams.get("seedArtist") || "").trim();
    const filterMode = parsedUrl.searchParams.get("filterMode") || "filterless";
    const defaultPlatform = getClientPlatform(req, parsedUrl);
    const targetChannel = parsedUrl.searchParams.get("channel") || defaultPlatform;
    const limit = Math.min(Math.max(parseInt(parsedUrl.searchParams.get("limit") || "15", 10), 5), 30);

    const radioTracks = await generateRadioStation(seedTitle, seedArtist, filterMode, limit, abortController?.signal, targetChannel);
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=180"
    });
    return res.end(JSON.stringify({
      success: true,
      channel: targetChannel,
      seed: { title: seedTitle, artist: seedArtist },
      station: `${seedTitle || seedArtist || "Spotify"} Radio`,
      tracks: radioTracks
    }));
  }

  // Time-Synced Karaoke Lyrics Endpoint (LRCLIB + Open Source Synced Lyrics)
  if (pathname === "/api/lyrics") {
    const title = (parsedUrl.searchParams.get("title") || "").trim();
    const artist = (parsedUrl.searchParams.get("artist") || "").trim();
    const duration = parseFloat(parsedUrl.searchParams.get("duration") || "0");

    const lyricsData = await resolveTrackLyrics(title, artist, duration, abortController?.signal);
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=86400"
    });
    return res.end(JSON.stringify({
      success: true,
      found: Boolean(lyricsData),
      lyrics: lyricsData
    }));
  }

  if (pathname === "/api/apk-link") {
    const apkUrl = (process.env.APK_DOWNLOAD_URL || "").trim();
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ success: true, url: apkUrl }));
  }

  // --------------------------------------------------------------------------
  // STATIC ASSET SERVER (Aggressive In-Memory / File Streaming & Custom 404)
  // --------------------------------------------------------------------------
  let resolvedPathname = pathname;
  if (resolvedPathname === "/privacy" || resolvedPathname === "/privacy-policy") {
    resolvedPathname = "/privacy.html";
  } else if (resolvedPathname === "/terms" || resolvedPathname === "/terms-of-service") {
    resolvedPathname = "/terms.html";
  } else if (resolvedPathname === "/discord" || resolvedPathname === "/discord-bot") {
    resolvedPathname = "/discord.html";
  } else if (resolvedPathname === "/404") {
    resolvedPathname = "/404.html";
  }

  let filePath = path.join(PUBLIC_DIR, resolvedPathname === "/" ? "index.html" : resolvedPathname);

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
      // If client is asking for an API route that reached here, return JSON 404
      if (pathname.startsWith("/api/")) {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ success: false, error: "API endpoint not found" }));
      }

      // If it looks like a missing static asset (has dot extension like .png, .mp3, .js, .css)
      const ext = path.extname(pathname);
      if (ext && ext !== ".html") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        return res.end("Asset Not Found");
      }

      // Serve custom 404.html page for unknown pages
      const notFoundPath = path.join(PUBLIC_DIR, "404.html");
      if (fs.existsSync(notFoundPath)) {
        res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
        return fs.createReadStream(notFoundPath).pipe(res);
      }

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
  console.log(" 🌐 SPY SEC MUSIC - DEDICATED SEPARATED RESPONSE SERVERS");
  console.log(` 🌐 Web App Response Server:    http://localhost:${PORT}/api/web/state`);
  console.log(` 📱 Mobile App Response Server: http://localhost:${PORT}/api/mobile/state`);
  console.log(` 🤖 Discord Bot Relay Server:   http://localhost:${PORT}/api/bot/state (Worker :3051)`);
  console.log(" ⚡ Dedicated Per-Platform State, Queues & Request Regulation");
  console.log(" ⚡ Zero Cross-Device Interference / Independent Playback");
  console.log("================================================================");

  // Automatic Cloud Discord Bot Runner:
  // If DISCORD_TOKEN is present in Render/cloud environment, automatically spawn the Discord Music Bot!
  if (process.env.DISCORD_TOKEN) {
    try {
      const { fork } = require("child_process");
      const botPath = path.resolve(__dirname, "..", "discord-bot", "bot.js");
      if (fs.existsSync(botPath)) {
        console.log("🤖 [Discord Bot Auto-Launch] DISCORD_TOKEN detected! Launching Discord Music Bot in background...");
        const botEnv = { ...process.env, PORT: "3051", BOT_PORT: "3051" };
        const botWorker = fork(botPath, [], {
          cwd: path.resolve(__dirname, "..", "discord-bot"),
          env: botEnv
        });
        botWorker.on("error", (err) => console.error("Discord Bot Worker error:", err.message));
        botWorker.on("exit", (code) => console.warn(`Discord Bot Worker exited with code ${code}`));
      }
    } catch (launchErr) {
      console.error("Failed to auto-launch Discord Bot:", launchErr.message);
    }
  }
});

