const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseChord, findVoicings, inspectVoicing, fingering, TUNING } = require('../dist/music.js');
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

test('common piano-sheet aliases normalize without losing their meaning', () => {
  const aliases = {
    C: ['CM', 'Cmaj', 'Cmajor'],
    Cm7: ['Cminor7', 'Cmin7', 'C-7', 'C−7'],
    Cm7b5: ['Cm7-5', 'Cø', 'Cø7', 'CØ7'],
    Cm9b5: ['Cø9', 'CØ9'],
    Cmmaj7: ['CmM7', 'Cm(maj7)', 'Cm△7'],
    C7sus4: ['Csus47', 'C7sus', 'C7(sus4)'],
    'C6/9': ['C69', 'C6/9'],
    'F#maj7/C#': ['f♯△7/c♯', 'F#M7/C#']
  };
  for (const [canonical, symbols] of Object.entries(aliases)) for (const symbol of symbols) {
    const parsed = parseChord(symbol);
    assert.equal(parsed.canonical, canonical, symbol);
    assert.deepEqual(pitches(parsed.canonical), pitches(symbol), symbol);
  }
});

test('suspensions retain explicitly added notes and conflicting input is rejected', () => {
  assert.deepEqual(pitches('Cadd4sus2'), [0,2,5,7]);
  assert.deepEqual(pitches('Csus2(add4)'), [0,2,5,7]);
  assert.deepEqual(pitches('Cadd2sus4'), [0,2,5,7]);
  assert.deepEqual(pitches('C7b9#9'), [0,1,3,4,7,10]);
  for (const symbol of ['C#b', 'C7/E#b', 'C()', 'C7(b9,)', 'C7,,b9', 'C7no5#5', 'C7#5no5', 'Csus2sus4', 'Cm7sus4', 'C5sus4', 'Cno3no5', 'C△', 'CmΔ']) {
    assert.throws(() => parseChord(symbol), undefined, symbol);
  }
});

test('canonical alterations remain separate from natural and accidental roots', () => {
  for (const root of ['C', 'Bb', 'C#', 'Cbb', 'F##']) {
    for (const suffix of ['(b5)', '(#5)', '(#9)', '(#11)', 'majb5', 'maj#5']) {
      const symbol = root + suffix;
      const original = parseChord(symbol);
      const restored = parseChord(original.canonical);
      assert.equal(restored.root, original.root, symbol);
      assert.deepEqual(restored.intervals, original.intervals, symbol);
      assert.equal(restored.canonical, original.canonical, symbol);
    }
  }
  assert.equal(parseChord('C(b5)').canonical, 'C(b5)');
  assert.equal(parseChord('Bb(b5)').canonical, 'Bb(b5)');
  assert.equal(parseChord('C#(#11)').canonical, 'C#(#11)');
  assert.deepEqual(pitches('C(#5)'), [0,4,8]);
  assert.deepEqual(pitches('C#5'), [1,8], 'a sharp-root power chord stays distinct');
  for (const symbol of ['C(b5)', 'C(#5)', 'Bb(b5)', 'C(#11)', 'C(#5)/E']) {
    const original = parseChord(symbol);
    const selected = findVoicings(original).voicings[0];
    assert.ok(selected, symbol);
    const restored = inspectVoicing(original.canonical, selected.frets);
    assert.equal(restored.valid, true, `${symbol}: ${restored.reason}`);
    assert.deepEqual(restored.voicing.frets, selected.frets, symbol);
    assert.deepEqual(parseChord(original.canonical).bassPC, original.bassPC, symbol);
  }
});

test('canonical modifiers preserve repeated additions after alterations', () => {
  for (const symbol of ['C(add9,b9,add9)', 'C9(add9,b9,add9)', 'C11(add11,#11,add11)', 'C(add9,#9,add9,b9,add9)']) {
    const original = parseChord(symbol);
    const restored = parseChord(original.canonical);
    assert.deepEqual(restored.intervals, original.intervals, symbol);
    assert.equal(restored.canonical, original.canonical, symbol);
  }
  const original = parseChord('C(add9,b9,add9)');
  assert.deepEqual(original.intervals.filter(i => i.degree === 9).map(i => i.pc), [1,2]);
  const selected = findVoicings(original).voicings[0];
  assert.ok(selected);
  const restored = inspectVoicing(original.canonical, selected.frets);
  assert.equal(restored.valid, true, restored.reason);
  assert.deepEqual(restored.voicing.frets, selected.frets);
});

