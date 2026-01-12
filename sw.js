// File: /Users/user/kasir/sw.js

const CACHE_NAME = 'kasir-pro-offline-v10';
const urlsToCache = [
  './',
  './index.html',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700&display=swap'
];

// Install Service Worker & Cache Resources
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Menyimpan file untuk offline...');
        return cache.addAll(urlsToCache);
      })
  );
});

// Fetch Resources (Cek Cache dulu, baru internet)
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Jika ada di cache, pakai cache
        if (response) {
          return response;
        }
        
        // Jika tidak ada di cache, ambil dari internet DAN SIMPAN (Dynamic Caching)
        // Ini penting agar file font (.woff2) ikut tersimpan otomatis
        return fetch(event.request).then(response => {
            // Cek validitas respon
            if(!response || response.status !== 200 || response.type !== 'basic' && response.type !== 'cors') {
                return response;
            }
            
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, responseToCache);
            });
            return response;
        });
      })
  );
});
