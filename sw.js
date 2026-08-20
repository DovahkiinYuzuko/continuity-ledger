/**
 * @file sw.js
 * @description Service Worker for Continuity Ledger (Offline PWA)
 */

const CACHE_NAME = 'continuity-ledger-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './screenshot.png',
  './manifest.json',
  './src/main.js',
  './src/fsm.js',
  './src/math.js',
  './src/storage.js',
  './src/export.js',
  './src/chart.js',
  './src/i18n.js',
  './locales/ja.json',
  './locales/en.json',
  './locales/ko.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((res) => {
      return res || fetch(e.request).then((fetchRes) => {
        return caches.open(CACHE_NAME).then((cache) => {
          // 只キャッシュ http(s)
          if (e.request.url.startsWith('http')) {
            cache.put(e.request, fetchRes.clone());
          }
          return fetchRes;
        });
      });
    }).catch(() => {
      if (e.request.destination === 'document') {
        return caches.match('./index.html');
      }
    })
  );
});
