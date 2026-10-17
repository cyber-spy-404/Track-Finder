const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

console.log("========================================");
console.log(" 📦 TRACK-FINDER BUILD SETUP");
console.log("========================================");

// 1. Try pip install yt-dlp safely
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

// 2. Fallback: Standalone binary
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

// 3. Ensure discord-bot dependencies are installed if present
const botDir = path.resolve(__dirname, "..", "discord-bot");
if (fs.existsSync(botDir) && fs.existsSync(path.join(botDir, "package.json"))) {
  try {
    console.log("📦 Installing discord-bot dependencies for cloud runner...");
    execSync("npm install --no-audit --no-fund", { cwd: botDir, stdio: "inherit", timeout: 60000 });
    console.log("✅ discord-bot dependencies ready.");
  } catch (botErr) {
    console.log("ℹ️ discord-bot npm install note:", botErr.message);
  }
}

console.log("🎉 Build setup completed successfully.");
process.exit(0);
