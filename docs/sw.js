// ============================================================================
// HANDBALL BOT 2.0 - SERVICE WORKER
// Gestion du cache hors-ligne et fonctionnement PWA (v2.2.0)
// ============================================================================

const CACHE_NAME = 'handball-app-v2.2.0';
const STATIC_ASSETS = [
  './',
  './index.html',
  './css/style.css?v=2.2.0',
  './js/api.js?v=2.2.0',
  './js/spakta-data.js?v=2.2.0',
  './js/spakta-data.json?v=2.2.0',
  './js/app.js?v=2.2.0',
  './manifest.json',
  './images/logo.png',
  './images/logo.svg',
  './images/logo.webp',
  './images/icon-192.png',
  './images/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (!event.request || !event.request.url || !event.request.url.startsWith('http')) {
    return;
  }
  const url = new URL(event.request.url);

  if (!url.protocol.startsWith('http')) {
    return;
  }

  // Toujours réseau pour l'API Google Apps Script
  if (url.hostname.includes('script.google.com') || url.hostname.includes('googleusercontent.com')) {
    return;
  }

  if (event.request.method !== 'GET') {
    return;
  }

  // Network-First pour HTML, CSS, JS : garantit la réception immédiate de toute mise à jour
  if (url.pathname.endsWith('.html') || url.pathname.endsWith('.css') || url.pathname.endsWith('.js') || url.pathname.endsWith('/')) {
    event.respondWith(
      fetch(event.request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache)).catch(() => {});
        }
        return networkResponse;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-First pour images et polices
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      return cachedResponse || fetch(event.request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache)).catch(() => {});
        }
        return networkResponse;
      });
    })
  );
});
