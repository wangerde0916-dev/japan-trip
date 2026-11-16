'use strict';

// Increase this version whenever a deployed asset or either trip dataset changes.
const CACHE_PREFIX = 'japan-winter-trip-';
const CACHE_NAME = `${CACHE_PREFIX}v4`;
const ASSETS = [
  './index.html',
  './styles.css',
  './app.js',
  './data.js',
  './trip-data.json',
  './trip-data-plus.json',
  './route-map.svg',
  './manifest.json',
  './sw.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];
const ASSET_URLS = new Set(ASSETS.map(path => new URL(path, self.registration.scope).href));
const INDEX_URL = new URL('./index.html', self.registration.scope).href;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // A failed download cancels installation, leaving the previous cache intact.
    await cache.addAll(ASSETS.map(path => new Request(new URL(path, self.registration.scope), { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  // Google Maps and every other external link remain ordinary network requests.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) return response;
      } catch {
        // An installed app can reopen its cached homepage without a connection.
      }
      const cache = await caches.open(CACHE_NAME);
      return await cache.match(INDEX_URL) || new Response('暂时无法打开页面，请联网后重试。', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    })());
    return;
  }

  // Only the explicit local asset list is cached. No API, map, or arbitrary URL.
  url.search = '';
  if (!ASSET_URLS.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(url.href);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) await cache.put(url.href, response.clone());
    return response;
  })());
});
