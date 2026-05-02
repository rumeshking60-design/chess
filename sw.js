// ═══════════════════════════════════════════════════════════
// SW.JS — Service Worker: cache-first shell, network-first APIs
// v5 — Android / TWA optimised
// ═══════════════════════════════════════════════════════════

const CACHE_NAME = "chess-academy-v5";

const APP_SHELL = [
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
  "/offline.html",
  "https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Mono:wght@400;500&family=Outfit:wght@300;400;500;600;700&display=swap",
];

// External API origins — always network-first
const API_ORIGINS = [
  "api.chess.com",
  "lichess.org",
  "fonts.gstatic.com",
];

// ── Install ──────────────────────────────────────────────────
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache =>
        // addAll is all-or-nothing for local files; fonts can fail silently
        Promise.allSettled(APP_SHELL.map(url => cache.add(url)))
      )
      .then(() => self.skipWaiting())
  );
});

// ── Activate: purge stale caches ─────────────────────────────
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────
self.addEventListener("fetch", event => {
  // Skip non-GET, chrome-extension, and data URIs
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (!["http:", "https:"].includes(url.protocol)) return;

  const isApi = API_ORIGINS.some(o => url.hostname.includes(o));

  if (isApi) {
    // Network-first for live API data; serve stale on failure
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        try {
          const response = await fetch(event.request);
          if (response.ok) {
            cache.put(event.request, response.clone());
          }
          return response;
        } catch {
          const cached = await cache.match(event.request);
          return cached ?? new Response(
            JSON.stringify({ offline: true }),
            { status: 503, headers: { "Content-Type": "application/json" } }
          );
        }
      })
    );
    return;
  }

  // Cache-first for app shell, fallback to offline.html for navigations
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type === "opaque") {
          return response;
        }
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      }).catch(() => {
        if (event.request.mode === "navigate") {
          return caches.match("/offline.html") ?? caches.match("/index.html");
        }
        // Return empty 204 for non-critical asset failures rather than hard errors
        return new Response("", { status: 204 });
      });
    })
  );
});

// ── Message handling ──────────────────────────────────────────
self.addEventListener("message", event => {
  if (!event.data) return;

  switch (event.data.type ?? event.data) {
    case "skipWaiting":
      self.skipWaiting();
      break;

    // TWA can send a PING to verify SW is alive
    case "PING":
      event.ports?.[0]?.postMessage({ type: "PONG", version: CACHE_NAME });
      break;

    // Allow runtime cache-busting for a specific URL
    case "INVALIDATE":
      if (event.data.url) {
        caches.open(CACHE_NAME)
          .then(cache => cache.delete(event.data.url));
      }
      break;
  }
});

// ── Push notifications (future-ready) ────────────────────────
self.addEventListener("push", event => {
  const data = event.data?.json() ?? { title: "Chess Academy", body: "You have a new update." };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-72.png",
      vibrate: [100, 50, 100],
      data: { url: data.url ?? "/" },
      tag: "chess-academy-notification",
      renotify: true,
    })
  );
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = event.notification.data?.url ?? "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true })
      .then(clients => {
        for (const client of clients) {
          if (client.url === target && "focus" in client) return client.focus();
        }
        if (self.clients.openWindow) return self.clients.openWindow(target);
      })
  );
});
