const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

console.log("========================================");
console.log(" 📦 TRACK-FINDER BUILD SETUP");
console.log("========================================");

// On Linux / Render, download standalone yt-dlp if possible
if (process.platform !== "win32") {
  const target = path.join(__dirname, "yt-dlp");
  if (!fs.existsSync(target)) {
    console.log("⬇️ Fetching standalone yt-dlp binary for Linux...");
    try {
      execSync("curl -L -f -s https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o " + target + " && chmod +x " + target, {
        timeout: 30000,
        stdio: "inherit"
      });
      console.log("✅ yt-dlp binary ready at:", target);
    } catch (err) {
      console.log("⚠️ Note: yt-dlp download skipped, using cloud Lavalink mode:", err.message);
    }
  } else {
    console.log("✅ yt-dlp already present at:", target);
  }
}

console.log("🎉 Build completed successfully.");
process.exit(0);
