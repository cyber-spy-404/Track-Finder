// Service Worker for Spy Sec Music PWA Mobile App - Fast Network-First Strategy
const CACHE_NAME = "spysec-music-v2";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.map((key) => caches.delete(key)));
    }).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  // Never intercept non-GET requests (POST, PUT, DELETE, etc.)
  if (event.request.method !== "GET") return;

  // Never intercept API endpoints, auth routes, or live audio streams
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return;

  // Static assets: network-first with cache fallback
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

