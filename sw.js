const CACHE_NAME = 'autopos-v1110';
const ASSETS = [
  'index.html',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/html5-qrcode'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
});

self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
