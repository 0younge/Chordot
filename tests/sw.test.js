const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '../dist/sw.js'), 'utf8');
const assetBytes = name => fs.readFileSync(path.join(__dirname, '../dist', name));
const assetSource = name => assetBytes(name).toString('utf8');
const bundleSize = 10;

async function waitFor(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'asynchronous response validation should finish');
    await new Promise(resolve => setImmediate(resolve));
  }
}

function setup(transform = response => response, options = {}) {
  const handlers = {}, stores = options.stores || new Map(), calls = [];
  const root = options.root || 'https://voicing.test/guitar/';
  const caches = {
    async open(name) {
      if (options.cacheUnavailable) throw new Error('CacheStorage unavailable');
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        async put(key, response) {
          if (options.failWrites && String(key).endsWith('/app.js')) throw new Error('Storage full');
          entries.set(String(key), response.clone());
        },
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
    const mime = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.png') ? 'image/png' : name.endsWith('.webmanifest') ? 'application/manifest+json' : 'text/html';
    const body = assetBytes(name);
    return transform(new Response(body, { status: 200, headers: { 'content-type': mime } }), name, request);
  };
  vm.runInNewContext(source, { self, caches, fetch, URL, Request, Response, AbortController, crypto: webcrypto, setTimeout: options.setTimeout || setTimeout, clearTimeout: options.clearTimeout || clearTimeout });
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
  assert.equal([...app.stores.values()][0].size, bundleSize);
  assert.equal(app.skipped, false);
  assert.ok(app.calls.every(call => call.redirect === 'error' && call.cache === 'reload'));
  assert.ok(app.calls.some(call => call.url.endsWith('/audio.js')));
  assert.ok(app.calls.some(call => call.url.endsWith('/state.js')));
});

test('the Korean Chordot title installs and remains available offline', async () => {
  assert.match(assetSource('index.html'), /<title>코드닷\(Chordot\)/);
  const app = setup(); await app.dispatch('install');
  app.setOffline(true);
  const response = await app.dispatch('fetch', { request: { method: 'GET', mode: 'navigate', url: app.root } });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), assetSource('index.html'));
});

