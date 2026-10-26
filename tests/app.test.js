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
async function appFixture(records = [grip]) {
  const nodes = new Map(), windowEvents = new Map(), storage = new Map();
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
  const location = { href: 'https://voicing.test/', protocol: 'https:' };
  const window = {
    VoicingMusic: music, VoicingState: state,
    VoicingAudio: { createPlayer: () => ({ stop() {} }) },
    addEventListener: (type, handler) => windowEvents.set(type, handler)
  };
  const context = vm.createContext({
    window, document, location, navigator: { onLine: true },
    history: { pushState(_state, _title, href) { location.href = href; }, replaceState(_state, _title, href) { location.href = href; } },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    setTimeout: () => 1, clearTimeout() {}, URL, Blob,
    Worker: class { constructor() { throw new Error('Use the supported main-thread fallback.'); } }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../dist/app.js'), 'utf8'), context);
  await flush();
  return {
    node: selector => nodes.get(selector),
    records: () => JSON.parse(storage.get(STORAGE) || '[]'),
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
