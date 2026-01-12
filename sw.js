const CACHE_NAME = 'smartpos-offline-v77';
const FILES_TO_CACHE = [
    './',
    './index.html',
    './manifest.json',
    'https://cdn.tailwindcss.com',
    'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
    'https://cdn.jsdelivr.net/npm/dayjs@1/dayjs.min.js',
    'https://unpkg.com/lucide@latest',
    'https://cdn.jsdelivr.net/npm/sweetalert2@11',
    'https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3'
];

// Install Service Worker & Cache Semua File
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(FILES_TO_CACHE);
        })
    );
});

// Gunakan Cache saat Offline
self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((response) => {
            // Jika ada di cache, pakai cache. Jika tidak, download dari internet
            return response || fetch(event.request).then((fetchResponse) => {
                return caches.open(CACHE_NAME).then((cache) => {
                    // FIX: Hanya cache method GET. Jangan cache POST (Google Sheet Sync) agar tidak error
                    if(event.request.url.startsWith('http') && event.request.method === 'GET') {
                        cache.put(event.request, fetchResponse.clone());
                    }
                    return fetchResponse;
                });
            });
        })
    );
});
