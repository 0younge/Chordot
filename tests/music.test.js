const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseChord, findVoicings, fingering, TUNING } = require('../dist/music.js');
const pitches = symbol => [...new Set(parseChord(symbol).intervals.map(n => n.pc))].sort((a, b) => a - b);

test('chord formulas independently match expected pitch classes', () => {
  const expected = {
    C: [0,4,7], Cm: [0,3,7], Cmaj9: [0,2,4,7,11], 'F#m7♭5': [0,4,6,9],
    'G7(♭9)': [2,5,7,8,11], C13: [0,2,4,5,7,9,10], Cdim7: [0,3,6,9],
    'Cm(maj7)': [0,3,7,11], Cadd9: [0,2,4,7], 'C6/9': [0,2,4,7,9],
    C7sus4: [0,5,7,10], Caug: [0,4,8], 'C7#9': [0,3,4,7,10], C5: [0,7],
    'C7(b9,#9)': [0,1,3,4,7,10], 'Cmaj7#11': [0,4,6,7,11], 'C7no5': [0,4,10]
  };
  for (const [symbol, notes] of Object.entries(expected)) assert.deepEqual(pitches(symbol), notes, symbol);
});

test('notation aliases and enharmonic spelling', () => {
  for (const alias of ['CM7','C△7','CΔ7','Cmaj7','CMaj7']) assert.deepEqual(pitches(alias), [0,4,7,11]);
  assert.deepEqual(pitches('Bø'), pitches('Bm7b5'));
  assert.deepEqual(pitches('F♯m7♭5'), pitches('F#m7b5'));
  assert.deepEqual(parseChord('C#maj7').intervals.map(i => i.name), ['C♯','E♯','G♯','B♯']);
  assert.deepEqual(parseChord('Cdim7').intervals.map(i => i.name), ['C','E♭','G♭','B♭♭']);
  assert.equal(parseChord('D/F#').bassPC, 6);
  assert.equal(parseChord('C6/9').bass, null);
});

test('invalid and unsupported input is rejected instead of guessed', () => {
  for (const symbol of ['', 'H7', 'Chello', 'C7b', 'C7(b9', 'C7)b9(', 'Calt', '<script>', 'C/'.repeat(40)]) {
    assert.throws(() => parseChord(symbol), undefined, symbol);
  }
});

test('all recommended shapes contain required tones and the exact slash bass', () => {
  const examples = ['C','Am','Em','F','Cmaj9','F#m7b5','G7(b9)','D/F#','C/E','C/D','C13','Bbmaj7','Cdim7','Cmmaj9','C7#9','C7sus4'];
  for (const symbol of examples) {
    const chord = parseChord(symbol);
    const { voicings } = findVoicings(chord);
    assert.ok(voicings.length > 0, `${symbol}: no shapes`);
    for (const v of voicings) {
      const actual = v.frets.flatMap((f, s) => f < 0 ? [] : [TUNING[s] + f]);
      const pcs = new Set(actual.map(n => n % 12));
      const allowed = new Set(chord.intervals.map(n => n.pc));
      if (chord.bassPC !== null) allowed.add(chord.bassPC);
      for (const pc of pcs) assert.ok(allowed.has(pc), `${symbol}: foreign note`);
      for (const tone of chord.intervals.filter(n => !n.optional)) assert.ok(pcs.has(tone.pc), `${symbol}: missing ${tone.name}`);
      if (chord.bassPC !== null) assert.equal(Math.min(...actual) % 12, chord.bassPC);
      assert.deepEqual(v.omitted.map(n => n.pc), chord.intervals.filter(n => !pcs.has(n.pc)).map(n => n.pc));
      assert.ok(v.count <= 4);
      assert.ok(v.maxFret <= 12);
      assert.ok(v.maxFret - v.minFret <= 3);
    }
  }
});

test('all-tones, no-barre and position filters are honored', () => {
  const full = findVoicings('Cmaj9', { complete: true });
  assert.ok(full.voicings.length);
  assert.ok(full.voicings.every(v => v.omitted.length === 0));
  assert.equal(findVoicings('C13', { complete: true }).voicings.length, 0, '7 distinct tones cannot fit 6 strings');
  const noBarre = findVoicings('F', { noBarre: true, maxFret: 5, span: 2 });
  assert.ok(noBarre.voicings.length);
  assert.ok(noBarre.voicings.every(v => !v.barre && v.maxFret <= 5 && v.maxFret - v.minFret <= 2));
});

test('barre cannot cross an open, muted, or lower fret', () => {
  const f = fingering([1,3,3,2,1,1]);
  assert.ok(f.barre);
  assert.equal(f.count, 4);
  assert.equal(fingering([1,3,3,2,1,1], false), null);
  const candidates = findVoicings('Cmaj9');
  for (const v of candidates.voicings) if (v.barre) {
    assert.ok(v.frets.slice(v.barre.start, v.barre.end + 1).every(f => f >= v.barre.fret));
  }
});