test('normalization never returns a chord name too long to reopen', () => {
  for (const quality of ['o', '°']) {
    const symbol = 'C' + quality + 'no5'.repeat(19);
    assert.ok(symbol.length <= 60);
    assert.throws(() => parseChord(symbol), /정리한 이름이 60자를 넘어요/);
  }
  const boundary = parseChord('Cdim' + 'no5'.repeat(18) + '/C');
  assert.equal(boundary.canonical.length, 60);
  assert.deepEqual(parseChord(boundary.canonical).intervals, boundary.intervals);
});

test('six-nine descriptions and required ninth remain distinct from dominant extensions', () => {
  assert.equal(parseChord('C6/9').description, '메이저 6/9');
  assert.equal(parseChord('Cm6/9').description, '마이너 6/9');
  assert.equal(parseChord('C9').description, '도미넌트 9');
  assert.equal(parseChord('C#6/9').intervals.find(i => i.degree === 9).optional, false);
  assert.equal(parseChord('C13').intervals.find(i => i.degree === 9).optional, true);
});

test('familiar playable grips lead recommendations instead of inverted fragments', () => {
  const cases = {
    C: [-1,3,2,0,1,0], D: [-1,-1,0,2,3,2], E: [0,2,2,1,0,0], G: [3,2,0,0,0,3], A: [-1,0,2,2,2,0],
    Dsus4: [-1,-1,0,2,3,3], Dsus2: [-1,-1,0,2,3,0], Gsus4: [3,3,0,0,1,3],
    C9: [-1,3,2,3,3,3], 'D/F#': [2,-1,0,2,3,2]
  };
  for (const [symbol, frets] of Object.entries(cases)) {
    const first = findVoicings(symbol).voicings[0];
    assert.deepEqual(first.frets, frets, symbol);
    assert.ok(first.soundingStrings >= 4, symbol);
    if (!symbol.includes('/')) assert.ok(first.rootBass, symbol);
  }
  assert.deepEqual(findVoicings('Csus47').voicings[0].frets, findVoicings('C7sus4').voicings[0].frets);
  assert.deepEqual(findVoicings('Dsus4').voicings[0].fingers, [0,0,0,1,3,4]);
});

test('ring-finger barres coexist with lower index notes, and finger spacing can skip a finger', () => {
  const ninth = inspectVoicing('C9', [-1,3,2,3,3,3]);
  assert.equal(ninth.valid, true);
  assert.deepEqual(ninth.voicing.barre, { fret: 3, start: 3, end: 5 });
  assert.deepEqual(ninth.voicing.fingers, [0,2,1,3,3,3]);
  assert.deepEqual(fingering([-1,3,5,5,-1,-1], false).fingers, [0,1,3,4,0,0]);
  assert.deepEqual(findVoicings('B').voicings[0].barre, { fret: 2, start: 1, end: 5 });
  assert.equal(fingering([1,2,3]), null);
  assert.equal(fingering([1,2,3,4,NaN,-1]), null);
});

test('saved voicings are inspected exactly, including pitch, bass and active filters', () => {
  const frets = [0,3,2,0,1,3];
  const saved = inspectVoicing('C', frets);
  assert.equal(saved.valid, true);
  assert.deepEqual(saved.voicing.frets, frets);
  assert.notEqual(saved.voicing.frets, frets, 'returns its own copy');
  assert.equal(inspectVoicing('C69', [-1,3,2,2,3,3]).valid, true);
  assert.equal(inspectVoicing('Cmaj9', [-1,3,2,4,3,0], { complete: true }).valid, false);
  assert.equal(inspectVoicing('Cmaj9', [-1,3,2,4,3,0]).voicing.omitted[0].name, 'G');
  assert.equal(inspectVoicing('C', [-1,3,2,0,1,1]).valid, false, 'foreign F is rejected');
  assert.equal(inspectVoicing('C/E', [-1,3,2,0,1,0]).valid, false, 'actual lowest note must be E');
  assert.equal(inspectVoicing('F', [1,3,3,2,1,1], { noBarre: true }).valid, false);
  assert.equal(inspectVoicing('C', [8,10,10,9,8,8], { maxFret: 5 }).valid, false);
  assert.equal(inspectVoicing('Cwrong', frets).valid, false);
  assert.equal(inspectVoicing('C', [null,3,2,0,1,0]).valid, false);
  assert.equal(inspectVoicing('C5', [-1,3,5,-1,-1,-1]).valid, true, 'two-note power chord is valid');
  // The open G string is below the fretted A string here: physical string order
  // alone must not decide a slash bass.
  const crossedRegister = [-1,12,14,0,13,12];
  assert.equal(inspectVoicing('Am7/A', crossedRegister, { maxFret: 15 }).valid, false);
  assert.equal(inspectVoicing('Am7/G', crossedRegister, { maxFret: 15 }).valid, true);
});