test('HTML with the correct localized title and app markers still requires its exact file hash', async () => {
  const app = setup((response, name) => name === 'index.html'
    ? new Response(assetSource(name) + '\n<!-- another release -->', { headers: response.headers })
    : response);
  await assert.rejects(() => app.dispatch('install'), /파일의 버전이 달라졌습니다: index\.html/);
  assert.equal(app.stores.size, 0, 'unverified HTML must never be installed for offline use');
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

test('installation rejects a changed script even when its HTTP status and MIME type are valid', async () => {
  const app = setup((response, name) => name === 'app.js'
    ? new Response(assetSource(name) + '\n/* another release */', { headers: response.headers })
    : response);
  await assert.rejects(() => app.dispatch('install'));
  assert.equal(app.stores.size, 0, 'unverified code must never be installed for offline use');
});

test('offline shell with a chord query and all local assets use the installed version', async () => {
  const app = setup(); await app.dispatch('install'); const calls = app.calls.length;
  app.setOffline(true);
  const shell = await app.dispatch('fetch', { request: { method: 'GET', mode: 'navigate', url: app.root + '?chord=C13' } });
  assert.equal(shell.status, 200); assert.match(await shell.text(), /search-form/);
  const asset = await app.dispatch('fetch', { request: { method: 'GET', mode: 'cors', url: app.root + 'audio.js' } });
  assert.equal(await asset.text(), assetSource('audio.js'));
  assert.equal(app.calls.length, calls, 'installed bundle is coherent and does not fetch fresh individual assets');
});

test('auth pages, other paths, external URLs and mutations are not intercepted', async () => {
  const app = setup();
  for (const url of ['https://other.test/guitar/index.html', app.root + 'login', 'https://voicing.test/other/index.html', 'https://voicing.test/login']) {
    assert.equal(await app.dispatch('fetch', { request: { method: 'GET', mode: 'navigate', url } }), undefined);
  }
  assert.equal(await app.dispatch('fetch', { request: { method: 'POST', mode: 'cors', url: app.root } }), undefined);
});

test('offline brand images retain their exact PNG bytes after installation', async () => {
  const app = setup(); await app.dispatch('install');
  const calls = app.calls.length;
  app.setOffline(true);
  for (const name of ['chordot-logo.png', 'chordot-icon.png']) {
    const response = await app.dispatch('fetch', { request: { method: 'GET', mode: 'cors', url: app.root + name } });
    assert.equal(response.status, 200, name);
    assert.equal(response.headers.get('content-type'), 'image/png', name);
    const actual = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(actual.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), name);
    assert.deepEqual(actual, assetBytes(name), name);
  }
  assert.equal(app.calls.length, calls, 'branding remains available without a network request');
});

test('brand images with an incorrect MIME type or changed bytes cannot be installed', async () => {
  for (const image of ['chordot-logo.png', 'chordot-icon.png']) {
    for (const defect of ['wrong-mime', 'changed-bytes']) {
      const app = setup((response, name) => {
        if (name !== image) return response;
        if (defect === 'wrong-mime') return new Response(assetBytes(name), { headers: { 'content-type': 'text/html' } });
        const body = Buffer.from(assetBytes(name));
        body[body.length - 1] ^= 1;
        return new Response(body, { headers: response.headers });
      });
      await assert.rejects(() => app.dispatch('install'), undefined, image + ': ' + defect);
      assert.equal(app.stores.size, 0, 'unverified image bytes cannot create an offline bundle');
    }
  }
});

test('evicted cache plus unavailable network returns an explicit non-cacheable failure', async () => {
  const app = setup(); app.setOffline(true);
  const response = await app.dispatch('fetch', { request: { method: 'GET', mode: 'navigate', url: app.root } });
  assert.equal(response.status, 503); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(await response.text(), /인터넷 연결/);
});

test('an online visit rebuilds an evicted bundle for the next offline visit', async () => {
  const app = setup(); await app.dispatch('install');
  app.stores.clear();
  const response = await app.dispatch('fetch', { request: { method: 'GET', url: app.root } });
  assert.equal(response.status, 200);
  assert.equal([...app.stores.values()][0].size, bundleSize, 'the whole bundle is restored without reinstalling the worker');
  app.setOffline(true);
  const shell = await app.dispatch('fetch', { request: { method: 'GET', url: app.root + '?chord=G7' } });
  const asset = await app.dispatch('fetch', { request: { method: 'GET', url: app.root + 'music.js' } });
  assert.equal(shell.status, 200);
  assert.equal(await asset.text(), assetSource('music.js'));
});

test('concurrent missing assets share one complete bundle recovery', async () => {
  const app = setup(); await app.dispatch('install');
  const entries = [...app.stores.values()][0];
  entries.delete(app.root + 'music.js'); entries.delete(app.root + 'audio.js');
  const calls = app.calls.length;
  const responses = await Promise.all(['music.js', 'audio.js', 'music.js'].map(name =>
    app.dispatch('fetch', { request: { method: 'GET', url: app.root + name } })
  ));
  assert.deepEqual(await Promise.all(responses.map(response => response.text())), ['music.js', 'audio.js', 'music.js'].map(assetSource));
  assert.equal(app.calls.length - calls, bundleSize, 'one recovery fetches each bundle file once');
  assert.equal(entries.size, bundleSize);
});

test('partial cache loss cannot mix a newer deployment with the installed application', async () => {
  let newerDeployment = false;
  const app = setup((response, name) => newerDeployment && name.endsWith('.js')
    ? new Response(assetSource(name) + '\n/* newer deployment */', { headers: response.headers })
    : response);
  await app.dispatch('install');
  const entries = [...app.stores.values()][0];
  entries.delete(app.root + 'music.js');
  newerDeployment = true;

  // A normal page can receive one cached script before a missing sibling causes
  // recovery. It must not then receive code belonging to another release.
  const retained = await app.dispatch('fetch', { request: { method: 'GET', url: app.root + 'app.js' } });
  const missing = await app.dispatch('fetch', { request: { method: 'GET', url: app.root + 'music.js' } });
  assert.equal(await retained.text(), assetSource('app.js'));
  assert.equal(missing.status, 503, 'reject a new-release script instead of combining it with an already returned old script');
  assert.equal(entries.has(app.root + 'music.js'), false, 'do not save a mismatched release in the installed cache');
  assert.equal(await entries.get(app.root + 'app.js').clone().text(), assetSource('app.js'), 'preserve every remaining installed file');
});

test('a missing application bundle opens a self-contained recovery screen after a new deployment', async () => {
  for (const loss of ['complete', 'script-only']) {
    let newerDeployment = false;
    const app = setup((response, name) => newerDeployment && name.endsWith('.js')
      ? new Response(assetSource(name) + '\n/* newer deployment */', { headers: response.headers })
      : response);
    await app.dispatch('install');
    const entries = [...app.stores.values()][0];
    if (loss === 'complete') app.stores.clear();
    else entries.delete(app.root + 'music.js');
    newerDeployment = true;

    const response = await app.dispatch('fetch', { request: { method: 'GET', mode: 'navigate', url: app.root + '?chord=D%2FF%23&frets=2,x,0,2,3,2' } });
    assert.equal(response.status, 503, loss);
    assert.match(response.headers.get('content-type'), /^text\/html/, loss);
    assert.equal(response.headers.get('cache-control'), 'no-store', loss);
    const html = await response.text();
    assert.match(html, /id="recover-app"/, loss);
    assert.match(html, /getRegistration\(\)/, 'recovery can apply a waiting update without loading app.js');
    assert.doesNotMatch(html, /<(?:script|link)\b[^>]*(?:src|href)=/, 'recovery needs no missing application assets');
    assert.doesNotMatch(html, /id="search-form"/, 'never open an unusable application shell');
    if (loss === 'script-only') {
      assert.equal(entries.size, bundleSize - 1);
      assert.equal(await entries.get(app.root + 'app.js').clone().text(), assetSource('app.js'));
    } else assert.ok([...app.stores.values()].every(value => value.size === 0));
  }
});

test('recovery rejects invalid files without caching a partial bundle', async () => {
  for (const kind of ['login', 'wrong-mime', 'missing']) {
    const app = setup((response, name) => {
      if (kind === 'login' && name === 'index.html') return new Response('<title>Sign in</title>', { headers: { 'content-type': 'text/html' } });
      if (kind === 'wrong-mime' && name === 'music.js') return new Response('<title>Sign in</title>', { headers: { 'content-type': 'text/html' } });
      if (kind === 'missing' && name === 'audio.js') return new Response('not found', {status: 404});
      return response;
    });
    const file = kind === 'login' ? '' : kind === 'wrong-mime' ? 'music.js' : 'audio.js';
    const response = await app.dispatch('fetch', { request: { method: 'GET', url: app.root + file } });
    assert.equal(response.status, 503, kind);
    assert.ok([...app.stores.values()].every(entries => entries.size === 0), kind);
  }
});

test('a failed unrelated file cannot block a valid online response or create an incomplete offline bundle', async () => {
  const app = setup((response, name) => name === 'chordot-icon.png' ? new Response('temporary failure', {status: 503}) : response);
  const response = await app.dispatch('fetch', { request: { method: 'GET', url: app.root } });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /search-form/);
  assert.ok([...app.stores.values()].every(entries => entries.size === 0));
  app.setOffline(true);
  const offline = await app.dispatch('fetch', { request: { method: 'GET', url: app.root } });
  assert.equal(offline.status, 503);
});

