const { test } = require('node:test');
const assert = require('node:assert/strict');
const state = require('../dist/state.js');
const old = { chord: 'D/F#', frets: [2,-1,0,2,3,2], options: { noBarre: true, maxFret: 5, span: 2 } };

test('legacy saved grips retain their exact frets and filters through backup and import', () => {
  const records = state.readStored(JSON.stringify([old]));
  const restored = state.readBackup(state.backup(records));
  assert.deepEqual(restored[0].frets, [2,-1,0,2,3,2]);
  assert.deepEqual(restored[0].options, { noBarre: true, complete: false, maxFret: 5, span: 2 });
  assert.equal(restored[0].chord, 'D/F#');
});
test('backup import merges distinct shapes without dropping existing records', () => {
  const alternate = { ...old, frets: [2,0,0,2,3,2] };
  const base = state.readStored(JSON.stringify([old]));
  const next = state.mergeRecords(base, state.readBackup(JSON.stringify([old,alternate])));
  assert.equal(next.length, 2);
  assert.deepEqual(next[0], base[0]);
});
test('saved aliases share one identity while retaining the original record and filters', () => {
  const legacy = { chord: 'CM7', frets: [-1,3,2,0,0,0], options: { noBarre: true, maxFret: 5, span: 2 } };
  const canonical = { ...legacy, chord: 'Cmaj7', options: { maxFret: 15 } };
  assert.equal(state.key(legacy), state.key(canonical));
  const stored = state.readStored(JSON.stringify([legacy, canonical]));
  assert.equal(stored.length, 1);
  assert.equal(stored[0].chord, 'CM7', 'retain the original spelling for legacy recovery');
  assert.deepEqual(stored[0].options, { noBarre: true, complete: false, maxFret: 5, span: 2 });
  assert.equal(state.mergeRecords(stored, state.readBackup(JSON.stringify([canonical]))).length, 1);
  assert.equal(state.readBackup(state.backup(stored))[0].chord, 'CM7');
  assert.equal(state.mergeRecords(stored, [{ ...canonical, frets: [8,10,9,9,8,8] }]).length, 2, 'different grips remain distinct');
});
test('unrecognized legacy symbols remain distinct and recoverable when identifying saved grips', () => {
  const unknown = { ...old, chord: 'Cunsupported' };
  assert.equal(state.key(unknown), 'Cunsupported|2,-1,0,2,3,2');
  assert.equal(state.readStored(JSON.stringify([unknown]))[0].chord, 'Cunsupported');
  assert.notEqual(state.key({ ...old, chord: 'C(b5)' }), state.key({ ...old, chord: 'Cb5' }));
});
test('malformed storage throws so callers can preserve the original instead of overwriting it', () => {
  for (const text of ['{', '{}', '[null]', '[{"chord":"C","frets":[0,0]}]', '[{"chord":"C","frets":[-1,-1,-1,-1,-1,-1]}]']) assert.throws(() => state.readStored(text));
  assert.throws(() => state.readBackup('{"format":"voicing-backup","version":999,"saved":[]}'));
  assert.throws(() => state.readBackup('x'.repeat(1024 * 1024 + 1)));
});
test('capacity error leaves the existing array untouched', () => {
  const existing = Array.from({length:150}, (_, i) => ({ ...old, chord: 'C' + i }));
  assert.throws(() => state.mergeRecords(existing, [{...old, chord:'D'}]));
  assert.equal(existing.length, 150);
});
test('exact chord, selected grip and search constraints survive URL round trip', () => {
  const value = { chord:'G7(b9)/Ab', options:{noBarre:true, complete:true, maxFret:15, span:4}, frets:[4,-1,3,4,3,4], view:'search' };
  const url = state.locationFor('https://example.com/guitar/?unrelated=ok#top', value);
  const restored = state.parseLocation(url);
  assert.equal(restored.chord, value.chord);
  assert.deepEqual(restored.options, value.options);
  assert.deepEqual(restored.frets, value.frets);
  assert.equal(new URL(url).searchParams.get('unrelated'), 'ok');
});
test('invalid URL chord is not silently replaced and malformed shapes are identifiable', () => {
  assert.equal(state.parseLocation('https://example.com/?chord=Cwrong').chord, 'Cwrong');
  assert.equal(state.parseLocation('https://example.com/?chord=').chord, '');
  assert.equal(state.parseLocation('https://example.com/?shape=2,,0,2,3,2').invalidShape, true);
  assert.equal(state.parseLocation('https://example.com/?shape=99,0,0,0,0,0').frets, null);
  assert.equal(state.parseLocation('https://example.com/').chord, 'Cmaj9');
});
test('unsupported filter values normalize to bounded defaults', () => {
  assert.deepEqual(state.parseLocation('https://example.com/?noBarre=false&maxFret=999&span=-1').options, { noBarre:false, complete:false, maxFret:12, span:3 });
});