test('all 12 roots preserve independently specified tones and fingering invariants', t => {
  const roots = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
  const types = {
    '': [[0,4,7],[0,4,7]], m: [[0,3,7],[0,3,7]],
    '7': [[0,4,7,10],[0,4,10]], maj7: [[0,4,7,11],[0,4,11]], m7: [[0,3,7,10],[0,3,10]],
    m7b5: [[0,3,6,10],[0,3,6,10]], dim: [[0,3,6],[0,3,6]], dim7: [[0,3,6,9],[0,3,6,9]], aug: [[0,4,8],[0,4,8]],
    sus2: [[0,2,7],[0,2,7]], sus4: [[0,5,7],[0,5,7]], add9: [[0,4,7,2],[0,4,2]],
    '6': [[0,4,7,9],[0,4,9]], '6/9': [[0,4,7,9,2],[0,4,9,2]],
    '9': [[0,4,7,10,2],[0,4,10,2]], m9: [[0,3,7,10,2],[0,3,10,2]], maj9: [[0,4,7,11,2],[0,4,11,2]],
    '11': [[0,4,7,10,2,5],[0,4,10,5]], '13': [[0,4,7,10,2,5,9],[0,4,10,9]],
    '7b9': [[0,4,7,10,1],[0,4,10,1]], '7#9': [[0,4,7,10,3],[0,4,10,3]],
    '7#11': [[0,4,7,10,6],[0,4,10,6]], '7b13': [[0,4,7,10,8],[0,4,10,8]]
  };
  assert.deepEqual(TUNING, [40,45,50,55,59,64]);
  let checked = 0;
  const start = performance.now();
  for (const [rootPC, root] of roots.entries()) for (const [type, [formula, required]] of Object.entries(types)) {
    const symbol = root + type;
    const expected = [...new Set(formula.map(n => (n + rootPC) % 12))].sort((a,b) => a-b);
    assert.deepEqual(pitches(symbol), expected, symbol);
    const found = findVoicings(symbol);
    assert.ok(found.voicings.length > 0, symbol);
    const unique = new Set();
    for (const v of found.voicings) {
      checked++;
      assert.ok(!unique.has(v.frets.join(',')), `${symbol}: duplicate shape`);
      unique.add(v.frets.join(','));
      const pcs = new Set(v.frets.flatMap((f,s) => f < 0 ? [] : [([40,45,50,55,59,64][s] + f) % 12]));
      for (const pc of pcs) assert.ok(expected.includes(pc), `${symbol}: foreign tone ${pc}`);
      for (const pc of required.map(n => (n + rootPC) % 12)) assert.ok(pcs.has(pc), `${symbol}: missing required ${pc}`);
      assert.deepEqual(v.omitted.map(i => i.pc).sort((a,b) => a-b), expected.filter(pc => !pcs.has(pc)), symbol);
      assert.ok(v.maxFret <= 12 && v.maxFret - v.minFret <= 3, `${symbol}: position`);
      assert.ok(new Set(v.fingers.filter(n => n > 0)).size <= 4, `${symbol}: finger count`);
      for (let s = 0; s < 6; s++) {
        assert.ok(v.frets[s] <= 0 ? v.fingers[s] === 0 : v.fingers[s] >= 1 && v.fingers[s] <= 4, `${symbol}: finger at ${s}`);
      }
      if (v.barre) {
        const b = v.barre, finger = v.fingers[b.start];
        for (let s = b.start; s <= b.end; s++) {
          assert.ok(v.frets[s] >= b.fret, `${symbol}: blocked barre`);
          if (v.frets[s] === b.fret) assert.equal(v.fingers[s], finger);
        }
      }
      assert.equal(inspectVoicing(symbol, v.frets).valid, true, symbol);
    }
  }
  t.diagnostic(`${roots.length * Object.keys(types).length} chord spellings, ${checked} recommended voicings checked in ${Math.round(performance.now()-start)} ms`);
});
