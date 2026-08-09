const CACHE_NAME = "muertometro-v8";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./data/monsters.json",
  "./assets/banner-header.webp",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/icons/attack.svg",
  "./assets/icons/curse.svg",
  "./assets/icons/dead.svg",
  "./assets/icons/disarm.svg",
  "./assets/icons/flying.svg",
  "./assets/icons/heal.svg",
  "./assets/icons/immobilize.svg",
  "./assets/icons/jump.svg",
  "./assets/icons/muddle.svg",
  "./assets/icons/pierce.svg",
  "./assets/icons/poison.svg",
  "./assets/icons/pull.svg",
  "./assets/icons/push.svg",
  "./assets/icons/range.svg",
  "./assets/icons/retaliate.svg",
  "./assets/icons/shield.svg",
  "./assets/icons/stun.svg",
  "./assets/icons/target.svg",
  "./assets/icons/wound.svg"
];

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isDocument = event.request.mode === "navigate" || event.request.destination === "document";
  const isAppAsset = isSameOrigin && (
    url.pathname.endsWith("/index.html") ||
    url.pathname.endsWith("/styles.css") ||
    url.pathname.endsWith("/app.js") ||
    url.pathname.endsWith("/manifest.json") ||
    url.pathname.endsWith("/data/monsters.json") ||
    url.pathname.endsWith("/assets/banner-header.webp") ||
    url.pathname.startsWith("/assets/icons/")
  );

  if (isDocument || isAppAsset) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request).then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return response;
      });
    })
  );
});

async function networkFirst(request) {
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const fallback = await caches.match("./index.html");
      if (fallback) return fallback;
    }
    throw new Error("Network unavailable");
  }
}
