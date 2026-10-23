// ============================================================================
// HANDBALL BOT 2.0 - SERVICE WORKER
// Gestion du cache hors-ligne et fonctionnement PWA
// ============================================================================

const CACHE_NAME = 'handball-app-v2.1.2';
const STATIC_ASSETS = [
  './',
  './index.html',
  './css/style.css?v=2.1.2',
  './js/api.js?v=2.1.2',
  './js/app.js?v=2.1.2',
  './manifest.json',
  './images/logo.png',
  './images/icon-192.png',
  './images/icon-512.png'
];

// Installation : mise en cache des ressources statiques
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activation : suppression des anciens caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Stratégie de cache : Stale-While-Revalidate pour les fichiers statiques, Network-Only pour l'API
self.addEventListener('fetch', event => {
  if (!event.request || !event.request.url || !event.request.url.startsWith('http')) {
    return;
  }
  const url = new URL(event.request.url);

  // Ignorer les requêtes non HTTP / HTTPS (ex: extensions Chrome)
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // Pour les appels API (Google Apps Script), toujours utiliser le réseau
  if (url.hostname.includes('script.google.com') || url.hostname.includes('googleusercontent.com')) {
    return;
  }

  // Pour les requêtes POST, pas de cache
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(cachedResponse => {
      const fetchPromise = fetch(event.request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            if (event.request.url.startsWith('http')) {
              cache.put(event.request, responseToCache).catch(() => {});
            }
          }).catch(() => {});
        }
        return networkResponse;
      }).catch(() => {
        // En cas de perte de réseau, rien à faire, le cachedResponse sera utilisé
      });

      return cachedResponse || fetchPromise;
    })
  );
});
