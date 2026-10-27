'use strict';

const ROOT = new URL(self.registration.scope);
// CacheStorage is shared by every path on an origin. Keep deployments isolated.
// Colons delimit the encoded path (literal colons inside paths are encoded).
const CACHE_PREFIX = 'voicing-static-scope:' + encodeURIComponent(ROOT.pathname) + ':';
// Generated from the exact deployed files by scripts/update-sw.js.
// BEGIN BUNDLE INTEGRITY
const BUNDLE_ID = '113eacb70acaa7f7f55f4ed257c0466159c233789c3abd7c6d4104c1e2c83574';
const FILE_HASHES = {
  "index.html": "827e2a102ecfcc50113bc73296395618223698ce784bb7ea7cd981edf935e3cf",
  "style.css": "f34e1e1c2b38e184eaf2429ce111978153b7c709cf5f222c9c5edafbdfd06033",
  "music.js": "4a81348d60e4f73d3caa7952da7a50ce0f8e4774033b7f085299f6c6a7918d0b",
  "state.js": "fd72f4fe13f6d6cb683979c0b2823037d33e26c4be60967911ce3b430bcdeb6b",
  "audio.js": "22a1ec28969ada87ca1e77e04046adb4b4567a15e51bb3cbc3b57077569a47e2",
  "app.js": "debb8de79c0614bfae8140b40d06ecb3908b34177efc0b78b75df1a7d08cd9ba",
  "worker.js": "55adc9250217553264eb1f6b21239e535f2e77605943bd5615a59a02d58b0d21",
  "chordot-logo.png": "e072bf1c115e5bf7b86f7716039fd200e52317b46b180cf7a72fbe890665dd84",
  "chordot-icon.png": "a06232d045587d4db0942dfed377985a5df67677953dae555d92d7b8b5da2f9d",
  "manifest.webmanifest": "e57e6470b95784ada500436d22cc635db1ca6e370c9a799a1c0917cf5ebfbaba"
};
// END BUNDLE INTEGRITY
const CACHE = CACHE_PREFIX + 'v17-' + BUNDLE_ID;
const FETCH_TIMEOUT_MS = 10000;
const FILES = {
  'index.html': 'html', 'style.css': 'css', 'music.js': 'javascript',
  'state.js': 'javascript', 'audio.js': 'javascript', 'app.js': 'javascript',
  'worker.js': 'javascript', 'chordot-logo.png': 'png', 'chordot-icon.png': 'png',
  'manifest.webmanifest': 'json'
};
const URLS = Object.keys(FILES).map(name => new URL(name, ROOT).href);
const REQUIRED_URLS = Object.entries(FILES).filter(([, kind]) => ['html', 'css', 'javascript'].includes(kind)).map(([name]) => new URL(name, ROOT).href);
const SHELL = new URL('index.html', ROOT).href;

