// File: /Users/user/kasir/sw.js

const CACHE_NAME = 'kasir-pro-offline-v2327'; // Versi dinaikkan
const urlsToCache = [
  './',
  './index.html',
  './app.js',
  './absensi.js'
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

// Activate Service Worker & Clean Up Old Caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.filter(cacheName => {
          // Hapus cache lama yang tidak sama dengan CACHE_NAME saat ini
          return cacheName.startsWith('kasir-pro-offline-') && cacheName !== CACHE_NAME;
        }).map(cacheName => {
          console.log('Menghapus cache lama:', cacheName);
          return caches.delete(cacheName);
        })
      );
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
