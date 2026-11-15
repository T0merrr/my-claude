// Maggie Koala Spotter service worker.
// Keeps the app shell, map tiles and photos already seen available with no
// signal. Sighting data and the report outbox are handled by the app itself.

const VERSION = "v1";
const SHELL = `shell-${VERSION}`;
const TILES = "tiles-v1";
const PHOTOS = "photos-v1";
const SHELL_URLS = ["/", "/injured", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => Promise.allSettled(SHELL_URLS.map((u) => cache.add(u))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith("shell-") && k !== SHELL).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "CACHE_URLS" && Array.isArray(event.data.urls)) {
    event.waitUntil(
      caches.open(SHELL).then(async (cache) => {
        for (const url of event.data.urls) {
          if (!(await cache.match(url))) {
            try {
              await cache.add(url);
            } catch {
              // ignore: it will be cached the next time it is fetched
            }
          }
        }
      }),
    );
  }
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(key);
}

async function cacheFirst(request, cacheName, max) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  // Tiles and photos come from other origins and may be opaque; still usable.
  if (response.ok || response.type === "opaque") {
    cache.put(request, response.clone());
    if (max) trim(cacheName, max);
  }
  return response;
}

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(SHELL);
  try {
    const response = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error("slow")), 6000)),
    ]);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const hit = (await cache.match(request)) || (fallbackUrl && (await cache.match(fallbackUrl)));
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.hostname === "tile.openstreetmap.org") {
    event.respondWith(cacheFirst(request, TILES, 600));
    return;
  }

  if (url.pathname.includes("/storage/v1/object/public/")) {
    event.respondWith(cacheFirst(request, PHOTOS, 150));
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Never cache the admin page or its API.
  if (url.pathname.startsWith("/admin") || url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, SHELL));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "/"));
    return;
  }

  event.respondWith(networkFirst(request));
});
