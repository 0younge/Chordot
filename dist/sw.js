const CACHE = 'voicing-static-v2';
const ASSETS = ['./', './index.html', './style.css', './music.js', './app.js', './worker.js', './icon.svg', './manifest.webmanifest'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('voicing-static-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== location.origin) return;
  const url = new URL(event.request.url);
  // Restrict caching to this app's static files, never authentication or other routes.
  const names = ['index.html','style.css','music.js','app.js','worker.js','icon.svg','manifest.webmanifest'];
  if (event.request.mode !== 'navigate' && !names.includes(url.pathname.split('/').pop())) return;
  event.respondWith(fetch(event.request).catch(async () => {
    const cached = await caches.match(event.request, { ignoreSearch: true });
    if (cached) return cached;
    if (event.request.mode === 'navigate') return caches.match('./index.html');
    return Response.error();
  }));
});
