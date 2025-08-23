// Define a name for the current cache
const cacheName = 'class-compass-v1.5';

// List all the files to cache
const filesToCache = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './timetable.json',
  './teachers.json',
  './rooms.json'
];

// The install event is fired when the service worker is first installed.
self.addEventListener('install', (event) => {
  console.log('Service Worker: Installing...');
  event.waitUntil(
    caches.open(cacheName).then((cache) => {
      console.log('Service Worker: Caching app shell');
      return cache.addAll(filesToCache);
    })
  );
});

// The activate event is fired when the service worker is activated.
self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activating...');
  // Remove old caches
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== cacheName) {
            console.log('Service Worker: Clearing old cache');
            return caches.delete(cache);
          }
        })
      );
    })
  );
});

// The fetch event is fired for every network request.
self.addEventListener('fetch', (event) => {
  console.log('Service Worker: Fetching', event.request.url);
  event.respondWith(
    // Try to find the response in the cache first.
    caches.match(event.request).then((response) => {
      // If it's in the cache, return it. Otherwise, fetch from the network.
      return response || fetch(event.request);
    })
  );
});
