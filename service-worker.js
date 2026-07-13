const CACHE = "touhan-engine-v0.8.3";
const ASSETS = [
  "./", "./index.html", "./app.bundle.js", "./manifest.webmanifest",
  "./icon-192.png", "./icon-512.png", "./data/tokyo_master.json",
  "./version.json"
];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const isCore = url.origin === self.location.origin;
  if (!isCore) return;
  event.respondWith(
    fetch(event.request, { cache: "no-store" })
      .then(response => {
        const clone = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
