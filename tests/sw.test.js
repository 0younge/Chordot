const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../dist/sw.js'), 'utf8');

function setup(transform = response => response, options = {}) {
  const handlers = {}, stores = options.stores || new Map(), calls = [];
  const root = options.root || 'https://voicing.test/guitar/';
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        async put(key, response) { entries.set(String(key), response.clone()); },
        async match(key) { return entries.get(String(key))?.clone(); }
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); }
  };
  let claimed = false, skipped = false;
  const self = {
    registration: { scope: root },
    addEventListener(name, handler) { handlers[name] = handler; },
    clients: { async claim() { claimed = true; } },
    async skipWaiting() { skipped = true; }
  };
  let offline = false;
  const fetch = async request => {
    calls.push(request);
    if (offline) throw new TypeError('offline');
    const name = new URL(request.url).pathname.split('/').pop();
    const mime = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.svg') ? 'image/svg+xml' : name.endsWith('.webmanifest') ? 'application/manifest+json' : 'text/html';
    const body = name === 'index.html' ? '<title>Voicing — 기타 코드</title><form id="search-form"></form><script src="music.js"></script>' : `asset:${name}`;
    return transform(new Response(body, { status: 200, headers: { 'content-type': mime } }), name);
  };
  vm.runInNewContext(source, { self, caches, fetch, URL, Request, Response });
  async function dispatch(name, data = {}) {
    let pending;
    handlers[name]({ ...data, waitUntil(promise) { pending = promise; }, respondWith(promise) { pending = promise; } });
    return pending;
  }
  return { dispatch, stores, calls, root, setOffline: value => { offline = value; }, get claimed() { return claimed; }, get skipped() { return skipped; } };
}

test('installation validates and caches a complete bundle without forcing a live-page update', async () => {
  const app = setup(); await app.dispatch('install');
  assert.equal(app.stores.size, 1);
  assert.equal([...app.stores.values()][0].size, 9);
  assert.equal(app.skipped, false);
  assert.ok(app.calls.every(call => call.redirect === 'error' && call.cache === 'reload'));
  assert.ok(app.calls.some(call => call.url.endsWith('/audio.js')));
  assert.ok(app.calls.some(call => call.url.endsWith('/state.js')));
});

test('a login response or MIME mismatch never becomes an offline app', async () => {
  for (const kind of ['login','redirect','404','wrong-mime']) {
    const app = setup((response, name) => {
      if (name !== 'index.html') return response;
      if (kind === 'login') return new Response('<title>Sign in</title>', { headers: { 'content-type': 'text/html' } });
      if (kind === 'redirect') { Object.defineProperty(response, 'redirected', { value: true }); return response; }
      if (kind === '404') return new Response('not found', { status: 404 });
      return new Response('javascript', { headers: { 'content-type': 'text/javascript' } });
    });
    await assert.rejects(() => app.dispatch('install'), undefined, kind);
    assert.equal(app.stores.size, 0, kind);
  }
});

test('offline shell with a chord query and all local assets use the installed version', async () => {
  const app = setup(); await app.dispatch('install'); const calls = app.calls.length;
  app.setOffline(true);
  const shell = await app.dispatch('fetch', { request: { method: 'GET', mode: 'navigate', url: app.root + '?chord=C13' } });
  assert.equal(shell.status, 200); assert.match(await shell.text(), /search-form/);
  const asset = await app.dispatch('fetch', { request: { method: 'GET', mode: 'cors', url: app.root + 'audio.js' } });
  assert.equal(await asset.text(), 'asset:audio.js');
  assert.equal(app.calls.length, calls, 'installed bundle is coherent and does not fetch fresh individual assets');
});

test('auth pages, other paths, external URLs and mutations are not intercepted', async () => {
  const app = setup();
  for (const url of ['https://other.test/guitar/index.html', app.root + 'login', 'https://voicing.test/other/index.html', 'https://voicing.test/login']) {
    assert.equal(await app.dispatch('fetch', { request: { method: 'GET', mode: 'navigate', url } }), undefined);
  }
  assert.equal(await app.dispatch('fetch', { request: { method: 'POST', mode: 'cors', url: app.root } }), undefined);
});

test('evicted cache plus unavailable network returns an explicit non-cacheable failure', async () => {
  const app = setup(); app.setOffline(true);
  const response = await app.dispatch('fetch', { request: { method: 'GET', mode: 'navigate', url: app.root } });
  assert.equal(response.status, 503); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(await response.text(), /인터넷 연결/);
});

test('activation clears only obsolete app caches and claims clients; explicit update can skip waiting', async () => {
  const app = setup(); await app.dispatch('install');
  const current = [...app.stores.keys()][0], old = current.replace(/v\d+$/, 'v0');
  app.stores.set(old, new Map()); app.stores.set('unrelated-app', new Map());
  await app.dispatch('activate');
  assert.equal(app.stores.has(old), false);
  assert.equal(app.stores.has(current), true);
  assert.equal(app.stores.has('unrelated-app'), true);
  assert.equal(app.claimed, true);
  await app.dispatch('message', { data: { type: 'SKIP_WAITING' } });
  assert.equal(app.skipped, true);
});

test('several deployments on the same origin retain separate caches and offline files', async () => {
  const stores = new Map();
  const paths = ['/', '/guitar/', '/guitar/-v5/', '/dist/'];
  const apps = paths.map(pathname => setup(undefined, { stores, root: 'https://voicing.test' + pathname }));
  for (const app of apps) await app.dispatch('install');
  assert.equal(stores.size, paths.length, 'each scope gets its own application bundle');
  for (const app of apps) await app.dispatch('activate');
  assert.equal(stores.size, paths.length, 'activation cannot delete another scope');
  for (const app of apps) {
    app.setOffline(true);
    const response = await app.dispatch('fetch', { request: { method: 'GET', mode: 'navigate', url: app.root + '?chord=C' } });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /search-form/);
  }
});

test('only the root deployment removes exact v1/v2 legacy cache names', async () => {
  const stores = new Map([
    ['voicing-static-v1', new Map()], ['voicing-static-v2', new Map()],
    ['voicing-static-v3', new Map()], ['voicing-static-v10', new Map()]
  ]);
  const child = setup(undefined, { stores, root: 'https://voicing.test/dist/' });
  await child.dispatch('install'); await child.dispatch('activate');
  assert.equal(stores.has('voicing-static-v1'), true);
  assert.equal(stores.has('voicing-static-v2'), true);
  const root = setup(undefined, { stores, root: 'https://voicing.test/' });
  await root.dispatch('install'); await root.dispatch('activate');
  assert.equal(stores.has('voicing-static-v1'), false);
  assert.equal(stores.has('voicing-static-v2'), false);
  assert.equal(stores.has('voicing-static-v3'), true, 'unknown unscoped caches are preserved');
  assert.equal(stores.has('voicing-static-v10'), true);
});
