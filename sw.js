/**
 * LangJack - Progressive Web App Service Worker (Chrome on Android & Offline Web)
 * Provides offline caching for the linguistic workbench, models, and dictionaries.
 */

// Bump the suffix on every deploy so returning visitors receive the new files.
const CACHE_NAME = 'langjack-pwa-v1.0.1-r1';

const PRECACHE_ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'icons/icon16.png',
  'icons/icon32.png',
  'icons/icon48.png',
  'icons/icon128.png',
  'icons/icon192.png',
  'icons/icon512.png',
  'js/controllers/app.js',
  'js/services/analyzer-service.js',
  'js/services/dictionary-service.js',
  'js/services/storage-service.js',
  'js/services/treebank-service.js',
  'js/services/conllu-exporter.js',
  'js/services/conllu-parser.js',
  'js/services/conllu-enhance.js',
  'js/services/gloss-format.js',
  'js/services/ud-feature-inventory.js',
  'data/ud-feature-inventory.json',
  'js/services/conllu-import-service.js',
  'js/controllers/conllu-import-panel.js',
  'js/lib/hfst/core.js',
  'js/lib/hfst/transducer.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Pre-cache core shell assets
      for (const asset of PRECACHE_ASSETS) {
        try {
          await cache.add(asset);
        } catch (err) {
          // Continue caching remaining assets even if one fails
          console.warn('[PWA SW] Precache skipped asset:', asset, err.message);
        }
      }
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle HTTP/HTTPS GET requests
  if (req.method !== 'GET') return;
  if (!req.url.startsWith('http://') && !req.url.startsWith('https://')) return;

  // Stale-While-Revalidate / Cache-First strategy
  event.respondWith(
    caches.match(req).then((cachedResp) => {
      if (cachedResp) {
        // Fetch fresh copy in background for non-model assets
        if (!req.url.includes('.hfstol')) {
          fetch(req).then((networkResp) => {
            if (networkResp && networkResp.ok) {
              caches.open(CACHE_NAME).then((cache) => cache.put(req, networkResp));
            }
          }).catch(() => {});
        }
        return cachedResp;
      }

      // Network fallback
      return fetch(req).then((networkResp) => {
        if (!networkResp || !networkResp.ok) {
          return networkResp;
        }
        // Cache successful responses for models, tsv, scripts, styles
        const clone = networkResp.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(req, clone);
        });
        return networkResp;
      }).catch((err) => {
        // Return cached index.html for navigation if offline
        if (req.mode === 'navigate') {
          return caches.match('index.html');
        }
        throw err;
      });
    })
  );
});
