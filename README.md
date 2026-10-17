# 🎧 Track Finder

<div align="center">

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Platform](https://img.shields.io/badge/Platform-Web%20%7C%20Android%20%7C%20Discord-success.svg)](#)
[![Deployment](https://img.shields.io/badge/Deploy-Render%20Blueprint-black.svg?logo=render)](#-1-click-render-blueprint-deployment-free--no-card)
[![Audio](https://img.shields.io/badge/Audio-Ultra--Low%20Latency%20(Opus%20251)-brightgreen.svg)](#)
[![Maintainer](https://img.shields.io/badge/Author-cyber--spy--404-blueviolet.svg)](https://github.com/cyber-spy-404)

**A sovereign, high-performance Web Audio & Music Streaming platform featuring a Spotify-inspired Web Player, native Android APK (Capacitor), and Discord Voice Bot synchronization with sub-second unthrottled streaming.**

[Features](#-key-features) • [Quick Start](#-quick-start) • [Render Deploy](#-1-click-render-blueprint-deployment-free--no-card) • [Mobile App](#-mobile-app--android-apk) • [Architecture](#-project-architecture) • [Environment Variables](#-configuration--environment-variables)

</div>

---

## 🌟 Key Features

### ⚡ 1. Ultra-Low Latency Audio Engine
- **Direct WebAudio Engine**: Streams unthrottled WebM Opus (`itag 251`) with YouTube `ratebypass=yes`.
- **Zero TLS Handshake Lag**: Persistent HTTPS/HTTP socket pooling with keep-alive agents eliminates 200–400ms connection latency on audio chunk requests.
- **TCP NoDelay**: `res.socket.setNoDelay(true)` disables Nagle's algorithm for immediate packet delivery.
- **Smart Prefetching**: Automatically pre-fetches direct stream URLs in the background for instant track transitions.

### 🎛️ 2. 3-Way Independent Audio Routing
Switch playback destinations live from the web player or mobile app:
- 🌐 **Web Browser**: Direct high-fidelity sound through your desktop or mobile browser.
- 📱 **Mobile App**: Unthrottled native playback via Capacitor audio engine.
- 🤖 **Discord Bot**: Streams live audio into your Discord server's voice channel.

### 🔥 3. Curated Indian & Global Trending Hub
- Daily auto-syncing Spotify charts and playlists:
  - **Top 50 - India** & **Top 50 - Global**
  - **Bollywood Butter**, **Hot Hits Hindi**, **Punjabi 101**
  - **Arijit Singh Best of**, **Atif Aslam Classics**, **Sufi Mystics**, **Kollywood**, **Tollywood Bangers**
- Instant one-click playback with high-resolution album artwork and lyrics.

### 📖 4. Sacred Quran & Islamic Halal Audio
- **114 Surahs Direct**: Complete Quran recitations by Mishary Rashid Alafasy available instantly.
- **Tri-Mode Islamic Filter Engine**:
  - `⚪ Filterless`: Full YouTube/Spotify catalog without restrictions.
  - `🟢 # Strict Halal`: Restricts playback exclusively to verified Quran recitations, instrument-free nasheeds, and Hamd/Naat.
  - `🟣 * Islamic Vibes`: Devotional vocal audio, peaceful lofi nasheeds, and zikr.

### 👤 5. User Account & Library Management
- Built-in session store with persistent disk backup (`userStore.js`).
- Personalized **Favorites (❤️ Liked Songs)**, **Custom Queue (📋)**, and **Daily Recommendations**.
- Mobile connection switcher to connect the mobile app to any custom server URL.

---

## 🚀 1-Click Render Blueprint Deployment (100% Free · No Card)

This project includes a native Render Blueprint (`render.yaml`) designed for Render's **Free Web Service** tier (zero credit/debit card required).

### Steps to Deploy:
1. Fork or push this repository to your GitHub account:
   ```bash
   https://github.com/cyber-spy-404/Track-Finder.git
   ```
2. Navigate to your **[Render Dashboard](https://dashboard.render.com)**.
3. Click **New +** (top right) ➔ **Blueprint**.
4. Connect and select the **`cyber-spy-404/Track-Finder`** repository.
5. Render reads `render.yaml` automatically and configures the `track-finder` service.
6. Click **Apply**.
7. In ~2 minutes, your web player will be live at `https://track-finder.onrender.com` (or your assigned subdomain).

---

## 💻 Local Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or newer)
- Python 3 with `yt-dlp` installed (`pip install yt-dlp`)

### Run the Web Player
```bash
# Clone the repository
git clone https://github.com/cyber-spy-404/Track-Finder.git
cd Track-Finder

# Install dependencies
npm install

# Start the standalone low-latency Web Player (Port 3050)
npm run web
```
Open **[http://localhost:3050](http://localhost:3050)** in your browser.

> **Windows Users**: You can also launch by double-clicking [`start-web-player.bat`](file:///c:/Users/mdasw/Downloads/Compressed/SlugYZeon-4.6.2/start-web-player.bat).

---

## 📱 Mobile App & Android APK

### Instant Install as PWA (Any Device)
Open `http://localhost:3050` or your hosted Render URL on your phone:
- **Android (Chrome)**: Tap **Install App** in the header, or Chrome menu (⋮) ➔ **"Add to Home Screen"**.
- **iOS (Safari)**: Tap the Share button ➔ **"Add to Home Screen"**.

### Compile Standalone Android APK (.apk)
1. Navigate to the `mobile-app` directory:
   ```bash
   cd mobile-app
   npm install
   ```
2. Run the automated build script:
   ```powershell
   .\build-apk.bat
   ```
3. Or open `mobile-app/android` in **Android Studio** and click **Build ➔ Build APK(s)**.
4. The generated `.apk` will be output to:
   ```
   mobile-app/android/app/build/outputs/apk/debug/app-debug.apk
   ```

---

## 📁 Project Architecture

```
Track-Finder/
├── render.yaml               # Render Blueprint automation for free deployment
├── package.json              # Root project dependencies & scripts
├── index.js                  # Root universal entrypoint
├── server.js                 # Root server alias
├── settings.gradle.kts       # Gradle project settings
│
├── web-app/                  # 🌐 Standalone High-Performance Audio Engine
│   ├── server.js             # HTTP/Audio streaming engine (TLS keep-alive, TCP nodelay)
│   ├── userStore.js          # Authentication, user accounts, and saved library
│   ├── spotifyTrending.js    # Curated trending playlists & Spotify catalog
│   ├── islamicFilter.js      # Halal/Islamic content filtering rules
│   ├── package.json          # Web app dependencies
│   ├── render.yaml           # Standalone Blueprint copy
│   └── public/               # Client-side SPA
│       ├── index.html        # Spotify-inspired client interface
│       ├── index.css         # Glassmorphism & Obsidian Dark design system
│       ├── app.js            # Web client player & audio routing logic
│       ├── manifest.json     # PWA manifest
│       └── sw.js             # Service Worker for offline asset caching
│
├── mobile-app/               # 📱 Native Android & Capacitor Project
│   ├── capacitor.config.json # Capacitor mobile config
│   ├── build-apk.bat         # 1-Click APK compilation script
│   └── android/              # Full Android Studio Gradle project
│
├── discord-bot/              # 🤖 Discord Voice Integration
│   └── bot.js                # Discord.js music bot & voice channel engine
│
└── lavalink-server/          # ⚡ High-Throughput Audio Node
    └── application.yml       # Lavalink configuration
```

---

## ⚙️ Configuration & Environment Variables

Copy `web-app/.env.example` to `web-app/.env` (or configure via Render Dashboard):

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3050` / `10000` | Port for the HTTP and audio streaming server. |
| `NODE_ENV` | `production` | Set to `production` in live environments. |
| `APK_DOWNLOAD_URL` | *None* | Direct URL to your hosted `.apk` file for mobile download buttons. |
| `LAVALINK_URL` | `http://127.0.0.1:2334` | Optional remote or community Lavalink v4 node URL. |
| `LAVALINK_AUTH` | `youshallnotpass` | Authorization password for Lavalink node. |
| `PYTHON_PATH` | *Auto-detected* | Custom path to Python binary (`python` or `python3`). |

---

## 🛡️ License

This project is licensed under the **Apache-2.0 License** — see the [LICENSE](LICENSE) file for details.

---

<div align="center">
Developed with ❤️ by <b><a href="https://github.com/cyber-spy-404">cyber-spy-404</a></b>
</div>
