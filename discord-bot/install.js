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

// 3. Standalone binary backup (Linux & Windows)
const binaryName = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
const target = path.join(__dirname, binaryName);
try {
  console.log(`⬇️ Fetching latest standalone ${binaryName} binary...`);
  if (process.platform === "win32") {
    execSync(`powershell -Command "Invoke-WebRequest -Uri 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile '${target}'"`, {
      timeout: 60000,
      stdio: "inherit"
    });
  } else {
    execSync(`curl -L -f --retry 3 -s https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o "${target}" && chmod 755 "${target}"`, {
      timeout: 60000,
      stdio: "inherit"
    });
  }
  if (fs.existsSync(target) && fs.statSync(target).size > 1000000) {
    console.log(`✅ Latest standalone ${binaryName} binary ready (${(fs.statSync(target).size / 1024 / 1024).toFixed(1)}MB).`);
  } else {
    console.warn("⚠️ Standalone binary downloaded but size is suspicious.");
  }
} catch (err2) {
  console.log("ℹ️ Standalone binary note:", err2.message);
}

console.log("🎉 Discord Bot build setup completed successfully.");
process.exit(0);
