const {
  Client,
  Events,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  EmbedBuilder
} = require("discord.js");
const { LavalinkManager } = require("lavalink-client");
const http = require("http");
const https = require("https");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const {
  checkBlocked,
  isIslamicText,
  isIslamicTrack,
  isIslamicQuery,
  sanitizeSearchQuery,
  validateByFilterMode,
  SURAH_NAMES,
  SURAH_ALIASES,
  isTranslationOrTafsir,
  resolveSurahInfo
} = require("./islamicFilter");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const userStore = require("./userStore");

const spotifyUrlInfo = require("spotify-url-info")(fetch);
const spotifyTrending = require("./spotifyTrending");
spotifyTrending.initSpotifyTrending();

// Ultra-Low Latency Keep-Alive Agents for Audio Proxying (Reuses TLS sockets, eliminates 200-400ms handshake lag)
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

// In-memory cache for fast search queries
const searchCache = new Map();
async function searchYouTubeMulti(query, limit = 20) {
  const cacheKey = (query || "").trim().toLowerCase();
  if (searchCache.has(cacheKey)) {
    const cached = searchCache.get(cacheKey);
    if (Date.now() - cached.time < 3600000 && Array.isArray(cached.results) && cached.results.length >= limit) {
      return cached.results.slice(0, limit);
    }
  }

  // Instant Surah Injection: If query is an authentic Quran Surah, resolve directly to Quran CDN
  const surahInfo = resolveSurahInfo(query);
  if (surahInfo) {
    const sNum = surahInfo.number;
    const padded = String(sNum).padStart(3, "0");
    const sName = SURAH_NAMES[sNum] || surahInfo.name || `Surah ${sNum}`;
    const directSurahTrack = {
      id: `quran_surah_${sNum}`,
      title: `Surah ${sNum}: ${sName} - Mishary Rashid Alafasy`,
      author: "Mishary Rashid Alafasy",
      duration: 180000,
      artworkUrl: "logo.png",
      url: `https://download.quranicaudio.com/quran/mishari_rashid_al_3afasy/${padded}.mp3`,
      streamUrl: `https://download.quranicaudio.com/quran/mishari_rashid_al_3afasy/${padded}.mp3`,
      rawStreamUrl: `https://download.quranicaudio.com/quran/mishari_rashid_al_3afasy/${padded}.mp3`,
      source: "quran",
      filterMode: "strict"
    };
    return [directSurahTrack];
  }

  // Fast path 1: Lavalink REST search (ultra-fast, ~900ms, no channel clutter)
  try {
    const protocol = process.env.LAVALINK_SECURE === "true" ? "https" : "http";
    const lHost = process.env.LAVALINK_HOST || "127.0.0.1";
    const lPort = process.env.LAVALINK_PORT || "2334";
    const lAuth = process.env.LAVALINK_AUTH || "youshallnotpass";
    const res = await fetch(`${protocol}://${lHost}:${lPort}/v4/loadtracks?identifier=ytsearch:${encodeURIComponent(query)}`, {
      headers: { Authorization: lAuth },
      signal: AbortSignal.timeout(6000)
    });
    const d = await res.json();
    const tracks = d.data?.length ? d.data : (d.data?.tracks || []);
    if (Array.isArray(tracks) && tracks.length > 0) {
      const results = tracks
        .filter(t => t && t.info && t.info.title)
        .map(t => ({
          id: t.info.identifier,
          title: t.info.title,
          author: t.info.author || "YouTube Music",
          duration: t.info.length || 0,
          artworkUrl: t.info.artworkUrl || `https://i.ytimg.com/vi/${t.info.identifier}/hqdefault.jpg`,
          url: t.info.uri || `https://www.youtube.com/watch?v=${t.info.identifier}`,
          encoded: t.encoded
        }));
      if (results.length > 0) {
        searchCache.set(cacheKey, { time: Date.now(), results });
        return results.slice(0, limit);
      }
    }
  } catch (lavalinkErr) {
    // Lavalink node busy or unavailable, fall through to yt-dlp
  }

  // Fallback 2: yt-dlp flat playlist search
  const fetchLimit = Math.max(limit + 5, 25);
  return new Promise((resolve) => {
    execFile(
      "python",
      ["-m", "yt_dlp", "--flat-playlist", "-J", `ytsearch${fetchLimit}:${query}`],
      { timeout: 20000, maxBuffer: 15 * 1024 * 1024 },
      (err, stdout) => {
        if (err || !stdout) return resolve([]);
        try {
          const data = JSON.parse(stdout);
          const entries = data.entries || [];
          // Filter out YouTube channels and non-video entries
          const allValid = entries
            .filter(e => e && e.title && !e.id?.startsWith("UC") && !e.url?.includes("/channel/") && !e.url?.includes("/user/"))
            .map(e => ({
              id: e.id,
              title: e.title,
              author: e.uploader || e.channel || "YouTube Music",
              duration: Math.round((e.duration || 0) * 1000),
              artworkUrl: (e.thumbnails && e.thumbnails.length > 0) ? e.thumbnails[e.thumbnails.length - 1].url : `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`,
              url: (e.url && e.url.startsWith("http")) ? e.url : `https://www.youtube.com/watch?v=${e.id}`
            }));
          searchCache.set(cacheKey, { time: Date.now(), results: allValid });
          resolve(allValid.slice(0, limit));
        } catch(e) {
          resolve([]);
        }
      }
    );
  });
}

let desModule = null;
try {
  desModule = require("des.js");
} catch (e) {}

// In-memory cache for fast playlist searches
function decryptSaavnMediaUrl(encUrl) {
  if (!encUrl || typeof encUrl !== "string") return null;
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

// Fast JioSaavn Song Search (Instant ~150ms response, 320kbps audio)
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
          artist: artistNames,
          duration: Math.round(parseFloat(r.more_info?.duration || 0) * 1000),
          artworkUrl: artwork || "logo.png",
          url: r.perma_url || `https://www.jiosaavn.com/song/${r.id}`,
          streamUrl: streamUrl,
          rawStreamUrl: streamUrl,
          source: "jiosaavn"
        };
      });
  } catch (e) {
    return [];
  }
}

// Fast JioSaavn Playlist Search (Instant ~150ms response, zero rate-limits)
async function searchJioSaavnPlaylists(query, limit = 5) {
  try {
    const url = `https://www.jiosaavn.com/api.php?__call=search.getPlaylistResults&_format=json&_marker=0&api_version=4&ctx=web6dot0&n=${limit}&p=1&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(2800) });
    const data = await res.json();
    const results = data.results || [];
    return results
      .filter(r => r && r.title)
      .map(r => {
        const cleanT = (r.title || "").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'");
        const cleanSub = (r.subtitle || "").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'");
        return {
          id: `saavn_pl_${r.id}`,
          rawId: r.id,
          title: cleanT,
          author: r.more_info?.firstname || r.more_info?.artist_name?.join(", ") || cleanSub || "Featured Playlist",
          trackCount: parseInt(r.more_info?.song_count || r.subtitle || "0", 10) || null,
          artworkUrl: (r.image || "").replace("150x150", "500x500") || "logo.png",
          url: r.perma_url || `https://www.jiosaavn.com/featured/${r.id}`,
          source: "jiosaavn"
        };
      });
  } catch (e) {
    return [];
  }
}

// Fast JioSaavn Album Search
async function searchJioSaavnAlbums(query, limit = 3) {
  try {
    const url = `https://www.jiosaavn.com/api.php?__call=search.getAlbumResults&_format=json&_marker=0&api_version=4&ctx=web6dot0&n=${limit}&p=1&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(2800) });
    const data = await res.json();
    const results = data.results || [];
    return results
      .filter(r => r && r.title)
      .map(r => {
        const cleanT = (r.title || "").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'");
        const cleanArtist = (r.artist || r.subtitle || "").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'");
        return {
          id: `saavn_alb_${r.id}`,
          rawId: r.id,
          isAlbum: true,
          title: `${cleanT} (Album)`,
          author: cleanArtist || "Official Album",
          trackCount: parseInt(r.more_info?.song_count || "0", 10) || null,
          artworkUrl: (r.image || "").replace("150x150", "500x500") || "logo.png",
          url: r.perma_url || `https://www.jiosaavn.com/album/${r.id}`,
          source: "jiosaavn"
        };
      });
  } catch (e) {
    return [];
  }
}

// Multi-Source Playlist Search (JioSaavn + Albums + YouTube Fallback)
async function searchPlaylistsMulti(query, limit = 5) {
  const cacheKey = (query || "").trim().toLowerCase();
  if (searchPlaylistCache.has(cacheKey)) {
    const cached = searchPlaylistCache.get(cacheKey);
    if (Date.now() - cached.time < 3600000 && Array.isArray(cached.results) && cached.results.length >= limit) {
      return cached.results.slice(0, limit);
    }
  }

  // 1. Parallel Fast Search: JioSaavn Playlists and Albums (~150ms)
  const [saavnPlaylists, saavnAlbums] = await Promise.all([
    searchJioSaavnPlaylists(query, Math.min(limit, 5)),
    searchJioSaavnAlbums(query, Math.min(limit, 3))
  ]);

  const combined = [];
  if (saavnPlaylists.length > 0) combined.push(...saavnPlaylists);
  if (saavnAlbums.length > 0) combined.push(...saavnAlbums);

  if (combined.length >= 2) {
    searchPlaylistCache.set(cacheKey, { time: Date.now(), results: combined });
    return combined.slice(0, limit);
  }

  // 2. Fallback: Fast YouTube Playlist Search with strict timeout (2.5s)
  const fetchLimit = limit + 3;
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAw%3D%3D`;

  return new Promise((resolve) => {
    const ytTimeout = setTimeout(() => resolve(combined.slice(0, limit)), 2500);
    execFile(
      "python",
      ["-m", "yt_dlp", "--flat-playlist", "-J", "--playlist-end", String(fetchLimit), url],
      { timeout: 3500, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => {
        clearTimeout(ytTimeout);
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
          } catch(e) {}
        }
        if (combined.length > 0) {
          searchPlaylistCache.set(cacheKey, { time: Date.now(), results: combined });
        }
        resolve(combined.slice(0, limit));
      }
    );
  });
}

function executeYtDlp(args, options, callback) {
  const runArgs = [...args];
  if (!runArgs.includes("--js-runtimes")) {
    runArgs.unshift("--js-runtimes", "node");
  }

  const localBinary = path.join(__dirname, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
  if (fs.existsSync(localBinary)) {
    return execFile(localBinary, runArgs, options, callback);
  }
  const pythonCmd = process.env.PYTHON_PATH || (process.platform === "win32" ? "python" : "python3");
  execFile(pythonCmd, ["-m", "yt_dlp", ...runArgs], options, (err, stdout, stderr) => {
    if (err && (err.code === "ENOENT" || err.message?.includes("ENOENT"))) {
      return execFile("yt-dlp", runArgs, options, (err2, stdout2, stderr2) => {
        if (err2 && process.platform !== "win32") {
          return execFile("python", ["-m", "yt_dlp", ...runArgs], options, callback);
        }
        callback(err2, stdout2, stderr2);
      });
    }
    callback(err, stdout, stderr);
  });
}

function extractYouTubePlaylistId(urlOrId) {
  if (!urlOrId || typeof urlOrId !== "string") return null;
  const s = urlOrId.trim();
  const listMatch = s.match(/[?&]list=([a-zA-Z0-9_-]+)/i);
  if (listMatch) return listMatch[1];
  const plMatch = s.match(/(?:youtube\.com|youtu\.be)\/playlist\/?\?list=([a-zA-Z0-9_-]+)/i);
  if (plMatch) return plMatch[1];
  if (/^(?:PL|OLAK5uy_|RD|UU|LL|FL|TL|CL)[a-zA-Z0-9_-]{10,}$/.test(s)) return s;
  return null;
}

function isYouTubeUrl(url) {
  if (!url || typeof url !== "string") return false;
  const s = url.trim();
  return /^(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?|shorts\/|playlist\?|embed\/)|youtu\.be\/)/i.test(s) ||
         Boolean(extractYouTubePlaylistId(s));
}

// In-memory cache for full playlist tracks resolver
const playlistTracksCache = new Map();
async function resolvePlaylistTracks(playlistUrlOrId, limit = 50) {
  const clean = String(playlistUrlOrId || "").trim();
  const cacheKey = clean.toLowerCase();
  if (playlistTracksCache.has(cacheKey)) {
    const cached = playlistTracksCache.get(cacheKey);
    if (Date.now() - cached.time < 3600000) return cached.data;
  }

  // Case 1: JioSaavn Playlist
  if (clean.startsWith("saavn_pl_") || clean.includes("jiosaavn.com/featured/")) {
    const listId = clean.replace("saavn_pl_", "").split("/").pop();
    try {
      const url = `https://www.jiosaavn.com/api.php?__call=playlist.getDetails&_format=json&_marker=0&api_version=4&ctx=web6dot0&listid=${encodeURIComponent(listId)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      const d = await res.json();
      const list = d.list || [];
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
          id: `saavn_pl_${d.id}`,
          title: (d.title || "JioSaavn Playlist").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'"),
          description: d.header_desc || d.subtitle || "Featured Playlist",
          author: d.more_info?.firstname || d.subtitle || "JioSaavn",
          artworkUrl: (d.image || "").replace("150x150", "500x500") || "logo.png",
          tracks: tracks,
          trackCount: tracks.length
        };
        playlistTracksCache.set(cacheKey, { time: Date.now(), data: result });
        return result;
      }
    } catch (e) {}
  }

  // Case 2: JioSaavn Album
  if (clean.startsWith("saavn_alb_") || clean.includes("jiosaavn.com/album/")) {
    const albId = clean.replace("saavn_alb_", "").split("/").pop();
    try {
      const url = `https://www.jiosaavn.com/api.php?__call=content.getAlbumDetails&_format=json&_marker=0&api_version=4&ctx=web6dot0&albumid=${encodeURIComponent(albId)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      const d = await res.json();
      const list = d.list || d.songs || [];
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
          id: `saavn_alb_${d.id}`,
          title: (d.title || "Album").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'"),
          description: d.header_desc || d.subtitle || "Album",
          author: d.artist || d.more_info?.artist_name?.join(", ") || "Artist",
          artworkUrl: (d.image || "").replace("150x150", "500x500") || "logo.png",
          tracks: tracks,
          trackCount: tracks.length
        };
        playlistTracksCache.set(cacheKey, { time: Date.now(), data: result });
        return result;
      }
    } catch (e) {}
  }

  // Case 3A: Direct Spotify Playlist / Album / Track Link
  if (isSpotifyUrl(clean) || (clean.startsWith("http") && clean.includes("spotify.com")) || clean.startsWith("spotify:")) {
    try {
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

  // Case 3B: YouTube Playlist via yt-dlp
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
        "--playlist-end", String(Math.max(limit, 1000)),
        url
      ],
      { timeout: 35000, maxBuffer: 50 * 1024 * 1024 },
      (err, stdout) => {
        if (err || !stdout) return resolve(null);
        try {
          const data = JSON.parse(stdout);
          const entries = (data.entries || []).filter(e => e && e.title && e.title !== "[Deleted video]" && e.title !== "[Private video]" && !e.id?.startsWith("UC"));
          const tracks = entries.map((e, idx) => ({
            id: e.id || `yt_${idx}`,
            title: e.title,
            artist: e.uploader || e.channel || data.title || "YouTube Music",
            author: e.uploader || e.channel || data.title || "YouTube Music",
            duration: Math.round((e.duration || 0) * 1000) || 180000,
            durationMs: Math.round((e.duration || 0) * 1000) || 180000,
            artworkUrl: (e.thumbnails && e.thumbnails.length > 0) ? e.thumbnails[e.thumbnails.length - 1].url : `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`,
            url: e.id ? `https://www.youtube.com/watch?v=${e.id}` : ((e.url && e.url.startsWith("http")) ? e.url.split("&list=")[0].split("?list=")[0] : `https://www.youtube.com/watch?v=${e.id}`),
            query: e.id ? `https://www.youtube.com/watch?v=${e.id}` : `${e.title} ${e.uploader || ""}`.trim(),
            proxyStreamUrl: e.id ? `/api/stream-audio?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${e.id}`)}` : null,
            source: "youtube"
          }));
          const result = {
            id: data.id || ytPlaylistId || `yt_${Date.now()}`,
            name: data.title || "YouTube Playlist",
            title: data.title || "YouTube Playlist",
            author: data.uploader || data.channel || "YouTube",
            description: data.description || `Playlist with ${tracks.length} songs`,
            artworkUrl: (data.thumbnails && data.thumbnails.length > 0) ? data.thumbnails[data.thumbnails.length - 1].url : (tracks[0]?.artworkUrl || "logo.png"),
            coverUrl: (data.thumbnails && data.thumbnails.length > 0) ? data.thumbnails[data.thumbnails.length - 1].url : (tracks[0]?.artworkUrl || "logo.png"),
            tracks: tracks,
            trackCount: tracks.length
          };
          if (tracks.length > 0) {
            playlistTracksCache.set(cacheKey, { time: Date.now(), data: result });
          }
          resolve(result);
        } catch(e) {
          resolve(null);
        }
      }
    );
  });
}

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
      const pUrl = new URL(req.url, "http://localhost:3050");
      token = pUrl.searchParams.get("token");
    } catch(e) {}
  }
  return token ? userStore.getUserByToken(token) : null;
}

/**
 * Validates whether an input string is a Spotify URL (playlist, album, track, or artist)
 */
function isSpotifyUrl(url) {
  if (!url || typeof url !== "string") return false;
  return /open\.spotify\.com\/(?:intl-[a-zA-Z]{2,5}\/)?(?:user\/[^/]+\/)?(playlist|album|track|artist|show|episode)\/([a-zA-Z0-9]+)/i.test(url) ||
         /spotify:(playlist|album|track|artist|show|episode):([a-zA-Z0-9]+)/i.test(url) ||
         /(?:spotify\.link|spotify\.app\.link)\/[a-zA-Z0-9_-]+/i.test(url);
}

/**
 * Extracts a Spotify URL from any mixed text string
 */
function extractSpotifyUrl(text) {
  if (!text || typeof text !== "string") return null;
  const match = text.match(/https?:\/\/open\.spotify\.com\/(?:intl-[a-zA-Z]{2,5}\/)?(?:user\/[^/]+\/)?(playlist|album|track|artist|show|episode)\/[a-zA-Z0-9]+(\?[^\s]*)?/i) ||
                text.match(/spotify:(playlist|album|track|artist|show|episode):[a-zA-Z0-9]+/i) ||
                text.match(/https?:\/\/(?:spotify\.link|spotify\.app\.link)\/[a-zA-Z0-9_-]+(\?[^\s]*)?/i);
  return match ? match[0] : null;
}

/**
 * Resolves full Spotify playlist/album/track metadata & tracklist without requiring user credentials.
 */
async function resolveSpotifyLink(url) {
  try {
    let cleanUrl = (url || "").trim();
    if (!cleanUrl) return null;

    if (cleanUrl.includes("spotify.link") || cleanUrl.includes("spotify.app.link")) {
      try {
        const headRes = await fetch(cleanUrl, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(4000) });
        if (headRes.url && headRes.url.includes("spotify.com")) {
          cleanUrl = headRes.url;
        }
      } catch (_) {}
    }

    cleanUrl = cleanUrl
      .replace(/\/intl-[a-zA-Z]{2,5}\//i, "/")
      .replace(/\/user\/[^/]+\/playlist\//i, "/playlist/");

    const details = await spotifyUrlInfo.getDetails(cleanUrl);
    if (!details) return null;

    const preview = details.preview || {};
    const type = preview.type || (cleanUrl.includes("/track/") ? "track" : cleanUrl.includes("/album/") ? "album" : cleanUrl.includes("/episode/") ? "episode" : cleanUrl.includes("/show/") ? "show" : "playlist");
    const rawTracks = details.tracks || (preview.title ? [{ name: preview.title, artist: preview.artist, duration: 180000, previewUrl: preview.audio }] : []);
    
    const tracks = rawTracks.map((t, idx) => {
      const name = t.name || t.title || `Track ${idx + 1}`;
      const artist = t.artist || preview.artist || "Spotify Artist";
      const spotifyTrackId = (t.uri && t.uri.startsWith("spotify:track:")) ? t.uri.split(":").pop() : null;
      const canonicalTrackUrl = spotifyTrackId ? `https://open.spotify.com/track/${spotifyTrackId}` : (t.url || cleanUrl);
      return {
        id: spotifyTrackId ? `sp_${spotifyTrackId}` : `sp_${Date.now()}_${idx + 1}`,
        title: name,
        artist: artist,
        duration: t.duration || 180000,
        artworkUrl: preview.image || "logo.png",
        query: `${artist} - ${name}`,
        previewUrl: t.previewUrl || preview.audio || null,
        url: canonicalTrackUrl,
        uri: t.uri || cleanUrl
      };
    });

    return {
      type: type,
      title: preview.title || (type === "track" ? tracks[0]?.title : "Spotify Playlist"),
      description: preview.description || `Imported Spotify ${type} (${tracks.length} tracks)`,
      artist: preview.artist || (tracks[0]?.artist || "Spotify"),
      image: preview.image || "logo.png",
      tracks: tracks,
      trackCount: tracks.length
    };
  } catch (err) {
    console.error("Error resolving Spotify link:", err.message);
    return null;
  }
}

