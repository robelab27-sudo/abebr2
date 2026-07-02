// ============================================================================
// Service worker: makes the app installable and usable offline.
//
// Strategy:
// - Precache the entire app shell (every HTML/CSS/JS file + icons) on
//   install, so the app opens instantly even with no connection.
// - Same-origin navigations/assets: cache-first, falling back to network,
//   and opportunistically refreshing the cache in the background (stale-
//   while-revalidate) so content stays current without blocking load.
// - Cross-origin CDN assets (Google Fonts, Chart.js): cache-first at
//   runtime, so once loaded they work offline too.
// - Never intercepts API calls (anything to the Worker backend) — those go
//   straight to the network and are handled by the app's own sync engine,
//   which already has its own offline queueing.
//
// Bump CACHE_VERSION whenever app files change; the old cache is deleted on
// activate, which is what gives you "automatic updates" — the next time the
// user opens the app after a deploy, they transparently get the new files.
// ============================================================================

const CACHE_VERSION = 'ledger-v1';
const APP_SHELL = [
  '/', '/index.html', '/login.html', '/dashboard.html', '/trades.html',
  '/calendar.html', '/journal.html', '/statistics.html', '/psychology.html',
  '/goals.html', '/risk-calculator.html', '/settings.html',
  '/manifest.json',
  '/css/styles.css',
  '/js/config.js', '/js/db.js', '/js/api.js', '/js/auth.js', '/js/sync.js',
  '/js/stats.js', '/js/theme.js',
  '/js/lib/csv.js',
  '/js/components/trade-modal.js',
  '/js/repositories/index.js', '/js/repositories/repository.js', '/js/repositories/settings.js',
  '/js/pages/login.js', '/js/pages/dashboard.js', '/js/pages/trades.js', '/js/pages/calendar.js',
  '/js/pages/journal.js', '/js/pages/statistics.js', '/js/pages/psychology.js',
  '/js/pages/goals.js', '/js/pages/risk-calculator.js', '/js/pages/settings.js',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png', '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isApiRequest(url) {
  // Anything that isn't same-origin static content — most reliably, just
  // check the path doesn't look like a file this app shell serves. Simplest
  // safe rule: only intercept GET requests to our own origin's known static
  // paths, or cross-origin CDN GETs; everything else (including all API
  // calls, which are cross-origin to a *.workers.dev domain) passes through
  // untouched.
  return url.origin !== self.location.origin && !url.hostname.endsWith('cdnjs.cloudflare.com') && !url.hostname.endsWith('fonts.googleapis.com') && !url.hostname.endsWith('fonts.gstatic.com');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // never cache writes; let them hit the network directly

  const url = new URL(request.url);
  if (isApiRequest(url)) return; // let the app's own fetch/sync logic handle this normally

  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached); // offline and not cached — nothing more we can do

      // Stale-while-revalidate: serve cached immediately if we have it,
      // update the cache in the background either way.
      return cached || networkFetch;
    })
  );
});
