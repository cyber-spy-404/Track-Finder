const http = require("http");

// 1. Resolve a track first
http.get("http://localhost:3050/api/resolve-track?q=Tauba+Tauba&channel=browser", (res) => {
  let body = "";
  res.on("data", c => body += c);
  res.on("end", () => {
    console.log("Resolve track status:", res.statusCode);
    const data = JSON.parse(body);
    console.log("Resolved track:", data.track?.title);

    // 2. Now simulate Chrome's HTML5 Audio behavior:
    // Request 1: Chrome sends Range: bytes=0- to inspect metadata
    console.log("\n--- Request 1: Initial probe (bytes=0-) ---");
    const req1 = http.request("http://localhost:3050/api/stream-audio?channel=browser", {
      headers: {
        "Range": "bytes=0-",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "*/*"
      }
    }, (res1) => {
      console.log("Req1 status:", res1.statusCode);
      console.log("Req1 headers:", res1.headers);
      let bytes1 = 0;
      res1.on("data", (chunk) => {
        bytes1 += chunk.length;
        if (bytes1 > 65536) {
          console.log(`Req1 received ${bytes1} bytes, now aborting (like Chrome does)...`);
          req1.destroy();

          // Request 2: Chrome starts real audio playback from byte 0 or buffered point
          setTimeout(() => {
            console.log("\n--- Request 2: Playback stream (bytes=0-) ---");
            const req2 = http.request("http://localhost:3050/api/stream-audio?channel=browser", {
              headers: {
                "Range": "bytes=0-",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "*/*"
              }
            }, (res2) => {
              console.log("Req2 status:", res2.statusCode);
              console.log("Req2 headers:", res2.headers);
              let bytes2 = 0;
              let startTime = Date.now();
              res2.on("data", (c2) => {
                bytes2 += c2.length;
              });
              const interval = setInterval(() => {
                const sec = ((Date.now() - startTime) / 1000).toFixed(1);
                console.log(`[${sec}s] Received ${bytes2} bytes (${(bytes2/1024).toFixed(1)} KB)`);
              }, 1000);

              res2.on("end", () => {
                clearInterval(interval);
                console.log(`Req2 ended after ${((Date.now() - startTime) / 1000).toFixed(1)}s, total bytes: ${bytes2}`);
                process.exit(0);
              });
              res2.on("error", (e) => {
                clearInterval(interval);
                console.log("Req2 error:", e.message);
                process.exit(1);
              });
            });
            req2.end();
          }, 500);
        }
      });
    });
    req1.end();
  });
});
