'use strict';

const ROOT = new URL(self.registration.scope);
// CacheStorage is shared by every path on an origin. Keep deployments isolated.
// Colons delimit the encoded path (literal colons inside paths are encoded).
const CACHE_PREFIX = 'voicing-static-scope:' + encodeURIComponent(ROOT.pathname) + ':';
// Bump the version whenever any cached application file changes.
const CACHE = CACHE_PREFIX + 'v6';
const FILES = {
  'index.html': 'html', 'style.css': 'css', 'music.js': 'javascript',
  'state.js': 'javascript', 'audio.js': 'javascript', 'app.js': 'javascript',
  'worker.js': 'javascript', 'icon.svg': 'svg', 'manifest.webmanifest': 'json'
};
const URLS = Object.keys(FILES).map(name => new URL(name, ROOT).href);
const SHELL = new URL('index.html', ROOT).href;

async function validResponse(response, kind) {
  if (!response || response.status !== 200 || response.redirected || response.type === 'opaque') return false;
  const type = (response.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
  const matches = {
    html: ['text/html'], css: ['text/css'],
    javascript: ['text/javascript', 'application/javascript', 'application/x-javascript'],
    svg: ['image/svg+xml'], json: ['application/manifest+json', 'application/json']
  };
  if (!matches[kind].includes(type)) return false;
  if (kind === 'html') {
    // An authentication gate may return 200 text/html. Never cache it as the app.
    const html = await response.clone().text();
    return /<title>\s*Voicing\b/.test(html) && /id=["']search-form["']/.test(html) && /src=["'](?:\.\/)?music\.js["']/.test(html);
  }
  return true;
}

async function fetchBundle(allowPartial = false) {
  const fetched = await Promise.allSettled(Object.entries(FILES).map(async ([name, kind]) => {
    const url = new URL(name, ROOT).href;
    const response = await fetch(new Request(url, { cache: 'reload', redirect: 'error', credentials: 'same-origin' }));
    if (!await validResponse(response, kind)) throw new Error('Voicing 정적 파일을 확인하지 못했습니다: ' + name);
    return [url, response];
  }));
  const failed = fetched.find(result => result.status === 'rejected');
  if (failed && !allowPartial) throw failed.reason;
  return fetched.filter(result => result.status === 'fulfilled').map(result => result.value);
}

async function storeBundle(responses) {
  const cache = await caches.open(CACHE);
  // Finish every write before deleting a failed bundle, so a late write cannot
  // leave a partial cache behind. Keep response bodies for online fallback.
  const writes = await Promise.allSettled(responses.map(([url, response]) => cache.put(url, response.clone())));
  const failed = writes.find(result => result.status === 'rejected');
  if (failed) {
    try { await caches.delete(CACHE); } catch { /* Storage may be unavailable. */ }
    throw failed.reason;
  }
}

let recovery = null;
function recoverBundle() {
  // A registration survives cache eviction. Rebuild all validated files on the
  // next online visit without requiring a new service-worker version to install.
  if (!recovery) recovery = (async () => {
    const responses = await fetchBundle(true);
    if (responses.length === URLS.length) {
      try { await storeBundle(responses); } catch { /* Online use still works when storage is full or unavailable. */ }
    }
    return new Map(responses);
  })().finally(() => { recovery = null; });
  return recovery;
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    await storeBundle(await fetchBundle());
    // Keep a new bundle waiting until existing pages close, or the UI explicitly
    // asks to update and reload. Never silently mix a new worker with old scripts.
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    const obsolete = names.filter(name => name !== CACHE && (
      name.startsWith(CACHE_PREFIX) ||
      (ROOT.pathname === '/' && /^voicing-static-v[12]$/.test(name))
    ));
    await Promise.all(obsolete.map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== ROOT.origin) return;
  url.search = ''; url.hash = '';
  const isShell = url.pathname === ROOT.pathname || url.href === SHELL;
  const key = isShell ? SHELL : url.href;
  if (!URLS.includes(key)) return;
  // A request for /login, /other/index.html or any external endpoint is never
  // intercepted. Query strings on our shell still resolve the same app bundle.
  event.respondWith((async () => {
    try {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(key);
      if (cached) return cached;
    } catch { /* Try the network when cache access is unavailable. */ }
    try {
      const responses = await recoverBundle();
      const response = responses.get(key);
      if (response) return response.clone();
    } catch { /* Offline without a cached copy. */ }
    return new Response('이 기기에 오프라인 파일이 없어요. 인터넷 연결 후 다시 열어 주세요.', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  })());
});