function recoveryResponse() {
  // This page must work even when none of the application files remain. Keep
  // the address and saved data intact; activate another version only on click.
  return new Response(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Chordot — 파일 다시 준비하기</title>
<style>body{font-family:system-ui,sans-serif;background:#f3eae3;color:#382824;margin:0;padding:12vh 24px}main{max-width:480px;margin:auto}h1{font-size:26px}p{line-height:1.8}button{font:inherit;padding:12px 18px;border:0;border-radius:8px;background:#382824;color:#fff9f3;cursor:pointer}button:disabled{opacity:.6}button:focus-visible{outline:3px solid #9b4935;outline-offset:4px}</style>
<main><p>Chordot · 코드닷</p><h1>코드 검색 파일을 다시 준비해야 해요.</h1><p>필요한 파일이 지워졌거나 새 버전과 달라졌어요. 인터넷 연결 후 아래 버튼을 눌러 주세요. 지금 주소의 코드와 보관함은 그대로 유지돼요.</p><button id="recover-app">파일 다시 준비하기</button><p id="recovery-status" role="status" aria-live="polite"></p></main>
<script>
(() => {
  const button = document.querySelector('#recover-app');
  const status = document.querySelector('#recovery-status');
  const serviceWorker = navigator.serviceWorker;
  const initialController = serviceWorker?.controller;
  let requested = false, reloading = false, attempt = 0, timer, installing = null, listener = null;
  const cleanup = () => {
    clearTimeout(timer);
    if (installing && listener) installing.removeEventListener('statechange', listener);
    installing = listener = null;
  };
  const fail = id => {
    if (id !== attempt || !requested || reloading) return;
    cleanup(); requested = false; button.disabled = false;
    status.textContent = '파일을 준비하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.';
  };
  const reload = id => {
    if (id !== attempt || !requested || reloading) return;
    reloading = true; cleanup(); location.reload();
  };
  serviceWorker?.addEventListener('controllerchange', () => { if (serviceWorker.controller) reload(attempt); });
  button.addEventListener('click', async () => {
    if (requested || reloading) return;
    const id = ++attempt;
    requested = true; button.disabled = true;
    status.textContent = '파일을 준비하고 있어요. 준비가 끝나면 같은 주소를 다시 열어요.';
    timer = setTimeout(() => fail(id), 20000);
    try {
      const registration = await serviceWorker?.getRegistration();
      if (id !== attempt || !requested || reloading) return;
      if (!registration) { fail(id); return; }
      if (!registration.waiting) await registration.update();
      if (id !== attempt || !requested || reloading) return;
      let sent = false;
      const apply = () => {
        if (id !== attempt || !requested || reloading) return;
        if (serviceWorker.controller && serviceWorker.controller !== initialController) { reload(id); return; }
        if (registration.waiting) {
          if (!sent) { sent = true; registration.waiting.postMessage({type:'SKIP_WAITING'}); }
        } else if (installing?.state === 'redundant') fail(id);
        else if (!registration.installing) reload(id);
      };
      installing = registration.installing;
      if (installing) {
        listener = () => { try { apply(); } catch { fail(id); } };
        installing.addEventListener('statechange', listener);
      }
      apply();
    } catch { fail(id); }
  });
})();
</script></html>`, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

async function validResponse(response, kind) {
  if (!response || response.status !== 200 || response.redirected || response.type === 'opaque') return false;
  const type = (response.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
  const matches = {
    html: ['text/html'], css: ['text/css'],
    javascript: ['text/javascript', 'application/javascript', 'application/x-javascript'],
    png: ['image/png'], json: ['application/manifest+json', 'application/json']
  };
  if (!matches[kind].includes(type)) return false;
  if (kind === 'html') {
    // An authentication gate may return 200 text/html. Never cache it as the app.
    const html = await response.clone().text();
    return /<title>\s*Chordot\b/.test(html) && /id=["']search-form["']/.test(html) && /src=["'](?:\.\/)?music\.js["']/.test(html);
  }
  return true;
}

async function fetchFile(name, kind) {
  const url = new URL(name, ROOT).href;
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error('코드닷 정적 파일 응답 시간이 초과되었습니다: ' + name));
      controller.abort();
    }, FETCH_TIMEOUT_MS);
  });
  try {
    // Bound both headers and body validation. A stalled optional file must not
    // leave all otherwise valid online responses waiting forever in recovery.
    return await Promise.race([deadline, (async () => {
      const response = await fetch(new Request(url, { cache: 'reload', redirect: 'error', credentials: 'same-origin', signal: controller.signal }));
      if (!await validResponse(response, kind)) throw new Error('코드닷 정적 파일을 확인하지 못했습니다: ' + name);
      // Cache.put also consumes the body. Finish it within this deadline rather
      // than allowing a truncated script or image stream to hang that write.
      const body = await response.clone().arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', body);
      const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      if (hash !== FILE_HASHES[name]) throw new Error('코드닷 파일의 버전이 달라졌습니다: ' + name);
      return [url, response];
    })()]);
  } finally { clearTimeout(timer); }
}

async function fetchBundle(allowPartial = false) {
  const fetched = await Promise.allSettled(Object.entries(FILES).map(([name, kind]) => fetchFile(name, kind)));
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
    const available = new Map();
    try {
      const cache = await caches.open(CACHE);
      if (!isShell) {
        const cached = await cache.match(key);
        if (cached) return cached;
      } else {
        // A cached shell alone is not usable when one of its scripts is gone.
        // Check before serving HTML so a missing script cannot hide recovery UI.
        await Promise.all(REQUIRED_URLS.map(async url => {
          const response = await cache.match(url);
          if (response) available.set(url, response);
        }));
        if (REQUIRED_URLS.every(url => available.has(url))) return available.get(SHELL);
      }
    } catch { /* Try the network when cache access is unavailable. */ }
    try {
      const responses = await recoverBundle();
      if (isShell) {
        for (const [url, response] of responses) available.set(url, response);
        if (REQUIRED_URLS.every(url => available.has(url))) return available.get(SHELL).clone();
        return recoveryResponse();
      }
      const response = responses.get(key);
      if (response) return response.clone();
    } catch { /* Offline without a cached copy. */ }
    if (isShell) return recoveryResponse();
    return new Response('이 기기에 오프라인 파일이 없어요. 인터넷 연결 후 다시 열어 주세요.', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  })());
});