test('cache failures preserve online use and never leave a partially written bundle', async () => {
  for (const options of [{failWrites: true}, {cacheUnavailable: true}]) {
    const app = setup(undefined, options);
    const response = await app.dispatch('fetch', { request: { method: 'GET', url: app.root } });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /search-form/);
    assert.equal(app.stores.size, 0);
    app.setOffline(true);
    const offline = await app.dispatch('fetch', { request: { method: 'GET', url: app.root } });
    assert.equal(offline.status, 503);
  }
});

test('activation clears only obsolete app caches and claims clients; explicit update can skip waiting', async () => {
  const app = setup(); await app.dispatch('install');
  const current = [...app.stores.keys()][0], old = current.replace(/v\d+(?:-[a-f\d]+)?$/, 'v0');
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

test('a stalled unrelated asset times out without blocking valid online responses or poisoning recovery', async () => {
  const timers = new Map();
  let nextTimer = 0, stall = true, stalledRequest;
  const app = setup((response, name, request) => {
    if (stall && name === 'chordot-icon.png') {
      stalledRequest = request;
      return new Promise(() => {});
    }
    return response;
  }, {
    setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  const pending = app.dispatch('fetch', { request: { method: 'GET', url: app.root } });
  // Let the other files arrive while the icon request remains stalled.
  await waitFor(() => timers.size === 1);
  assert.equal(timers.size, 1, 'a stalled request has a bounded deadline');
  for (const callback of timers.values()) callback();
  const response = await pending;
  assert.equal(response.status, 200);
  assert.match(await response.text(), /search-form/);
  assert.equal(stalledRequest.signal.aborted, true, 'stop the stalled network request');
  assert.ok([...app.stores.values()].every(entries => entries.size === 0), 'never save a partial bundle');
  assert.equal(timers.size, 0);

  stall = false;
  const retried = await app.dispatch('fetch', { request: { method: 'GET', url: app.root } });
  assert.equal(retried.status, 200);
  assert.equal([...app.stores.values()][0].size, bundleSize, 'later visits can retry and complete the cache');
});

test('a shell body that never finishes is bounded and leaves no incomplete installation', async () => {
  const timers = new Map();
  let nextTimer = 0;
  const app = setup((response, name) => name === 'index.html'
    ? new Response(new ReadableStream({start(controller) { controller.enqueue(new TextEncoder().encode('<title>Chordot')); }}), {headers: {'content-type':'text/html'}})
    : response, {
    setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  const pending = app.dispatch('install');
  const rejected = assert.rejects(pending, /시간|timeout/i);
  await waitFor(() => timers.size === 1);
  assert.equal(timers.size, 1);
  for (const callback of timers.values()) callback();
  await rejected;
  assert.equal(app.stores.size, 0);
  assert.equal(timers.size, 0);
});

test('a stalled required script opens recovery instead of an unusable application shell', async () => {
  const timers = new Map();
  let nextTimer = 0;
  const app = setup((response, name) => name === 'music.js'
    ? new Response(new ReadableStream({start(controller) { controller.enqueue(new TextEncoder().encode('/* partial script')); }}), {headers: {'content-type':'text/javascript'}})
    : response, {
    setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  const pending = app.dispatch('fetch', { request: { method: 'GET', url: app.root } });
  await waitFor(() => timers.size === 1);
  assert.equal(timers.size, 1);
  for (const callback of timers.values()) callback();
  const response = await pending;
  assert.equal(response.status, 503);
  assert.match(response.headers.get('content-type'), /^text\/html/);
  assert.match(await response.text(), /id="recover-app"/);
  assert.ok([...app.stores.values()].every(entries => entries.size === 0));
  assert.equal(timers.size, 0);
});
