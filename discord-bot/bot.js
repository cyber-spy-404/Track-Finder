const {
  Client,
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
  validateByFilterMode
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

// In-memory cache for fast playlist searches
const searchPlaylistCache = new Map();
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
    execFile(
      "python",
      ["-m", "yt_dlp", "--flat-playlist", "-J", "--playlist-end", String(fetchLimit), url],
      { timeout: 15000, maxBuffer: 15 * 1024 * 1024 },
      (err, stdout) => {
        if (err || !stdout) return resolve([]);
        try {
          const data = JSON.parse(stdout);
          const entries = data.entries || [];
          const playlists = entries
            .filter(e => e && e.title && !e.id?.startsWith("UC") && !e.url?.includes("/channel/") && !e.url?.includes("/user/") && (e.url?.includes("list=") || e.id?.startsWith("PL") || e.id?.startsWith("OL") || e.id?.startsWith("RD") || e.id?.startsWith("UU") || e._type === "url"))
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
        } catch(e) {
          resolve([]);
        }
      }
    );
  });
}

// In-memory cache for full playlist tracks resolver
const playlistTracksCache = new Map();
async function resolvePlaylistTracks(playlistUrlOrId, limit = 30) {
  const clean = String(playlistUrlOrId || "").trim();
  const cacheKey = clean.toLowerCase();
  if (playlistTracksCache.has(cacheKey)) {
    const cached = playlistTracksCache.get(cacheKey);
    if (Date.now() - cached.time < 3600000) return cached.data;
  }

  const url = clean.startsWith("http") ? clean : `https://www.youtube.com/playlist?list=${clean}`;
  return new Promise((resolve) => {
    execFile(
      "python",
      ["-m", "yt_dlp", "--flat-playlist", "-J", "--playlist-end", String(limit), url],
      { timeout: 16000, maxBuffer: 20 * 1024 * 1024 },
      (err, stdout) => {
        if (err || !stdout) return resolve(null);
        try {
          const data = JSON.parse(stdout);
          const entries = (data.entries || []).filter(e => e && e.title && !e.id?.startsWith("UC"));
          const tracks = entries.map((e, idx) => ({
            id: e.id,
            title: e.title,
            artist: e.uploader || e.channel || data.title || "YouTube Music",
            duration: Math.round((e.duration || 0) * 1000),
            artworkUrl: (e.thumbnails && e.thumbnails.length > 0) ? e.thumbnails[e.thumbnails.length - 1].url : `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`,
            url: (e.url && e.url.startsWith("http")) ? e.url : `https://www.youtube.com/watch?v=${e.id}`
          }));
          const result = {
            id: data.id || clean,
            title: data.title || "YouTube Playlist",
            author: data.uploader || data.channel || "YouTube",
            description: data.description || `Playlist with ${tracks.length} songs`,
            artworkUrl: (data.thumbnails && data.thumbnails.length > 0) ? data.thumbnails[data.thumbnails.length - 1].url : (tracks[0]?.artworkUrl || "logo.png"),
            tracks: tracks,
            trackCount: tracks.length
          };
          playlistTracksCache.set(cacheKey, { time: Date.now(), data: result });
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
  return /open\.spotify\.com\/(playlist|album|track|artist)\/([a-zA-Z0-9]+)/i.test(url) ||
         /spotify:(playlist|album|track|artist):([a-zA-Z0-9]+)/i.test(url);
}

/**
 * Extracts a Spotify URL from any mixed text string
 */
function extractSpotifyUrl(text) {
  if (!text || typeof text !== "string") return null;
  const match = text.match(/https?:\/\/open\.spotify\.com\/(playlist|album|track|artist)\/[a-zA-Z0-9]+(\?[^\s]*)?/i) ||
                text.match(/spotify:(playlist|album|track|artist):[a-zA-Z0-9]+/i);
  return match ? match[0] : null;
}

/**
 * Resolves full Spotify playlist/album/track metadata & tracklist without requiring user credentials.
 */
async function resolveSpotifyLink(url) {
  try {
    const cleanUrl = url.trim();
    const details = await spotifyUrlInfo.getDetails(cleanUrl);
    if (!details) return null;

    const preview = details.preview || {};
    const type = preview.type || (cleanUrl.includes("/track/") ? "track" : cleanUrl.includes("/album/") ? "album" : "playlist");
    const rawTracks = details.tracks || (preview.title ? [{ name: preview.title, artist: preview.artist, duration: 180000, previewUrl: preview.audio }] : []);
    
    const tracks = rawTracks.map((t, idx) => {
      const name = t.name || t.title || `Track ${idx + 1}`;
      const artist = t.artist || preview.artist || "Spotify Artist";
      return {
        id: `sp_${Date.now()}_${idx + 1}`,
        title: name,
        artist: artist,
        duration: t.duration || 180000,
        artworkUrl: preview.image || "logo.png",
        query: `${artist} - ${name}`,
        previewUrl: t.previewUrl || preview.audio || null,
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
  const isUrl = target.startsWith("http://") || target.startsWith("https://");
  if (!isUrl) {
    try {
      const searchRes = await searchYouTubeMulti(queryOrUrl, 1);
      if (searchRes && searchRes.length > 0 && searchRes[0].url) {
        streamMeta = searchRes[0];
        target = streamMeta.url;
      } else {
        target = `ytsearch1:${queryOrUrl}`;
      }
    } catch(e) {
      target = `ytsearch1:${queryOrUrl}`;
    }
  }

  return new Promise((resolve) => {
    // Ultra-Fast path: direct audio stream extraction with android client (enables ratebypass=yes for instant, unthrottled streaming)
    execFile(
      "python",
      ["-m", "yt_dlp", "-g", "-f", "ba[ext=webm]/251/ba[ext=m4a]/140/ba/best", "--no-playlist", "--no-warnings", "--extractor-args", "youtube:player_client=android", target],
      { timeout: 15000 },
      (err, stdout) => {
        if (!err && stdout && stdout.trim()) {
          const directUrl = stdout.trim().split("\n")[0].trim();
          if (directUrl.startsWith("http")) {
            const data = {
              title: streamMeta?.title || "YouTube Audio",
              author: streamMeta?.author || "Trending Music",
              duration: streamMeta?.duration || 0,
              streamUrl: directUrl,
              artworkUrl: streamMeta?.artworkUrl || "logo.png"
            };
            directStreamCache.set(cacheKey, { time: Date.now(), data });
            return resolve(data);
          }
        }

        // Fallback: full JSON extraction if -g failed
        execFile(
          "python",
          ["-m", "yt_dlp", "-j", "-f", "ba[ext=webm]/251/ba[ext=m4a]/140/ba/best", "--no-playlist", "--no-warnings", "--extractor-args", "youtube:player_client=android", target],
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
                  duration: streamMeta?.duration || Math.round((info.duration || 0) * 1000),
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

const lavalink = new LavalinkManager({
  nodes: [
    {
      authorization: process.env.LAVALINK_AUTH || "youshallnotpass",
      host: process.env.LAVALINK_HOST || "127.0.0.1",
      port: parseInt(process.env.LAVALINK_PORT || "2334", 10),
      secure: process.env.LAVALINK_SECURE === "true"
    }
  ],
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

  // Auto-recovery for YouTube stream failures using yt-dlp direct stream extractor:
  const isYtTrack = track?.info?.sourceName === "youtube" || track?.info?.uri?.includes("youtube.com") || track?.info?.uri?.includes("youtu.be");
  if (isYtTrack && !track.userData?.mirrored) {
    try {
      console.log(`🔄 [Auto-Recovery] Extracting direct stream for "${track.info.title}"...`);
      const streamInfo = await extractYouTubeStream(track.info.uri || track.info.title);
      if (streamInfo && streamInfo.streamUrl) {
        const httpRes = await player.search({ query: streamInfo.streamUrl }, track.userData?.requester || { username: "AutoRecovery" });
        if (httpRes?.tracks?.length) {
          const mirrorTrack = httpRes.tracks[0];
          mirrorTrack.info.title = streamInfo.title;
          mirrorTrack.info.author = streamInfo.author;
          if (streamInfo.duration) mirrorTrack.info.duration = streamInfo.duration;
          mirrorTrack.userData = { ...track.userData, mirrored: true };
          await player.play({ clientTrack: mirrorTrack });
          textChannel?.send({
            content: `🔄 **Seamless Audio Recovery:** Connected high-fidelity stream for **"${streamInfo.title}"** 🎧`
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

function resolveSurah(input) {
  const num = parseInt(input);
  if (!isNaN(num) && num >= 1 && num <= 114) {
    return num;
  }
  const clean = input.toLowerCase().replace(/[^a-z]/g, "");
  for (const [sNum, sName] of Object.entries(SURAH_NAMES)) {
    if (sName.toLowerCase().replace(/[^a-z]/g, "").includes(clean)) {
      return parseInt(sNum);
    }
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
  if (normTitle.includes("surah")) {
    const match = normTitle.match(/surah\s*(\d+)/i);
    const startNum = match ? parseInt(match[1], 10) : 1;
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
        url: quranUrl,
        source: "quran",
        isRadio: true,
        radioSeed: seedTitle
      });
    }
    return radio;
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
  }
  if (!player.connected) await player.connect();
  return player;
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

          // Resolve & Play Track 1 Immediately
          const first = spotifyData.tracks[0];
          try {
            const streamInfo = await extractYouTubeStream(first.query);
            if (streamInfo && streamInfo.streamUrl) {
              const httpRes = await player.search({ query: streamInfo.streamUrl }, message.author);
              if (httpRes?.tracks?.length) {
                const tr = httpRes.tracks[0];
                tr.info.title = streamInfo.title || first.title;
                tr.info.author = streamInfo.author || first.artist;
                if (streamInfo.duration) tr.info.duration = streamInfo.duration;
                if (streamInfo.artworkUrl) tr.info.artworkUrl = streamInfo.artworkUrl;
                tr.userData = { filterMode: mode, requester: message.author, streamUrl: streamInfo.streamUrl };
                if (isPlayNow) {
                  if (player.queue.current) addToHistory(message.guild.id, player.queue.current);
                  await player.play({ clientTrack: tr });
                } else {
                  player.queue.add(tr);
                  if (!player.playing) await player.play();
                }
              }
            }
          } catch(e) {
            console.error("Spotify track 1 stream resolution error:", e);
          }

          // Background enqueue remaining tracks
          (async () => {
            for (let i = 1; i < spotifyData.tracks.length; i++) {
              const spTrack = spotifyData.tracks[i];
              try {
                const streamInfo = await extractYouTubeStream(spTrack.query);
                if (streamInfo && streamInfo.streamUrl) {
                  const httpRes = await player.search({ query: streamInfo.streamUrl }, message.author);
                  if (httpRes?.tracks?.length) {
                    const tr = httpRes.tracks[0];
                    tr.info.title = streamInfo.title || spTrack.title;
                    tr.info.author = streamInfo.author || spTrack.artist;
                    if (streamInfo.duration) tr.info.duration = streamInfo.duration;
                    if (streamInfo.artworkUrl) tr.info.artworkUrl = streamInfo.artworkUrl;
                    tr.userData = { filterMode: mode, requester: message.author, streamUrl: streamInfo.streamUrl };
                    player.queue.add(tr);
                  }
                }
              } catch(e) {}
            }
          })().catch(() => {});

          return;
        }

        // Direct media links (.mp3, .m4a, .ogg, etc.)
        if (query.match(/\.(mp3|m4a|wav|aac|flac|ogg)(\?.*)?$/i)) {
          try {
            res = await player.search({ query }, message.author);
            if (res?.tracks?.length) {
              if (mode === "filterless" || validateByFilterMode(mode, res.tracks[0]).allowed) {
                candidateTrack = res.tracks[0];
              }
            }
          } catch(e) {}
        }

        // For YouTube & video URLs, extract direct stream
        if (!candidateTrack) {
          try {
            const streamInfo = await extractYouTubeStream(query);
            if (streamInfo && streamInfo.streamUrl) {
              const httpRes = await player.search({ query: streamInfo.streamUrl }, message.author);
              if (httpRes?.tracks?.length) {
                const tr = httpRes.tracks[0];
                tr.info.title = streamInfo.title;
                tr.info.author = streamInfo.author;
                if (streamInfo.duration) tr.info.duration = streamInfo.duration;
                if (streamInfo.artworkUrl) tr.info.artworkUrl = streamInfo.artworkUrl;

                if (mode === "filterless" || validateByFilterMode(mode, tr).allowed) {
                  candidateTrack = tr;
                }
              }
            }
          } catch(ytErr) {
            console.error("Direct URL stream extraction error:", ytErr);
          }
        }
      } else {
        // Search query: Extract direct audio stream via yt-dlp
        try {
          const streamInfo = await extractYouTubeStream(query);
          if (streamInfo && streamInfo.streamUrl) {
            const httpRes = await player.search({ query: streamInfo.streamUrl }, message.author);
            if (httpRes?.tracks?.length) {
              const tr = httpRes.tracks[0];
              tr.info.title = streamInfo.title;
              tr.info.author = streamInfo.author;
              if (streamInfo.duration) tr.info.duration = streamInfo.duration;
              if (streamInfo.artworkUrl) tr.info.artworkUrl = streamInfo.artworkUrl;

              if (mode === "filterless" || validateByFilterMode(mode, tr).allowed) {
                candidateTrack = tr;
              }
            }
          }
        } catch(searchErr) {
          console.error("Search stream extraction error:", searchErr);
        }

        // Fallback: If yt-dlp didn't find anything, try direct search
        if (!candidateTrack) {
          try {
            res = await player.search({ query: `ytsearch:${query}` }, message.author);
            if (res?.tracks?.length) {
              if (mode === "filterless") candidateTrack = res.tracks[0];
              else candidateTrack = res.tracks.find(t => validateByFilterMode(mode, t).allowed);
            }
          } catch(e) {}
        }
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
          await player.play({ clientTrack: first });
        } else {
          candidateTracks.forEach(t => {
            t.userData = { filterMode: mode, requester: message.author };
            player.queue.add(t);
          });
          message.channel.send(`${badge}\n▶️ **Queued Playlist:** Added **${candidateTracks.length}** tracks to queue 🎧`);
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
        await player.play({ clientTrack: candidateTrack });
      } else {
        player.queue.add(candidateTrack);
        message.channel.send(`${badge}\n▶️ Queued: **${candidateTrack.info.title}** by *${candidateTrack.info.author}* 🎧`);
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
async function resolveMediaTrack(queryOrUrl, forcedFilterMode = null) {
  const { mode: detectedMode, query } = parseQueryFilter(queryOrUrl);
  const filterMode = (detectedMode !== "filterless") ? detectedMode : (forcedFilterMode || "filterless");
  const isUrl = query.startsWith("http://") || query.startsWith("https://");

  // Check if it's a Surah number or query
  const surahMatch = query.match(/surah\s*(\d+)/i) || (query.match(/^\d+$/) ? [, query] : null);
  if (surahMatch) {
    const sNum = parseInt(surahMatch[1]);
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

  // YouTube / Spotify query via yt-dlp direct stream extractor
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
        const first = tracks[0];
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
          for (let i = 1; i < tracks.length; i++) {
            try {
              const tr = await resolveMediaTrack(tracks[i].query, "filterless");
              if (tr) chan.queue.push(tr);
            } catch(e) {}
          }
        })().catch(() => {});
        return `${isImmediate ? "⚡ Playing now" : "Imported"} Spotify ${spotifyData.type} "${spotifyData.title}" (${spotifyData.trackCount} tracks) on ${chan.name}`;
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
    const tracks = bodyObj.tracks || [];
    const playlistName = bodyObj.name || "Trending Playlist";
    const isImmediate = bodyObj.immediate === true;
    (async () => {
      let isFirst = isImmediate || !chan.isPlaying || !chan.current;
      for (const q of tracks) {
        try {
          const tr = await resolveMediaTrack(q, "filterless");
          if (tr) {
            if (isFirst) {
              if (chan.current) chan.history.push(chan.current);
              chan.current = tr;
              chan.isPlaying = true;
              chan.isPaused = false;
              chan.position = 0;
              isFirst = false;
            } else {
              chan.queue.push(tr);
            }
          }
        } catch(e) {}
      }
    })().catch(() => {});
    return `${isImmediate ? "⚡ Playing now" : "Enqueued"} ${tracks.length} tracks from "${playlistName}" on ${chan.name}`;
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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const parsedUrl = new URL(req.url, "http://localhost:3050");
  const pathname = parsedUrl.pathname;
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
  if (pathname === "/api/search") {
    const q = parsedUrl.searchParams.get("q") || "";
    const filterMode = parsedUrl.searchParams.get("filterMode") || "filterless";
    if (!q) {
      res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ success: false, error: "Missing search query" }));
    }

    try {
      const [rawResults, rawPlaylists] = await Promise.all([
        searchYouTubeMulti(q, 20),
        searchPlaylistsMulti(q, 5)
      ]);

      let results = rawResults;
      let playlists = rawPlaylists;
      if (filterMode !== "filterless") {
        results = rawResults.filter(t => {
          const check = validateByFilterMode(filterMode, { info: t });
          return check.allowed;
        });
        playlists = rawPlaylists.filter(p => {
          const check = validateByFilterMode(filterMode, { info: p });
          return check.allowed;
        });
      }
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({
        success: true,
        query: q,
        filterMode,
        results,
        playlists
      }));
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

  // Playlist Details Endpoint (Resolves full track list for YouTube / external playlists)
  if (pathname === "/api/playlist-details") {
    const targetUrl = parsedUrl.searchParams.get("url") || parsedUrl.searchParams.get("id");
    if (!targetUrl) {
      res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ success: false, error: "Missing playlist url or id" }));
    }

    try {
      const plData = await resolvePlaylistTracks(targetUrl, 30);
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
  if (pathname === "/api/user/me") {
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
  if (pathname === "/api/user/register" && req.method === "POST") {
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

  if (pathname === "/api/user/logout" && (req.method === "POST" || req.method === "GET")) {
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

    if (!urlParam || !isSpotifyUrl(urlParam)) {
      res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ success: false, error: "Please provide a valid Spotify URL (playlist, album, or track)" }));
    }

    try {
      const spotifyData = await resolveSpotifyLink(urlParam);
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

  // Instant Track Resolver for Direct Browser & App Playback
  if (pathname === "/api/resolve-track") {
    const q = parsedUrl.searchParams.get("q") || "";
    const filterMode = parsedUrl.searchParams.get("filterMode") || "filterless";
    const targetChannel = parsedUrl.searchParams.get("channel") || "browser";

    if (!q) {
      res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ success: false, error: "Missing query" }));
    }

    try {
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
      uri = systemChannels.browser.current?.streamUrl;
    } else if (targetChannel === "app") {
      uri = systemChannels.app.current?.streamUrl;
    } else {
      const guildId = "1553640111047180448";
      const player = lavalink.getPlayer(guildId);
      const currentTrack = player?.queue?.current;
      uri = currentTrack?.userData?.streamUrl || currentTrack?.info?.uri;
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
        res.writeHead(200, {
          "Access-Control-Allow-Origin": "*",
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
            for (const q of tracks) {
              try {
                const streamInfo = await extractYouTubeStream(q);
                if (streamInfo && streamInfo.streamUrl) {
                  const httpRes = await player.search({ query: streamInfo.streamUrl }, { username: "LiquidGlassWeb" });
                  if (httpRes?.tracks?.length) {
                    const tr = httpRes.tracks[0];
                    tr.info.title = streamInfo.title;
                    tr.info.author = streamInfo.author;
                    tr.userData = {
                      filterMode: "filterless",
                      requester: { username: "LiquidGlassWeb" },
                      streamUrl: streamInfo.streamUrl
                    };
                    if (isFirst && isPlayNow) {
                      if (player.queue.current) addToHistory(guild.id, player.queue.current);
                      await player.play({ clientTrack: tr });
                      isFirst = false;
                    } else if (isFirst && !player.playing) {
                      player.queue.add(tr);
                      await player.play();
                      isFirst = false;
                    } else {
                      player.queue.add(tr);
                      isFirst = false;
                    }
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
              const first = tracks[0];
              try {
                const streamInfo = await extractYouTubeStream(first.query);
                if (streamInfo && streamInfo.streamUrl) {
                  const httpRes = await player.search({ query: streamInfo.streamUrl }, { username: "LiquidGlassWeb" });
                  if (httpRes?.tracks?.length) {
                    const tr = httpRes.tracks[0];
                    tr.info.title = streamInfo.title || first.title;
                    tr.info.author = streamInfo.author || first.artist;
                    if (streamInfo.duration) tr.info.duration = streamInfo.duration;
                    if (streamInfo.artworkUrl) tr.info.artworkUrl = streamInfo.artworkUrl;
                    tr.userData = { filterMode: mode, requester: { username: "LiquidGlassWeb" }, streamUrl: streamInfo.streamUrl };
                    if (isPlayNow) {
                      if (player.queue.current) addToHistory(guild.id, player.queue.current);
                      await player.play({ clientTrack: tr });
                    } else {
                      player.queue.add(tr);
                      if (!player.playing) await player.play();
                    }
                  }
                }
              } catch(e) {}

              // Background queue remaining tracks
              (async () => {
                for (let i = 1; i < tracks.length; i++) {
                  try {
                    const sInfo = await extractYouTubeStream(tracks[i].query);
                    if (sInfo && sInfo.streamUrl) {
                      const hRes = await player.search({ query: sInfo.streamUrl }, { username: "LiquidGlassWeb" });
                      if (hRes?.tracks?.length) {
                        const tr = hRes.tracks[0];
                        tr.info.title = sInfo.title || tracks[i].title;
                        tr.info.author = sInfo.author || tracks[i].artist;
                        if (sInfo.duration) tr.info.duration = sInfo.duration;
                        if (sInfo.artworkUrl) tr.info.artworkUrl = sInfo.artworkUrl;
                        tr.userData = { filterMode: mode, requester: { username: "LiquidGlassWeb" }, streamUrl: sInfo.streamUrl };
                        player.queue.add(tr);
                      }
                    }
                  } catch(e) {}
                }
              })().catch(() => {});

              resultMsg = `${isPlayNow ? "⚡ Playing now" : "Imported"} Spotify ${spotifyData.type}: ${spotifyData.title} (${spotifyData.trackCount} tracks on Discord Bot)`;
              res.writeHead(200, { "Content-Type": "application/json" });
              return res.end(JSON.stringify({ success: true, channel: "bot", message: resultMsg }));
            }
          }

          if (isUrl && query.match(/\.(mp3|m4a|wav|aac|flac|ogg)(\?.*)?$/i)) {
            try {
              const resUrl = await player.search({ query }, { username: "LiquidGlassWeb" });
              if (resUrl?.tracks?.length) {
                if (mode === "filterless" || validateByFilterMode(mode, resUrl.tracks[0]).allowed) {
                  candidate = resUrl.tracks[0];
                }
              }
            } catch(e) {}
          }

          if (!candidate) {
            try {
              const streamInfo = await extractYouTubeStream(query);
              if (streamInfo && streamInfo.streamUrl) {
                const httpRes = await player.search({ query: streamInfo.streamUrl }, { username: "LiquidGlassWeb" });
                if (httpRes?.tracks?.length) {
                  const tr = httpRes.tracks[0];
                  tr.info.title = streamInfo.title;
                  tr.info.author = streamInfo.author;
                  if (streamInfo.duration) tr.info.duration = streamInfo.duration;
                  if (streamInfo.artworkUrl) tr.info.artworkUrl = streamInfo.artworkUrl;

                  if (mode === "filterless" || validateByFilterMode(mode, tr).allowed) {
                    candidate = tr;
                  }
                }
              }
            } catch(e) {
              console.error("Web API stream extraction error:", e);
            }
          }

          if (!candidate) {
            try {
              const resYT = await player.search({ query: `ytsearch:${query}` }, { username: "LiquidGlassWeb" });
              if (resYT?.tracks?.length) {
                if (mode === "filterless" || validateByFilterMode(mode, resYT.tracks[0]).allowed) {
                  candidate = resYT.tracks[0];
                }
              }
            } catch(e) {}
          }

          if (candidate) {
            candidate.userData = {
              filterMode: mode,
              requester: { username: "LiquidGlassWeb" },
              streamUrl: candidate.streamUrl || candidate.info?.uri || null
            };
            if (isPlayNow) {
              if (player.queue.current) addToHistory(guild.id, player.queue.current);
              await player.play({ clientTrack: candidate });
              resultMsg = `⚡ Playing Now on Discord Bot: ${candidate.info.title}`;
            } else {
              player.queue.add(candidate);
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

webServer.listen(3050, "0.0.0.0", () => {
  console.log("🌐 Spy Sec Music Web Player live at http://localhost:3050");
});

client.once("clientReady", async () => {
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

client.login(process.env.DISCORD_TOKEN);
