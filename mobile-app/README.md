# 📱 Spy Sec Music — Mobile Application & Android APK Project

**Author:** `cyber_spy.404`  
**License:** Apache-2.0  
**Design System:** Spy Sec Obsidian Dark & Spotify Emerald

---

## 🌟 Highlights

1. **3-Way Real-Time Audio Routing**:
   - `🌐 Play only in browser`: Direct high-fidelity sound through your phone or computer speakers; Discord bot is muted (`volume: 0`).
   - `🎙️ Only in DC`: Stream audio exclusively into your Discord Voice Channel; local speakers muted.
   - `✨ In both`: Synchronized playback through both device speakers and Discord Voice simultaneously.

2. **Daily Imported Spotify Trending Hub**:
   - **Today's Top Hits**: Worldwide #1 hits (*Stop The Wedding!*, *Nicole Kidman*, *the cure*).
   - **Top 50 - Global & Top 50 - USA**: Official daily Spotify charts auto-updated every 24 hours.
   - **RapCaviar, Pop Rising, New Music Friday, Viva Latino, Chill Hits, Mega Hit Mix, and Viral Hits**.
   - **Hot Tracks Today**: 1-Click instant stream row on mobile home screen.
   - **On-Demand Sync**: ↻ Refresh button with auto-updating timestamps.

3. **Multi-Result Search (~20 Tracks & 5 Playlists)**:
   - Dedicated in-page mobile search input and clear button.
   - Dual Special Characters:
     - `⚪ Filterless`: Play any music or audio without restrictions.
     - `🟢 # Strict Halal`: Quran recitations, nasheeds, and instrument-free vocal audio.
     - `🟣 * Islamic Vibes`: Devotional vocal, lofi, waz, and kalam vibes.

4. **Discord Web & Mobile Account System**:
   - User profile modal with quick 1-click Discord member chips.
   - Persistent Liked Songs ❤️ and Saved Queue 📋.
   - Dedicated Logout button.
   - Mobile Server Connection configuration (connect to any computer IP, VPS, or tunnel).

5. **Channel Management & Legal Compliance**:
   - Announcement channel selector with multi-server auto-sync.
   - Built-in Terms of Service (`/terms-of-service`) and Privacy Policy (`/privacy-policy`) compliant with Discord Developer policies.

---

## 🚀 How to Use & Install on Mobile

### Method 1: Instant Install as Mobile App (PWA) — Recommended ⚡
No Android Studio required! You can install the application directly to your home screen on any phone (Android, iPhone, iPad, or Tablet):

1. Ensure the Discord bot is running on your computer:
   ```powershell
   node discord-bot/bot.js
   ```
2. Find your computer's local IP address (e.g. `192.168.1.15`) via `ipconfig`.
3. Open your mobile browser (Google Chrome on Android, or Safari on iOS) and navigate to:
   ```
   http://<YOUR-COMPUTER-IP>:3050/
   ```
4. **Android (Chrome)**:
   - Tap the **`📲 Install App`** button at the top header, OR tap the Chrome menu (3 dots `⋮`) and select **"Add to Home screen"** / **"Install app"**.
5. **iOS (Safari)**:
   - Tap the **Share** button (box with upward arrow) -> Tap **"Add to Home Screen"**.
6. The app will install with its native icon, full-screen standalone display, bottom navigation bar, and sticky mini-player!

---

### Method 2: Build Standalone Android APK (.apk)

The `mobile-app/android` directory contains a full Android Studio project ready to compile:

#### Option A: One-Click Build Script
Double-click `mobile-app/build-apk.bat` or run:
```powershell
cd mobile-app
.\build-apk.bat
```

#### Option B: Android Studio
1. Open **Android Studio**.
2. Select **File -> Open...** and browse to:
   ```
   c:\Users\mdasw\Downloads\Compressed\SlugYZeon-4.6.2\mobile-app\android
   ```
3. Wait for Gradle sync to complete.
4. Select **Build -> Build Bundle(s) / APK(s) -> Build APK(s)**.
5. The compiled `.apk` will be in:
   ```
   mobile-app/android/app/build/outputs/apk/debug/app-debug.apk
   ```
6. Transfer `app-debug.apk` to your Android device and tap to install!

---

## 📁 Project Architecture

```
mobile-app/
├── package.json              # Capacitor dependencies & build scripts
├── capacitor.config.json     # Mobile configuration & permissions
├── copy-assets.js            # Sync script between web player & mobile app
├── build-apk.bat             # One-click Windows APK builder
├── README.md                 # Complete guide & documentation
├── www/                      # Bundled web assets for offline shell
└── android/                  # Native Android Studio Gradle project
    ├── build.gradle          # Root Gradle build script
    ├── variables.gradle      # SDK versions (compileSdk 34, minSdk 22)
    └── app/
        ├── build.gradle      # Application module build config
        └── src/main/
            ├── AndroidManifest.xml   # Audio foreground service & network permissions
            ├── java/com/cyberspy404/ahmmusic/MainActivity.java
            └── assets/public/        # Embedded offline web assets
```
