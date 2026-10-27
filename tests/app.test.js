const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const music = require('../dist/music.js');
const state = require('../dist/state.js');

const STORAGE = 'voicing-saved-v1';
const grip = { chord: 'Cmaj9', frets: [-1, 3, 2, 4, 3, 0], options: state.cleanOptions() };
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

// A small DOM/event fixture for app wiring, not a layout or browser substitute.
// Execute the shipped script and drive the same buttons used in the UI.
async function appFixture(records = [grip], config = {}) {
  const nodes = new Map(), windowEvents = new Map(), storage = new Map();
  const calculations = [];
  let holdCalculations = false;
  storage.set(STORAGE, JSON.stringify(records));
  let activeElement = null;
  class Element {
    constructor(attributes = {}) {
      this.attributes = { ...attributes }; this.dataset = {}; this.events = new Map();
      this.children = []; this.descendants = []; this.value = attributes.value || '';
      this.hidden = false; this.checked = false; this._html = ''; this.textContent = '';
      const classes = new Set((attributes.class || '').split(/\s+/).filter(Boolean));
      this.classList = {
        add: name => classes.add(name), remove: name => classes.delete(name),
        contains: name => classes.has(name),
        toggle(name, force = !classes.has(name)) { if (force) classes.add(name); else classes.delete(name); }
      };
      for (const [key, value] of Object.entries(attributes)) {
        if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())] = value;
      }
      if (attributes.id) nodes.set('#' + attributes.id, this);
    }
    set innerHTML(html) {
      if (this.descendants.includes(activeElement)) activeElement = null;
      for (const child of this.descendants) if (child.attributes.id) nodes.delete('#' + child.attributes.id);
      this._html = html; this.descendants = parseElements(html);
    }
    get innerHTML() { return this._html; }
    addEventListener(type, callback) { this.events.set(type, callback); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    removeAttribute(name) { delete this.attributes[name]; }
    querySelectorAll(selector) {
      const match = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
      return match ? this.descendants.filter(node => match[1] in node.attributes && (match[2] === undefined || node.attributes[match[1]] === match[2])) : [];
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    replaceChildren(...children) { this.children = children; }
    append(child) { this.children.push(child); }
    contains(node) { return this === node || this.children.includes(node); }
    focus() { activeElement = this; }
    async click() { await this.events.get('click')?.({ target: this, detail: 1 }); await flush(); }
  }
  function parseElements(html) {
    return [...html.matchAll(/<[a-z][\w-]*\b([^>]*)>/gi)].map(match => {
      const attributes = Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(attr => [attr[1], attr[2]]));
      return new Element(attributes);
    });
  }
  const all = parseElements(fs.readFileSync(path.join(__dirname, '../dist/index.html'), 'utf8'));
  const document = {
    querySelector: selector => nodes.get(selector) || null,
    querySelectorAll: selector => selector === '[data-chord]' ? all.filter(node => 'chord' in node.dataset) : [],
    createElement: () => new Element(), addEventListener() {},
    get activeElement() { return activeElement; }
  };
  const location = { href: config.href || 'https://voicing.test/', protocol: 'https:' };
  const entries = [location.href]; let historyIndex = 0;
  const window = {
    VoicingMusic: music, VoicingState: state,
    VoicingAudio: { createPlayer: () => ({ stop() {} }) },
    addEventListener: (type, handler) => windowEvents.set(type, handler)
  };
  const context = vm.createContext({
    window, document, location, navigator: { onLine: true, locks: config.locks },
    history: {
      pushState(_state, _title, href) { entries.splice(++historyIndex); entries.push(href); location.href = href; },
      replaceState(_state, _title, href) { entries[historyIndex] = href; location.href = href; }
    },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => {
        if (config.writeError) throw config.writeError;
        storage.set(key, value);
      }
    },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    setTimeout: () => 1, clearTimeout() {}, URL, Blob,
    Worker: class {
      constructor() { if (!config.worker) throw new Error('Use the supported main-thread fallback.'); }
      postMessage(request) {
        const respond = () => this.onmessage({ data: { id: request.id, result: music.findVoicings(request.chord, request.options) } });
        if (holdCalculations) calculations.push(respond); else queueMicrotask(respond);
      }
      terminate() {}
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../dist/app.js'), 'utf8'), context);
  await flush();
  return {
    node: selector => nodes.get(selector),
    activeElement: () => activeElement,
    href: () => location.href,
    async search(value) { nodes.get('#search-input').value = value; nodes.get('#search-form').events.get('submit')({ preventDefault() {} }); await flush(); },
    async back() { location.href = entries[--historyIndex]; windowEvents.get('popstate')(); await flush(); },
    async forward() { location.href = entries[++historyIndex]; windowEvents.get('popstate')(); await flush(); },
    holdSearches() { holdCalculations = true; },
    async finishSearch() { calculations.shift()(); await flush(); },
    records: () => JSON.parse(storage.get(STORAGE) || '[]'),
    async replaceFromAnotherTab(records, notify = true) {
      storage.set(STORAGE, JSON.stringify(records));
      if (notify) windowEvents.get('storage')({ key: STORAGE });
      await flush();
    },
    async clearFromAnotherTab() { storage.clear(); windowEvents.get('storage')({ key: null }); await flush(); }
  };
}

test('undo from the library updates the selected grip after returning to search', async () => {
  const app = await appFixture();
  assert.equal(app.node('#save-voicing').getAttribute('aria-pressed'), 'true');
  await app.node('#saved-tab').click();
  await app.node('#saved-list').querySelector('[data-delete]').click();
  assert.equal(app.records().length, 0);
  await app.node('#search-tab').click();
  assert.equal(app.node('#save-voicing').getAttribute('aria-pressed'), 'false');

  await app.node('#toast').children[1].click();
  assert.equal(app.records().length, 1);
  assert.equal(app.node('#saved-count').textContent, '1');
  assert.equal(app.node('#save-voicing').getAttribute('aria-pressed'), 'true');
  assert.equal(app.node('#save-voicing').classList.contains('saved'), true);
  assert.match(app.node('#save-voicing').innerHTML, /저장됨/);
});

test('clearing storage in another tab updates the selected grip and saved count', async () => {
  const app = await appFixture();
  await app.clearFromAnotherTab();
  assert.equal(app.node('#saved-count').textContent, '0');
  assert.equal(app.node('#save-voicing').getAttribute('aria-pressed'), 'false');
  assert.equal(app.node('#save-voicing').classList.contains('saved'), false);
  assert.match(app.node('#save-voicing').innerHTML, /운지 저장/);
});

test('clearing storage in another tab refreshes an open library', async () => {
  const app = await appFixture();
  await app.node('#saved-tab').click();
  assert.equal(app.node('#saved-list').querySelectorAll('[data-delete]').length, 1);
  await app.clearFromAnotherTab();
  assert.equal(app.node('#saved-list').querySelectorAll('[data-delete]').length, 0);
  assert.match(app.node('#saved-list').innerHTML, /마음에 드는 운지를 모아 보세요/);
});

test('a save waiting for another tab refreshes the library opened before it finishes', async () => {
  let release;
  const app = await appFixture([], { locks: { request: (_name, write) => new Promise(resolve => {
    release = () => resolve(write());
  }) } });
  const saving = app.node('#save-voicing').click();
  await app.node('#saved-tab').click();
  assert.equal(app.node('#saved-list').querySelectorAll('[data-open-saved]').length, 0);
  release(); await saving;
  assert.equal(app.records().length, 1);
  assert.equal(app.node('#saved-count').textContent, '1');
  assert.equal(app.node('#saved-list').querySelectorAll('[data-open-saved]').length, 1);
});

test('a delayed save keeps the search input focused and preserves the current result controls', async () => {
  let release;
  const app = await appFixture([], { locks: { request: (_name, write) => new Promise(resolve => {
    release = () => resolve(write());
  }) } });
  const saveButton = app.node('#save-voicing');
  const saving = saveButton.click();
  const input = app.node('#search-input');
  input.focus(); input.value = 'Dm';
  release(); await saving;
  assert.equal(app.activeElement(), input, 'saving must not interrupt typing the next chord');
  assert.equal(app.node('#save-voicing'), saveButton, 'saving updates the existing control without replacing it');
  assert.equal(saveButton.getAttribute('aria-pressed'), 'true');
  assert.equal(input.value, 'Dm');
});

test('a delayed undo keeps a focused playback button available while updating the saved state', async () => {
  let release;
  const app = await appFixture([grip], { locks: { request: (_name, write) => new Promise(resolve => {
    release = () => resolve(write());
  }) } });
  const removing = app.node('#save-voicing').click();
  release(); await removing;
  await app.node('#toast').children[1].click();
  const playback = app.node('#play-chord');
  playback.focus();
  release(); await flush();
  assert.equal(app.activeElement(), playback, 'finishing undo must not discard the currently focused playback button');
  assert.equal(app.node('#play-chord'), playback);
  assert.equal(app.node('#save-voicing').getAttribute('aria-pressed'), 'true');
});

test('a saved alias is recognized and removed from its canonical search result without duplicates', async () => {
  const alias = { chord: 'CM7', frets: [-1, 3, 2, 0, 0, 0], options: state.cleanOptions() };
  const app = await appFixture([alias]);
  await app.node('#saved-tab').click();
  await app.node('#saved-list').querySelector('[data-open-saved]').click();
  assert.equal(app.node('#save-voicing').getAttribute('aria-pressed'), 'true');
  await app.node('#save-voicing').click();
  assert.deepEqual(app.records(), []);
  await app.node('#toast').children[1].click();
  assert.deepEqual(app.records(), [alias]);
  assert.equal(app.node('#save-voicing').getAttribute('aria-pressed'), 'true');
});

test('a delayed library deletion leaves focus where the user moved it', async () => {
  for (const destination of ['search', 'library-tools']) {
    let release;
    const app = await appFixture([grip], { locks: { request: (_name, write) => new Promise(resolve => {
      release = () => resolve(write());
    }) } });
    await app.node('#saved-tab').click();
    const button = app.node('#saved-list').querySelector('[data-delete]');
    button.focus();
    const removing = button.click();
    if (destination === 'search') await app.node('#search-tab').click();
    const nextControl = app.node(destination === 'search' ? '#search-input' : '#import-saved');
    nextControl.focus();
    release(); await removing;
    assert.equal(app.activeElement(), nextControl, destination);
    assert.deepEqual(app.records(), []);
    assert.equal(app.node('#save-voicing').getAttribute('aria-pressed'), 'false');
  }
});

test('a delayed deletion preserves focus on another library item after its index changes', async () => {
  for (const scenario of [
    { role: 'open-saved', refresh: false }, { role: 'delete', refresh: false },
    { role: 'open-saved', refresh: true }, { role: 'delete', refresh: true }
  ]) {
    const { role, refresh } = scenario;
    let release;
    const app = await appFixture([cGrip, dmGrip], { locks: { request: (_name, write) => new Promise(resolve => {
      release = () => resolve(write());
    }) } });
    await app.node('#saved-tab').click();
    const removing = app.node('#saved-list').querySelector('[data-delete="0"]').click();
    if (refresh) await app.replaceFromAnotherTab([dmGrip, cGrip]);
    app.node('#saved-list').querySelector(`[data-${role}="${refresh ? 0 : 1}"]`).focus();
    release(); await removing;
    const remainingButton = app.node('#saved-list').querySelector(`[data-${role}="0"]`);
    assert.equal(app.activeElement(), remainingButton, 'focus follows the surviving Dm record, not its previous index');
    assert.deepEqual(app.records(), [dmGrip]);
  }
});

test('a queued deletion keeps keyboard navigation after its focused button is refreshed', async () => {
  for (const role of ['delete', 'open-saved']) for (const latest of [[dmGrip, cGrip], [{ ...cGrip, options: { ...cGrip.options, span: 4 } }]]) {
    let release;
    const app = await appFixture([cGrip], { locks: { request: (_name, write) => new Promise(resolve => {
      release = () => resolve(write());
    }) } });
    await app.node('#saved-tab').click();
    const button = app.node('#saved-list').querySelector('[data-delete]');
    button.focus();
    const removing = button.click();
    app.node('#saved-list').querySelector(`[data-${role}]`).focus();
    await app.replaceFromAnotherTab(latest);
    const refreshed = app.node('#saved-list').querySelector(`[data-${role}="${latest.length - 1}"]`);
    assert.notEqual(refreshed, button);
    assert.equal(app.activeElement(), refreshed, 'the same saved grip remains focused after refresh');
    release(); await removing;
    const remaining = app.node('#saved-list').querySelector(`[data-${role}]`) || app.node('#empty-back');
    assert.equal(app.activeElement(), remaining, 'completion must follow the focused grip even when its button was replaced');
    assert.equal(app.records().some(entry => state.key(entry) === state.key(cGrip)), false);
  }
});

test('removing the focused grip from another tab keeps library keyboard navigation', async () => {
  for (const role of ['delete', 'open-saved']) for (const remainingRecords of [[dmGrip], []]) {
    const app = await appFixture([cGrip, ...remainingRecords]);
    await app.node('#saved-tab').click();
    app.node('#saved-list').querySelector(`[data-${role}="0"]`).focus();
    await app.replaceFromAnotherTab(remainingRecords);
    const remaining = app.node('#saved-list').querySelector(`[data-${role}="0"]`) || app.node('#empty-back');
    assert.equal(app.activeElement(), remaining, 'a removed card must leave focus on an available library action');
  }
});

test('the empty library search action keeps focus through queued writes and new records', async () => {
  let release;
  const app = await appFixture([cGrip], { locks: { request: (_name, write) => new Promise(resolve => {
    release = () => resolve(write());
  }) } });
  await app.node('#saved-tab').click();
  const button = app.node('#saved-list').querySelector('[data-delete]');
  button.focus();
  const removing = button.click();
  await app.replaceFromAnotherTab([]);
  assert.equal(app.activeElement(), app.node('#empty-back'));
  release(); await removing;
  assert.equal(app.activeElement(), app.node('#empty-back'), 'a repeated empty render must keep the search action focused');
  await app.replaceFromAnotherTab([dmGrip]);
  assert.equal(app.activeElement(), app.node('#back-search'), 'when records arrive, focus stays on the equivalent search action');
});

test('a queued save does not delete a grip saved by another tab before it completes', async () => {
  let release;
  const app = await appFixture([], { locks: { request: (_name, write) => new Promise(resolve => {
    release = () => resolve(write());
  }) } });
  const saving = app.node('#save-voicing').click();
  const latest = { ...grip, options: { noBarre: true, complete: false, maxFret: 15, span: 4 } };
  await app.replaceFromAnotherTab([latest]);
  release(); await saving;
  assert.deepEqual(app.records(), [latest]);
  assert.equal(app.node('#save-voicing').getAttribute('aria-pressed'), 'true');
  assert.equal(app.node('#toast').children.length, 1, 'saving must never offer deletion undo');
});

test('a queued removal does not recreate a grip removed by another tab', async () => {
  let release;
  const app = await appFixture([grip], { locks: { request: (_name, write) => new Promise(resolve => {
    release = () => resolve(write());
  }) } });
  const removing = app.node('#save-voicing').click();
  await app.replaceFromAnotherTab([]);
  release(); await removing;
  assert.deepEqual(app.records(), []);
  assert.equal(app.node('#save-voicing').getAttribute('aria-pressed'), 'false');
  assert.equal(app.node('#toast').children.length, 1, 'nothing was removed by this operation');
});

test('undoing removal from search restores the original saved search conditions', async () => {
  const original = { ...grip, options: { noBarre: true, complete: false, maxFret: 15, span: 4 } };
  const app = await appFixture([original]);
  await app.node('#save-voicing').click();
  assert.equal(app.records().length, 0);
  await app.node('#toast').children[1].click();
  assert.deepEqual(app.records(), [original]);
});

const cGrip = { chord: 'C', frets: [-1, 3, 2, 0, 1, 0], options: state.cleanOptions() };
const dmGrip = { chord: 'Dm', frets: [-1, -1, 0, 2, 3, 1], options: state.cleanOptions() };

test('exporting refreshed storage does not retarget a rendered library delete button', async () => {
  const app = await appFixture([cGrip, dmGrip]);
  await app.node('#saved-tab').click();
  // Storage can be read before the other tab's queued storage event arrives.
  await app.replaceFromAnotherTab([dmGrip], false);
  await app.node('#export-saved').click();
  assert.match(app.node('#saved-list').innerHTML, /<h3>C<\/h3>/);
  await app.node('#saved-list').querySelector('[data-delete="0"]').click();
  assert.deepEqual(app.records(), [dmGrip]);
  assert.doesNotMatch(app.node('#saved-list').innerHTML, /<h3>C<\/h3>/);
});

test('exporting refreshed storage does not retarget a rendered library open button', async () => {
  const app = await appFixture([cGrip, dmGrip]);
  await app.node('#saved-tab').click();
  await app.replaceFromAnotherTab([dmGrip], false);
  await app.node('#export-saved').click();
  await app.node('#saved-list').querySelector('[data-open-saved="0"]').click();
  assert.equal(app.node('#search-input').value, 'C');
  assert.equal(new URL(app.href()).searchParams.get('shape'), cGrip.frets.join(','));
});

test('library deletion undo restores the actual latest record and its search conditions', async () => {
  const app = await appFixture([grip]);
  await app.node('#saved-tab').click();
  const latest = { ...grip, options: { noBarre: true, complete: false, maxFret: 15, span: 4 } };
  await app.replaceFromAnotherTab([latest], false);
  await app.node('#saved-list').querySelector('[data-delete]').click();
  assert.deepEqual(app.records(), []);
  await app.node('#toast').children[1].click();
  assert.deepEqual(app.records(), [latest]);
});

test('deleting a stale library entry does not offer to recreate an already removed record', async () => {
  const app = await appFixture([grip]);
  await app.node('#saved-tab').click();
  await app.replaceFromAnotherTab([], false);
  await app.node('#saved-list').querySelector('[data-delete]').click();
  assert.deepEqual(app.records(), []);
  assert.equal(app.node('#toast').children.length, 1);
  assert.match(app.node('#toast').children[0].textContent, /이미/);
});

test('undo does not overwrite a newer record re-added after deletion from either view', async () => {
  for (const view of ['search', 'saved']) {
    const app = await appFixture([grip]);
    if (view === 'saved') {
      await app.node('#saved-tab').click();
      await app.node('#saved-list').querySelector('[data-delete]').click();
    } else await app.node('#save-voicing').click();
    const latest = { ...grip, options: { noBarre: true, complete: false, maxFret: 15, span: 4 } };
    await app.replaceFromAnotherTab([latest]);
    await app.node('#toast').children[1].click();
    assert.deepEqual(app.records(), [latest], view + ' undo must keep another tab\'s newer settings');
  }
});

test('a failed library write refreshes the list from the latest readable storage', async () => {
  const config = {};
  const app = await appFixture([cGrip, dmGrip], config);
  await app.node('#saved-tab').click();
  await app.replaceFromAnotherTab([dmGrip], false);
  config.writeError = new Error('저장할 수 없어요.');
  await app.node('#saved-list').querySelector('[data-delete="0"]').click();
  assert.deepEqual(app.records(), [dmGrip]);
  assert.equal(app.node('#saved-count').textContent, '1');
  assert.doesNotMatch(app.node('#saved-list').innerHTML, /<h3>C<\/h3>/);
  assert.match(app.node('#saved-list').innerHTML, /<h3>Dm<\/h3>/);
  assert.equal(app.node('#toast').classList.contains('visible'), true);
  config.writeError = null;
  await app.node('#saved-list').querySelector('[data-open-saved="0"]').click();
  assert.equal(app.node('#search-input').value, 'Dm');
});

test('undo write errors remain visible without Web Locks and do not report a restored grip', async () => {
  const config = {};
  const app = await appFixture([grip], config);
  await app.node('#save-voicing').click();
  config.writeError = Object.assign(new Error('Quota exceeded'), { name: 'QuotaExceededError' });
  await app.node('#toast').children[1].click();
  assert.deepEqual(app.records(), []);
  assert.equal(app.node('#save-voicing').getAttribute('aria-pressed'), 'false');
  assert.equal(app.node('#toast').classList.contains('visible'), true);
  assert.equal(app.node('#toast').inert, false);
  assert.match(app.node('#toast').children[0].textContent, /저장 공간이 부족해요/);
});

test('invalid and empty searches retain their input and error after reload', async () => {
  for (const input of ['H7', '']) {
    const app = await appFixture();
    await app.search(input);
    const url = new URL(app.href());
    assert.equal(url.searchParams.get('chord'), input);
    assert.equal(url.searchParams.has('shape'), false);
    const reloaded = await appFixture([], { href: app.href() });
    assert.equal(reloaded.node('#search-input').value, input);
    assert.equal(reloaded.node('#search-input').getAttribute('aria-invalid'), 'true');
    assert.equal(reloaded.node('#save-voicing'), undefined);
  }
});

test('a rejected saved shape keeps its exact chord and frets in the address', async () => {
  const incompatible = { ...grip, chord: 'C' };
  const app = await appFixture([incompatible]);
  await app.node('#saved-tab').click();
  await app.node('#saved-list').querySelector('[data-open-saved]').click();
  const url = new URL(app.href());
  assert.equal(url.searchParams.get('chord'), 'C');
  assert.equal(url.searchParams.get('shape'), incompatible.frets.join(','));
  assert.equal(url.searchParams.has('view'), false);
  const reloaded = await appFixture([], { href: app.href() });
  assert.equal(reloaded.node('#search-input').value, 'C');
  assert.match(reloaded.node('#result-content').innerHTML, /저장된 프렛: × · 3 · 2 · 4 · 3 · 0/);
});

test('history restores an error search across library navigation and a successful retry', async () => {
  const app = await appFixture();
  await app.search('H7');
  await app.node('#saved-tab').click();
  assert.equal(new URL(app.href()).searchParams.get('view'), 'saved');
  await app.back();
  assert.equal(app.node('#finder-view').hidden, false);
  assert.equal(app.node('#search-input').value, 'H7');
  await app.forward();
  assert.equal(app.node('#saved-view').hidden, false);
  await app.back();
  await app.node('#retry-search').click();
  assert.equal(app.node('#search-input').value, 'Cmaj9');
  await app.back();
  assert.equal(app.node('#search-input').value, 'H7');
  assert.equal(app.node('#search-input').getAttribute('aria-invalid'), 'true');
});

test('switching views while a search is pending never restores the previous result', async () => {
  const app = await appFixture([], { worker: true });
  app.holdSearches();
  await app.search('Dm');
  assert.equal(new URL(app.href()).searchParams.get('chord'), 'Dm');
  await app.node('#saved-tab').click();
  await app.node('#search-tab').click();
  assert.equal(app.node('#search-input').value, 'Dm');
  assert.match(app.node('#result-content').innerHTML, /운지를 찾고 있어요/);
  assert.equal(app.node('#save-voicing'), undefined);
  await app.finishSearch();
  assert.match(app.node('#result-content').innerHTML, /Dm 선택한 운지/);
  assert.equal(new URL(app.href()).searchParams.get('chord'), 'Dm');
});

test('repeating a search or its alias does not add duplicate history entries', async () => {
  const app = await appFixture();
  await app.search('Dm');
  await app.search('CM7');
  await app.search('CM7');
  await app.search('Cmaj7');
  await app.back();
  assert.equal(app.node('#search-input').value, 'Dm');
  assert.match(app.node('#result-content').innerHTML, /Dm 선택한 운지/);
});

test('library navigation preserves malformed shape links until a new search', async () => {
  const app = await appFixture([], { href: 'https://voicing.test/?chord=C&shape=bad' });
  await app.node('#saved-tab').click();
  assert.equal(new URL(app.href()).searchParams.get('shape'), 'bad');
  await app.node('#search-tab').click();
  assert.match(app.node('#result-content').innerHTML, /주소에 들어 있는 운지 정보가 올바르지 않아요/);
  const reloaded = await appFixture([], { href: app.href() });
  assert.match(reloaded.node('#result-content').innerHTML, /주소에 들어 있는 운지 정보가 올바르지 않아요/);
  await app.node('#retry-search').click();
  assert.match(app.node('#result-content').innerHTML, /C 선택한 운지/);
});
