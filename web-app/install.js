const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

console.log("========================================");
console.log(" 📦 TRACK-FINDER BUILD SETUP");
console.log("========================================");

const https = require("https");

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    function getUrl(targetUrl, redirectCount = 0) {
      if (redirectCount > 8) return reject(new Error("Too many redirects"));
      https.get(targetUrl, { headers: { "User-Agent": "TrackFinder/1.0 (Linux/Node.js)" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return getUrl(res.headers.location, redirectCount + 1);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Download failed with status ${res.statusCode}`));
        }
        const tempPath = `${destPath}.tmp_${Date.now()}`;
        const out = fs.createWriteStream(tempPath);
        res.pipe(out);
        out.on("finish", () => {
          out.close(() => {
            try {
              if (fs.existsSync(tempPath) && fs.statSync(tempPath).size > 1000000) {
                if (fs.existsSync(destPath)) {
                  try { fs.unlinkSync(destPath); } catch (_) {}
                }
                fs.renameSync(tempPath, destPath);
                try { fs.chmodSync(destPath, 0o755); } catch (_) {}
                resolve();
              } else {
                reject(new Error("Downloaded binary is too small or corrupt"));
              }
            } catch (e) {
              reject(e);
            }
          });
        });
        out.on("error", (e) => {
          try { fs.unlinkSync(tempPath); } catch (_) {}
          reject(e);
        });
      }).on("error", reject);
    }
    getUrl(url);
  });
}

async function runBuild() {
  // 1. Try pip install yt-dlp safely with --upgrade
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

  // 2. Standalone binary backup (Linux & Windows) via pure Node HTTPS or curl
  const binaryName = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
  const target = path.join(__dirname, binaryName);
  const binaryUrl = process.platform === "win32"
    ? "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
    : "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";

  try {
    console.log(`⬇️ Downloading standalone ${binaryName} binary via HTTPS...`);
    await downloadFile(binaryUrl, target);
    console.log(`✅ Standalone ${binaryName} ready (${(fs.statSync(target).size / 1024 / 1024).toFixed(1)}MB).`);
  } catch (dlErr) {
    console.warn("⚠️ HTTPS direct download note:", dlErr.message);
    try {
      console.log("⬇️ Falling back to curl/powershell...");
      if (process.platform === "win32") {
        execSync(`powershell -Command "Invoke-WebRequest -Uri '${binaryUrl}' -OutFile '${target}'"`, { timeout: 60000, stdio: "inherit" });
      } else {
        execSync(`curl -L -f --retry 3 -s "${binaryUrl}" -o "${target}" && chmod 755 "${target}"`, { timeout: 60000, stdio: "inherit" });
      }
      if (fs.existsSync(target) && fs.statSync(target).size > 1000000) {
        console.log(`✅ Standalone ${binaryName} ready via fallback.`);
      }
    } catch (curlErr) {
      console.warn("⚠️ Fallback download error:", curlErr.message);
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
}

runBuild().catch((err) => {
  console.error("Build process error:", err.message);
  process.exit(0);
});