/**
 * Filter Mode Parser for Dual Special Characters & Filterless Play:
 * - Special Character 1 ('#'): Filter 1 -> Strict Halal (Quran, Acapella Nasheed, Naat, Hamd, Duas)
 * - Special Character 2 ('*' or '$'): Filter 2 -> Islamic Remix & Vibes (Remix, Lofi, Waz, Bayan, Kalam, Gojol)
 * - No special char (or '~' / '-'): Filterless Play -> Completely unrestricted playback of ANY song / audio
 */
function parseQueryFilter(input) {
  let raw = (input || "").trim();
  // Strip command triggers if present in queries (e.g. "play now ...", "!playnow ...", "play ...")
  raw = raw.replace(/^(!|\/)?(playnow|play-now|play\s+now|pn|play|now)\s+/i, "").trim();
  let mode = "filterless";
  let query = raw;
  let badge = "⚪ [Filterless Mode 🎵]";

  if (raw.startsWith("*") || raw.startsWith("$")) {
    mode = "remix";
    query = raw.slice(1).trim();
    badge = "🟣 [Filter 2: * Islamic Remix & Vibes 🌙]";
  } else if (raw.startsWith("#")) {
    // If it's a remix/vibes/bayan hashtag like #IslamicRemix or #IslamicVibes, classify under Filter 2 (Remix & Vibes)
    const afterHash = raw.slice(1).trim().toLowerCase();
    if (
      afterHash.includes("remix") ||
      afterHash.includes("vibes") ||
      afterHash.includes("lofi") ||
      afterHash.includes("slowed") ||
      afterHash.includes("bayan") ||
      afterHash.includes("waz")
    ) {
      mode = "remix";
      query = raw; // Keep hashtag for search
      badge = "🟣 [Filter 2: * Islamic Remix & Vibes 🌙]";
    } else {
      mode = "strict";
      query = raw.slice(1).trim();
      badge = "🟢 [Filter 1: # Strict Halal 📖]";
    }
  } else if (raw.startsWith("~") || raw.startsWith("-")) {
    mode = "filterless";
    query = raw.slice(1).trim();
    badge = "⚪ [Filterless Mode 🎵]";
  }

  // Ensure any secondary play command triggers inside query are also stripped
  query = query.replace(/^(!|\/)?(playnow|play-now|play\s+now|pn|play|now)\s+/i, "").trim();

  return { mode, query, badge };
}

/**
 * Resolves metadata for any YouTube link (watch, youtu.be, shorts, music)
 * using YouTube's official oEmbed service (zero bot blocks, instantaneous <100ms response).
 */
async function resolveYouTubeMeta(url) {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const res = await fetch(oembedUrl);
    if (res.ok) {
      const data = await res.json();
      if (data && data.title) {
        return {
          title: data.title,
          author: data.author_name || ""
        };
      }
    }
  } catch (err) {
    console.warn("YouTube oEmbed fetch error:", err.message);
  }
  return null;
}

const directStreamCache = new Map();

/**
 * Uses yt-dlp to extract direct audio streams from YouTube links or searches.
 * Fast path: converts queries to direct video URLs via flat-search first (takes 1.5s instead of 25s).
 * Caches direct streams for 1 hour to ensure instant repeat playback.
 */
async function extractYouTubeStream(queryOrUrl) {
  const cacheKey = (queryOrUrl || "").trim().toLowerCase();
  if (directStreamCache.has(cacheKey)) {
    const cached = directStreamCache.get(cacheKey);
    if (Date.now() - cached.time < 3600000) {
      return cached.data;
    }
  }

  let streamMeta = null;
  let target = (queryOrUrl || "").trim();
  let isUrl = target.startsWith("http://") || target.startsWith("https://");

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

  if (!isUrl) {
    try {
      const searchRes = await searchYouTubeMulti(target, 1);
      if (searchRes && searchRes.length > 0 && searchRes[0].url) {
        streamMeta = searchRes[0];
        target = streamMeta.url;
      } else {
        target = `ytsearch1:${target}`;
      }
    } catch(e) {
      target = `ytsearch1:${target}`;
    }
  }

  // Strip playlist parameter from individual video URLs to speed up extraction by 10x
  if ((target.includes("youtube.com") || target.includes("youtu.be")) && !target.startsWith("ytsearch")) {
    const vMatch = target.match(/[?&]v=([a-zA-Z0-9_-]{11})/i) || target.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/i) || target.match(/\/shorts\/([a-zA-Z0-9_-]{11})/i);
    if (vMatch && vMatch[1]) {
      target = `https://www.youtube.com/watch?v=${vMatch[1]}`;
    }
  }

  return new Promise((resolve) => {
    executeYtDlp(
      ["-g", "--get-title", "--get-duration", "-f", "ba/ba*/bestaudio/b/best", "--no-playlist", "--no-warnings", target],
      { timeout: 35000 },
      (err, stdout) => {
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
            directStreamCache.set(cacheKey, { time: Date.now(), data });
            return resolve(data);
          }
        }

        // Fallback: full JSON extraction if -g failed
        executeYtDlp(
          ["-j", "-f", "ba/ba*/bestaudio/b/best", "--no-playlist", "--no-warnings", target],
          { maxBuffer: 15 * 1024 * 1024, timeout: 25000 },
          (err2, stdout2) => {
            if (err2 || !stdout2) return resolve(null);
            try {
              const firstLine = stdout2.trim().split("\n")[0];
              const info = JSON.parse(firstLine);
              if (info && info.url) {
                const data = {
                  title: streamMeta?.title || info.title || "YouTube Audio",
                  author: streamMeta?.author || info.uploader || info.channel || "YouTube",
                  duration: Math.round((info.duration || 0) * 1000) || streamMeta?.duration || 0,
                  streamUrl: info.url,
                  artworkUrl: streamMeta?.artworkUrl || info.thumbnail || "logo.png"
                };
                directStreamCache.set(cacheKey, { time: Date.now(), data });
                resolve(data);
              } else {
                resolve(null);
              }
            } catch (e) {
              resolve(null);
            }
          }
        );
      }
    );
  });
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

function buildLavalinkNodes() {
  const nodes = [];
  const auth = process.env.LAVALINK_AUTH || "youshallnotpass";
  const isCloud = Boolean(process.env.RENDER || process.env.RAILWAY_ENVIRONMENT || process.env.HEROKU_APP_NAME || process.env.FLY_APP_NAME);

  if (process.env.LAVALINK_URL) {
    try {
      const u = new URL(process.env.LAVALINK_URL);
      nodes.push({
        id: "env-lavalink",
        authorization: auth,
        host: u.hostname,
        port: u.port ? parseInt(u.port, 10) : (u.protocol === "https:" ? 443 : 80),
        secure: u.protocol === "https:" || u.port === "443"
      });
    } catch (e) {
      console.warn("Failed to parse LAVALINK_URL:", e.message);
    }
  } else if (process.env.LAVALINK_HOST) {
    nodes.push({
      id: "env-host",
      authorization: auth,
      host: process.env.LAVALINK_HOST,
      port: parseInt(process.env.LAVALINK_PORT || "2334", 10),
      secure: process.env.LAVALINK_SECURE === "true"
    });
  }

  const cloudNode = {
    id: "jirayu-cloud",
    authorization: auth,
    host: "lavalink.jirayu.net",
    port: 13592,
    secure: false
  };

  const localNode = {
    id: "local-lavalink",
    authorization: auth,
    host: "127.0.0.1",
    port: 2334,
    secure: false
  };

  if (isCloud) {
    nodes.push(cloudNode);
    nodes.push(localNode);
  } else {
    nodes.push(localNode);
    nodes.push(cloudNode);
  }

  return nodes;
}

const lavalink = new LavalinkManager({
  nodes: buildLavalinkNodes(),
  sendToShard: (guildId, payload) => client.guilds.cache.get(guildId)?.shard?.send(payload),
  client: {
    id: process.env.CLIENT_ID || "1559615126406168646",
    username: "SpySecMusic"
  }
});

client.on("raw", (d) => {
  try {
    lavalink.sendRawData(d);
  } catch (err) {
    // Ignore packet if Lavalink node is connecting or in transition
  }
});

client.on("error", (err) => {
  console.warn("Discord Client warning/error:", err.message);
});

lavalink.nodeManager.on("error", (node, error) => {
  console.error("Lavalink Node error:", error?.message || error);
});

// Guild Track History store (for Previous button and Queue history)
const trackHistory = new Map();

// Guild Song Announcement Channel Store (customized via keyword 'send' or UI selector)
const announcementChannels = new Map();
const ANNOUNCEMENTS_FILE = path.join(__dirname, "data", "announcements.json");

function loadStoredAnnouncements() {
  try {
    if (fs.existsSync(ANNOUNCEMENTS_FILE)) {
      const raw = fs.readFileSync(ANNOUNCEMENTS_FILE, "utf8");
      const obj = JSON.parse(raw);
      for (const [gId, cId] of Object.entries(obj)) {
        announcementChannels.set(gId, cId);
      }
    }
  } catch (e) {
    console.error("Failed to load stored announcements:", e);
  }
}

