const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const workerSource = fs.readFileSync(path.join(__dirname, '../dist/sw.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

// Execute the actual standalone fallback page, with independently controlled
// service-worker lifecycle events and deadlines. No application script is loaded.
async function fixture(config = {}) {
  const response = vm.runInNewContext(workerSource + '\nrecoveryResponse();', {
    self: { registration: { scope: 'https://voicing.test/guitar/' }, addEventListener() {} }, URL, Response
  });
  const html = await response.text();
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const buttonEvents = new Map(), serviceEvents = new Map(), workerEvents = new Set(), timers = new Map();
  const actions = [], messages = [];
  let nextTimer = 0;
  const button = { disabled: false, addEventListener(type, callback) { buttonEvents.set(type, callback); } };
  const status = { textContent: '' };
  const worker = {
    state: config.installing ? 'installing' : 'installed',
    postMessage(message) { messages.push(message); },
    addEventListener(type, callback) { if (type === 'statechange') workerEvents.add(callback); },
    removeEventListener(type, callback) { if (type === 'statechange') workerEvents.delete(callback); }
  };
  const registration = {
    waiting: config.waiting ? worker : null,
    installing: config.installing ? worker : null,
    async update() { actions.push('update'); if (config.update) return config.update(); }
  };
  const serviceWorker = {
    controller: { state: 'activated' },
    addEventListener(type, callback) { serviceEvents.set(type, callback); },
    async getRegistration() { actions.push('get-registration'); return config.getRegistration ? config.getRegistration(registration) : registration; }
  };
  const href = 'https://voicing.test/guitar/?chord=D%2FF%23&shape=2%2C0%2C0%2C2%2C3%2C2&maxFret=9&view=saved';
  const location = { href, reload() { actions.push('reload'); } };
  vm.runInNewContext(script, {
    document: { querySelector: selector => selector === '#recover-app' ? button : status },
    navigator: { serviceWorker }, location,
    setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  return {
    response, html, button, status, registration, actions, messages, location, href, timers,
    click: () => buttonEvents.get('click')(),
    async expire() { const [id, callback] = timers.entries().next().value; timers.delete(id); callback(); await flush(); },
    finishInstall() {
      registration.installing = null; registration.waiting = worker; worker.state = 'installed';
      [...workerEvents].forEach(callback => callback());
    },
    rejectInstall() {
      registration.installing = null; worker.state = 'redundant';
      [...workerEvents].forEach(callback => callback());
    },
    activate() {
      registration.installing = registration.waiting = null; worker.state = 'activated'; serviceWorker.controller = worker;
      [...workerEvents].forEach(callback => callback());
      serviceEvents.get('controllerchange')();
    }
  };
}

test('recovery is self-contained, non-cacheable, and does not update until requested', async () => {
  const page = await fixture({ waiting: true });
  assert.equal(page.response.status, 503);
  assert.match(page.response.headers.get('content-type'), /text\/html/);
  assert.equal(page.response.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(page.html, /<script[^>]+src=|<link[^>]+href=/i);
  assert.deepEqual(page.actions, []);
  assert.equal(page.messages.length, 0);
  page.activate();
  assert.deepEqual(page.actions, [], 'another tab activating must not reload this page');
  assert.equal(page.location.href, page.href);
});

test('requested recovery activates a waiting version and reloads once at the same address', async () => {
  const page = await fixture({ waiting: true });
  await page.click();
  assert.equal(page.messages.length, 1);
  assert.equal(page.messages[0].type, 'SKIP_WAITING');
  assert.equal(page.actions.includes('reload'), false);
  page.activate();
  page.activate();
  await page.click();
  assert.equal(page.actions.filter(action => action === 'reload').length, 1);
  assert.equal(page.messages.length, 1);
  assert.equal(page.location.href, page.href);
  assert.equal(page.timers.size, 0);
});

test('requested recovery waits for an installing worker before applying it', async () => {
  const page = await fixture({ installing: true });
  await page.click();
  assert.equal(page.messages.length, 0);
  assert.equal(page.actions.includes('reload'), false);
  page.finishInstall();
  assert.equal(page.messages[0].type, 'SKIP_WAITING');
  page.activate();
  assert.equal(page.actions.filter(action => action === 'reload').length, 1);
});

test('a fully installed waiting version can recover the app even without network access', async () => {
  const page = await fixture({ waiting: true, update: () => Promise.reject(new Error('offline')) });
  await page.click();
  assert.equal(page.actions.includes('update'), false, 'an already prepared version needs no fresh network update');
  assert.equal(page.messages[0].type, 'SKIP_WAITING');
  assert.equal(page.actions.includes('reload'), false);
  page.activate();
  assert.equal(page.actions.filter(action => action === 'reload').length, 1);
  assert.equal(page.location.href, page.href);
});

test('recovery reloads the current address when another tab already activated the update', async () => {
  const page = await fixture({ waiting: true });
  page.activate();
  await page.click();
  assert.equal(page.messages.length, 0);
  assert.equal(page.actions.filter(action => action === 'reload').length, 1);
  assert.equal(page.location.href, page.href);
});

test('failed update and installation leave an actionable retry instead of automatic reloads', async () => {
  const config = { update: () => Promise.reject(new Error('offline')) };
  const page = await fixture(config);
  await page.click();
  assert.equal(page.button.disabled, false);
  assert.match(page.status.textContent, /다시 시도/);
  assert.equal(page.actions.includes('reload'), false);
  assert.equal(page.timers.size, 0);
  config.update = null;
  await page.click();
  assert.equal(page.actions.filter(action => action === 'reload').length, 1);

  const installing = await fixture({ installing: true });
  await installing.click();
  installing.rejectInstall();
  assert.equal(installing.button.disabled, false);
  assert.match(installing.status.textContent, /다시 시도/);
  assert.equal(installing.actions.includes('reload'), false);
});

test('a timed-out registration lookup cannot run inside a newer recovery attempt', async () => {
  const first = deferred(), second = deferred(); let calls = 0;
  const page = await fixture({ getRegistration: () => (++calls === 1 ? first.promise : second.promise) });
  const oldAttempt = page.click();
  await flush();
  await page.expire();
  assert.equal(page.button.disabled, false);
  const currentAttempt = page.click();
  await flush();
  first.resolve(page.registration);
  await oldAttempt;
  assert.equal(page.actions.includes('update'), false, 'the stale lookup must not start update work for a new click');
  assert.equal(page.actions.includes('reload'), false);
  assert.equal(page.button.disabled, true);
  second.resolve(page.registration);
  await currentAttempt;
  assert.equal(page.actions.filter(action => action === 'reload').length, 1);
});

test('a timed-out update failure cannot cancel a newer recovery attempt', async () => {
  const first = deferred(), second = deferred(); let calls = 0;
  const page = await fixture({ update: () => (++calls === 1 ? first.promise : second.promise) });
  const oldAttempt = page.click();
  await flush();
  await page.expire();
  const currentAttempt = page.click();
  await flush();
  first.reject(new Error('old network request failed'));
  await oldAttempt;
  assert.equal(page.button.disabled, true, 'the earlier failure must not reset the active attempt');
  assert.equal(page.timers.size, 1, 'the new attempt must retain its deadline');
  second.resolve();
  await currentAttempt;
  assert.equal(page.actions.filter(action => action === 'reload').length, 1);
});
