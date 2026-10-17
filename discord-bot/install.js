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

// 2. Try pip install yt-dlp safely
try {
  console.log("📦 Checking yt-dlp python package...");
  execSync("pip install --no-cache-dir yt-dlp || python3 -m pip install --no-cache-dir yt-dlp", {
    timeout: 45000,
    stdio: "inherit"
  });
  console.log("✅ yt-dlp installed successfully via pip.");
} catch (err) {
  console.log("ℹ️ pip install note:", err.message);
}

// 3. Fallback: Standalone binary on Linux
if (process.platform !== "win32") {
  const target = path.join(__dirname, "yt-dlp");
  if (!fs.existsSync(target)) {
    try {
      console.log("⬇️ Fetching standalone yt-dlp binary backup...");
      execSync(`curl -L -f -s https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o "${target}" && chmod +x "${target}"`, {
        timeout: 30000,
        stdio: "inherit"
      });
      console.log("✅ Standalone yt-dlp binary downloaded.");
    } catch (err2) {
      console.log("ℹ️ Standalone binary note:", err2.message);
    }
  }
}

console.log("🎉 Discord Bot build setup completed successfully.");
process.exit(0);