function saveStoredAnnouncements() {
  try {
    const dir = path.dirname(ANNOUNCEMENTS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const obj = {};
    for (const [gId, cId] of announcementChannels.entries()) {
      obj[gId] = cId;
    }
    fs.writeFileSync(ANNOUNCEMENTS_FILE, JSON.stringify(obj, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to save announcements:", e);
  }
}

// Load initially stored channels
loadStoredAnnouncements();

// Default Announcement Channel name and ID (#music)
const DEFAULT_ANNOUNCEMENT_CHANNEL_NAME = "music";
const DEFAULT_ANNOUNCEMENT_CHANNEL_ID = "1559799364732452915";

function getAnnouncementChannelId(guildId, fallbackId = null) {
  if (guildId && announcementChannels.has(guildId)) {
    return announcementChannels.get(guildId);
  }
  if (guildId) {
    const guild = client.guilds.cache.get(guildId);
    if (guild) {
      const musicChan = guild.channels.cache.find(c =>
        (c.isTextBased?.() || c.type === 0) && c.name.toLowerCase() === DEFAULT_ANNOUNCEMENT_CHANNEL_NAME
      );
      if (musicChan) return musicChan.id;

      const defChan = guild.channels.cache.get(DEFAULT_ANNOUNCEMENT_CHANNEL_ID);
      if (defChan) return defChan.id;

      const firstText = guild.channels.cache.find(c => (c.isTextBased?.() || c.type === 0));
      if (firstText) return firstText.id;
    }
  }
  return fallbackId || DEFAULT_ANNOUNCEMENT_CHANNEL_ID;
}

let channelsVersion = Date.now();

function getAllGuildServersWithChannels() {
  const servers = [];
  const flatChannels = [];

  for (const guild of client.guilds.cache.values()) {
    const activeAnnounceId = getAnnouncementChannelId(guild.id);
    const textChannels = Array.from(guild.channels.cache.values())
      .filter(c => (c.isTextBased?.() || c.type === 0))
      .sort((a, b) => (a.rawPosition || 0) - (b.rawPosition || 0))
      .map(c => ({
        id: c.id,
        name: c.name,
        guildId: guild.id,
        guildName: guild.name,
        category: c.parent?.name || null,
        isAnnouncement: c.id === activeAnnounceId
      }));

    textChannels.forEach(c => flatChannels.push(c));

    servers.push({
      guildId: guild.id,
      guildName: guild.name,
      guildIcon: guild.iconURL ? guild.iconURL({ dynamic: true, size: 64 }) : null,
      memberCount: guild.memberCount || 0,
      announcementChannelId: activeAnnounceId,
      announcementChannelName: guild.channels.cache.get(activeAnnounceId)?.name || "music",
      channels: textChannels
    });
  }

  return { servers, flatChannels };
}

function addToHistory(guildId, track) {
  if (!guildId || !track) return;
  if (!trackHistory.has(guildId)) trackHistory.set(guildId, []);
  const list = trackHistory.get(guildId);
  list.push(track);
  if (list.length > 25) list.shift();
}

lavalink.on("trackStart", async (player, track) => {
  const mode = track?.userData?.filterMode || "filterless";
  const validation = validateByFilterMode(mode, track);
  const targetChannelId = getAnnouncementChannelId(player.guildId, player.textChannelId);

  if (!validation.allowed) {
    console.warn(`🚨 [FILTER REJECTED] Track intercepted: "${track?.info?.title}" by "${track?.info?.author}" under mode [${mode}]. Stopping!`);
    await player.stopPlaying();
    const textChannel = client.channels.cache.get(targetChannelId);
    textChannel?.send({
      content: `🚫 **Stream Terminated by ${mode === "strict" ? "Strict Halal Filter (#)" : "Islamic Remix Filter (*)"}:**\n**"${track?.info?.title}"** was stopped: ${validation.reason}.\n💡 *To play without restrictions, use Filterless Play:* \`!play ${track?.info?.title}\``
    }).catch(() => {});
    return;
  }

  // Auto-apply Equalizer preset tailored to each filter mode
  try {
    if (mode === "strict") {
      await player.filterManager.setEQPreset("FullSound"); // Vocal clarity & Quran recitation focus
    } else if (mode === "remix") {
      await player.filterManager.setEQPreset("BetterMusic"); // Warm bass & reverbed ambiance
    } else {
      await player.filterManager.clearEQ(); // Flat, pure original sound
    }
  } catch (eqErr) {}

  console.log(`🎵 [Lavalink] Track started [Mode: ${mode}]: ${track?.info?.title} by ${track?.info?.author}`);
  addToHistory(player.guildId, track);

  const textChannel = client.channels.cache.get(targetChannelId);
  if (textChannel) {
    textChannel.send(createControlPanel(player, mode)).catch(() => {});
  }
});

lavalink.on("trackError", async (player, track, payload) => {
  const errMsg = payload?.exception?.message || payload?.message || "";
  console.error(`❌ [Lavalink] Track error on "${track?.info?.title}":`, errMsg);
  const textChannel = client.channels.cache.get(getAnnouncementChannelId(player.guildId, player.textChannelId));

  // Auto-recovery for stream failures using alternative search:
  if (!track?.userData?.mirrored) {
    try {
      const q = track?.info?.title || "";
      if (q) {
        console.log(`🔄 [Auto-Recovery] Attempting mirror search for "${q}"...`);
        const scRes = await player.search({ query: `scsearch:${q}` }, track?.userData?.requester || { username: "AutoRecovery" });
        if (scRes?.tracks?.length) {
          const mirrorTrack = scRes.tracks[0];
          mirrorTrack.userData = { ...(track.userData || {}), mirrored: true };
          await player.play({ clientTrack: mirrorTrack });
          textChannel?.send({
            content: `🔄 **Seamless Audio Recovery:** Connected alternative audio stream for **"${q}"** 🎧`
          }).catch(() => {});
          return;
        }
      }
    } catch (mErr) {
      console.error("Auto-recovery failed:", mErr.message);
    }
  }

  // If not recovered, send clean notice without raw Java stack traces
  if (!errMsg.includes("All clients failed")) {
    const shortErr = (errMsg || "Format loading issue").split("\n")[0].slice(0, 180);
    textChannel?.send({
      content: `⚠️ **Stream Notice:** ${shortErr}.\n💡 *Tip: Tap a button on the Control Panel for instant high-speed CDN audio.*`
    }).catch(() => {});
  }
});

lavalink.on("trackStuck", (player, track, payload) => {
  console.error(`⚠️ [Lavalink] Track stuck:`, payload);
});

lavalink.on("queueEnd", async (player, track, payload) => {
  const seed = track || (player.queue?.previous?.length > 0 ? player.queue.previous[player.queue.previous.length - 1] : null);
  if (!seed) return;
  const targetChannelId = getAnnouncementChannelId(player.guildId, player.textChannelId);
  const textChannel = client.channels.cache.get(targetChannelId);

  try {
    const seedTitle = seed.info?.title || seed.title || "";
    const seedAuthor = seed.info?.author || seed.author || "";
    const mode = track?.userData?.filterMode || "filterless";
    console.log(`📻 [Lavalink Autoplay] Voice queue finished! Generating radio for: "${seedTitle}" by "${seedAuthor}"`);

    const radio = await generateRadioStation(seedTitle, seedAuthor, mode, 6);
    if (radio && radio.length > 0) {
      for (const t of radio) {
        const q = t.url || `${t.title} ${t.author}`;
        const res = await player.search({ query: q }, track?.userData?.requester || { username: "Spotify Radio" });
        if (res?.tracks?.length) {
          const found = res.tracks[0];
          found.userData = { ...(track?.userData || {}), isRadio: true, radioSeed: seedTitle };
          player.queue.add(found);
        }
      }
      if (!player.playing && player.queue.tracks.length > 0) {
        await player.play();
        textChannel?.send({
          content: `📻 **Spotify Infinite Radio Active:** Queue finished! Auto-playing songs inspired by **"${seedTitle}"** 🎧`
        }).catch(() => {});
      }
    }
  } catch (err) {
    console.error("Lavalink queueEnd radio error:", err.message);
  }
});

function resolveSurah(input) {
  const info = resolveSurahInfo(input);
  if (info) return info.number;
  const num = parseInt(input);
  if (!isNaN(num) && num >= 1 && num <= 114) {
    return num;
  }
  return null;
}

function formatTime(ms) {
  if (!ms || isNaN(ms)) return "00:00";
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function createProgressBar(currentMs, totalMs, size = 14) {
  if (!totalMs || totalMs <= 0) return "🔴 LIVE STREAM ──────────────";
  const progress = Math.min(Math.max(currentMs / totalMs, 0), 1);
  const progressChars = Math.round(size * progress);
  const emptyChars = Math.max(0, size - progressChars);
  const bar = "━".repeat(Math.max(0, progressChars - 1)) + "🔘" + "━".repeat(emptyChars);
  const cur = formatTime(currentMs);
  const tot = formatTime(totalMs);
  const pct = Math.round(progress * 100);
  return `${cur} ${bar} ${tot} [${pct}%]`;
}

// ==========================================================================
// SPOTIFY INFINITE RADIO & AUTOPLAY GENERATION ENGINE
// ==========================================================================
async function generateRadioStation(seedTitle, seedArtist, filterMode = "filterless", limit = 15) {
  const normTitle = (seedTitle || "").trim().toLowerCase();
  const normArtist = (seedArtist || "").trim();

  // 1. Quran Surah Progressive Recitation Radio
  const seedSurah = resolveSurahInfo(normTitle);
  if (seedSurah) {
    const startNum = seedSurah.number;
    const radio = [];
    for (let i = 1; i <= limit; i++) {
      const nextNum = ((startNum - 1 + i) % 114) + 1;
      const padded = String(nextNum).padStart(3, "0");
      const name = SURAH_NAMES[nextNum] || `Surah ${nextNum}`;
      const quranUrl = `https://download.quranicaudio.com/quran/mishari_rashid_al_3afasy/${padded}.mp3`;
      radio.push({
        id: `quran_surah_${nextNum}`,
        title: `Surah ${nextNum}: ${name}`,
        author: normArtist || "Mishary Rashid Alafasy",
        duration: 180000,
        artworkUrl: "logo.png",
        streamUrl: quranUrl,
        rawStreamUrl: quranUrl,
        url: quranUrl,
        source: "quran",
        isRadio: true,
        radioSeed: seedTitle
      });
    }
    return {
      tracks: radio,
      title: `Quran Progressive Radio (From Surah ${startNum}: ${seedSurah.name})`
    };
  }

  // 2. Music Radio via JioSaavn Search API & Multi Search
  const primaryArtist = (normArtist || "").split(/[,&x/]|feat\.|ft\./i)[0].trim();
  const cleanTitle = (seedTitle || "").replace(/\(.*?\)|\[.*?\]/g, "").trim();
  const normalizedSeed = cleanTitle.toLowerCase().replace(/[^a-z0-9]/g, "");

  const queryA = primaryArtist ? `${primaryArtist} top songs` : `${cleanTitle} hits`;
  const queryB = primaryArtist ? `${cleanTitle} ${primaryArtist}` : `${cleanTitle} similar`;

  const urlA = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&api_version=4&ctx=web6dot0&n=10&p=1&q=${encodeURIComponent(queryA)}`;
  const urlB = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&api_version=4&ctx=web6dot0&n=10&p=1&q=${encodeURIComponent(queryB)}`;

  const [resA, resB] = await Promise.all([
    fetch(urlA).then(r => r.json()).catch(() => ({ results: [] })),
    fetch(urlB).then(r => r.json()).catch(() => ({ results: [] }))
  ]);

  const rawList = [...(resA.results || []), ...(resB.results || [])];
  const seen = new Set();
  const tracks = [];

  for (const r of rawList) {
    if (!r || !r.title) continue;
    const tNorm = r.title.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (normalizedSeed && (tNorm.includes(normalizedSeed) || normalizedSeed.includes(tNorm))) continue;
    if (seen.has(tNorm)) continue;
    seen.add(tNorm);

    const cleanT = r.title.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'");
    const artists = r.more_info?.artistMap?.primary_artists?.map(a => a.name).join(", ") || r.subtitle || "Artist";
    const trackObj = {
      id: `saavn_${r.id}`,
      title: cleanT,
      author: artists,
      duration: Math.round(parseFloat(r.more_info?.duration || 0) * 1000),
      artworkUrl: (r.image || "").replace("150x150", "500x500"),
      url: r.perma_url || `https://www.jiosaavn.com/song/${r.id}`,
      source: "jiosaavn",
      isRadio: true,
      radioSeed: seedTitle
    };

    const validation = validateByFilterMode(filterMode, trackObj);
    if (!validation.allowed) continue;

    tracks.push(trackObj);
    if (tracks.length >= limit) break;
  }

  // If fewer than 5 tracks found from JioSaavn, augment with searchYouTubeMulti
  if (tracks.length < 5) {
    try {
      const ytQuery = primaryArtist ? `${primaryArtist} mix playlist` : `${cleanTitle} radio`;
      const ytResults = await searchYouTubeMulti(ytQuery, limit - tracks.length);
      for (const yt of ytResults) {
        if (!yt || !yt.title) continue;
        const ytNorm = yt.title.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (normalizedSeed && (ytNorm.includes(normalizedSeed) || normalizedSeed.includes(ytNorm))) continue;
        if (seen.has(ytNorm)) continue;
        seen.add(ytNorm);

        const validation = validateByFilterMode(filterMode, yt);
        if (!validation.allowed) continue;

        tracks.push({
          ...yt,
          isRadio: true,
          radioSeed: seedTitle
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

async function resolveTrackLyrics(title, artist, duration = 0) {
  const cleanTitle = (title || "").replace(/\(.*?\)|\[.*?\]/g, "").trim();
  const cleanArtist = (artist || "").split(/[,&x/]|feat\.|ft\./i)[0].trim();
  const cacheKey = `${cleanTitle.toLowerCase()}_${cleanArtist.toLowerCase()}`;
  if (lyricsCache.has(cacheKey)) {
    return lyricsCache.get(cacheKey);
  }

  // 1. Quran Surah English Translation / Guidance
  const lyricSurah = resolveSurahInfo(cleanTitle);
  if (lyricSurah) {
    const surahNum = lyricSurah.number;
    const surahName = SURAH_NAMES[surahNum] || lyricSurah.name || `Surah ${surahNum}`;
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
      headers: { "User-Agent": "TrackFinder/4.6" },
      signal: AbortSignal.timeout(6000)
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
      signal: AbortSignal.timeout(6000)
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

// Navigation & Loop Handlers
async function handlePrevious(player) {
  if (!player) return "No active player!";
  // If track has been playing for more than 6 seconds, seek to 0 (restart track)
  if (player.position > 6000) {
    await player.seek(0);
    return "⏮️ Replayed from the beginning.";
  }

  // Try queue previous or history
  let prevTrack = await player.queue.shiftPrevious();
  if (!prevTrack && trackHistory.has(player.guildId) && trackHistory.get(player.guildId).length > 0) {
    const list = trackHistory.get(player.guildId);
    // Pop the current track if it's top
    if (list.length > 1) {
      list.pop();
      prevTrack = list.pop();
    } else {
      prevTrack = list.pop();
    }
  }

  if (!prevTrack) {
    await player.seek(0);
    return "⏮️ Restarted current track (no earlier history found).";
  }

  if (player.queue.current) {
    player.queue.tracks.unshift(player.queue.current);
  }

  await player.play({ clientTrack: prevTrack });
  return `⏮️ Playing previous track: **${prevTrack.info.title}**`;
}

async function handleNext(player) {
  if (!player) return "No active player!";
  if (player.queue?.tracks?.length > 0) {
    if (player.queue.current) {
      addToHistory(player.guildId, player.queue.current);
    }
    await player.skip();
    return `⏭️ Skipped to: **${player.queue.current?.info?.title || "Next track"}**`;
  } else {
    // When queue is empty, connect to Spotify radio based on the seed track (current song or last song played)
    const seedTrack = player.queue.current || (trackHistory.get(player.guildId)?.length > 0 ? trackHistory.get(player.guildId).slice(-1)[0] : null);
    if (seedTrack) {
      const seedTitle = seedTrack.info?.title || seedTrack.title || "";
      const seedAuthor = seedTrack.info?.author || seedTrack.author || "";
      const mode = seedTrack.userData?.filterMode || "filterless";
      if (player.queue.current) {
        addToHistory(player.guildId, player.queue.current);
      }
      try {
        console.log(`📻 [Voice Autoplay] User requested next with empty queue! Connecting to radio for: "${seedTitle}" by "${seedAuthor}"`);
        const radio = await generateRadioStation(seedTitle, seedAuthor, mode, 8);
        if (radio && radio.length > 0) {
          for (const t of radio) {
            const q = t.url || `${t.title} ${t.author}`;
            const res = await player.search({ query: q }, seedTrack.userData?.requester || { username: "Spotify Radio" });
            if (res?.tracks?.length) {
              const found = res.tracks[0];
              found.userData = { ...(seedTrack.userData || {}), isRadio: true, radioSeed: seedTitle };
              player.queue.add(found);
            }
          }
          if (player.queue.tracks.length > 0) {
            await player.skip();
            return `📻 Connected to **${seedTitle} Radio**! Playing: **${player.queue.current?.info?.title || "Radio Track"}**`;
          }
        }
      } catch (err) {
        console.error("Voice Autoplay next error:", err.message);
      }
    }

    if (player.queue.current) {
      addToHistory(player.guildId, player.queue.current);
    }
    await player.stopPlaying();
    return "⏹️ Reached end of queue. Playback stopped.";
  }
}

async function handleLoop(player) {
  if (!player) return "No active player!";
  const currentMode = player.repeatMode || "off";
  let newMode = "off";
  let label = "Off (Play queue once)";
  if (currentMode === "off") {
    newMode = "track";
    label = "🔂 Repeating Current Track";
  } else if (currentMode === "track") {
    newMode = "queue";
    label = "🔁 Repeating Entire Queue";
  } else {
    newMode = "off";
    label = "➡️ Repeat Off";
  }
  await player.setRepeatMode(newMode);
  return `Loop mode set to: **${label}**`;
}

function createControlPanel(player = null, activeFilterMode = null) {
  const current = player?.queue?.current;
  const isPlaying = player?.playing;
  const isPaused = player?.paused;
  const position = player?.position || 0;
  const duration = current?.info?.duration || 0;
  const progressText = createProgressBar(position, duration);
  const loopMode = player?.repeatMode || "off";
  const loopLabel = loopMode === "track" ? "🔂 Track" : loopMode === "queue" ? "🔁 Queue" : "➡️ Off";
  const filterMode = activeFilterMode || current?.userData?.filterMode || "filterless";
  const filterBadge = filterMode === "strict" ? "🟢 [Filter 1: # Strict Halal]"
                    : filterMode === "remix" ? "🟣 [Filter 2: * Islamic Remix & Vibes]"
                    : "⚪ [Filterless Mode (Unrestricted)]";

  const embed = new EmbedBuilder()
    .setColor(filterMode === "strict" ? 0x059669 : filterMode === "remix" ? 0x8b5cf6 : 0x1ed760)
    .setTitle("🛡️ Spy Sec Music — Audio & Media Center")
    .setDescription(
      `### 🎧 Now Streaming:\n` +
      `**${current ? current.info.title : "Surah Ar-Rahman (Mishary Rashid Alafasy)"}**\n` +
      `*Artist / Reciter:* **${current?.info?.author || "Mishary Rashid Alafasy / Quran CDN"}**\n\n` +
      `\`${progressText}\`\n\n` +
      `• **Active Filter:** \`${filterBadge}\`\n` +
      `• **Status:** ${isPaused ? "⏸️ Paused" : isPlaying ? "▶️ Playing" : "⏹️ Ready / Idle"}\n` +
      `• **Loop Mode:** \`${loopLabel}\`\n` +
      `• **Voice Channel Bitrate:** \`96 kbps (Studio Master)\`\n` +
      `• **Upcoming:** \`${player?.queue?.tracks?.length || 0} tracks in queue\`\n` +
      `• **Spy Sec Web Player:** [Open Web Controller (Port 3050)](http://localhost:3050)\n\n` +
      `🎛️ **Dual Filter & Filterless Commands:**\n` +
      `• 🟢 \`!play #<query>\` (or \`!# <query>\`) → **Filter 1:** Strict Halal (Quran, Acapella Nasheed)\n` +
      `• 🟣 \`!play *<query>\` (or \`!* <query>\`) → **Filter 2:** Islamic Remix & Vibes (Waz, Bayan, Kalam)\n` +
      `• ⚪ \`!play <query>\` (or \`~query\`) → **Filterless Play:** Unrestricted music & songs`
    )
    .setFooter({ text: "Spy Sec Music • cyber_spy.404 Audio Engine • Port 2334" });

  if (current?.info?.artworkUrl) {
    embed.setThumbnail(current.info.artworkUrl);
  }

  // Row 1: Core Navigation & Transport
  const transportButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ctrl_prev").setLabel("Previous").setEmoji("⏮️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("ctrl_pause").setLabel(isPaused ? "Resume" : "Pause").setEmoji(isPaused ? "▶️" : "⏸️").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("ctrl_next").setLabel("Next").setEmoji("⏭️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("ctrl_stop").setLabel("Stop").setEmoji("⏹️").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("ctrl_loop").setLabel(loopMode === "track" ? "Loop: Track" : loopMode === "queue" ? "Loop: Queue" : "Loop: Off").setEmoji("🔁").setStyle(ButtonStyle.Secondary)
  );

  // Row 2: Featured 1-Click Plays + Spy Sec Web link
  const quickButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("play_rahman").setLabel("Ar-Rahman").setEmoji("📖").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("play_yasin").setLabel("Ya-Sin").setEmoji("📖").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("play_mulk").setLabel("Al-Mulk").setEmoji("📖").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("play_hasbi").setLabel("Hasbi Rabbi").setEmoji("🎵").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setLabel("Spy Sec Web Player").setEmoji("🌐").setStyle(ButtonStyle.Link).setURL("http://localhost:3050")
  );

  // Row 3: Full 114 Surah Select Menu
  const surahSelect = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("select_surah")
      .setPlaceholder("📜 Choose a Surah (1-114)...")
      .addOptions([
        { label: "Surah 1: Al-Fatihah", value: "1", emoji: "📖" },
        { label: "Surah 2: Al-Baqarah", value: "2", emoji: "📖" },
        { label: "Surah 18: Al-Kahf", value: "18", emoji: "📖" },
        { label: "Surah 36: Ya-Sin", value: "36", emoji: "📖" },
        { label: "Surah 55: Ar-Rahman", value: "55", emoji: "📖" },
        { label: "Surah 56: Al-Waqi'ah", value: "56", emoji: "📖" },
        { label: "Surah 67: Al-Mulk", value: "67", emoji: "📖" },
        { label: "Surah 112: Al-Ikhlas", value: "112", emoji: "📖" },
        { label: "Surah 113: Al-Falaq", value: "113", emoji: "📖" },
        { label: "Surah 114: An-Nas", value: "114", emoji: "📖" }
      ])
  );

  return { embeds: [embed], components: [transportButtons, quickButtons, surahSelect] };
}

async function getOrCreatePlayer(guild, voiceChannelId, textChannelId) {
  const channel = guild.channels.cache.get(voiceChannelId);
  if (channel && channel.bitrate < guild.maximumBitrate) {
    channel.setBitrate(guild.maximumBitrate).catch(() => {});
  }
  const preferredTextChannel = getAnnouncementChannelId(guild.id, textChannelId);
  let player = lavalink.getPlayer(guild.id);
  if (!player) {
    player = await lavalink.createPlayer({
      guildId: guild.id,
      voiceChannelId: voiceChannelId,
      textChannelId: preferredTextChannel,
      selfDeaf: false,
      selfMute: false,
      volume: 100
    });
  } else {
    player.textChannelId = preferredTextChannel;
    if (voiceChannelId && player.voiceChannelId !== voiceChannelId) {
      player.voiceChannelId = voiceChannelId;
    }
  }
  if (!player.connected) await player.connect();
  return player;
}

/**
 * Robust Lavalink track resolution for Discord Voice:
 * 1. Direct URLs (YouTube, SoundCloud, direct MP3 CDN)
 * 2. Native YouTube search via youtube-plugin (ytsearch:) - primary, zero 403, 100% reliable
 * 3. YouTube Music search (ytmsearch:)
 * 4. SoundCloud search (scsearch:)
 * 5. Stream extractor fallback (yt-dlp)
 */
async function resolveLavalinkTrack(player, query, requester, mode = "filterless") {
  if (!query || typeof query !== "string") return null;
  const target = query.trim();
  const isUrl = target.startsWith("http://") || target.startsWith("https://");

  // 1. Direct URL (YouTube, SoundCloud, direct MP3/M4A)
  if (isUrl) {
    try {
      const res = await player.search({ query: target }, requester);
      if (res?.tracks?.length) {
        if (mode === "filterless") return res.tracks[0];
        const match = res.tracks.find(t => validateByFilterMode(mode, t).allowed);
        if (match) return match;
      }
    } catch (e) {
      console.warn("Direct URL Lavalink search notice:", e.message);
    }
  }

  // 2. Native YouTube search via youtube-plugin (Primary, zero 403, crystal-clear audio in Discord Voice)
  try {
    const resYt = await player.search({ query: `ytsearch:${target}` }, requester);
    if (resYt?.tracks?.length) {
      if (mode === "filterless") return resYt.tracks[0];
      const match = resYt.tracks.find(t => validateByFilterMode(mode, t).allowed);
      if (match) return match;
    }
  } catch (ytErr) {
    console.warn("ytsearch Lavalink notice:", ytErr.message);
  }

  // 3. Fallback: YouTube Music
  try {
    const resYtm = await player.search({ query: `ytmsearch:${target}` }, requester);
    if (resYtm?.tracks?.length) {
      if (mode === "filterless") return resYtm.tracks[0];
      const match = resYtm.tracks.find(t => validateByFilterMode(mode, t).allowed);
      if (match) return match;
    }
  } catch (ytmErr) {}

  // 4. Fallback: SoundCloud
  try {
    const resSc = await player.search({ query: `scsearch:${target}` }, requester);
    if (resSc?.tracks?.length) {
      if (mode === "filterless") return resSc.tracks[0];
      const match = resSc.tracks.find(t => validateByFilterMode(mode, t).allowed);
      if (match) return match;
    }
  } catch (scErr) {}

  // 5. Ultimate Fallback: Direct stream extraction via yt-dlp
  try {
    const streamInfo = await extractYouTubeStream(target);
    if (streamInfo && streamInfo.streamUrl) {
      const httpRes = await player.search({ query: streamInfo.streamUrl }, requester);
      if (httpRes?.tracks?.length) {
        const tr = httpRes.tracks[0];
        tr.info.title = streamInfo.title || tr.info.title;
        tr.info.author = streamInfo.author || tr.info.author;
        if (streamInfo.duration) tr.info.duration = streamInfo.duration;
        if (streamInfo.artworkUrl) tr.info.artworkUrl = streamInfo.artworkUrl;
        if (mode === "filterless" || validateByFilterMode(mode, tr).allowed) {
          return tr;
        }
      }
    }
  } catch (dlpErr) {}

  return null;
}

async function playSurahDirect(player, surahNum, requester) {
  const padded = String(surahNum).padStart(3, "0");
  const url = `https://download.quranicaudio.com/quran/mishaari_raashid_al_3afaasee/${padded}.mp3`;
  const res = await player.search({ query: url }, requester);
  if (res?.tracks?.length) {
    const tr = res.tracks[0];
    tr.userData = { streamUrl: url, filterMode: "strict", requester };
    player.queue.add(tr);
    if (!player.playing) await player.play();
    return tr;
  }
  return null;
}

lavalink.nodeManager.on("connect", async (node) => {
  console.log("🎵 Lavalink connected to node!");
  const guild = client.guilds.cache.get("1553640111047180448");
  if (!guild) return;

  const announceId = getAnnouncementChannelId(guild.id);
  const textChannel = guild.channels.cache.get(announceId);
  if (textChannel) {
    textChannel.send(createControlPanel()).catch(() => {});
  }

  let vs = guild.voiceStates.cache.get("1215714832997949481");
  if (!vs || !vs.channelId) {
    vs = guild.voiceStates.cache.find(v => v.channelId);
  }

  if (!vs || !vs.channelId) {
    console.log("No user in voice channel right now.");
    return;
  }

  console.log(`Connecting to voice channel: ${vs.channel?.name || vs.channelId}`);
  try {
    await getOrCreatePlayer(guild, vs.channelId, announceId);
    console.log("Discord Voice handshake complete!");
  } catch (err) {
    console.error("Voice connect error:", err);
  }
});

// Interactive Button & Dropdown Handlers (1-Click Controls)
client.on("interactionCreate", async (interaction) => {
  if (!interaction.guild) return;

  const member = interaction.member;
  const vc = member?.voice?.channel;
  if (!vc) {
    return interaction.reply({
      content: "⚠️ **Please join a voice channel first!**",
      ephemeral: true
    });
  }

  try {
    const player = await getOrCreatePlayer(interaction.guild, vc.id, interaction.channelId);

    if (interaction.isButton()) {
      await interaction.deferUpdate().catch(() => {});

      if (interaction.customId === "ctrl_prev") {
        const msg = await handlePrevious(player);
        interaction.channel?.send(msg).catch(() => {});
      } else if (interaction.customId === "ctrl_next") {
        const msg = await handleNext(player);
        interaction.channel?.send(msg).catch(() => {});
      } else if (interaction.customId === "ctrl_pause") {
        if (player.paused) await player.resume();
        else await player.pause();
        interaction.channel?.send(createControlPanel(player)).catch(() => {});
      } else if (interaction.customId === "ctrl_stop") {
        await player.destroy();
        interaction.channel?.send("⏹️ Playback stopped and player disconnected.").catch(() => {});
      } else if (interaction.customId === "ctrl_loop") {
        const msg = await handleLoop(player);
        interaction.channel?.send(msg).catch(() => {});
      } else if (interaction.customId === "play_rahman") {
        await playSurahDirect(player, 55, interaction.user);
      } else if (interaction.customId === "play_yasin") {
        await playSurahDirect(player, 36, interaction.user);
      } else if (interaction.customId === "play_mulk") {
        await playSurahDirect(player, 67, interaction.user);
      } else if (interaction.customId === "play_hasbi") {
        const res = await player.search({ query: "scsearch:hasbi rabbi sami yusuf" }, interaction.user);
        if (res?.tracks?.length) {
          player.queue.add(res.tracks[0]);
          if (!player.playing) await player.play();
        }
      }
    } else if (interaction.isStringSelectMenu() && interaction.customId === "select_surah") {
      await interaction.deferUpdate().catch(() => {});
      const surahNum = parseInt(interaction.values[0]) || 1;
      await playSurahDirect(player, surahNum, interaction.user);
    }
  } catch (err) {
    console.error("Interaction error:", err);
  }
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;

  const prefix = "!";
  let command = "";
  let args = [];

  const trimmed = message.content.trim();
  const lowerTrimmed = trimmed.toLowerCase();
  const detectedSpotify = extractSpotifyUrl(trimmed);
  if (trimmed.startsWith(prefix)) {
    args = trimmed.slice(prefix.length).trim().split(/ +/);
    command = args.shift().toLowerCase();
  } else if (lowerTrimmed.startsWith("send ") || lowerTrimmed === "send") {
    // Support keyword "send" directly without prefix
    args = trimmed.split(/ +/);
    command = args.shift().toLowerCase();
  } else if (lowerTrimmed.startsWith("play now ") || lowerTrimmed.startsWith("playnow ") || lowerTrimmed.startsWith("pn ")) {
    args = trimmed.split(/ +/);
    const firstWord = args.shift().toLowerCase();
    if (firstWord === "play" && args[0]?.toLowerCase() === "now") {
      args.shift();
    }
    command = "playnow";
  } else if (lowerTrimmed.startsWith("play ") || lowerTrimmed.startsWith("p ")) {
    args = trimmed.split(/ +/);
    command = args.shift().toLowerCase();
  } else if (lowerTrimmed === "music" || lowerTrimmed === "!music") {
    command = "music";
  } else if (detectedSpotify) {
    command = "spotify";
    args = [detectedSpotify];
  } else {
    return;
  }

  // Change / Set Song Announcement Channel via keyword "send"
  if (command === "send" || command === "channel" || command === "setchannel" || command === "announcement") {
    let targetChannel = message.mentions.channels.first();
    const arg0 = args[0]?.toLowerCase();

    if (!targetChannel) {
      if (!arg0 || arg0 === "here" || arg0 === "this" || arg0 === "current") {
        targetChannel = message.channel;
      } else if (arg0 === "status" || arg0 === "get" || arg0 === "info") {
        const curId = getAnnouncementChannelId(message.guild.id);
        const curCh = message.guild.channels.cache.get(curId);
        return message.channel.send(`📢 **Current Song Announcement Channel:** ${curCh ? `<#${curCh.id}> (\`#${curCh.name}\`)` : `\`${curId}\``}`);
      } else {
        const rawArg = args.join(" ").replace(/^[#<@!&>]+/, "").trim().toLowerCase();
        targetChannel = message.guild.channels.cache.find(c => 
          (c.isTextBased?.() || c.type === 0) && (c.id === rawArg || c.name.toLowerCase() === rawArg)
        );
      }
    }

    if (!targetChannel || (!targetChannel.isTextBased?.() && targetChannel.type !== 0)) {
      return message.channel.send(
        `⚠️ **Could not find text channel.**\n` +
        `• **Usage:** \`!send #channel\`, \`!send here\`, or \`send <channel-name>\`\n` +
        `• **Examples:**\n` +
        `  - \`!send #general\`\n` +
        `  - \`send here\` *(sets current channel)*\n` +
        `  - \`!send music-chat\``
      );
    }

    announcementChannels.set(message.guild.id, targetChannel.id);
    const player = lavalink.getPlayer(message.guild.id);
    if (player) {
      player.textChannelId = targetChannel.id;
    }

    const embed = new EmbedBuilder()
      .setColor(0xe59819)
      .setTitle("📢 Song Announcement Channel Updated!")
      .setDescription(
        `✅ All future **Now Playing songs**, **Control Panels**, and **Audio Alerts** will now be sent to <#${targetChannel.id}> (\`#${targetChannel.name}\`).\n\n` +
        `• **Configured By:** ${message.author}\n` +
        `• **Keyword Used:** \`${command}\`\n` +
        `• **Target Channel ID:** \`${targetChannel.id}\`\n` +
        `• **Spy Sec Web Controller:** [Open http://localhost:3050](http://localhost:3050)`
      )
      .setFooter({ text: "Spy Sec Music Audio Engine • cyber_spy.404" })
      .setTimestamp();

    await message.channel.send({ embeds: [embed] });

    if (targetChannel.id !== message.channel.id) {
      targetChannel.send({
        content: `🎵 **Song Announcement Channel Activated!** Now playing songs and music controls will be announced here.`
      }).catch(() => {});
    }
    return;
  }

  // Control Panel & Now Playing with Live Progress Bar
  if (command === "panel" || command === "np" || command === "nowplaying" || command === "progress") {
    const player = lavalink.getPlayer(message.guild.id);
    return message.channel.send(createControlPanel(player));
  }

  // Previous Track
  if (command === "prev" || command === "previous") {
    const player = lavalink.getPlayer(message.guild.id);
    if (!player) return message.channel.send("No active player!");
    const msg = await handlePrevious(player);
    return message.channel.send(msg);
  }

  // Next / Skip Track
  if (command === "next" || command === "skip" || command === "n") {
    const player = lavalink.getPlayer(message.guild.id);
    if (!player) return message.channel.send("No active player!");
    const msg = await handleNext(player);
    return message.channel.send(msg);
  }

  // Loop mode
  if (command === "loop" || command === "repeat") {
    const player = lavalink.getPlayer(message.guild.id);
    if (!player) return message.channel.send("No active player!");
    const msg = await handleLoop(player);
    return message.channel.send(msg);
  }

  // Seek
  if (command === "seek") {
    const player = lavalink.getPlayer(message.guild.id);
    if (!player) return message.channel.send("No active player!");
    const input = args[0];
    if (!input) return message.channel.send("Specify timestamp to seek to (e.g. `!seek 1:30` or `!seek 90`)");

    let seconds = 0;
    if (input.includes(":")) {
      const parts = input.split(":").map(Number);
      if (parts.length === 2) seconds = parts[0] * 60 + parts[1];
      else if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else {
      seconds = Number(input);
    }
    if (isNaN(seconds) || seconds < 0) return message.channel.send("Invalid timestamp format.");
    await player.seek(seconds * 1000);
    return message.channel.send(`⏩ Seeked to **${formatTime(seconds * 1000)}**`);
  }

  // Queue Command
  if (command === "queue" || command === "q") {
    const player = lavalink.getPlayer(message.guild.id);
    if (!player) return message.channel.send("No active player!");

    const current = player.queue.current;
    const upcoming = player.queue.tracks || [];
    const history = trackHistory.get(message.guild.id) || [];

    let desc = `**Now Playing:**\n${current ? `▶️ **${current.info.title}** (${formatTime(current.info.duration)})` : "None"}\n\n`;
    desc += `**Upcoming Queue (${upcoming.length}):**\n`;
    if (upcoming.length === 0) {
      desc += "*No tracks waiting in queue.*\n";
    } else {
      desc += upcoming.slice(0, 8).map((t, i) => `${i + 1}. **${t.info.title}** (${formatTime(t.info.duration)})`).join("\n") + "\n";
    }

    if (history.length > 0) {
      desc += `\n**Recently Played:**\n${history.slice(-3).reverse().map(t => `• *${t.info.title}*`).join("\n")}`;
    }

    const embed = new EmbedBuilder()
      .setColor(0x10b981)
      .setTitle("📋 Spy Sec Music — Playback Queue")
      .setDescription(desc)
      .setFooter({ text: "Use !next to skip or !prev to go back • Port 2334" });

    return message.channel.send({ embeds: [embed] });
  }

  // Filter guide command
  if (command === "filters" || command === "filter" || command === "modes") {
    const embed = new EmbedBuilder()
      .setColor(0x059669)
      .setTitle("🎛️ Spy Sec Audio Engine — Dual Filter & Filterless Guide")
      .setDescription(
        `### Two Special Characters for Two Distinct Filters + Filterless Play:\n\n` +
        `🟢 **1. Special Character \`#\` → Filter 1: Strict Halal & Quran**\n` +
        `• **Usage:** \`!play #<query>\` or \`!# <query>\`\n` +
        `• **Content:** Holy Quran recitations, pure acapella Nasheeds, Naat, Hamd, Duas, Adhan.\n` +
        `• **Enforcement:** Zero musical instruments, no DJ beats, strictly blocks secular songs.\n` +
        `• **Audio DSP:** Crystal Clear Vocals & Recitation clarity EQ preset.\n\n` +
        `🟣 **2. Special Character \`*\` (or \`$\`) → Filter 2: Islamic Remix & Spiritual Vibes**\n` +
        `• **Usage:** \`!play *<query>\` or \`!* <query>\` (or \`!play $<query>\`)\n` +
        `• **Content:** #IslamicRemix, #IslamicVibes, Halal Lofi / Slowed Reverb, Emotional Bayan, Waz lectures, Bengali Gojols, Kalam.\n` +
        `• **Enforcement:** Permits Islamic remixes & speeches, blocks vulgar/secular club music.\n` +
        `• **Audio DSP:** Warm Bass & Spiritual Reverb ambiance EQ preset.\n\n` +
        `⚪ **3. Normal Play (No Special Character) → Filterless Play**\n` +
        `• **Usage:** \`!play <query>\` or \`!raw <query>\` (or \`!play ~<query>\`)\n` +
        `• **Content:** Pure unrestricted audio playback of ANY song, music, video, or track.\n` +
        `• **Enforcement:** Zero filters, zero blocks, no restrictions.\n` +
        `• **Audio DSP:** Natural / Flat studio output.`
      )
      .setFooter({ text: "Type !panel to view current live player and controls" });
    return message.channel.send({ embeds: [embed] });
  }

  // Play & Play Now Commands supporting Dual Filters, Spotify Playlists, & Filterless Play
  const isNowCmdWithArgs = command === "now" && args.length > 0;
  const playCmds = [
    "play", "p", "playnow", "pn", "play-now",
    "spotify", "sp", "strict", "halal", "#", "remix", "vibes", "*", "$", "raw", "unfiltered"
  ];
  if (playCmds.includes(command) || isNowCmdWithArgs) {
    try {
      let isPlayNow = command === "playnow" || command === "pn" || command === "play-now" || isNowCmdWithArgs;
      if (args[0] && (args[0].toLowerCase() === "now" || args[0].toLowerCase() === "--now" || args[0].toLowerCase() === "-now")) {
        isPlayNow = true;
        args.shift();
      }

      let rawQuery = args.join(" ").trim();
      let forcedMode = null;
      if (command === "strict" || command === "halal" || command === "#") forcedMode = "strict";
      else if (command === "remix" || command === "vibes" || command === "*" || command === "$") forcedMode = "remix";
      else if (command === "raw" || command === "unfiltered") forcedMode = "filterless";

      if (!rawQuery) {
        return message.channel.send(
          `**🎵 How to Play & Play Now with Dual Filters & Filterless Mode:**\n` +
          `• ⚡ **Play Now (Instant Play):** \`!playnow <query>\` *(or \`!pn <query>\` / \`!play now <query>\`)*\n` +
          `• 🟢 **Spotify Playlists via Link:** \`!play <spotify-playlist-url>\` *(or \`!playnow <url>\`)*\n` +
          `• 🟢 **Filter 1 (Strict Halal):** \`!play #<query>\` *(or \`!playnow #<query>\`)*\n` +
          `• 🟣 **Filter 2 (Islamic Remix):** \`!play *<query>\` *(or \`!playnow *<query>\`)*\n` +
          `• ⚪ **Filterless Play:** \`!play <query>\` *(Unrestricted playback of any audio/song)*\n\n` +
          `*Type \`!filters\` for detailed filter documentation.*`
        );
      }

      const parsed = parseQueryFilter(rawQuery);
      const mode = forcedMode || parsed.mode;
      const query = forcedMode ? rawQuery : parsed.query;
      const badge = mode === "strict" ? "🟢 [Filter 1: # Strict Halal 📖]"
                  : mode === "remix" ? "🟣 [Filter 2: * Islamic Remix & Vibes 🌙]"
                  : "⚪ [Filterless Mode 🎵]";

      const isUrl = query.startsWith("http://") || query.startsWith("https://") || query.startsWith("spotify:");
      const isYouTube = isUrl && (query.includes("youtube.com") || query.includes("youtu.be"));

      // In Strict or Remix mode, check query keywords if it's NOT a URL (URLs are validated on resolved track metadata)
      if (mode !== "filterless" && !isUrl) {
        const queryCheck = validateByFilterMode(mode, query);
        if (!queryCheck.allowed) {
          return message.channel.send(
            `🚫 **Rejected by ${mode === "strict" ? "Strict Halal Filter (#)" : "Islamic Remix Filter (*)"}:**\n` +
            `*${queryCheck.reason}*\n\n` +
            `💡 *To play this without filtering, use Filterless Mode:* \`!play ${query}\``
          );
        }
      }

      const vc = message.member?.voice?.channel;
      if (!vc) return message.channel.send("⚠️ Join a voice channel first!");

      const player = await getOrCreatePlayer(message.guild, vc.id, message.channel.id);
      let res;
      let candidateTrack = null;
      let candidateTracks = null; // for playlists

      if (isUrl) {
        // Direct Spotify playlist / album / track resolution
        if (isSpotifyUrl(query)) {
          const announceChanId = getAnnouncementChannelId(message.guild.id, message.channel.id);
          const announceChan = client.channels.cache.get(announceChanId) || message.channel;
          const statusMsg = await message.channel.send(`⏳ **Fetching Spotify audio metadata from link...**`);

          const spotifyData = await resolveSpotifyLink(query);
          if (!spotifyData || !spotifyData.tracks?.length) {
            return statusMsg.edit(`⚠️ **Could not resolve Spotify link.** Please make sure the playlist/track is public.`);
          }

          const embed = new EmbedBuilder()
            .setColor(0x1ed760)
            .setTitle(`🟢 Spotify ${spotifyData.type.toUpperCase()}: ${spotifyData.title}`)
            .setDescription(
              `🎵 **${spotifyData.trackCount} Tracks** loaded.\n` +
              `• **Artist / Curator:** ${spotifyData.artist}\n` +
              `• **Voice Channel:** <#${vc.id}>\n` +
              `• **Announcements:** <#${announceChanId}>\n` +
              `• **Play Mode:** ${isPlayNow ? "⚡ **Playing Now (Immediate Play)**" : "▶️ Enqueued"}\n` +
              `• **Web Client:** [Open Web Player](http://localhost:3050)`
            )
            .setThumbnail(spotifyData.image)
            .setFooter({ text: "Spy Sec Music Spotify Engine • cyber_spy.404" })
            .setTimestamp();

          await statusMsg.edit({ content: "", embeds: [embed] }).catch(() => {});

          let startIdx = 0;
          const indexMatch = query.match(/[?&]index=(\d+)/i);
          if (indexMatch && indexMatch[1]) {
            const parsedIdx = parseInt(indexMatch[1], 10) - 1;
            if (parsedIdx >= 0 && parsedIdx < spotifyData.tracks.length) startIdx = parsedIdx;
          }
          const spTrackMatch = query.match(/\/track\/([a-zA-Z0-9]+)/i) || query.match(/spotify:track:([a-zA-Z0-9]+)/i);
          if (spTrackMatch && spTrackMatch[1]) {
            const tId = spTrackMatch[1];
            const fIdx = spotifyData.tracks.findIndex(t => (t.url && t.url.includes(tId)) || (t.id && t.id.includes(tId)));
            if (fIdx >= 0) startIdx = fIdx;
          }

          // Resolve & Play chosen track immediately
          const first = spotifyData.tracks[startIdx] || spotifyData.tracks[0];
          try {
            const tr = await resolveLavalinkTrack(player, first.query, message.author, mode);
            if (tr) {
              tr.userData = { filterMode: mode, requester: message.author };
              if (isPlayNow) {
                if (player.queue.current) addToHistory(message.guild.id, player.queue.current);
                if (player.paused) await player.resume();
                await player.play({ clientTrack: tr });
              } else {
                player.queue.add(tr);
                if (player.paused) await player.resume();
                if (!player.playing) await player.play();
              }
            }
          } catch(e) {
            console.error("Spotify stream resolution error:", e);
          }

          // Background enqueue remaining tracks (startIdx+1 to end, then 0 to startIdx)
          (async () => {
            const queueIndices = [];
            for (let i = startIdx + 1; i < spotifyData.tracks.length; i++) queueIndices.push(i);
            for (let i = 0; i < startIdx; i++) queueIndices.push(i);
            for (const i of queueIndices) {
              const spTrack = spotifyData.tracks[i];
              try {
                const tr = await resolveLavalinkTrack(player, spTrack.query, message.author, mode);
                if (tr) {
                  tr.userData = { filterMode: mode, requester: message.author };
                  player.queue.add(tr);
                  if (!player.playing && player.queue.tracks.length === 1) {
                    await player.play();
                  }
                }
              } catch(e) {}
            }
          })().catch(() => {});

          return;
        }

        // Direct YouTube playlist / mix resolution
        const ytPlaylistId = extractYouTubePlaylistId(query);
        if (ytPlaylistId) {
          const announceChanId = getAnnouncementChannelId(message.guild.id, message.channel.id);
          const announceChan = client.channels.cache.get(announceChanId) || message.channel;
          const statusMsg = await message.channel.send(`⏳ **Fetching YouTube playlist tracks...**`);

          const ytData = await resolvePlaylistTracks(query, 500);
          if (!ytData || !ytData.tracks?.length) {
            return statusMsg.edit(`⚠️ **Could not resolve YouTube playlist.** Please make sure the playlist is public.`);
          }

          const embed = new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle(`🔴 YouTube Playlist: ${ytData.title || ytData.name}`)
            .setDescription(
              `🎵 **${ytData.trackCount || ytData.tracks.length} Tracks** loaded.\n` +
              `• **Author / Channel:** ${ytData.author || "YouTube"}\n` +
              `• **Voice Channel:** <#${vc.id}>\n` +
              `• **Announcements:** <#${announceChanId}>\n` +
              `• **Play Mode:** ${isPlayNow ? "⚡ **Playing Now (Immediate Play)**" : "▶️ Enqueued"}\n` +
              `• **Web Client:** [Open Web Player](http://localhost:3050)`
            )
            .setThumbnail(ytData.artworkUrl || ytData.coverUrl || "logo.png")
            .setFooter({ text: "Spy Sec Music YouTube Engine • cyber_spy.404" })
            .setTimestamp();

          await statusMsg.edit({ content: "", embeds: [embed] }).catch(() => {});

          let startIdx = 0;
          const indexMatch = query.match(/[?&]index=(\d+)/i);
          if (indexMatch && indexMatch[1]) {
            const parsedIdx = parseInt(indexMatch[1], 10) - 1;
            if (parsedIdx >= 0 && parsedIdx < ytData.tracks.length) startIdx = parsedIdx;
          }
          const vMatch = query.match(/[?&]v=([a-zA-Z0-9_-]{11})/i);
          let fIdx = -1;
          if (vMatch && vMatch[1]) {
            fIdx = ytData.tracks.findIndex(t => t.id === vMatch[1] || (t.url && t.url.includes(vMatch[1])));
            if (fIdx >= 0) startIdx = fIdx;
          }

          let firstQ = null;
          if (vMatch && vMatch[1] && fIdx === -1) {
            firstQ = `https://www.youtube.com/watch?v=${vMatch[1]}`;
          } else {
            const first = ytData.tracks[startIdx] || ytData.tracks[0];
            firstQ = first.url || (first.id ? `https://www.youtube.com/watch?v=${first.id}` : first.query);
          }
          try {
            const tr = await resolveLavalinkTrack(player, firstQ, message.author, mode);
            if (tr) {
              tr.userData = { filterMode: mode, requester: message.author };
              if (isPlayNow) {
                if (player.queue.current) addToHistory(message.guild.id, player.queue.current);
                if (player.paused) await player.resume();
                await player.play({ clientTrack: tr });
              } else {
                player.queue.add(tr);
                if (player.paused) await player.resume();
                if (!player.playing) await player.play();
              }
            }
          } catch(e) {
            console.error("YouTube playlist track 1 stream resolution error:", e);
          }

          // Background enqueue remaining tracks
          (async () => {
            const queueIndices = [];
            for (let i = startIdx + 1; i < ytData.tracks.length; i++) queueIndices.push(i);
            for (let i = 0; i < startIdx; i++) queueIndices.push(i);

            for (const idx of queueIndices) {
              const item = ytData.tracks[idx];
              try {
                const itemQ = item.url || (item.id ? `https://www.youtube.com/watch?v=${item.id}` : item.query);
                const tr = await resolveLavalinkTrack(player, itemQ, message.author, mode);
                if (tr) {
                  tr.userData = { filterMode: mode, requester: message.author };
                  player.queue.add(tr);
                  if (!player.playing && player.queue.tracks.length === 1) {
                    await player.play();
                  }
                }
              } catch(e) {}
            }
          })().catch(() => {});

          return;
        }

        // Direct URLs (YouTube, SoundCloud, direct MP3s, etc.)
        candidateTrack = await resolveLavalinkTrack(player, query, message.author, mode);
      } else {
        // Query search via Lavalink (ytsearch, ytmsearch, scsearch)
        candidateTrack = await resolveLavalinkTrack(player, query, message.author, mode);
      }

      // Handle Playlist vs Single Track
      if (candidateTracks && candidateTracks.length > 0) {
        if (isPlayNow) {
          candidateTracks.forEach(t => {
            t.userData = { filterMode: mode, requester: message.author };
          });
          const first = candidateTracks.shift();
          if (candidateTracks.length > 0) {
            player.queue.tracks.unshift(...candidateTracks);
          }
          if (player.queue.current) addToHistory(message.guild.id, player.queue.current);
          message.channel.send(`⚡ **Playing Playlist Now:** Starting **${first.info.title}** immediately (+${candidateTracks.length} queued) 🎧`);
          if (player.paused) await player.resume();
          await player.play({ clientTrack: first });
        } else {
          candidateTracks.forEach(t => {
            t.userData = { filterMode: mode, requester: message.author };
            player.queue.add(t);
          });
          message.channel.send(`${badge}\n▶️ **Queued Playlist:** Added **${candidateTracks.length}** tracks to queue 🎧`);
          if (player.paused) await player.resume();
          if (!player.playing) await player.play();
        }
        return;
      }

      if (!candidateTrack) {
        if (mode === "filterless") {
          return message.channel.send(`❌ No search results found for **"${query}"**.`);
        } else {
          return message.channel.send(
            `🚫 **No approved audio found under ${badge}:**\n` +
            `Could not find a track matching **"${query}"** that satisfies ${mode === "strict" ? "Strict Halal" : "Islamic Remix"} criteria.\n\n` +
            `💡 *To play without restrictions, use Filterless Play:* \`!play ${query}\``
          );
        }
      }

      // Store filterMode in userData
      candidateTrack.userData = {
        filterMode: mode,
        requester: message.author
      };

      if (isPlayNow) {
        if (player.queue.current) addToHistory(message.guild.id, player.queue.current);
        message.channel.send(`⚡ **Playing Now:** **${candidateTrack.info.title}** by *${candidateTrack.info.author}* 🎧`);
        if (player.paused) await player.resume();
        await player.play({ clientTrack: candidateTrack });
      } else {
        player.queue.add(candidateTrack);
        message.channel.send(`${badge}\n▶️ Queued: **${candidateTrack.info.title}** by *${candidateTrack.info.author}* 🎧`);
        if (player.paused) await player.resume();
        if (!player.playing) await player.play();
      }
    } catch (e) {
      console.error(e);
      message.channel.send(`Error: ${(e.message || "Unknown").slice(0, 150)}`);
    }
  }

  if (command === "quran" || command === "surah") {
    try {
      let query = args.join(" ") || "55";
      const surahNum = resolveSurah(query) || 55;
      const vc = message.member?.voice?.channel;
      if (!vc) return message.channel.send("Join a voice channel first!");

      const player = await getOrCreatePlayer(message.guild, vc.id, message.channel.id);
      const track = await playSurahDirect(player, surahNum, message.author);
      const surahName = SURAH_NAMES[surahNum] || `Surah ${surahNum}`;
      if (track) {
        message.channel.send(`📖 **Streaming ${surahName} (Reciter: Mishary Rashid Alafasy)** 🎧`);
      }
    } catch (e) {
      console.error(e);
      message.channel.send(`Error: ${(e.message || "Unknown").slice(0, 150)}`);
    }
  }

  if (command === "stop") {
    const player = lavalink.getPlayer(message.guild.id);
    if (player) {
      await player.destroy();
      message.channel.send("⏹️ Stopped playback and disconnected from voice channel.");
    }
  }

  if (command === "volume" || command === "vol") {
    const vol = parseInt(args[0]);
    if (isNaN(vol) || vol < 1 || vol > 200) {
      return message.channel.send("🔊 Specify volume between 1 and 200 (e.g. `!volume 100`)");
    }
    const player = lavalink.getPlayer(message.guild.id);
    if (player) {
      await player.setVolume(vol);
      message.channel.send(`🔊 Volume set to **${vol}%**`);
    }
  }

  if (command === "eq" || command === "equalizer") {
    const preset = (args[0] || "").toLowerCase();
    const player = lavalink.getPlayer(message.guild.id);
    if (!player) return message.channel.send("No active player!");

    if (preset === "better" || preset === "clear") {
      await player.filterManager.setEQPreset("BetterMusic");
      return message.channel.send("🎚️ Equalizer set to: **BetterMusic (Crisp Vocals & Clarity)**");
    } else if (preset === "full" || preset === "hd") {
      await player.filterManager.setEQPreset("FullSound");
      return message.channel.send("🎚️ Equalizer set to: **FullSound (Rich Harmonic Boost)**");
    } else if (preset === "bass") {
      await player.filterManager.setEQPreset("BassboostMedium");
      return message.channel.send("🎚️ Equalizer set to: **BassBoost Medium**");
    } else if (preset === "off" || preset === "flat" || preset === "reset") {
      await player.filterManager.clearEQ();
    } else {
      return message.channel.send("🎚️ Available EQ options: `!eq better` (Vocal clarity), `!eq full` (Rich sound), `!eq bass`, `!eq off`");
    }
  }

  if (command === "send" || command === "channel" || command === "setchannel") {
    let targetChan = message.mentions.channels?.first();
    if (!targetChan && args[0]) {
      const raw = args[0].replace(/^[#<@!&>]+/, "").trim();
      targetChan = message.guild.channels.cache.find(c =>
        (c.isTextBased?.() || c.type === 0) && (c.id === raw || c.name.toLowerCase() === raw.toLowerCase())
      );
    }
    if (!targetChan) targetChan = message.channel;

    announcementChannels.set(message.guild.id, targetChan.id);
    saveStoredAnnouncements();
    channelsVersion = Date.now();
    const player = lavalink.getPlayer(message.guild.id);
    if (player) player.textChannelId = targetChan.id;

    return message.channel.send(`📢 **Song Announcement Channel updated!**\nNow playing embeds and song updates for **${message.guild.name}** will be sent to <#${targetChan.id}>.`);
  }

  if (command === "quality" || command === "status") {
    const vc = message.member?.voice?.channel;
    const bitrate = vc ? (vc.bitrate / 1000) : 96;
    message.channel.send(
      `💎 **Audio Quality Status:**\n` +
      `• **Voice Channel Bitrate:** ${bitrate} kbps *(Maximum allowed by Discord)*\n` +
      `• **Opus Encoding Quality:** 10/10 *(Studio Master)*\n` +
      `• **Resampling Quality:** HIGH *(Sinc Interpolation)*\n` +
      `• **Audio Engine:** Lavalink v4.2.2 + DAVE E2EE MLS Engine\n` +
      `• **Spy Sec Web Player:** http://localhost:3050`
    );
  }

  if (command === "tags" || command === "hashtags" || command === "genres") {
    const embed = new EmbedBuilder()
      .setColor(0x10b981)
      .setTitle("🏷️ Spy Sec Music — High-Traffic Islamic Tags & Genres")
      .setDescription(
        "Use these high-traffic tags and genres directly with `!play <tag>` for instant discovery:\n\n" +
        "**1. Global / Universal Tags:**\n" +
        "• `#IslamicStatus` — Top trending short-form quotes, clips & reminders\n" +
        "• `#IslamicVibes` / `#IslamicRemix` — Peaceful halal vibes & spiritual vocal remixes\n" +
        "• `#IslamicKalam` / `#IslamicVideo` — Beautiful spoken word & poetry\n\n" +
        "**2. For Waz (Sermons & Bayans):**\n" +
        "• `#Waz` / `#IslamicWaz` — South Asian & global scholarly talks\n" +
        "• `#EmotionalBayan` / `#IslamicSpeech` — Powerful heart-touching reminders\n\n" +
        "**3. For Naat (Praises of the Prophet ﷺ):**\n" +
        "• `#Naat` / `#NaatSharif` / `#NewNaat` — Classical & contemporary praises\n" +
        "• `#Madinah` / `#YaRasoolAllah` — Devotional spiritual tracks\n\n" +
        "**4. For Nasheeds & Halal Bangers:**\n" +
        "• `#Nasheed` / `#HalalBanger` — Catchy modern halal vocal chants\n" +
        "• `#VocalOnly` / `#NoMusic` — 100% instrument-free pure vocal audio\n" +
        "• `#QuranRecitation` / `#QuranVibes` — Soul-soothing Quran recitations\n\n" +
        "🌐 **Live Spy Sec Web Player:** [Open Web Dashboard](http://localhost:3050)"
      )
      .setFooter({ text: "All categories strictly filtered for Halal compliance • Port 2334" });

    return message.channel.send({ embeds: [embed] });
  }
});

// ==========================================================================
// 3 TOTALLY INDEPENDENT SYSTEM CHANNELS: BROWSER, APP, AND DISCORD BOT
// ==========================================================================
let currentRoutingMode = "both"; // "both" | "browser" | "discord"
let storedUserVolume = 100;

const systemChannels = {
  browser: {
    id: "browser",
    name: "Web Browser",
    icon: "🌐",
    badge: "Direct Browser Audio Engine",
    current: null,
    isPlaying: false,
    isPaused: false,
    position: 0,
    duration: 0,
    volume: 100,
    repeatMode: "off",
    queue: [],
    history: [],
    filterMode: "filterless"
  },
  app: {
    id: "app",
    name: "Mobile App",
    icon: "📱",
    badge: "Mobile App Audio Engine",
    current: null,
    isPlaying: false,
    isPaused: false,
    position: 0,
    duration: 0,
    volume: 100,
    repeatMode: "off",
    queue: [],
    history: [],
    filterMode: "filterless"
  }
};

/**
 * Resolves any song query, Spotify track title, or Surah into a playable direct media track
 * for local system channels (Browser & Mobile App) without affecting the Discord bot.
 */
async function resolveMediaTrack(queryOrUrl, forcedFilterMode = null, expectedTitle = "", expectedArtist = "") {
  const { mode: detectedMode, query } = parseQueryFilter(queryOrUrl);
  const filterMode = (detectedMode !== "filterless") ? detectedMode : (forcedFilterMode || "filterless");
  const isUrl = query.startsWith("http://") || query.startsWith("https://");
  const isExplicitYt = Boolean(query && (query.includes("youtube.com/watch") || query.includes("youtu.be/") || query.includes("youtube.com/shorts/")));

  // Direct YouTube URL: Always extract the exact YouTube video requested!
  if (isExplicitYt) {
    try {
      const streamInfo = await extractYouTubeStream(query);
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
      console.warn("Direct YouTube stream extraction error in bot.js resolveMediaTrack:", err.message);
    }
  }

  // Check if query or expectedTitle is an authentic Quran Surah (for non-YouTube queries)
  const surahMatch = resolveSurahInfo(query) || (!isExplicitYt ? resolveSurahInfo(expectedTitle) : null);
  if (surahMatch) {
    const sNum = surahMatch.number;
    const padded = String(sNum).padStart(3, "0");
    const sName = SURAH_NAMES[sNum] || surahMatch.name || `Surah ${sNum}`;
    
    // Check if query specifies a particular reciter
    const qLower = `${query} ${expectedArtist || ""}`.toLowerCase();
    let cdnUrl = `https://download.quranicaudio.com/quran/mishari_rashid_al_3afasy/${padded}.mp3`;
    let reciter = "Mishary Rashid Alafasy";
    if (qLower.includes("sudais")) {
      cdnUrl = `https://download.quranicaudio.com/quran/abdurrahmaan_as-sudays/${padded}.mp3`;
      reciter = "Abdur-Rahman As-Sudais";
    } else if (qLower.includes("abdul basit") || qLower.includes("abdulbasit")) {
      cdnUrl = `https://download.quranicaudio.com/quran/abdulbaset_mujawwad/${padded}.mp3`;
      reciter = "Abdul Basit Abdul Samad";
    } else if (qLower.includes("ghamdi") || qLower.includes("ghamidi")) {
      cdnUrl = `https://download.quranicaudio.com/quran/sa3d_al-ghaamidi/complete/${padded}.mp3`;
      reciter = "Saad Al-Ghamdi";
    } else if (qLower.includes("muaiqly") || qLower.includes("maher")) {
      cdnUrl = `https://download.quranicaudio.com/quran/maher_almu3aiqly/year1440/${padded}.mp3`;
      reciter = "Maher Al-Muaiqly";
    } else if (qLower.includes("minshawi") || qLower.includes("menshawy")) {
      cdnUrl = `https://download.quranicaudio.com/quran/muhammad_siddeeq_al-menshaawi/${padded}.mp3`;
      reciter = "Muhammad Siddiq Al-Minshawi";
    } else if (qLower.includes("hussary") || qLower.includes("hosary")) {
      cdnUrl = `https://download.quranicaudio.com/quran/mahmood_khaleel_al-husaree_dour/${padded}.mp3`;
      reciter = "Mahmoud Khalil Al-Hussary";
    }

    return {
      title: `Surah ${sNum}: ${sName}`,
      author: reciter,
      duration: 180000,
      streamUrl: cdnUrl,
      rawStreamUrl: cdnUrl,
      source: "quran",
      artworkUrl: "logo.png",
      filterMode: "strict"
    };
  }

  // Direct MP3/Audio file URL
  if (isUrl && (query.includes("quranicaudio.com") || query.match(/\.(mp3|m4a|wav|aac|flac|ogg)(\?.*)?$/i))) {
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

  const isQIslamic = isIslamicQuery(query) || isIslamicText(query) || isIslamicText(expectedTitle) || Boolean(surahMatch);

  // Spotify Link Resolution (Extract single track or specific track of playlist/album)
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

        if (!isQIslamic) {
          for (let i = chosenIdx; i < Math.min(spData.tracks.length, chosenIdx + 5); i++) {
            const topTrack = spData.tracks[i];
            const searchQ = topTrack.query || `${topTrack.title} ${topTrack.artist}`.trim();
            const saavnMatch = await searchJioSaavn(searchQ, 5);
            const relevantMatch = (saavnMatch || []).find(r => r && r.streamUrl && isJioSaavnResultRelevant(searchQ, r.title, topTrack.title, topTrack.artist));
            if (relevantMatch && relevantMatch.streamUrl) {
              return {
                title: topTrack.title || relevantMatch.title,
                author: topTrack.artist || relevantMatch.author,
                duration: topTrack.duration || relevantMatch.duration,
                streamUrl: relevantMatch.streamUrl,
                rawStreamUrl: relevantMatch.streamUrl,
                artworkUrl: topTrack.artworkUrl || relevantMatch.artworkUrl || "logo.png",
                filterMode
              };
            }
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

  const isDirectAudioUrl = query.startsWith("http://") || query.startsWith("https://");

  // Fast Path 1: Check JioSaavn first for instant (~100ms) 320kbps CD-quality audio stream!
  // Strictly bypass JioSaavn for any Islamic content or Surah queries to prevent secular Indian song fallback
  if (!isDirectAudioUrl && !isQIslamic) {
    try {
      const saavnResults = await searchJioSaavn(query, 5);
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

  // Fast Path 2: YouTube / Spotify query via yt-dlp direct stream extractor
  try {
    const streamInfo = await extractYouTubeStream(query);
    if (streamInfo && streamInfo.streamUrl) {
      return {
        title: streamInfo.title || "YouTube Audio",
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

/**
 * Handles actions dispatched directly to independent system channels (Browser or Mobile App).
 */
async function handleLocalChannelAction(chanKey, action, value, bodyObj = {}) {
  const chan = systemChannels[chanKey];
  if (!chan) return "Channel not found";

  if (action === "play_pause") {
    if (chan.current) {
      chan.isPaused = !chan.isPaused;
      chan.isPlaying = !chan.isPaused;
      return `${chan.name} ${chan.isPaused ? "Paused" : "Resumed"}`;
    } else if (chan.queue.length > 0) {
      chan.current = chan.queue.shift();
      chan.isPlaying = true;
      chan.isPaused = false;
      chan.position = 0;
      return `${chan.name} started playing: ${chan.current.title}`;
    }
    return `${chan.name} has no track loaded`;
  }

  if (action === "next") {
    if (chan.queue.length > 0) {
      if (chan.current) chan.history.push(chan.current);
      chan.current = chan.queue.shift();
      chan.isPlaying = true;
      chan.isPaused = false;
      chan.position = 0;
      return `${chan.name} playing next: ${chan.current.title}`;
    }
    // Queue is empty: check for seed track (current playing song, or last song played in history)
    const seedTrack = chan.current || (chan.history.length > 0 ? chan.history[chan.history.length - 1] : null);
    if (seedTrack) {
      const seedTitle = seedTrack.title || "";
      const seedArtist = seedTrack.author || "";
      const mode = seedTrack.filterMode || "filterless";
      try {
        console.log(`📻 [Local Channel Radio] Queue finished for ${chan.name}! Connecting to radio for: "${seedTitle}" by "${seedArtist}"`);
        const radio = await generateRadioStation(seedTitle, seedArtist, mode, 10);
        if (radio && radio.length > 0) {
          if (chan.current) chan.history.push(chan.current);
          chan.current = radio.shift();
          chan.queue.push(...radio);
          chan.isPlaying = true;
          chan.isPaused = false;
          chan.position = 0;
          return `${chan.name} connected to radio for "${seedTitle}": playing ${chan.current.title}`;
        }
      } catch (err) {
        console.error("Local channel radio error:", err.message);
      }
    }
    if (chan.current) {
      chan.history.push(chan.current);
      chan.current = null;
      chan.isPlaying = false;
      chan.isPaused = false;
    }
    return `${chan.name} queue finished`;
  }

  if (action === "prev") {
    if (chan.history.length > 0) {
      if (chan.current) chan.queue.unshift(chan.current);
      chan.current = chan.history.pop();
      chan.isPlaying = true;
      chan.isPaused = false;
      chan.position = 0;
      return `${chan.name} playing previous: ${chan.current.title}`;
    }
    return `No previous tracks in ${chan.name} history`;
  }

  if (action === "stop") {
    if (chan.current) chan.history.push(chan.current);
    chan.current = null;
    chan.isPlaying = false;
    chan.isPaused = false;
    chan.position = 0;
    return `Stopped playback on ${chan.name}`;
  }

  if (action === "volume") {
    chan.volume = Math.min(Math.max(Number(value) || 0, 0), 100);
    return `${chan.name} volume set to ${chan.volume}%`;
  }

  if (action === "seek") {
    chan.position = Number(value) || 0;
    return `${chan.name} seeked to ${formatTime(Number(value))}`;
  }

  if (action === "loop") {
    const next = chan.repeatMode === "off" ? "track" : chan.repeatMode === "track" ? "queue" : "off";
    chan.repeatMode = next;
    return `${chan.name} loop mode: ${next}`;
  }

  if (action === "report_state") {
    if (bodyObj.position !== undefined) chan.position = Math.max(0, Number(bodyObj.position) || 0);
    if (bodyObj.duration !== undefined && bodyObj.duration > 0) chan.duration = Number(bodyObj.duration);
    if (bodyObj.isPlaying !== undefined) chan.isPlaying = Boolean(bodyObj.isPlaying);
    if (bodyObj.isPaused !== undefined) chan.isPaused = Boolean(bodyObj.isPaused);
    return `Reported state for ${chan.name}: ${Math.round(chan.position / 1000)}s`;
  }

  if (action === "set_track") {
    if (bodyObj.track) {
      if (chan.current) chan.history.push(chan.current);
      chan.current = bodyObj.track;
      chan.isPlaying = true;
      chan.isPaused = false;
      chan.position = 0;
      if (bodyObj.track.duration) chan.duration = bodyObj.track.duration;
    }
    return `Active track updated on ${chan.name}`;
  }

  if (action === "play_surah") {
    const surahNum = Number(value || bodyObj.surahNum) || 55;
    const padded = String(surahNum).padStart(3, "0");
    const surahName = SURAH_NAMES[surahNum] || `Surah ${surahNum}`;
    const track = {
      title: `Surah ${surahNum}: ${surahName}`,
      author: "Mishary Rashid Alafasy",
      duration: 180000,
      streamUrl: `https://download.quranicaudio.com/quran/mishaari_raashid_al_3afaasee/${padded}.mp3`,
      rawStreamUrl: `https://download.quranicaudio.com/quran/mishaari_raashid_al_3afaasee/${padded}.mp3`,
      artworkUrl: "logo.png",
      filterMode: "strict"
    };
    if (bodyObj.immediate || !chan.isPlaying || !chan.current) {
      if (chan.current) chan.history.push(chan.current);
      chan.current = track;
      chan.isPlaying = true;
      chan.isPaused = false;
      chan.position = 0;
    } else {
      chan.queue.push(track);
    }
    return `Streaming ${track.title} on ${chan.name}`;
  }

  if (action === "play_query" || action === "play_now") {
    const isImmediate = action === "play_now" || bodyObj.immediate === true;
    const rawQ = String(value || bodyObj.query || "");
    const forcedMode = bodyObj.filterMode || null;

    if (isSpotifyUrl(rawQ)) {
      const spotifyData = await resolveSpotifyLink(rawQ);
      if (spotifyData && spotifyData.tracks?.length > 0) {
        const tracks = spotifyData.tracks;
        let startIdx = 0;
        const indexMatch = rawQ.match(/[?&]index=(\d+)/i);
        if (indexMatch && indexMatch[1]) {
          const parsedIdx = parseInt(indexMatch[1], 10) - 1;
          if (parsedIdx >= 0 && parsedIdx < tracks.length) startIdx = parsedIdx;
        }
        const spTrackMatch = rawQ.match(/\/track\/([a-zA-Z0-9]+)/i) || rawQ.match(/spotify:track:([a-zA-Z0-9]+)/i);
        if (spTrackMatch && spTrackMatch[1]) {
          const tId = spTrackMatch[1];
          const fIdx = tracks.findIndex(t => (t.url && t.url.includes(tId)) || (t.id && t.id.includes(tId)));
          if (fIdx >= 0) startIdx = fIdx;
        }
        const first = tracks[startIdx] || tracks[0];
        const firstResolved = await resolveMediaTrack(first.query, "filterless");
        if (firstResolved) {
          if (chan.current) chan.history.push(chan.current);
          chan.current = firstResolved;
          chan.isPlaying = true;
          chan.isPaused = false;
          chan.position = 0;
          if (firstResolved.duration) chan.duration = firstResolved.duration;
        }
        (async () => {
          const queueIndices = [];
          for (let i = startIdx + 1; i < tracks.length; i++) queueIndices.push(i);
          for (let i = 0; i < startIdx; i++) queueIndices.push(i);
          for (const i of queueIndices) {
            try {
              const tr = await resolveMediaTrack(tracks[i].query, "filterless");
              if (tr) chan.queue.push(tr);
            } catch(e) {}
          }
        })().catch(() => {});
        return `${isImmediate ? "⚡ Playing now" : "Imported"} Spotify ${spotifyData.type} "${spotifyData.title}" (${spotifyData.trackCount} tracks) on ${chan.name}`;
      }
    }

    const ytPlaylistId = extractYouTubePlaylistId(rawQ);
    if (ytPlaylistId) {
      const ytData = await resolvePlaylistTracks(rawQ, 500);
      if (ytData && ytData.tracks?.length > 0) {
        const tracks = ytData.tracks;
        let startIdx = 0;
        const indexMatch = rawQ.match(/[?&]index=(\d+)/i);
        if (indexMatch && indexMatch[1]) {
          const parsedIdx = parseInt(indexMatch[1], 10) - 1;
          if (parsedIdx >= 0 && parsedIdx < tracks.length) startIdx = parsedIdx;
        }
        const vMatch = rawQ.match(/[?&]v=([a-zA-Z0-9_-]{11})/i);
        let fIdx = -1;
        if (vMatch && vMatch[1]) {
          fIdx = tracks.findIndex(t => t.id === vMatch[1] || (t.url && t.url.includes(vMatch[1])));
          if (fIdx >= 0) startIdx = fIdx;
        }
        let firstQ = null;
        if (vMatch && vMatch[1] && fIdx === -1) {
          firstQ = `https://www.youtube.com/watch?v=${vMatch[1]}`;
        } else {
          const first = tracks[startIdx] || tracks[0];
          firstQ = first.url || (first.id ? `https://www.youtube.com/watch?v=${first.id}` : first.query);
        }
        const firstResolved = await resolveMediaTrack(firstQ, forcedMode || "filterless");
        if (firstResolved) {
          if (chan.current) chan.history.push(chan.current);
          chan.current = firstResolved;
          chan.isPlaying = true;
          chan.isPaused = false;
          chan.position = 0;
          if (firstResolved.duration) chan.duration = firstResolved.duration;
        }
        (async () => {
          const queueIndices = [];
          for (let i = startIdx + 1; i < tracks.length; i++) queueIndices.push(i);
          for (let i = 0; i < startIdx; i++) queueIndices.push(i);
          for (const idx of queueIndices) {
            try {
              const item = tracks[idx];
              const itemQ = item.url || (item.id ? `https://www.youtube.com/watch?v=${item.id}` : item.query);
              const tr = await resolveMediaTrack(itemQ, forcedMode || "filterless");
              if (tr) chan.queue.push(tr);
            } catch(e) {}
          }
        })().catch(() => {});
        return `${isImmediate ? "⚡ Playing now" : "Imported"} YouTube Playlist "${ytData.title || ytData.name}" (${ytData.trackCount} tracks) on ${chan.name}`;
      }
    }

    const track = await resolveMediaTrack(rawQ, forcedMode);
    if (track) {
      if (isImmediate || !chan.isPlaying || !chan.current) {
        if (chan.current) chan.history.push(chan.current);
        chan.current = track;
        chan.isPlaying = true;
        chan.isPaused = false;
        chan.position = 0;
        if (track.duration) chan.duration = track.duration;
        return `⚡ Playing now on ${chan.name}: ${track.title}`;
      } else {
        chan.queue.push(track);
        return `▶️ Queued on ${chan.name}: ${track.title}`;
      }
    }
    return `Could not find audio for "${rawQ}" on ${chan.name}`;
  }


  if (action === "play_playlist") {
    const rawTracks = bodyObj.tracks || [];
    const playlistName = bodyObj.name || "Trending Playlist";
    const isImmediate = bodyObj.immediate === true;
    (async () => {
      let isFirst = isImmediate || !chan.isPlaying || !chan.current;
      for (const item of rawTracks) {
        try {
          const q = (typeof item === "string") ? item : (item.url || item.query || `${item.title || ""} ${item.artist || ""}`.trim());
          const expTitle = (typeof item === "object" && item) ? (item.title || "") : "";
          const expArtist = (typeof item === "object" && item) ? (item.artist || item.author || "") : "";
          const tr = await resolveMediaTrack(q, "filterless", expTitle, expArtist);
          if (tr) {
            if (isFirst) {
              if (chan.current) chan.history.push(chan.current);
              chan.current = tr;
              chan.isPlaying = true;
              chan.isPaused = false;
              chan.position = 0;
              if (tr.duration) chan.duration = tr.duration;
              isFirst = false;
            } else {
              chan.queue.push(tr);
            }
          }
        } catch(e) {}
      }
    })().catch(() => {});
    return `${isImmediate ? "⚡ Playing now" : "Enqueued"} ${rawTracks.length} tracks from "${playlistName}" on ${chan.name}`;
  }

  return "Action executed on local system channel";
}

const PUBLIC_DIR = path.join(__dirname, "public");
const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const webServer = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD, PUT, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range, Authorization, Accept, Origin, X-Requested-With, X-Client-Platform, X-Target-Channel, *");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS, HEAD, PUT, DELETE",
      "Access-Control-Allow-Headers": "Content-Type, Range, Authorization, Accept, Origin, X-Requested-With, X-Client-Platform, X-Target-Channel, *",
      "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
      "Access-Control-Max-Age": "86400"
    });
    return res.end();
  }

  const parsedUrl = new URL(req.url, "http://localhost:3050");
  let pathname = parsedUrl.pathname;
  if (pathname.length > 1 && pathname.endsWith("/")) {
    pathname = pathname.replace(/\/+$/, "");
  }
  // Android APK Download Link & Info Endpoint
  if (pathname === "/api/apk-link") {
    const apkUrl = (process.env.APK_DOWNLOAD_URL || "").trim();
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    return res.end(JSON.stringify({ success: true, url: apkUrl }));
  }

  if (pathname === "/download-apk" || pathname === "/download/app.apk") {
    const apkUrl = (process.env.APK_DOWNLOAD_URL || "").trim();
    if (apkUrl) {
      res.writeHead(302, { Location: apkUrl });
      return res.end();
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end("<p>Android APK download link will be available as soon as build completes.</p>");
  }

  // Fast Multi-Track & Playlist Search Endpoint (Returns approx 20 tracks and 5 playlists)
  if (pathname === "/api/search" || pathname === "/api/search/tracks" || pathname === "/api/search/playlists") {
    const q = parsedUrl.searchParams.get("q") || "";
    const filterMode = parsedUrl.searchParams.get("filterMode") || "filterless";
    const type = parsedUrl.searchParams.get("type") || (pathname.includes("tracks") ? "tracks" : pathname.includes("playlists") ? "playlists" : "all");

    if (!q) {
      res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ success: false, error: "Missing search query" }));
    }

    try {
      if (type === "tracks") {
        const rawResults = await searchYouTubeMulti(q, 20);
        let results = rawResults;
        if (filterMode !== "filterless") {
          results = rawResults.filter(t => validateByFilterMode(filterMode, { info: t }).allowed);
        }
        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        return res.end(JSON.stringify({
          success: true,
          query: q,
          filterMode,
          results
        }));
      } else if (type === "playlists") {
        const rawPlaylists = await searchPlaylistsMulti(q, 6);
        let playlists = rawPlaylists;
        if (filterMode !== "filterless") {
          playlists = rawPlaylists.filter(p => validateByFilterMode(filterMode, { info: p }).allowed);
        }
        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        return res.end(JSON.stringify({
          success: true,
          query: q,
          filterMode,
          playlists
        }));
      } else {
        const [rawResults, rawPlaylists] = await Promise.all([
          searchYouTubeMulti(q, 20),
          searchPlaylistsMulti(q, 6)
        ]);

        let results = rawResults;
        let playlists = rawPlaylists;
        if (filterMode !== "filterless") {
          results = rawResults.filter(t => validateByFilterMode(filterMode, { info: t }).allowed);
          playlists = rawPlaylists.filter(p => validateByFilterMode(filterMode, { info: p }).allowed);
        }
        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        return res.end(JSON.stringify({
          success: true,
          query: q,
          filterMode,
          results,
          playlists
        }));
      }
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ success: false, error: e.message }));
    }
  }

  // Radio Station Endpoint (Spotify-like Infinite Radio)
  if (pathname === "/api/radio") {
    const seedTitle = (parsedUrl.searchParams.get("seedTitle") || "").trim();
    const seedArtist = (parsedUrl.searchParams.get("seedArtist") || "").trim();
    const filterMode = parsedUrl.searchParams.get("filterMode") || "filterless";
    const limit = Math.min(Math.max(parseInt(parsedUrl.searchParams.get("limit") || "15", 10), 5), 30);

    try {
      const radioTracks = await generateRadioStation(seedTitle, seedArtist, filterMode, limit);
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=180"
      });
      return res.end(JSON.stringify({
        success: true,
        seed: { title: seedTitle, artist: seedArtist },
        station: `${seedTitle || seedArtist || "Spotify"} Radio`,
        tracks: radioTracks
      }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ success: false, error: err.message }));
    }
  }

  // Time-Synced Karaoke Lyrics Endpoint (LRCLIB + Open Source Synced Lyrics)
  if (pathname === "/api/lyrics") {
    const title = (parsedUrl.searchParams.get("title") || "").trim();
    const artist = (parsedUrl.searchParams.get("artist") || "").trim();
    const duration = parseFloat(parsedUrl.searchParams.get("duration") || "0");

    try {
      const lyricsData = await resolveTrackLyrics(title, artist, duration);
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
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ success: false, error: err.message }));
    }
  }

  // Playlist Details Endpoint (Resolves full track list for YouTube / external playlists)
  if (pathname === "/api/playlist-details") {
    const targetUrl = parsedUrl.searchParams.get("url") || parsedUrl.searchParams.get("id");
    if (!targetUrl) {
      res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ success: false, error: "Missing playlist url or id" }));
    }

    try {
      const plData = await resolvePlaylistTracks(targetUrl, 500);
      if (plData && plData.tracks && plData.tracks.length > 0) {
        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        return res.end(JSON.stringify({ success: true, playlist: plData }));
      } else {
        res.writeHead(404, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        return res.end(JSON.stringify({ success: false, error: "Could not fetch playlist tracks" }));
      }
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ success: false, error: err.message }));
    }
  }

  // User Profile & Authentication Endpoints
  const isMeRoute = pathname === "/api/user/me" || pathname === "/api/me" || pathname === "/api/auth/me";
  if (isMeRoute) {
    const user = getSessionUser(req);
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
          tasteProfile: userStore.getUserTasteProfile(user.id)
        }
      }));
    } else {
      return res.end(JSON.stringify({ authenticated: false, user: null }));
    }
  }

  // Customer Account Registration Endpoint (Email & Password)
  const isRegisterRoute = pathname === "/api/user/register" || pathname === "/api/register" || pathname === "/api/auth/register";
  if (isRegisterRoute && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const { email, username, password, displayName, avatar, preferredGenres } = JSON.parse(body || "{}");
        const result = userStore.registerCustomer({ email, username, password, displayName, avatar, preferredGenres });
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
      } catch(err) {
        res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Customer Login Endpoint (Email & Password)
  const isLoginRoute = pathname === "/api/user/login" || pathname === "/api/login" || pathname === "/api/auth/login";
  if (isLoginRoute && req.method === "POST") {
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
      } catch(err) {
        res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Individual Taste Event Recording Endpoint
  if (pathname === "/api/user/taste/record" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const { track, type, userId: explicitUserId } = JSON.parse(body || "{}");
        const user = getSessionUser(req);
        const targetUserId = user ? user.id : (explicitUserId || "local_default");
        
        // Ensure user exists
        if (!user && targetUserId) {
          userStore.getOrCreateUser({ id: targetUserId, username: "Guest Listener" });
        }

        const stats = userStore.recordTasteEvent(targetUserId, { track, type: type || "play" });
        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        return res.end(JSON.stringify({ success: true, stats }));
      } catch(err) {
        res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Individual Taste Profile Endpoint
  if (pathname === "/api/user/taste/profile" && req.method === "GET") {
    const user = getSessionUser(req);
    const userId = user ? user.id : (parsedUrl.searchParams.get("userId") || "local_default");
    const profile = userStore.getUserTasteProfile(userId);
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    return res.end(JSON.stringify({ success: true, profile }));
  }

  // Daily Taste Recommendations (Updates Homepage Tracks Everyday)
  if (pathname === "/api/user/daily-recommendations" && req.method === "GET") {
    const user = getSessionUser(req);
    const userId = user ? user.id : (parsedUrl.searchParams.get("userId") || "local_guest_default");
    const forceRefresh = parsedUrl.searchParams.get("refresh") === "true";
    const recommendations = userStore.getDailyRecommendations(userId, forceRefresh);
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    return res.end(JSON.stringify({ success: true, recommendations }));
  }

  // Calibrate User Taste Preferences
  if (pathname === "/api/user/taste/calibrate" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const { preferredGenres, favoriteArtists, userId: explicitUserId } = JSON.parse(body || "{}");
        const user = getSessionUser(req);
        const targetUserId = user ? user.id : (explicitUserId || "local_guest_default");
        const updatedRecs = userStore.calibrateUserTaste(targetUserId, { preferredGenres, favoriteArtists });
        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        return res.end(JSON.stringify({ success: true, recommendations: updatedRecs }));
      } catch(err) {
        res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  const isLogoutRoute = pathname === "/api/user/logout" || pathname === "/api/logout" || pathname === "/api/auth/logout";
  if (isLogoutRoute && (req.method === "POST" || req.method === "GET")) {
    const authHeader = req.headers["authorization"];
    let token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
    if (!token && req.headers.cookie) {
      const m = req.headers.cookie.match(/ahm_auth_token=([^;]+)/);
      if (m) token = decodeURIComponent(m[1].trim());
    }
    if (token) userStore.removeSession(token);
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Set-Cookie": "ahm_auth_token=; Path=/; Max-Age=0"
    });
    return res.end(JSON.stringify({ success: true, message: "Logged out" }));
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
        const result = await userStore.verifyDiscordServerMember(client, GUILD_ID, query);
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
    const origin = `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host || "localhost:3050"}`;
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
    const origin = `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host || "localhost:3050"}`;
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
          const guild = client.guilds.cache.get(GUILD_ID);
          const member = guild ? await guild.members.fetch(discordUser.id).catch(() => null) : null;

          if (member) {
            const userObj = userStore.getOrCreateUser({
              id: `discord_${discordUser.id}`,
              username: discordUser.username,
              displayName: member.displayName || discordUser.global_name || discordUser.username,
              avatar: discordUser.avatar ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png` : "logo.png",
              type: "discord",
              discordId: discordUser.id,
              isServerMember: true,
              roles: member.roles.cache.map(r => r.name).filter(n => n !== "@everyone")
            });
            const sessionToken = userStore.createSession(userObj);
            res.writeHead(302, {
              "Location": `/discord?token=${sessionToken}`,
              "Set-Cookie": `ahm_auth_token=${encodeURIComponent(sessionToken)}; Path=/; Max-Age=2592000; SameSite=Lax`
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
    // Fallback: redirect back to discord with verification prompt
    res.writeHead(302, { "Location": `/discord?verify_prompt=true` });
    return res.end();
  }

  // User Favorites Endpoints
  if (pathname === "/api/user/favorites") {
    const user = getSessionUser(req);
    const userId = user ? user.id : (parsedUrl.searchParams.get("userId") || "local_default");
    const favs = userStore.getFavorites(userId);
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    return res.end(JSON.stringify({ success: true, favorites: favs }));
  }

  if (pathname === "/api/user/favorites/toggle" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        const { track, userId: bodyUserId } = JSON.parse(body || "{}");
        const user = getSessionUser(req);
        const userId = user ? user.id : (bodyUserId || "local_default");
        if (!user) userStore.getOrCreateUser({ id: userId, username: "Local User" });
        const result = userStore.toggleFavorite(userId, track);
        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        return res.end(JSON.stringify({ success: true, ...result }));
      } catch(err) {
        res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // User Saved Queue Endpoints
  if (pathname === "/api/user/queue") {
    if (req.method === "GET") {
      const user = getSessionUser(req);
      const userId = user ? user.id : (parsedUrl.searchParams.get("userId") || "local_default");
      const qList = userStore.getQueue(userId);
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ success: true, queue: qList }));
    }
    if (req.method === "POST") {
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        try {
          const { queue, userId: bodyUserId } = JSON.parse(body || "{}");
          const user = getSessionUser(req);
          const userId = user ? user.id : (bodyUserId || "local_default");
          if (!user) userStore.getOrCreateUser({ id: userId, username: "Local User" });
          const saved = userStore.saveQueue(userId, queue || []);
          res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
          return res.end(JSON.stringify({ success: true, queue: saved }));
        } catch(err) {
          res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
          return res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }
  }

  // Dedicated Endpoint: Daily Imported Trending Spotify Playlists & Top Tracks
  if (pathname === "/api/spotify-trending") {
    const data = spotifyTrending.getTrendingData();
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    return res.end(JSON.stringify({ success: true, ...data }));
  }

  // Dedicated Endpoint: Force Refresh Daily Trending Spotify Playlists
  if (pathname === "/api/spotify-trending/refresh") {
    try {
      const data = await spotifyTrending.refreshTrending(true);
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ success: true, ...data }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ success: false, error: err.message }));
    }
  }

  // Dedicated Endpoint: Resolve Spotify Playlists, Albums, & Tracks into playable track collections
  if (pathname === "/api/spotify-playlist") {
    let urlParam = parsedUrl.searchParams.get("url");
    if (!urlParam && req.method === "POST") {
      let body = "";
      req.on("data", chunk => body += chunk);
      await new Promise(r => req.on("end", r));
      try {
        const b = JSON.parse(body);
        urlParam = b.url;
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
        const ytData = await resolvePlaylistTracks(ytUrl || urlParam, 500);
        if (ytData && ytData.tracks?.length) {
          res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
          return res.end(JSON.stringify({ success: true, playlist: ytData }));
        }
      } catch (err) {
        console.warn("/api/spotify-playlist YouTube fallback error in bot.js:", err.message);
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
    } catch(err) {
      res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ success: false, error: err.message }));
    }
  }

  // Dedicated Endpoint: Resolve YouTube Playlists, Mixes & Radios into playable track collections
  if (pathname === "/api/youtube-playlist") {
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
      const plData = await resolvePlaylistTracks(urlParam, 500);
      if (!plData || !plData.tracks?.length) {
        res.writeHead(404, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        return res.end(JSON.stringify({ success: false, error: "Could not fetch tracks for this YouTube playlist. Please ensure it is public." }));
      }

      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ success: true, playlist: plData }));
    } catch(err) {
      res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ success: false, error: err.message }));
    }
  }

  // Instant Track Resolver for Direct Browser & App Playback
  if (pathname === "/api/resolve-track") {
    let q = parsedUrl.searchParams.get("q") || "";
    const listParam = parsedUrl.searchParams.get("list");
    if (listParam && !q.includes("list=")) {
      q += (q.includes("?") ? "&" : "?") + "list=" + listParam;
    }
    const filterMode = parsedUrl.searchParams.get("filterMode") || "filterless";
    const targetChannel = parsedUrl.searchParams.get("channel") || "browser";
    const titleParam = parsedUrl.searchParams.get("title") || "";
    const artistParam = parsedUrl.searchParams.get("artist") || "";

    if (!q) {
      res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
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
            const indexMatch = q.match(/[?&]index=(\d+)/i);
            if (indexMatch && indexMatch[1]) {
              const parsedIdx = parseInt(indexMatch[1], 10) - 1;
              if (parsedIdx >= 0 && parsedIdx < spData.tracks.length) {
                chosenIndex = parsedIdx;
              }
            }
            const spTrackMatch = q.match(/\/track\/([a-zA-Z0-9]+)/i) || q.match(/spotify:track:([a-zA-Z0-9]+)/i);
            if (spTrackMatch && spTrackMatch[1]) {
              const tId = spTrackMatch[1];
              const fIdx = spData.tracks.findIndex(t => (t.url && t.url.includes(tId)) || (t.id && t.id.includes(tId)));
              if (fIdx >= 0) chosenIndex = fIdx;
            }
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
              resolvedFirst = await resolveMediaTrack(candQ, filterMode, cand.title, cand.artist);
              if (resolvedFirst) {
                chosenIndex = i;
                break;
              }
            }
            if (!resolvedFirst && chosenIndex > 0) {
              for (let i = 0; i < Math.min(chosenIndex, 5); i++) {
                const cand = spData.tracks[i];
                const candQ = cand.query || `${cand.title} ${cand.artist}`;
                resolvedFirst = await resolveMediaTrack(candQ, filterMode, cand.title, cand.artist);
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
                  proxyStreamUrl: resolvedFirst.streamUrl ? `/api/stream-audio?channel=${targetChannel}&url=${encodeURIComponent(resolvedFirst.streamUrl)}` : null
                }
              }));
            }
          }
        } catch (e) {}
      }

      const isYtUrl = isYouTubeUrl(q);
      const ytPlaylistId = extractYouTubePlaylistId(q);
      const isYtPlaylist = Boolean(ytPlaylistId || q.includes("playlist?list=") || q.includes("&list=") || q.includes("?list="));

      if (isYtPlaylist) {
        const plData = await resolvePlaylistTracks(q, 1000);
        if (plData && plData.tracks && plData.tracks.length > 0) {
          let chosenIndex = 0;
          const vMatch = q.match(/[?&]v=([a-zA-Z0-9_-]{11})/i) || q.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/i) || q.match(/\/shorts\/([a-zA-Z0-9_-]{11})/i);
          let foundIdx = -1;
          if (vMatch && vMatch[1]) {
            foundIdx = plData.tracks.findIndex(t => t.id === vMatch[1] || (t.url && t.url.includes(vMatch[1])));
            if (foundIdx >= 0) chosenIndex = foundIdx;
          }
          if (foundIdx === -1) {
            const indexMatch = q.match(/[?&]index=(\d+)/i);
            if (indexMatch && indexMatch[1]) {
              const parsedIdx = parseInt(indexMatch[1], 10) - 1;
              if (parsedIdx >= 0 && parsedIdx < plData.tracks.length) {
                chosenIndex = parsedIdx;
              }
            }
          }
          let resolvedFirst = null;

          // If video ID was requested but not found in playlist entries, resolve the specific video directly!
          if (vMatch && vMatch[1] && foundIdx === -1) {
            try {
              const directTrack = await resolveMediaTrack(`https://www.youtube.com/watch?v=${vMatch[1]}`, filterMode, titleParam, artistParam);
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
              const candUrl = cand.url || (cand.id ? `https://www.youtube.com/watch?v=${cand.id}` : null);
              const candQ = candUrl || cand.query || `${cand.title} ${cand.artist}`;
              resolvedFirst = await resolveMediaTrack(candQ, filterMode, cand.title, cand.artist);
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
              streamUrl: candUrl || q,
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

      const track = await resolveMediaTrack(q, filterMode, titleParam, artistParam);
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
        return res.end(JSON.stringify({ success: false, error: `Could not resolve audio for "${q}"` }));
      }
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ success: false, error: e.message }));
    }
  }

  // Direct Audio Stream Proxy (Supports independent streaming for Browser, App, and Discord Bot)
  if (pathname === "/api/stream-audio") {
    const targetChannel = parsedUrl.searchParams.get("channel") || "bot";
    const directUrl = parsedUrl.searchParams.get("url");

    let uri = null;
    if (directUrl) {
      uri = directUrl;
    } else if (targetChannel === "browser") {
      uri = systemChannels.browser.current?.streamUrl || systemChannels.browser.current?.rawStreamUrl || systemChannels.browser.current?.url;
    } else if (targetChannel === "app") {
      uri = systemChannels.app.current?.streamUrl || systemChannels.app.current?.rawStreamUrl || systemChannels.app.current?.url;
    } else {
      const guildId = "1553640111047180448";
      const player = lavalink.getPlayer(guildId);
      const currentTrack = player?.queue?.current;
      uri = currentTrack?.userData?.streamUrl || currentTrack?.info?.uri;
    }

    if (uri && (uri.includes("youtube.com/watch") || uri.includes("youtu.be/") || uri.includes("youtube.com/shorts/"))) {
      const vMatch = uri.match(/[?&]v=([a-zA-Z0-9_-]{11})/i) || uri.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/i) || uri.match(/\/shorts\/([a-zA-Z0-9_-]{11})/i);
      const cleanYt = (vMatch && vMatch[1]) ? `https://www.youtube.com/watch?v=${vMatch[1]}` : uri;
      try {
        const streamInfo = await extractYouTubeStream(cleanYt);
        if (streamInfo && streamInfo.streamUrl && streamInfo.streamUrl.startsWith("http")) {
          uri = streamInfo.streamUrl;
        }
      } catch (e) {
        console.warn("[StreamProxy] YouTube stream extract error in bot.js:", e.message);
      }
    }

    if (!uri || (!uri.startsWith("http://") && !uri.startsWith("https://"))) {
      res.writeHead(404, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ error: `No active audio stream for channel: ${targetChannel}` }));
    }

    // CRITICAL GUARD: If uri is still a YouTube HTML webpage, stream extraction failed!
    // NEVER proxy an HTML webpage into an audio player element!
    if (uri && (uri.includes("youtube.com") || uri.includes("youtu.be"))) {
      console.warn("[StreamProxy] YouTube direct stream extraction yielded no audio stream for:", uri);
      const curTitle = systemChannels[targetChannel]?.current?.title || "";
      const isTrans = isTranslationOrTafsir(curTitle);
      const surahCheck = !isTrans ? resolveSurahInfo(curTitle) : null;
      if (surahCheck) {
        const padded = String(surahCheck.number).padStart(3, "0");
        uri = `https://download.quranicaudio.com/quran/mishari_rashid_al_3afasy/${padded}.mp3`;
      } else {
        res.writeHead(502, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        return res.end(JSON.stringify({ error: "Could not extract playable stream for this YouTube video. It may be restricted or unavailable." }));
      }
    }

    try {
      const targetUrl = new URL(uri);
      const isHttps = targetUrl.protocol === "https:";
      const clientLib = isHttps ? https : http;
      const agent = isHttps ? httpsKeepAliveAgent : httpKeepAliveAgent;

      // Disable Nagle's algorithm on client socket for instant audio packet delivery
      if (res.socket) res.socket.setNoDelay(true);

      if (req.method === "HEAD") {
        res.writeHead(200, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Range, Authorization, Accept, Origin, X-Requested-With",
          "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
          "Content-Type": "audio/webm",
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
      if (targetUrl.hostname.includes("googlevideo.com")) {
        proxyReqHeaders["Referer"] = "https://www.youtube.com/";
        proxyReqHeaders["Origin"] = "https://www.youtube.com";
      }
      if (req.headers.range) {
        proxyReqHeaders["range"] = req.headers.range;
      }

      const reqMethod = "GET";
      const proxyReq = clientLib.request(targetUrl, { method: reqMethod, headers: proxyReqHeaders, agent }, (proxyRes) => {
        proxyReq.setNoDelay(true);

        // Handle HTTP redirects (301, 302, 307)
        if ((proxyRes.statusCode === 301 || proxyRes.statusCode === 302 || proxyRes.statusCode === 307) && proxyRes.headers.location) {
          try {
            const redirectUrl = new URL(proxyRes.headers.location, targetUrl);
            const redLib = redirectUrl.protocol === "https:" ? https : http;
            const redAgent = redirectUrl.protocol === "https:" ? httpsKeepAliveAgent : httpKeepAliveAgent;
            const redReq = redLib.request(redirectUrl, { method: reqMethod, headers: proxyReqHeaders, agent: redAgent }, (redRes) => {
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
              if (reqMethod === "HEAD") return res.end();
              redRes.pipe(res);
            });
            redReq.on("error", () => {
              if (!res.headersSent) res.writeHead(502);
              res.end();
            });
            req.on("close", () => redReq.destroy());
            redReq.end();
            return;
          } catch(e) {}
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
        if (reqMethod === "HEAD") return res.end();
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

  // Real-time State Endpoint with Multi-Server Channel Registry & 3 System Channels
  if (pathname === "/api/state") {
    const { servers, flatChannels } = getAllGuildServersWithChannels();
    const primaryGuildId = "1553640111047180448";
    const guildObj = client.guilds.cache.get(primaryGuildId) || client.guilds.cache.first();
    const activeGuildId = guildObj?.id || primaryGuildId;
    const player = lavalink.getPlayer(activeGuildId);
    const history = trackHistory.get(activeGuildId) || [];
    const currentTrack = player?.queue?.current || null;
    const streamUri = currentTrack?.userData?.streamUrl || currentTrack?.info?.uri || null;

    let announceChId = getAnnouncementChannelId(activeGuildId, player?.textChannelId);
    let announceCh = client.channels.cache.get(announceChId);
    if (!announceCh && flatChannels.length > 0) {
      announceChId = flatChannels[0].id;
      announceCh = client.channels.cache.get(announceChId);
    }
    const defaultVoice = guildObj?.channels.cache.find(c => c.isVoiceBased?.() || c.type === 2);

    const botChannelState = {
      id: "bot",
      name: "Discord Bot",
      icon: "🤖",
      badge: `Discord Voice: ${defaultVoice?.name || "General"}`,
      current: currentTrack ? {
        info: {
          title: currentTrack.info?.title || "Unknown Track",
          author: currentTrack.info?.author || "Unknown Artist",
          duration: currentTrack.info?.duration || 0,
          uri: currentTrack.info?.uri || "",
          artworkUrl: currentTrack.info?.artworkUrl || "logo.png"
        },
        streamUrl: streamUri,
        filterMode: currentTrack.userData?.filterMode || "filterless"
      } : null,
      isPlaying: !!player?.playing,
      isPaused: !!player?.paused,
      position: player?.position || 0,
      duration: player?.queue?.current?.info?.duration || 0,
      volume: player?.volume || 100,
      repeatMode: player?.repeatMode || "off",
      queue: (player?.queue?.tracks || []).map(t => ({
        info: {
          title: t.info?.title,
          author: t.info?.author,
          duration: t.info?.duration,
          artworkUrl: t.info?.artworkUrl || "logo.png"
        }
      })),
      history: history.map(t => ({
        info: {
          title: t.info?.title,
          author: t.info?.author,
          duration: t.info?.duration,
          artworkUrl: t.info?.artworkUrl || "logo.png"
        }
      })),
      voiceChannel: defaultVoice?.name || "General",
      announcementChannelId: announceChId,
      announcementChannelName: announceCh?.name || "music",
      announcementGuildId: announceCh?.guild?.id || activeGuildId,
      announcementGuildName: announceCh?.guild?.name || guildObj?.name || "Discord Server",
      streamUrl: streamUri ? "/api/stream-audio?channel=bot" : null,
      rawStreamUrl: streamUri
    };

    const browserChan = {
      ...systemChannels.browser,
      streamUrl: systemChannels.browser.current ? `/api/stream-audio?channel=browser` : null,
      rawStreamUrl: systemChannels.browser.current?.streamUrl
    };

    const appChan = {
      ...systemChannels.app,
      streamUrl: systemChannels.app.current ? `/api/stream-audio?channel=app` : null,
      rawStreamUrl: systemChannels.app.current?.streamUrl
    };

    const sessionUser = getSessionUser(req);

    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      currentUser: sessionUser ? {
        id: sessionUser.id,
        username: sessionUser.username,
        displayName: sessionUser.displayName,
        avatar: sessionUser.avatar,
        isServerMember: Boolean(sessionUser.isServerMember),
        favoriteCount: sessionUser.favorites?.length || 0,
        queueCount: sessionUser.queue?.length || 0
      } : null,
      channels: {
        browser: browserChan,
        app: appChan,
        bot: botChannelState
      },
      servers: servers,
      availableTextChannels: flatChannels,
      channelsVersion: channelsVersion,
      announcementChannelId: announceChId,
      announcementChannelName: announceCh?.name || "music",
      announcementGuildId: announceCh?.guild?.id || activeGuildId,
      announcementGuildName: announceCh?.guild?.name || guildObj?.name || "Discord Server",
      // Backward-compatible fields
      current: currentTrack,
      streamUrl: streamUri ? "/api/stream-audio?channel=bot" : null,
      rawStreamUrl: streamUri,
      isPlaying: !!player?.playing,
      isPaused: !!player?.paused,
      position: player?.position || 0,
      duration: player?.queue?.current?.info?.duration || 0,
      volume: player?.volume || 100,
      userVolume: storedUserVolume,
      routingMode: currentRoutingMode,
      repeatMode: player?.repeatMode || "off",
      queue: player?.queue?.tracks || [],
      history: history,
      filterMode: player?.queue?.current?.userData?.filterMode || "filterless",
      bitrate: 96
    }));
  }

  // Interactive Action Endpoint (Supports multi-channel target: browser, app, bot, or all)
  if (pathname === "/api/action" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", async () => {
      try {
        const bodyObj = JSON.parse(body || "{}");
        const { action, value } = bodyObj;
        const targetChannel = bodyObj.targetChannel || bodyObj.channel || "browser";

        // Special handling: Announcement Channel Configuration across ANY server
        if (action === "send" || action === "set_announcement_channel") {
          const rawId = String(value || bodyObj.channelId || "").replace(/^[#<@!&>]+/, "").trim();
          let target = client.channels.cache.get(rawId);
          if (!target) {
            for (const g of client.guilds.cache.values()) {
              const found = g.channels.cache.find(c =>
                (c.isTextBased?.() || c.type === 0) && (c.id === rawId || c.name.toLowerCase() === rawId.toLowerCase())
              );
              if (found) { target = found; break; }
            }
          }
          if (target && target.guild) {
            announcementChannels.set(target.guild.id, target.id);
            saveStoredAnnouncements();
            channelsVersion = Date.now();
            const p = lavalink.getPlayer(target.guild.id);
            if (p) p.textChannelId = target.id;
            const resultMsg = `Song announcement channel updated to #${target.name} under server "${target.guild.name}"`;
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({
              success: true,
              channel: "bot",
              message: resultMsg,
              channelId: target.id,
              channelName: target.name,
              guildId: target.guild.id,
              guildName: target.guild.name
            }));
          } else {
            res.writeHead(400, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ success: false, error: `Could not find text channel: ${rawId}` }));
          }
        }

        // Dispatch to Browser Channel
        if (targetChannel === "browser") {
          const resultMsg = await handleLocalChannelAction("browser", action, value, bodyObj);
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ success: true, channel: "browser", message: resultMsg, current: systemChannels.browser.current }));
        }

        // Dispatch to Mobile App Channel
        if (targetChannel === "app") {
          const resultMsg = await handleLocalChannelAction("app", action, value, bodyObj);
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ success: true, channel: "app", message: resultMsg, current: systemChannels.app.current }));
        }

        // Multi-channel Broadcast (All 3 systems)
        if (targetChannel === "all") {
          await handleLocalChannelAction("browser", action, value, bodyObj);
          await handleLocalChannelAction("app", action, value, bodyObj);
          // Also execute on Discord bot
        }

        // Target: Discord Bot (Lavalink Voice)
        // Verify Discord server membership authentication
        const sessionUser = getSessionUser(req);
        if (!sessionUser || !sessionUser.isServerMember) {
          res.writeHead(403, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({
            success: false,
            error: "Authentication required: You must be logged in with Discord and a verified member of the Spy Sec Music server to control the bot.",
            requireDiscordAuth: true
          }));
        }

        const guild = client.guilds.cache.get("1553640111047180448");
        if (!guild) {
          res.writeHead(500, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "Guild not found" }));
        }

        let vs = guild.voiceStates.cache.find(v => v.channelId);
        const defaultVoice = guild.channels.cache.find(c => c.isVoiceBased?.() || c.type === 2);
        const vcId = vs?.channelId || defaultVoice?.id || "1558166090025013329";
        const announceId = getAnnouncementChannelId(guild.id);
        const player = await getOrCreatePlayer(guild, vcId, announceId);

        let resultMsg = "Action executed successfully";
        if (action === "play_pause") {
          if (player.paused) await player.resume();
          else if (player.playing) await player.pause();
          else if (player.queue.current) await player.play();
        } else if (action === "next") {
          resultMsg = await handleNext(player);
        } else if (action === "prev") {
          resultMsg = await handlePrevious(player);
        } else if (action === "stop") {
          await player.stopPlaying();
          resultMsg = "Stopped playback";
        } else if (action === "seek") {
          await player.seek(Number(value) || 0);
          resultMsg = `Seeked to ${formatTime(Number(value))}`;
        } else if (action === "volume") {
          storedUserVolume = Number(value) || 100;
          if (currentRoutingMode !== "browser") {
            await player.setVolume(storedUserVolume);
          }
          resultMsg = `Volume set to ${storedUserVolume}%`;
        } else if (action === "routing") {
          currentRoutingMode = String(value || "both");
          resultMsg = `Audio routing set to ${currentRoutingMode}`;
        } else if (action === "send" || action === "set_announcement_channel") {
          const rawId = String(value || "").replace(/^[#<@!&>]+/, "").trim();
          const target = guild.channels.cache.find(c =>
            (c.isTextBased?.() || c.type === 0) && (c.id === rawId || c.name.toLowerCase() === rawId.toLowerCase())
          );
          if (target) {
            announcementChannels.set(guild.id, target.id);
            if (player) player.textChannelId = target.id;
            resultMsg = `Song announcement channel updated to #${target.name}`;
          } else {
            resultMsg = `Could not find text channel: ${rawId}`;
          }
        } else if (action === "play_playlist") {
          const tracks = bodyObj.tracks || [];
          const playlistName = bodyObj.name || "Trending Playlist";
          const isPlayNow = bodyObj.immediate === true;

          (async () => {
            let isFirst = true;
            for (const item of tracks) {
              try {
                const q = (typeof item === "string") ? item : (item.url || item.query || `${item.title || ""} ${item.artist || ""}`.trim());
                const tr = await resolveLavalinkTrack(player, q, { username: "LiquidGlassWeb" }, "filterless");
                if (tr) {
                  tr.userData = {
                    filterMode: "filterless",
                    requester: { username: "LiquidGlassWeb" }
                  };
                  if (isFirst && isPlayNow) {
                    if (player.queue.current) addToHistory(guild.id, player.queue.current);
                    if (player.paused) await player.resume();
                    await player.play({ clientTrack: tr });
                    isFirst = false;
                  } else if (isFirst && !player.playing) {
                    player.queue.add(tr);
                    if (player.paused) await player.resume();
                    await player.play();
                    isFirst = false;
                  } else {
                    player.queue.add(tr);
                    isFirst = false;
                  }
                }
              } catch(e) {}
            }
          })().catch(() => {});

          resultMsg = `${isPlayNow ? "⚡ Playing now" : "Enqueued"} playlist on Discord Bot: ${playlistName} (${tracks.length} tracks)`;
        } else if (action === "loop") {
          resultMsg = await handleLoop(player);
        } else if (action === "play_surah") {
          const surahNum = Number(value || bodyObj.surahNum) || 55;
          await playSurahDirect(player, surahNum, { username: "LiquidGlassWeb" });
          resultMsg = `Streaming Surah ${surahNum} on Discord Bot`;
        } else if (action === "play_queue_index") {
          const idx = Number(value);
          if (player && player.queue?.tracks?.length > idx) {
            const target = player.queue.tracks.splice(idx, 1)[0];
            player.queue.tracks.unshift(target);
            await player.skip();
            resultMsg = `⚡ Playing now from queue: ${target.info?.title || "Track"}`;
          } else {
            resultMsg = `Invalid queue track index: ${idx}`;
          }
        } else if (action === "play_query" || action === "play_now") {
          const isPlayNow = action === "play_now" || bodyObj.immediate === true;
          const rawQ = String(value || bodyObj.query || "");
          const forcedMode = bodyObj.filterMode || null;
          const { mode: detectedMode, query, badge } = parseQueryFilter(rawQ);
          const mode = (detectedMode !== "filterless") ? detectedMode : (forcedMode || "filterless");

          let candidate = null;
          const isUrl = query.startsWith("http://") || query.startsWith("https://") || query.startsWith("spotify:");

          if (isSpotifyUrl(query)) {
            const spotifyData = await resolveSpotifyLink(query);
            if (spotifyData && spotifyData.tracks?.length > 0) {
              const tracks = spotifyData.tracks;
              let startIdx = 0;
              const indexMatch = query.match(/[?&]index=(\d+)/i);
              if (indexMatch && indexMatch[1]) {
                const parsedIdx = parseInt(indexMatch[1], 10) - 1;
                if (parsedIdx >= 0 && parsedIdx < tracks.length) startIdx = parsedIdx;
              }
              const spTrackMatch = query.match(/\/track\/([a-zA-Z0-9]+)/i) || query.match(/spotify:track:([a-zA-Z0-9]+)/i);
              if (spTrackMatch && spTrackMatch[1]) {
                const tId = spTrackMatch[1];
                const fIdx = tracks.findIndex(t => (t.url && t.url.includes(tId)) || (t.id && t.id.includes(tId)));
                if (fIdx >= 0) startIdx = fIdx;
              }
              const first = tracks[startIdx] || tracks[0];
              try {
                const tr = await resolveLavalinkTrack(player, first.query, { username: "LiquidGlassWeb" }, mode);
                if (tr) {
                  tr.userData = { filterMode: mode, requester: { username: "LiquidGlassWeb" } };
                  if (isPlayNow) {
                    if (player.queue.current) addToHistory(guild.id, player.queue.current);
                    if (player.paused) await player.resume();
                    await player.play({ clientTrack: tr });
                  } else {
                    player.queue.add(tr);
                    if (player.paused) await player.resume();
                    if (!player.playing) await player.play();
                  }
                }
              } catch(e) {}

              // Background queue remaining tracks
              (async () => {
                const queueIndices = [];
                for (let i = startIdx + 1; i < tracks.length; i++) queueIndices.push(i);
                for (let i = 0; i < startIdx; i++) queueIndices.push(i);
                for (const i of queueIndices) {
                  try {
                    const tr = await resolveLavalinkTrack(player, tracks[i].query, { username: "LiquidGlassWeb" }, mode);
                    if (tr) {
                      tr.userData = { filterMode: mode, requester: { username: "LiquidGlassWeb" } };
                      player.queue.add(tr);
                    }
                  } catch(e) {}
                }
              })().catch(() => {});

              resultMsg = `${isPlayNow ? "⚡ Playing now" : "Imported"} Spotify ${spotifyData.type}: ${spotifyData.title} (${spotifyData.trackCount} tracks on Discord Bot)`;
              res.writeHead(200, { "Content-Type": "application/json" });
              return res.end(JSON.stringify({ success: true, channel: "bot", message: resultMsg }));
            }
          }

          const ytPlaylistId = extractYouTubePlaylistId(query);
          if (ytPlaylistId) {
            const ytData = await resolvePlaylistTracks(query, 500);
            if (ytData && ytData.tracks?.length > 0) {
              const tracks = ytData.tracks;
              let startIdx = 0;
              const indexMatch = query.match(/[?&]index=(\d+)/i);
              if (indexMatch && indexMatch[1]) {
                const parsedIdx = parseInt(indexMatch[1], 10) - 1;
                if (parsedIdx >= 0 && parsedIdx < tracks.length) startIdx = parsedIdx;
              }
              const vMatch = query.match(/[?&]v=([a-zA-Z0-9_-]{11})/i);
              let fIdx = -1;
              if (vMatch && vMatch[1]) {
                fIdx = tracks.findIndex(t => t.id === vMatch[1] || (t.url && t.url.includes(vMatch[1])));
                if (fIdx >= 0) startIdx = fIdx;
              }
              let firstQ = null;
              if (vMatch && vMatch[1] && fIdx === -1) {
                firstQ = `https://www.youtube.com/watch?v=${vMatch[1]}`;
              } else {
                const first = tracks[startIdx] || tracks[0];
                firstQ = first.url || (first.id ? `https://www.youtube.com/watch?v=${first.id}` : first.query);
              }
              try {
                const tr = await resolveLavalinkTrack(player, firstQ, { username: "LiquidGlassWeb" }, mode);
                if (tr) {
                  tr.userData = { filterMode: mode, requester: { username: "LiquidGlassWeb" } };
                  if (isPlayNow) {
                    if (player.queue.current) addToHistory(guild.id, player.queue.current);
                    if (player.paused) await player.resume();
                    await player.play({ clientTrack: tr });
                  } else {
                    player.queue.add(tr);
                    if (player.paused) await player.resume();
                    if (!player.playing) await player.play();
                  }
                }
              } catch(e) {}

              // Background queue remaining tracks
              (async () => {
                const queueIndices = [];
                for (let i = startIdx + 1; i < tracks.length; i++) queueIndices.push(i);
                for (let i = 0; i < startIdx; i++) queueIndices.push(i);
                for (const idx of queueIndices) {
                  try {
                    const item = tracks[idx];
                    const itemQ = item.url || (item.id ? `https://www.youtube.com/watch?v=${item.id}` : item.query);
                    const tr = await resolveLavalinkTrack(player, itemQ, { username: "LiquidGlassWeb" }, mode);
                    if (tr) {
                      tr.userData = { filterMode: mode, requester: { username: "LiquidGlassWeb" } };
                      player.queue.add(tr);
                    }
                  } catch(e) {}
                }
              })().catch(() => {});

              resultMsg = `${isPlayNow ? "⚡ Playing now" : "Imported"} YouTube Playlist: ${ytData.title || ytData.name} (${ytData.trackCount} tracks on Discord Bot)`;
              res.writeHead(200, { "Content-Type": "application/json" });
              return res.end(JSON.stringify({ success: true, channel: "bot", message: resultMsg }));
            }
          }

          if (!candidate) {
            candidate = await resolveLavalinkTrack(player, query, { username: "LiquidGlassWeb" }, mode);
          }

          if (candidate) {
            candidate.userData = {
              filterMode: mode,
              requester: { username: "LiquidGlassWeb" },
              streamUrl: candidate.streamUrl || candidate.info?.uri || null
            };
            if (isPlayNow) {
              if (player.queue.current) addToHistory(guild.id, player.queue.current);
              if (player.paused) await player.resume();
              await player.play({ clientTrack: candidate });
              resultMsg = `⚡ Playing Now on Discord Bot: ${candidate.info.title}`;
            } else {
              player.queue.add(candidate);
              if (player.paused) await player.resume();
              if (!player.playing) await player.play();
              resultMsg = `${badge} Queued on Discord Bot: ${candidate.info.title}`;
            }
          } else {
            resultMsg = mode === "filterless" ? "No results found" : `Rejected by ${mode === "strict" ? "Strict Halal Filter (#)" : "Islamic Remix Filter (*)"}`;
          }
        } else if (action === "eq") {
          if (value === "better") await player.filterManager.setEQPreset("BetterMusic");
          else if (value === "full") await player.filterManager.setEQPreset("FullSound");
          else if (value === "flat") await player.filterManager.clearEQ();
          resultMsg = `Equalizer preset: ${value}`;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, channel: "bot", message: resultMsg }));
      } catch(err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Static File Serving with no-cache headers for instant updates
  let targetPath = pathname === "/" ? "index.html" : pathname;
  if (pathname === "/discord" || pathname === "/bot" || pathname === "/dashboard") {
    targetPath = "discord.html";
  } else if (pathname === "/terms" || pathname === "/terms-of-service" || pathname === "/tos") {
    targetPath = "terms.html";
  } else if (pathname === "/privacy" || pathname === "/privacy-policy") {
    targetPath = "privacy.html";
  }
  let filePath = path.join(PUBLIC_DIR, targetPath);
  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || "text/plain";

  const staticHeaders = {
    "Content-Type": contentType,
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0"
  };

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === "ENOENT") {
        fs.readFile(path.join(PUBLIC_DIR, "index.html"), (err2, fallback) => {
          if (err2) {
            res.writeHead(404);
            res.end("Not Found");
          } else {
            res.writeHead(200, {
              "Content-Type": "text/html",
              "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"
            });
            res.end(fallback);
          }
        });
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${err.code}`);
      }
    } else {
      res.writeHead(200, staticHeaders);
      res.end(content);
    }
  });
});

webServer.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.log("⚡ Standalone Web & Mobile Audio Engine is active on port 3050. Discord bot running in dedicated Voice Mode.");
  } else {
    console.error("Web server error:", err.message);
  }
});

const BOT_PORT = parseInt(process.env.PORT || process.env.BOT_PORT || "3050", 10);
webServer.listen(BOT_PORT, "0.0.0.0", () => {
  console.log(`🌐 Spy Sec Music Web Player live on port ${BOT_PORT}`);
});
webServer.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.warn(`⚠️ [Bot Web Server] Port ${BOT_PORT} in use. Running bot headlessly in background.`);
  } else {
    console.error("Web server error:", err.message);
  }
});

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  loadStoredAnnouncements();
  channelsVersion = Date.now();
  console.log(`🌐 Bot active across ${client.guilds.cache.size} server(s). Channel registry initialized.`);
  await lavalink.init({ id: client.user.id, username: client.user.username });
});

// Dynamic channel & server change listeners
client.on("channelCreate", (channel) => {
  channelsVersion = Date.now();
  console.log(`📢 [CHANNEL ADDED] #${channel.name} created in server "${channel.guild?.name || 'Unknown'}"`);
});

