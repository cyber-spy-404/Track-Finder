/**
 * DISCORD BOT MANAGER — DEDICATED ADMINISTRATIVE WEB DASHBOARD CONTROLLER
 * Real-time voice control, queue monitoring, announcement channel switching, & equalizer
 */

(function () {
  "use strict";

  function resolveApiUrl(path) {
    if (!path) return "";
    if (path.startsWith("http://") || path.startsWith("https://")) return path;
    if (typeof window !== "undefined" && typeof window.resolveApiUrl === "function") {
      return window.resolveApiUrl(path);
    }
    const custom = (localStorage.getItem("ahm_server_url") || "").trim();
    if (custom && (custom.startsWith("http://") || custom.startsWith("https://"))) {
      const base = custom.replace(/\/+$/, "");
      return base + (path.startsWith("/") ? path : "/" + path);
    }
    if (typeof window !== "undefined" && window.location?.origin && window.location.origin.includes("track-finder.onrender.com")) {
      return path;
    }
    return "https://track-finder.onrender.com" + (path.startsWith("/") ? path : "/" + path);
  }

  // Elements
  const headerBotAvatar = document.getElementById("headerBotAvatar");
  const voiceChannelLabel = document.getElementById("voiceChannelLabel");
  const headerAnnounceLabel = document.getElementById("headerAnnounceLabel");
  const botPlaybackStatusBadge = document.getElementById("botPlaybackStatusBadge");
  const botTrackArt = document.getElementById("botTrackArt");
  const botTrackTitle = document.getElementById("botTrackTitle");
  const botTrackAuthor = document.getElementById("botTrackAuthor");
  const botFilterPill = document.getElementById("botFilterPill");
  const botCurrentTime = document.getElementById("botCurrentTime");
  const botTotalTime = document.getElementById("botTotalTime");
  const botScrubber = document.getElementById("botScrubber");
  const btnBotPlayPause = document.getElementById("btnBotPlayPause");
  const btnBotPrev = document.getElementById("btnBotPrev");
  const btnBotNext = document.getElementById("btnBotNext");
  const btnBotLoop = document.getElementById("btnBotLoop");
  const btnBotStop = document.getElementById("btnBotStop");
  const botVolumeSlider = document.getElementById("botVolumeSlider");
  const botVolumeVal = document.getElementById("botVolumeVal");

  const selectAnnounceChannel = document.getElementById("selectAnnounceChannel");
  const btnUpdateAnnounceChannel = document.getElementById("btnUpdateAnnounceChannel");
  const btnPostControlEmbed = document.getElementById("btnPostControlEmbed");

  const discordQueryInput = document.getElementById("discordQueryInput");
  const btnDiscordPlay = document.getElementById("btnDiscordPlay");
  const discordQueueContainer = document.getElementById("discordQueueContainer");
  const queueBadgeCount = document.getElementById("queueBadgeCount");
  const historyBadgeCount = document.getElementById("historyBadgeCount");
  const tabShowQueue = document.getElementById("tabShowQueue");
  const tabShowHistory = document.getElementById("tabShowHistory");
  const btnClearDiscordQueue = document.getElementById("btnClearDiscordQueue");
  const toastNotice = document.getElementById("toastNotice");

  // State
  let currentBotState = null;
  let activeQueueTab = "queue";
  let activeFilterMode = "filterless";
  let activeEQ = "flat";
  let isDraggingScrubber = false;
  let toastTimer = null;
  let channelsPopulated = false;

  // Indian playlists database for direct enqueueing
  const INDIAN_PLAYLISTS = {
    "trending-india": {
      name: "Trending Now India",
      tracks: [
        "Millionaire Yo Yo Honey Singh",
        "Tauba Tauba Bad Newz Karan Aujla",
        "Aaj Ki Raat Stree 2 Tamannaah Bhatia",
        "O Maahi Dunki Arijit Singh",
        "Husn Anuv Jain",
        "Chaleya Jawan Shah Rukh Khan Arijit Singh"
      ]
    },
    "bollywood-central": {
      name: "Bollywood Central",
      tracks: [
        "Kesariya Brahmastra Arijit Singh",
        "Apna Bana Le Bhediya Arijit Singh",
        "Tum Hi Ho Aashiqui 2 Arijit Singh",
        "Raataan Lambiyan Shershaah Jubin Nautiyal"
      ]
    },
    "punjabi-101": {
      name: "Punjabi 101",
      tracks: [
        "Softly Karan Aujla",
        "Cheques Shubh",
        "Born to Shine Diljit Dosanjh",
        "Lover Diljit Dosanjh"
      ]
    },
    "arijit-singh": {
      name: "Best of Arijit Singh",
      tracks: [
        "Kesariya Arijit Singh",
        "O Maahi Dunki Arijit Singh",
        "Chaleya Arijit Singh",
        "Tum Hi Ho Arijit Singh",
        "Agar Tum Saath Ho Arijit Singh"
      ]
    }
  };

  // Helper: Format Time in M:SS
  function formatTime(ms) {
    if (!ms || isNaN(ms)) return "0:00";
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  }

  // Toast Notification (Success, Error & Info with Icons)
  function showToast(msg, type = null) {
    if (!toastNotice) return;
    if (!type) {
      const lower = String(msg).toLowerCase();
      if (lower.includes("error") || lower.includes("failed") || lower.includes("could not") || lower.includes("invalid") || lower.includes("denied")) {
        type = "error";
      } else if (lower.includes("success") || lower.includes("connected") || lower.includes("verified") || lower.includes("cleared") || lower.includes("queued") || lower.includes("applied") || lower.includes("started")) {
        type = "success";
      } else {
        type = "info";
      }
    }

    toastNotice.className = `toast-notice toast-${type}`;
    let icon = "ℹ";
    if (type === "success") icon = "✓";
    if (type === "error") icon = "⚠";
    
    toastNotice.innerHTML = `<span style="font-weight:900;margin-right:6px;">${icon}</span><span>${msg}</span>`;
    toastNotice.classList.remove("hidden");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastNotice.classList.add("hidden");
    }, type === "error" ? 3800 : 2800);
  }

  // Update dynamic copyright year
  const copyYear = document.getElementById("dashFooterYear");
  if (copyYear) copyYear.textContent = new Date().getFullYear();

  // Auth state & verification
  let currentAuthUser = null;
  try {
    const cached = localStorage.getItem("ahm_cached_user");
    if (cached) currentAuthUser = JSON.parse(cached);
  } catch(e) {}

  async function checkAuthStatus() {
    try {
      // Check query param for token from OAuth2
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.has("token")) {
        const urlToken = urlParams.get("token");
        localStorage.setItem("ahm_session_token", urlToken);
        window.history.replaceState({}, document.title, window.location.pathname);
      }
      if (urlParams.get("error") === "not_in_server") {
        showToast("Access Denied: You are not a member of the Spy Sec Music Discord server.");
        window.history.replaceState({}, document.title, window.location.pathname);
      }

      const token = localStorage.getItem("ahm_session_token");
      const authGate = document.getElementById("discordAuthGate");
      const userBadge = document.getElementById("headerUserAuthBadge");
      const userName = document.getElementById("dashUserName");
      const userAvatar = document.getElementById("dashUserAvatar");
      const btnDashLogout = document.getElementById("btnDashLogout");

      // Instantly restore cached user if available
      if (currentAuthUser && token) {
        if (authGate) authGate.style.display = "none";
        if (userBadge) userBadge.style.display = "inline-flex";
        if (userName) userName.textContent = currentAuthUser.displayName || currentAuthUser.username || currentAuthUser.email;
        if (userAvatar) userAvatar.src = currentAuthUser.avatar && currentAuthUser.avatar.length > 2 && currentAuthUser.avatar !== "logo.png" ? currentAuthUser.avatar : "logo.png";
        if (btnDashLogout) btnDashLogout.style.display = "inline-flex";
      }

      if (!token) {
        currentAuthUser = null;
        localStorage.removeItem("ahm_cached_user");
        if (authGate) {
          authGate.style.display = "flex";
          loadServerMemberChips();
        }
        if (userBadge) userBadge.style.display = "none";
        if (btnDashLogout) btnDashLogout.style.display = "none";
        return;
      }

      const headers = { "Authorization": `Bearer ${token}` };
      const res = await fetch(resolveApiUrl("/api/user/me"), { headers });
      const data = await res.json();

      if (data.authenticated && data.user) {
        currentAuthUser = data.user;
        localStorage.setItem("ahm_cached_user", JSON.stringify(data.user));
        if (authGate) authGate.style.display = "none";
        if (userBadge) userBadge.style.display = "inline-flex";
        if (userName) userName.textContent = data.user.displayName || data.user.username || data.user.email;
        if (userAvatar) userAvatar.src = data.user.avatar && data.user.avatar.length > 2 && data.user.avatar !== "logo.png" ? data.user.avatar : "logo.png";
        if (btnDashLogout) btnDashLogout.style.display = "inline-flex";
      } else {
        currentAuthUser = null;
        localStorage.removeItem("ahm_session_token");
        localStorage.removeItem("ahm_cached_user");
        if (authGate) {
          authGate.style.display = "flex";
          loadServerMemberChips();
        }
        if (userBadge) userBadge.style.display = "none";
        if (btnDashLogout) btnDashLogout.style.display = "none";
      }
    } catch(e) {
      console.warn("Auth check network notice (keeping session):", e.message);
    }
  }

  async function loginWithEmailAndPassword() {
    const emailInput = document.getElementById("inputDashEmail");
    const passInput = document.getElementById("inputDashPassword");
    const errBox = document.getElementById("dashEmailErrorBox");
    const btn = document.getElementById("btnDashEmailLogin");

    const email = emailInput ? emailInput.value.trim() : "";
    const password = passInput ? passInput.value : "";

    if (!email) {
      if (errBox) {
        errBox.textContent = "Please enter your email address";
        errBox.style.display = "block";
      }
      return;
    }
    if (!password) {
      if (errBox) {
        errBox.textContent = "Please enter your password";
        errBox.style.display = "block";
      }
      return;
    }
    if (errBox) errBox.style.display = "none";

    if (btn) {
      btn.disabled = true;
      btn.textContent = "Signing In...";
    }

    let res, data;
    try {
      res = await fetch(resolveApiUrl("/api/user/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      data = await res.json();
    } catch (e) {
      console.error("Discord login request error:", e);
      if (errBox) {
        errBox.textContent = "Network error connecting to server. Please verify the server is running.";
        errBox.style.display = "block";
      }
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Log In & Unlock Dashboard";
      }
      return;
    }

    try {
      if (data && data.success && data.user) {
        if (data.token) localStorage.setItem("ahm_session_token", data.token);
        showToast(`Welcome ${data.user.displayName || data.user.email}! Logged in.`);
        await checkAuthStatus();
        pollState();
      } else {
        if (errBox) {
          errBox.textContent = (data && data.error) ? data.error : "Login failed. Please check your credentials.";
          errBox.style.display = "block";
        }
      }
    } catch (postErr) {
      console.error("Post-login error:", postErr);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Log In & Unlock Dashboard";
      }
    }
  }

  async function loadServerMemberChips() {
    const container = document.getElementById("dashServerMembersChips");
    if (!container || container.children.length > 0) return;
    try {
      const res = await fetch(resolveApiUrl("/api/auth/server-members"));
      const data = await res.json();
      if (data.success && Array.isArray(data.members)) {
        container.innerHTML = "";
        data.members.slice(0, 16).forEach(m => {
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = "server-member-chip";
          chip.innerHTML = `
            <img src="${m.avatar || 'logo.png'}">
            <span>${escapeHtml(m.displayName || m.username)}</span>
          `;
          chip.addEventListener("click", () => {
            const input = document.getElementById("inputDiscordVerify");
            if (input) {
              input.value = m.id || m.username;
              verifyDiscordMember(m.id || m.username);
            }
          });
          container.appendChild(chip);
        });
      }
    } catch(e) {}
  }

  async function verifyDiscordMember(overrideQuery = null) {
    const input = document.getElementById("inputDiscordVerify");
    const btn = document.getElementById("btnVerifyDiscordMember");
    const errBox = document.getElementById("verifyErrorBox");
    const query = overrideQuery || (input ? input.value.trim() : "");

    if (!query) {
      if (errBox) {
        errBox.textContent = "Please enter your Discord User ID or Username";
        errBox.style.display = "block";
      }
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = "Verifying...";
    }
    if (errBox) errBox.style.display = "none";

    try {
      const res = await fetch(resolveApiUrl("/api/auth/discord-verify"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query })
      });
      let data = null;
      try {
        data = await res.json();
      } catch(parseErr) {}

      if (data && data.success && data.isServerMember) {
        if (data.token) {
          localStorage.setItem("ahm_session_token", data.token);
        }
        showToast(`Welcome ${data.user?.displayName || "Member"}! Verified server member.`);
        await checkAuthStatus();
        pollState();
      } else {
        if (errBox) {
          errBox.textContent = (data && data.error) ? data.error : "User was not found in the Spy Sec Music server.";
          errBox.style.display = "block";
        }
      }
    } catch (e) {
      if (errBox) {
        errBox.textContent = "Network error communicating with server. Please check your connection.";
        errBox.style.display = "block";
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Verify & Unlock";
      }
    }
  }

  // Send Action to Discord Bot API
  async function sendBotAction(action, value = null, extra = {}) {
    try {
      const payload = {
        targetChannel: "bot",
        action: action,
        value: value,
        ...extra
      };
      const token = localStorage.getItem("ahm_session_token") || "";
      const headers = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(resolveApiUrl("/api/action"), {
        method: "POST",
        headers: headers,
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.status === 403 || data.requireDiscordAuth) {
        showToast("Discord server authentication required");
        checkAuthStatus();
        return;
      }
      if (data.message) {
        showToast(data.message);
      } else if (data.error) {
        showToast("Error: " + data.error);
      }
      pollState();
    } catch (e) {
      showToast("Network error contacting server");
      console.error(e);
    }
  }

  // Poll Bot State from Backend
  async function pollState() {
    try {
      const res = await fetch(resolveApiUrl("/api/state?t=" + Date.now()));
      if (!res.ok) return;
      const data = await res.json();
      renderDashboard(data);
    } catch (e) {
      // Background retry
    }
  }

  // Render Dashboard
  function renderDashboard(data) {
    const bot = data?.channels?.bot || {};
    currentBotState = bot;

    // Header updates
    if (voiceChannelLabel) voiceChannelLabel.textContent = bot.voiceChannel || "General";
    if (headerAnnounceLabel) headerAnnounceLabel.textContent = "#" + (bot.announcementChannelName || "music");

    // Populate text channels dropdown grouped by server with real-time version update
    if (selectAnnounceChannel && (Array.isArray(data.servers) || Array.isArray(data.availableTextChannels))) {
      const versionKey = `${data.channelsVersion || 0}_${data.announcementChannelId || ''}`;
      if (selectAnnounceChannel.dataset.version !== versionKey && document.activeElement !== selectAnnounceChannel) {
        selectAnnounceChannel.dataset.version = versionKey;
        const currentSelected = bot.announcementChannelId || data.announcementChannelId;
        selectAnnounceChannel.innerHTML = "";

        if (Array.isArray(data.servers) && data.servers.length > 0) {
          data.servers.forEach(srv => {
            const group = document.createElement("optgroup");
            group.label = `Server: ${srv.guildName} (${srv.channels.length} channels)`;
            srv.channels.forEach(ch => {
              const opt = document.createElement("option");
              opt.value = ch.id;
              opt.textContent = `#${ch.name}${ch.category ? ` • ${ch.category}` : ''}`;
              if (ch.id === currentSelected) {
                opt.selected = true;
              }
              group.appendChild(opt);
            });
            selectAnnounceChannel.appendChild(group);
          });
        } else if (Array.isArray(data.availableTextChannels)) {
          data.availableTextChannels.forEach(ch => {
            const opt = document.createElement("option");
            opt.value = ch.id;
            opt.textContent = `${ch.guildName ? `[${ch.guildName}] ` : ''}#${ch.name}`;
            if (ch.id === currentSelected || ch.name.toLowerCase() === "music") {
              opt.selected = (ch.id === currentSelected);
            }
            selectAnnounceChannel.appendChild(opt);
          });
        }

        if (currentSelected) {
          selectAnnounceChannel.value = currentSelected;
        }
      } else if (data.announcementChannelId && document.activeElement !== selectAnnounceChannel && selectAnnounceChannel.value !== data.announcementChannelId) {
        selectAnnounceChannel.value = data.announcementChannelId;
      }
    }

    // Now Playing Card
    const current = bot.current;
    if (current && current.info) {
      if (botTrackTitle) botTrackTitle.textContent = current.info.title || "Playing Track";
      if (botTrackAuthor) botTrackAuthor.textContent = current.info.author || "Unknown Artist";
      if (botTrackArt && current.info.artworkUrl) {
        botTrackArt.src = current.info.artworkUrl;
      }
      if (botFilterPill) {
        const mode = current.filterMode || "filterless";
        botFilterPill.textContent = mode === "strict" ? "Strict Halal" : (mode === "remix" ? "Islamic Vibes" : "Filterless");
      }

      const statusText = document.getElementById("botPlaybackStatusText") || botPlaybackStatusBadge;
      const wave = document.getElementById("dashWaveIndicator");
      if (statusText) {
        if (bot.isPlaying) {
          statusText.textContent = "Live in Voice";
          if (wave) wave.style.display = "inline-flex";
          botPlaybackStatusBadge.style.background = "var(--emerald-soft)";
          botPlaybackStatusBadge.style.borderColor = "rgba(16, 185, 129, 0.3)";
          botPlaybackStatusBadge.style.color = "var(--emerald)";
        } else if (bot.isPaused) {
          statusText.textContent = "Paused";
          if (wave) wave.style.display = "none";
          botPlaybackStatusBadge.style.background = "rgba(217, 119, 6, 0.12)";
          botPlaybackStatusBadge.style.borderColor = "rgba(217, 119, 6, 0.3)";
          botPlaybackStatusBadge.style.color = "#D97706";
        } else {
          statusText.textContent = "Standby";
          if (wave) wave.style.display = "none";
          botPlaybackStatusBadge.style.background = "var(--bg-surface)";
          botPlaybackStatusBadge.style.borderColor = "var(--border-subtle)";
          botPlaybackStatusBadge.style.color = "var(--text-muted)";
        }
      }

      // Time & Scrubber
      const pos = bot.position || 0;
      const dur = bot.duration || current.info.duration || 0;
      if (botCurrentTime) botCurrentTime.textContent = formatTime(pos);
      if (botTotalTime) botTotalTime.textContent = formatTime(dur);

      if (!isDraggingScrubber && botScrubber) {
        botScrubber.max = dur || 100;
        botScrubber.value = pos;
      }

      if (btnBotPlayPause) {
        btnBotPlayPause.textContent = bot.isPlaying ? "⏸" : "▶";
      }
    } else {
      if (botTrackTitle) botTrackTitle.textContent = "Voice Standby";
      if (botTrackAuthor) botTrackAuthor.textContent = "Connected to #" + (bot.voiceChannel || "General");
      if (botTrackArt) botTrackArt.src = "logo.png";
      const statusText = document.getElementById("botPlaybackStatusText") || botPlaybackStatusBadge;
      const wave = document.getElementById("dashWaveIndicator");
      if (statusText) {
        statusText.textContent = "Idle";
        if (wave) wave.style.display = "none";
        botPlaybackStatusBadge.style.background = "rgba(148, 155, 164, 0.2)";
        botPlaybackStatusBadge.style.borderColor = "rgba(148, 155, 164, 0.3)";
        botPlaybackStatusBadge.style.color = "#949BA4";
      }
      if (btnBotPlayPause) btnBotPlayPause.textContent = "▶";
      if (botCurrentTime) botCurrentTime.textContent = "0:00";
      if (botTotalTime) botTotalTime.textContent = "0:00";
      if (!isDraggingScrubber && botScrubber) botScrubber.value = 0;
    }

    // Volume
    if (bot.volume !== undefined) {
      if (botVolumeSlider && document.activeElement !== botVolumeSlider) {
        botVolumeSlider.value = bot.volume;
      }
      if (botVolumeVal) {
        botVolumeVal.textContent = bot.volume + "%";
      }
    }

    // Loop button state
    if (btnBotLoop) {
      if (bot.repeatMode && bot.repeatMode !== "off") {
        btnBotLoop.style.background = "var(--discord-blurple)";
        btnBotLoop.style.color = "#fff";
      } else {
        btnBotLoop.style.background = "";
        btnBotLoop.style.color = "";
      }
    }

    // Queue & History Counts
    const queueList = bot.queue || [];
    const historyList = bot.history || [];
    if (queueBadgeCount) queueBadgeCount.textContent = queueList.length;
    if (historyBadgeCount) historyBadgeCount.textContent = historyList.length;

    renderQueueList(activeQueueTab === "queue" ? queueList : historyList);
  }

  // Render Queue Table
  function renderQueueList(items) {
    if (!discordQueueContainer) return;

    if (!items || items.length === 0) {
      discordQueueContainer.innerHTML = `
        <div style="text-align: center; padding: 32px 0; color: #949BA4; font-size: 0.9rem;">
          ${activeQueueTab === "queue" ? "No upcoming songs in Discord queue. Search or click a quick-chip above!" : "No recent playback history on this session."}
        </div>
      `;
      return;
    }

    let html = "";
    items.forEach((track, idx) => {
      const info = track.info || {};
      const title = info.title || "Track " + (idx + 1);
      const author = info.author || "Unknown Artist";
      const dur = formatTime(info.duration || 0);
      const art = info.artworkUrl || "logo.png";

      html += `
        <div class="queue-item">
          <div class="queue-item-meta">
            <span class="queue-idx">${idx + 1}</span>
            <img src="${art}" alt="" style="width: 36px; height: 36px; border-radius: 4px; object-fit: cover;">
            <div style="min-width: 0; display: flex; flex-direction: column;">
              <span class="queue-item-title">${escapeHtml(title)}</span>
              <span class="queue-item-author">${escapeHtml(author)}</span>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 12px;">
            <span class="queue-item-time">${dur}</span>
            ${activeQueueTab === "queue" ? `
              <button class="btn-ctrl" style="width: 30px; height: 30px; font-size: 12px;" onclick="window.skipToQueueIndex(${idx})" title="Play this track">▶</button>
            ` : ""}
          </div>
        </div>
      `;
    });

    discordQueueContainer.innerHTML = html;
  }

  function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // Window helper for queue item click — jumps directly to that track
  window.skipToQueueIndex = function (idx) {
    sendBotAction("play_queue_index", idx);
  };

  // Setup Event Listeners
  function setupListeners() {
    // Transport Controls
    if (btnBotPlayPause) {
      btnBotPlayPause.addEventListener("click", () => sendBotAction("play_pause"));
    }
    if (btnBotNext) {
      btnBotNext.addEventListener("click", () => sendBotAction("next"));
    }
    if (btnBotPrev) {
      btnBotPrev.addEventListener("click", () => sendBotAction("prev"));
    }
    if (btnBotLoop) {
      btnBotLoop.addEventListener("click", () => sendBotAction("loop"));
    }
    if (btnBotStop) {
      btnBotStop.addEventListener("click", () => sendBotAction("stop"));
    }

    // Scrubber
    if (botScrubber) {
      botScrubber.addEventListener("mousedown", () => { isDraggingScrubber = true; });
      botScrubber.addEventListener("touchstart", () => { isDraggingScrubber = true; });
      botScrubber.addEventListener("input", (e) => {
        if (botCurrentTime) botCurrentTime.textContent = formatTime(Number(e.target.value));
      });
      botScrubber.addEventListener("change", (e) => {
        isDraggingScrubber = false;
        sendBotAction("seek", Number(e.target.value));
      });
    }

    // Volume Slider
    if (botVolumeSlider) {
      botVolumeSlider.addEventListener("input", (e) => {
        if (botVolumeVal) botVolumeVal.textContent = e.target.value + "%";
      });
      botVolumeSlider.addEventListener("change", (e) => {
        sendBotAction("volume", Number(e.target.value));
      });
    }

    // Quick Volume Chips
    document.querySelectorAll("[data-vol]").forEach(chip => {
      chip.addEventListener("click", () => {
        const val = Number(chip.getAttribute("data-vol"));
        if (botVolumeSlider) botVolumeSlider.value = val;
        if (botVolumeVal) botVolumeVal.textContent = val + "%";
        sendBotAction("volume", val);
      });
    });

    // Equalizer Presets
    document.querySelectorAll(".btn-eq").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".btn-eq").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        const eqName = btn.getAttribute("data-eq");
        activeEQ = eqName;
        sendBotAction("eq", eqName);
      });
    });

    // Audio Routing Mode Buttons
    const btnRouteBotOnly = document.getElementById("btnRouteBotOnly");
    const btnRouteBoth = document.getElementById("btnRouteBoth");
    if (btnRouteBotOnly) {
      btnRouteBotOnly.addEventListener("click", () => {
        sendBotAction("routing", "bot");
      });
    }
    if (btnRouteBoth) {
      btnRouteBoth.addEventListener("click", () => {
        sendBotAction("routing", "both");
      });
    }

    // Announcement Channel Save
    if (btnUpdateAnnounceChannel && selectAnnounceChannel) {
      btnUpdateAnnounceChannel.addEventListener("click", () => {
        const chId = selectAnnounceChannel.value;
        sendBotAction("set_announcement_channel", chId);
      });
    }

    // Re-send Embed Button
    if (btnPostControlEmbed) {
      btnPostControlEmbed.addEventListener("click", () => {
        // Enqueue command or notify
        sendBotAction("send", selectAnnounceChannel?.value || "music");
      });
    }

    // Filter Mode Chips
    const chips = [
      { id: "chipFilterFilterless", mode: "filterless" },
      { id: "chipFilterStrict", mode: "strict" },
      { id: "chipFilterRemix", mode: "remix" }
    ];
    chips.forEach(c => {
      const el = document.getElementById(c.id);
      if (el) {
        el.addEventListener("click", () => {
          chips.forEach(other => document.getElementById(other.id)?.classList.remove("active"));
          el.classList.add("active");
          activeFilterMode = c.mode;
        });
      }
    });

    // Play Now & Enqueue Buttons & Input
    function triggerPlayNow() {
      const q = discordQueryInput ? discordQueryInput.value.trim() : "";
      if (!q) return;
      let finalQ = q;
      if (activeFilterMode === "strict" && !q.startsWith("#")) {
        finalQ = "#" + q;
      } else if (activeFilterMode === "remix" && !q.startsWith("*")) {
        finalQ = "*" + q;
      }
      sendBotAction("play_now", finalQ, { filterMode: activeFilterMode, immediate: true });
      if (discordQueryInput) discordQueryInput.value = "";
    }

    function triggerEnqueue() {
      const q = discordQueryInput ? discordQueryInput.value.trim() : "";
      if (!q) return;
      let finalQ = q;
      if (activeFilterMode === "strict" && !q.startsWith("#")) {
        finalQ = "#" + q;
      } else if (activeFilterMode === "remix" && !q.startsWith("*")) {
        finalQ = "*" + q;
      }
      sendBotAction("play_query", finalQ, { filterMode: activeFilterMode, immediate: false });
      if (discordQueryInput) discordQueryInput.value = "";
    }

    const btnDiscordPlayNow = document.getElementById("btnDiscordPlayNow");
    if (btnDiscordPlayNow) {
      btnDiscordPlayNow.addEventListener("click", triggerPlayNow);
    }
    if (btnDiscordPlay) {
      btnDiscordPlay.addEventListener("click", triggerEnqueue);
    }
    if (discordQueryInput) {
      discordQueryInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") triggerPlayNow();
      });
    }

    // Quick Surah Chips
    document.querySelectorAll("[data-surah]").forEach(chip => {
      chip.addEventListener("click", () => {
        const surahNum = chip.getAttribute("data-surah");
        sendBotAction("play_surah", surahNum);
      });
    });

    // Quick Indian Playlist Chips
    document.querySelectorAll("[data-plist]").forEach(chip => {
      chip.addEventListener("click", () => {
        const pKey = chip.getAttribute("data-plist");
        const plist = INDIAN_PLAYLISTS[pKey];
        if (plist) {
          sendBotAction("play_playlist", null, {
            name: plist.name,
            tracks: plist.tracks
          });
        }
      });
    });

    // Quick Spotify Paste Link Button
    const btnQuickSpotifyPaste = document.getElementById("btnQuickSpotifyPaste");
    if (btnQuickSpotifyPaste) {
      btnQuickSpotifyPaste.addEventListener("click", () => {
        const url = prompt("Paste public Spotify playlist, album, or track URL (e.g. https://open.spotify.com/playlist/...):");
        if (url && url.trim()) {
          showToast("⏳ Importing Spotify playlist to Discord Voice...");
          sendBotAction("play_query", url.trim(), { filterMode: "filterless" });
        }
      });
    }

    // Queue / History Tabs
    if (tabShowQueue && tabShowHistory) {
      tabShowQueue.addEventListener("click", () => {
        activeQueueTab = "queue";
        tabShowQueue.classList.add("active");
        tabShowHistory.classList.remove("active");
        if (currentBotState) renderQueueList(currentBotState.queue || []);
      });

      tabShowHistory.addEventListener("click", () => {
        activeQueueTab = "history";
        tabShowHistory.classList.add("active");
        tabShowQueue.classList.remove("active");
        if (currentBotState) renderQueueList(currentBotState.history || []);
      });
    }

    // Clear Queue Button
    if (btnClearDiscordQueue) {
      btnClearDiscordQueue.addEventListener("click", () => {
        sendBotAction("stop");
      });
    }

    // Email & Password Login Handler
    const btnDashEmailLogin = document.getElementById("btnDashEmailLogin");
    const inputDashEmail = document.getElementById("inputDashEmail");
    const inputDashPassword = document.getElementById("inputDashPassword");

    if (btnDashEmailLogin) {
      btnDashEmailLogin.addEventListener("click", loginWithEmailAndPassword);
    }
    if (inputDashPassword) {
      inputDashPassword.addEventListener("keydown", (e) => {
        if (e.key === "Enter") loginWithEmailAndPassword();
      });
    }
    if (inputDashEmail) {
      inputDashEmail.addEventListener("keydown", (e) => {
        if (e.key === "Enter") inputDashPassword?.focus();
      });
    }

    // Discord Member Verification Gate
    const btnVerify = document.getElementById("btnVerifyDiscordMember");
    const inputVerify = document.getElementById("inputDiscordVerify");
    if (btnVerify) {
      btnVerify.addEventListener("click", verifyDiscordMember);
    }
    if (inputVerify) {
      inputVerify.addEventListener("keydown", (e) => {
        if (e.key === "Enter") verifyDiscordMember();
      });
    }

    // Logout from Discord session
    document.getElementById("btnDashLogout")?.addEventListener("click", async () => {
      try {
        const token = localStorage.getItem("ahm_session_token");
        await fetch(resolveApiUrl("/api/user/logout"), {
          method: "POST",
          headers: token ? { "Authorization": `Bearer ${token}` } : {}
        });
      } catch(e) {}
      localStorage.removeItem("ahm_session_token");
      localStorage.removeItem("ahm_cached_user");
      currentAuthUser = null;
      showToast("Logged out of Discord session");
      checkAuthStatus();
    });
  }

  // Theme Manager (Dedicated Separate Dark & Light Mode Support)
  function initTheme() {
    const savedTheme = localStorage.getItem("spysec_theme") || "dark";
    applyTheme(savedTheme, false);

    const btnDark = document.getElementById("btnDashThemeDark");
    const btnLight = document.getElementById("btnDashThemeLight");

    if (btnDark) {
      btnDark.addEventListener("click", () => applyTheme("dark", true));
    }
    if (btnLight) {
      btnLight.addEventListener("click", () => applyTheme("light", true));
    }

    // Support click delegation for any [data-set-theme]
    document.addEventListener("click", (e) => {
      const trigger = e.target.closest("[data-set-theme]");
      if (trigger && trigger.dataset.setTheme) {
        applyTheme(trigger.dataset.setTheme, true);
      }
    });

    const btnToggle = document.getElementById("btnDashThemeToggle");
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

    const btnDark = document.getElementById("btnDashThemeDark");
    const btnLight = document.getElementById("btnDashThemeLight");
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

    document.querySelectorAll("[data-set-theme]").forEach(el => {
      const active = el.getAttribute("data-set-theme") === effectiveTheme;
      el.classList.toggle("active", active);
      el.setAttribute("aria-pressed", active ? "true" : "false");
    });

    const sunIcon = document.querySelector("#btnDashThemeToggle .theme-icon-sun");
    const moonIcon = document.querySelector("#btnDashThemeToggle .theme-icon-moon");
    const label = document.getElementById("dashThemeToggleText");
    if (effectiveTheme === "light") {
      if (sunIcon) sunIcon.style.display = "block";
      if (moonIcon) moonIcon.style.display = "none";
      if (label) label.textContent = "Light";
    } else {
      if (sunIcon) sunIcon.style.display = "none";
      if (moonIcon) moonIcon.style.display = "block";
      if (label) label.textContent = "Dark";
    }

    if (showNotice && typeof showToast === "function") {
      showToast(`Switched to ${effectiveTheme === "dark" ? "Dark" : "Light"} Mode`);
    }
  }
  window.applyTheme = applyTheme;

  // Card Mouse Hover Spotlight Engine
  function initCardSpotlights() {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    document.querySelectorAll(".dash-card").forEach(card => {
      let rafId = null;
      card.addEventListener("pointerenter", () => {
        card.style.setProperty("--spotlight-opacity", "1");
      });
      card.addEventListener("pointermove", (e) => {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          const rect = card.getBoundingClientRect();
          const percentX = ((e.clientX - rect.left) / rect.width) * 100;
          const percentY = ((e.clientY - rect.top) / rect.height) * 100;
          card.style.setProperty("--mouse-x", `${percentX.toFixed(1)}%`);
          card.style.setProperty("--mouse-y", `${percentY.toFixed(1)}%`);
        });
      }, { passive: true });
      card.addEventListener("pointerleave", () => {
        if (rafId) cancelAnimationFrame(rafId);
        card.style.setProperty("--spotlight-opacity", "0");
      });
    });
  }

  // Tactile Mouse Click Effect Engine (Emil Kowalski Physics Ripple & Sparks)
  function initMouseClickEffect() {
    let container = document.getElementById("clickEffectContainer");
    if (!container) {
      container = document.createElement("div");
      container.id = "clickEffectContainer";
      container.className = "click-effect-container";
      document.body.appendChild(container);
    }

    window.addEventListener("pointerdown", (e) => {
      if (e.button !== undefined && e.button !== 0) return;
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
      setTimeout(() => {
        ripple.remove();
      }, 450);
    }, { passive: true });
  }

  // Initialization
  document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    setupListeners();
    checkAuthStatus();
    initCardSpotlights();
    initMouseClickEffect();
    pollState();
    setInterval(pollState, 1200);
  });
})();
