// DedTxt service worker — caches the app shell so it works offline.
// Bumped automatically on every web build via the BUILD_ID placeholder
// replaced by scripts/build-web.js.

const VERSION = '__BUILD_ID__';
const CACHE = `dedtxt-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './renderer.js',
  './welcome.js',
  './version.js',
  './line-numbers.js',
  './find.js',
  './scroll-arrows.js',
  './platform/index.js',
  './platform/web.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/favicon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (!res || res.status !== 200 || res.type !== 'basic') return res;
        const clone = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, clone));
        return res;
      }).catch(() => cached);
    })
  );
});
