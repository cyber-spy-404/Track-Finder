const fs = require("fs");
const path = require("path");

const webAppPublic = path.resolve(__dirname, "..", "web-app", "public");
const srcDir = fs.existsSync(webAppPublic) ? webAppPublic : path.resolve(__dirname, "..", "discord-bot", "public");
const destDir = path.resolve(__dirname, "www");

if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

function copyRecursive(src, dest) {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (!fs.existsSync(destPath)) fs.mkdirSync(destPath);
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

copyRecursive(srcDir, destDir);
console.log(`✅ Synced mobile web assets from ${srcDir} -> ${destDir}`);

const androidAssetsDir = path.resolve(__dirname, "android", "app", "src", "main", "assets", "public");
if (fs.existsSync(androidAssetsDir)) {
  copyRecursive(srcDir, androidAssetsDir);
  console.log(`✅ Synced mobile web assets to Android APK directory: ${androidAssetsDir}`);
}