client.on("channelDelete", (channel) => {
  channelsVersion = Date.now();
  console.log(`📢 [CHANNEL REMOVED] #${channel.name} deleted from server "${channel.guild?.name || 'Unknown'}"`);
});

client.on("channelUpdate", (oldChan, newChan) => {
  if (oldChan.name !== newChan.name || oldChan.parentId !== newChan.parentId) {
    channelsVersion = Date.now();
    console.log(`📢 [CHANNEL UPDATED] #${newChan.name} updated in server "${newChan.guild?.name || 'Unknown'}"`);
  }
});

client.on("guildCreate", (guild) => {
  channelsVersion = Date.now();
  console.log(`🎉 [NEW SERVER JOINED] Bot added to "${guild.name}" (ID: ${guild.id}, Members: ${guild.memberCount})`);
});

client.on("guildDelete", (guild) => {
  channelsVersion = Date.now();
  console.log(`👋 [SERVER REMOVED] Bot removed from "${guild.name}" (ID: ${guild.id})`);
});

client.on("guildUpdate", (oldGuild, newGuild) => {
  if (oldGuild.name !== newGuild.name || oldGuild.icon !== newGuild.icon) {
    channelsVersion = Date.now();
    console.log(`📢 [SERVER UPDATED] Server "${newGuild.name}" updated`);
  }
});

process.on("unhandledRejection", (e) => console.error("Unhandled Rejection:", e));

if (!process.env.DISCORD_TOKEN) {
  console.error("❌ [CRITICAL] DISCORD_TOKEN is missing in environment variables!");
  console.error("👉 Please add DISCORD_TOKEN to your Render Environment Variables dashboard.");
  if (process.env.RENDER) {
    console.log("ℹ️ Running Web Server on Render without Discord Gateway connection.");
  } else {
    process.exit(1);
  }
} else {
  client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error("❌ [Discord Bot Login Failed]:", err.message);
  });
}
