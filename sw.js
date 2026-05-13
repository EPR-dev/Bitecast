// Bitecast (Fiesta Island demo) — offline-first service worker.
// Cache strategy:
//   - App shell + GeoJSON + MapLibre lib: cache-first, refresh in background.
//   - Map tiles & style: cache-first runtime, fall back to network when possible.
//   - NOAA / Open-Meteo: network-only (the app stores last-good in localStorage).
//
// Bump CACHE_VERSION when you ship breaking changes to the app shell so
// previous caches are evicted on activate.

const CACHE_VERSION = "bitecast-v14";
const SHELL_CACHE = CACHE_VERSION + "-shell";
const TILE_CACHE = CACHE_VERSION + "-tiles";

const APP_SHELL = [
  "./",
  "./index.html",
  "./about.html",
  "./app.js",
  "./styles.css",
  "./data/shore.geojson",
  "./data/park.geojson",
  "./data/access.geojson",
  "./data/hazards.geojson",
  "./data/pois.geojson",
  "./data/zones.geojson",
  "./data/eelgrass.geojson",
  "./data/bathy_grid.geojson",
  "./data/community.json",
  "./og-image.svg",
  "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js",
  "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // best-effort: don't fail install if a CDN url 404s
      Promise.all(
        APP_SHELL.map((u) =>
          cache.add(u).catch((err) => {
            console.warn("SW: skip caching", u, err && err.message);
          })
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== TILE_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // 1) APIs: network-only. App handles last-good fallback itself.
  if (
    url.host.indexOf("tidesandcurrents.noaa.gov") >= 0 ||
    url.host.indexOf("open-meteo.com") >= 0 ||
    url.host.indexOf("overpass") >= 0
  ) {
    // let the network handle it; no SW interception needed
    return;
  }

  // 2) Map style + tiles: runtime cache-first.
  if (
    url.host.indexOf("openfreemap.org") >= 0 ||
    url.host.indexOf("openstreetmap.org") >= 0 ||
    url.host.indexOf("cartocdn.com") >= 0 ||
    url.host.indexOf("tile.") >= 0
  ) {
    event.respondWith(cacheFirstRuntime(req, TILE_CACHE));
    return;
  }

  // 3) Everything else (app shell, geojson, CDN js/css): cache-first w/ refresh.
  event.respondWith(cacheFirstShell(req));
});

async function cacheFirstShell(req) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(req, { ignoreSearch: false });
  if (cached) {
    // Refresh in the background; do not block the response.
    fetch(req)
      .then((res) => {
        if (res && res.ok) cache.put(req, res.clone());
      })
      .catch(() => {});
    return cached;
  }
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    return new Response("Offline and not cached.", {
      status: 503,
      statusText: "Offline",
      headers: { "Content-Type": "text/plain" },
    });
  }
}

async function cacheFirstRuntime(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) {
    return cached;
  }
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === "opaque")) {
      // tile servers often respond opaque; still safe to cache
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch (err) {
    return new Response("", {
      status: 503,
      statusText: "Tile offline",
      headers: { "Content-Type": "image/png" },
    });
  }
}

// Allow the page to prompt an immediate update when needed.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});
