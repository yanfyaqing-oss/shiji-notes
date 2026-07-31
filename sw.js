const CACHE = 'shiji-v26';
const ASSETS = ['./','./index.html','./styles.css?v=26','./standard.css?v=26','./spine-workflow-standard.html','./learning-plan.js?v=26','./app.js?v=26','./cloud.js?v=26','./manifest.webmanifest','./icon.svg'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => { if (event.request.method !== 'GET') return; event.respondWith(fetch(event.request).then(response => { const copy=response.clone(); caches.open(CACHE).then(cache=>cache.put(event.request,copy)); return response; }).catch(()=>caches.match(event.request).then(hit=>hit||caches.match('./index.html')))); });
