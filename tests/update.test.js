const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the shipped update event wiring with independent tab/worker events.
// The surrounding search DOM is covered by app.test.js.
const appSource = fs.readFileSync(path.join(__dirname, '../dist/app.js'), 'utf8');
const updateSource = appSource.slice(appSource.indexOf("  if ('serviceWorker' in navigator"), appSource.lastIndexOf('})();'));

async function fixture({ controlled = true, hasUpdate = true, installing = false } = {}) {
  const events = new Map(), buttons = new Map(), messages = [], actions = [], workerEvents = new Map(), registrationEvents = new Map();
  const oldController = controlled ? { state: 'activated' } : null;
  const newWorker = {
    state: installing ? 'installing' : 'installed',
    postMessage: message => messages.push(message),
    addEventListener: (type, handler) => workerEvents.set(type, handler)
  };
  const notice = { hidden: true };
  const registration = {
    waiting: hasUpdate && !installing ? newWorker : null,
    installing: installing ? newWorker : null,
    addEventListener: (type, handler) => registrationEvents.set(type, handler),
    async update() {}
  };
  const serviceWorker = {
    controller: oldController,
    addEventListener: (type, handler) => events.set(type, handler),
    async register() { return registration; }
  };
  let selection = 'original grip', restoredSelection = null;
  const location = { protocol: 'https:', reload() { actions.push('reload'); } };
  vm.runInNewContext(updateSource, {
    navigator: { serviceWorker, onLine: true }, location,
    $: selector => selector === '#update-notice' ? notice : { addEventListener: (type, handler) => buttons.set(type, handler) },
    updateLocation(mode) { restoredSelection = selection; actions.push('save:' + mode); },
    stopSound() { actions.push('stop'); }
  });
  await Promise.resolve();
  return {
    notice, messages, actions,
    click() { buttons.get('click')(); },
    setSelection(value) { selection = value; },
    get restoredSelection() { return restoredSelection; },
    discover() { registrationEvents.get('updatefound')?.(); },
    finishInstall() {
      registration.installing = null; registration.waiting = newWorker;
      newWorker.state = 'installed'; workerEvents.get('statechange')?.();
    },
    activate() {
      newWorker.state = 'activated'; registration.waiting = null;
      serviceWorker.controller = newWorker; events.get('controllerchange')();
    }
  };
}

test('a tab can apply an update already activated by another tab', async () => {
  const app = await fixture();
  assert.equal(app.notice.hidden, false);
  app.activate();
  assert.equal(app.actions.includes('reload'), false, 'another tab must not force a reload');
  app.setSelection('recently selected grip');
  app.click();
  assert.equal(app.actions.filter(action => action === 'reload').length, 1);
  assert.equal(app.restoredSelection, 'recently selected grip');
  assert.equal(app.messages.length, 0, 'do not message a worker whose activation already completed');
});

test('applying a waiting update preserves selection and reloads once after activation', async () => {
  const app = await fixture();
  app.setSelection('selected alternative');
  app.click();
  assert.equal(app.messages[0].type, 'SKIP_WAITING');
  assert.equal(app.actions.includes('reload'), false);
  assert.equal(app.restoredSelection, 'selected alternative');
  app.activate();
  app.click();
  assert.equal(app.actions.filter(action => action === 'reload').length, 1);
  assert.equal(app.messages.length, 1);
});

test('the first service-worker claim does not offer a redundant update', async () => {
  const app = await fixture({ controlled: false, hasUpdate: false });
  app.activate();
  assert.equal(app.notice.hidden, true);
  app.click();
  assert.equal(app.actions.includes('reload'), false);
  assert.equal(app.messages.length, 0);
});

test('a controller update is actionable even when this tab missed the waiting event', async () => {
  const app = await fixture({ hasUpdate: false });
  app.activate();
  assert.equal(app.notice.hidden, false);
  app.click();
  assert.equal(app.actions.filter(action => action === 'reload').length, 1);
});

test('an update already installing when registration resolves is announced and can be applied', async () => {
  const app = await fixture({ installing: true });
  assert.equal(app.notice.hidden, true);
  app.finishInstall();
  assert.equal(app.notice.hidden, false, 'observe an existing installing worker even without a later updatefound event');
  app.setSelection('grip chosen during installation');
  app.click();
  assert.equal(app.messages[0].type, 'SKIP_WAITING');
  app.activate();
  assert.equal(app.actions.filter(action => action === 'reload').length, 1);
  assert.equal(app.restoredSelection, 'grip chosen during installation');
});

test('first installation does not leave an unusable update notice after its initial claim', async () => {
  const app = await fixture({ controlled: false, installing: true });
  app.discover();
  app.finishInstall();
  assert.equal(app.notice.hidden, true, 'initial offline installation is not an update to a controlled page');
  app.activate();
  assert.equal(app.notice.hidden, true);
  app.click();
  assert.equal(app.messages.length, 0);
  assert.equal(app.actions.includes('reload'), false);
});
