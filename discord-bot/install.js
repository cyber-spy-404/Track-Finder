const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

console.log("========================================");
console.log(" 📦 DISCORD-BOT BUILD SETUP (Render/Linux/Docker)");
console.log("========================================");

// 1. Ensure data directory exists
const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log("✅ Created data/ directory.");
}

// 2. Try pip install yt-dlp safely with --upgrade
try {
  console.log("📦 Checking yt-dlp python package...");
  execSync("pip install -U --no-cache-dir yt-dlp || python3 -m pip install -U --no-cache-dir --break-system-packages yt-dlp || true", {
    timeout: 45000,
    stdio: "inherit"
  });
  console.log("✅ yt-dlp checked/installed via pip.");
} catch (err) {
  console.log("ℹ️ pip install note:", err.message);
}

// 3. Standalone binary backup on Linux (Always ensure latest binary exists)
if (process.platform !== "win32") {
  const target = path.join(__dirname, "yt-dlp");
  try {
    console.log("⬇️ Fetching latest standalone yt-dlp binary backup...");
    execSync(`curl -L -f -s https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o "${target}" && chmod +x "${target}"`, {
      timeout: 30000,
      stdio: "inherit"
    });
    console.log("✅ Latest standalone yt-dlp binary downloaded.");
  } catch (err2) {
    console.log("ℹ️ Standalone binary note:", err2.message);
  }
}

console.log("🎉 Discord Bot build setup completed successfully.");
process.exit(0);
