// ═══════════════════════════════════════════════════════════
// SW.JS — Service Worker: cache-first shell, network-first APIs
// ═══════════════════════════════════════════════════════════

const CACHE_NAME = "chess-academy-v4";
const APP_SHELL  = [
  "/",
  "/index.html",
  "/manifest.json",
  "/ui.js",
  "/state.js",
  "/api.js",
  "/liveSync.js",
  "/coach.js",
  "/tournament.js",
  "/proxy.js",
  "https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Mono:wght@400;500&family=Outfit:wght@300;400;500;600;700&display=swap",
];

// External API origins that should always be network-first
const API_ORIGINS = [
  "api.chess.com",
  "lichess.org",
  "fonts.gstatic.com",
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL).catch(() => {})) // don't fail install on font cache miss
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  const isApi = API_ORIGINS.some(o => url.hostname.includes(o));

  if (event.request.method !== "GET") return; // skip non-GET

  if (isApi) {
    // Network-first for live API data; silent fail to let app handle it
    event.respondWith(
      fetch(event.request)
        .catch(() => new Response(
          JSON.stringify({ offline: true }),
          { headers: { "Content-Type": "application/json" } }
        ))
    );
    return;
  }

  // Cache-first for app shell
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type === "opaque") return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      }).catch(() => {
        // Fallback to index.html for navigation requests
        if (event.request.mode === "navigate") {
          return caches.match("/index.html");
        }
      });
    })
  );
});

// Listen for skip-waiting message from UI
self.addEventListener("message", event => {
  if (event.data === "skipWaiting") self.skipWaiting();
});
