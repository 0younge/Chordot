(function (scope) {
  'use strict';
  const TUNING = [40, 45, 50, 55, 59, 64];
  const NATURAL = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const LETTERS = 'CDEFGAB';
  const DEGREE = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11, 9: 14, 11: 17, 13: 21 };
  const mod = n => ((n % 12) + 12) % 12;
  const pretty = s => s.replace(/#/g, '♯').replace(/b/g, '♭');
  const notePC = name => mod(NATURAL[name[0].toUpperCase()] + [...name.slice(1)].reduce((n, a) => n + (a === '#' ? 1 : -1), 0));

  function spell(root, degree, semitones) {
    const letter = LETTERS[(LETTERS.indexOf(root[0]) + degree - 1) % 7];
    let diff = mod(notePC(root) + semitones - NATURAL[letter]);
    if (diff > 6) diff -= 12;
    return letter + (diff < 0 ? '♭'.repeat(-diff) : '♯'.repeat(diff));
  }

  function parseChord(input) {
    if (typeof input !== 'string' || input.length > 60) throw new Error('코드 이름을 60자 이내로 입력해 주세요.');
    let text = input.trim().replace(/\s/g, '').replace(/♯/g, '#').replace(/♭/g, 'b').replace(/[△Δ]/g, 'maj').replace(/[°º]/g, 'dim').replace(/[−–]/g, '-');
    if (!text) throw new Error('찾고 싶은 코드를 입력해 주세요.');
    const rootMatch = text.match(/^([A-Ga-g])([#b]{0,2})/);
    if (!rootMatch) throw new Error('C, D, E, F, G, A, B 중 하나로 시작해 주세요. 예: F#m7b5');
    const root = rootMatch[1].toUpperCase() + rootMatch[2];
    let suffix = text.slice(rootMatch[0].length);
    let bass = null;
    const bassMatch = suffix.match(/\/([A-Ga-g][#b]{0,2})$/);
    if (bassMatch) {
      bass = bassMatch[1][0].toUpperCase() + bassMatch[1].slice(1);
      suffix = suffix.slice(0, -bassMatch[0].length);
    }
    // Parentheses group modifiers; reject unmatched or nested groups.
    let depth = 0;
    for (const char of suffix) {
      if (char === '(' && ++depth > 1) throw new Error('괄호는 한 겹으로 묶어 주세요. 예: C7(b9,#11)');
      if (char === ')' && --depth < 0) throw new Error('코드의 괄호를 확인해 주세요.');
    }
    if (depth) throw new Error('코드의 괄호를 확인해 주세요.');
    suffix = suffix.replace(/[(),]/g, '').replace(/major|Maj|MAJ/g, 'maj').replace(/minor|min/gi, 'm').replace(/M(?=\d|$)/g, 'maj').replace(/-/g, 'm').replace(/6\/9/g, '69');
    if (/^ø7?$/.test(suffix)) suffix = 'm7b5';
    if (/^o(7)?/.test(suffix)) suffix = suffix.replace(/^o/, 'dim');
    let quality = '', extension = '', tail = '', majorSeventh = false;
    const minorMajor = suffix.match(/^mmaj(13|11|9|7)/);
    if (minorMajor) {
      quality = 'm'; extension = minorMajor[1]; majorSeventh = true; tail = suffix.slice(minorMajor[0].length);
    } else {
      const match = suffix.match(/^(maj|dim|aug|sus2|sus4|sus|m|\+)?(69|13|11|9|7|6|5)?/);
      quality = match[1] || ''; extension = match[2] || ''; tail = suffix.slice(match[0].length);
      majorSeventh = quality === 'maj';
    }
    if (quality === '+') quality = 'aug';
    if (quality === 'sus') quality = 'sus4';
    if (extension === '5' && quality) throw new Error('파워 코드는 C5처럼 입력해 주세요.');
    let intervals = [];
    function add(degree, alteration = 0) {
      const semitones = DEGREE[degree] + alteration;
      if (!intervals.some(i => i.degree === degree && i.semitones === semitones)) {
        intervals.push({ degree, semitones, alteration });
      }
    }
    add(1);
    if (extension !== '5') {
      if (quality === 'sus2') add(2);
      else if (quality === 'sus4') add(4);
      else add(3, quality === 'm' || quality === 'dim' ? -1 : 0);
    }
    add(5, quality === 'dim' ? -1 : quality === 'aug' ? 1 : 0);
    const ext = Number(extension);
    if ([7, 9, 11, 13].includes(ext)) add(7, majorSeventh ? 0 : quality === 'dim' ? -2 : -1);
    if ([9, 11, 13].includes(ext)) add(9);
    if ([11, 13].includes(ext)) add(11);
    if (ext === 13) add(13);
    if (ext === 6 || ext === 69) add(6);
    if (ext === 69) add(9);
    const explicitDegrees = new Set();
    while (tail) {
      const modifier = tail.match(/^(add([#b]?)(13|11|9|6|4|2)|(?:no|omit)(3|5)|sus(2|4)?|([#b])(13|11|9|5))/);
      if (!modifier) throw new Error('아직 지원하지 않는 표기예요. 예: Cmaj9, F#m7b5, G7(b9), C/E');
      if (modifier[0].startsWith('add')) {
        const d = Number(modifier[3]);
        add(d, modifier[2] === '#' ? 1 : modifier[2] === 'b' ? -1 : 0);
        explicitDegrees.add(d);
      } else if (modifier[4]) {
        intervals = intervals.filter(i => i.degree !== Number(modifier[4]));
      } else if (modifier[0].startsWith('sus')) {
        intervals = intervals.filter(i => ![2, 3, 4].includes(i.degree));
        add(Number(modifier[5] || 4));
      } else {
        const d = Number(modifier[7]);
        intervals = intervals.filter(i => !(i.degree === d && i.alteration === 0));
        add(d, modifier[6] === '#' ? 1 : -1);
        explicitDegrees.add(d);
      }
      tail = tail.slice(modifier[0].length);
    }
    const rootPC = notePC(root);
    intervals.sort((a, b) => a.degree - b.degree || a.semitones - b.semitones);
    intervals = intervals.map(i => ({ ...i,
      pc: mod(rootPC + i.semitones),
      name: spell(root, i.degree, i.semitones),
      label: i.degree === 1 ? 'R' : (i.alteration < 0 ? '♭'.repeat(-i.alteration) : '♯'.repeat(i.alteration)) + i.degree,
      optional: i.alteration === 0 && !explicitDegrees.has(i.degree) &&
        ((i.degree === 5 && intervals.length > 3) || (i.degree === 9 && ext > 9) || (i.degree === 11 && ext === 13))
    }));
    const description = extension === '5' ? '파워 코드' :
      (quality === 'm' ? '마이너' : quality === 'dim' ? '디미니시드' : quality === 'aug' ? '어그먼티드' : quality.startsWith('sus') ? '서스펜디드' : majorSeventh ? '메이저' : ext >= 7 ? '도미넌트' : '메이저') +
      (ext && ext !== 69 ? ` ${ext}` : ext === 69 ? ' 6/9' : '') + (majorSeventh && quality === 'm' ? ' · 메이저 7 포함' : '');
    const canonical = root + suffix + (bass ? '/' + bass : '');
    return { input, root, rootPC, bass, bassPC: bass ? notePC(bass) : null, canonical,
      name: pretty(canonical.replace('69', '6/9')), description, intervals };
  }

  // Conservative fingering: each note uses one finger, or one straight barre
  // plus individual fingers. A barre never crosses an open, muted, or lower note.
  function fingering(frets, allowBarre = true) {
    const pressed = frets.map((f, s) => ({ f, s })).filter(n => n.f > 0);
    const solutions = [];
    if (pressed.length <= 4) solutions.push({ barre: null, groups: pressed.map(n => [n]) });
    if (allowBarre) for (const fret of [...new Set(pressed.map(n => n.f))]) {
      for (let start = 0; start < 5; start++) for (let end = start + 1; end < 6; end++) {
        if (frets[start] !== fret || frets[end] !== fret) continue;
        if (frets.slice(start, end + 1).some(f => f < fret)) continue;
        const covered = pressed.filter(n => n.f === fret && n.s >= start && n.s <= end);
        const rest = pressed.filter(n => !covered.includes(n));
        if (rest.length + 1 > 4) continue;
        // The barre is assigned the index finger; lower fretted notes cannot coexist.
        if (rest.some(n => n.f < fret)) continue;
        solutions.push({ barre: { fret, start, end }, groups: [covered, ...rest.map(n => [n])] });
      }
    }
    if (!solutions.length) return null;
    solutions.sort((a, b) => (a.groups.length + (a.barre ? 0.8 : 0)) - (b.groups.length + (b.barre ? 0.8 : 0)));
    const best = solutions[0];
    if (!best.barre) best.groups.sort((a, b) => a[0].f - b[0].f || a[0].s - b[0].s);
    else best.groups = [best.groups[0], ...best.groups.slice(1).sort((a, b) => a[0].f - b[0].f || a[0].s - b[0].s)];
    const fingers = Array(6).fill(0);
    best.groups.forEach((group, i) => group.forEach(n => { fingers[n.s] = i + 1; }));
    return { fingers, barre: best.barre, count: best.groups.length };
  }

  const familiar = {
    C: [-1,3,2,0,1,0], D: [-1,-1,0,2,3,2], E: [0,2,2,1,0,0], G: [3,2,0,0,0,3], A: [-1,0,2,2,2,0],
    Am: [-1,0,2,2,1,0], Em: [0,2,2,0,0,0], Dm: [-1,-1,0,2,3,1], F: [1,3,3,2,1,1],
    Cmaj7: [-1,3,2,0,0,0], Cmaj9: [-1,3,2,4,3,0], Cadd9: [-1,3,2,0,3,0],
    G7: [3,2,0,0,0,1], D7: [-1,-1,0,2,1,2], A7: [-1,0,2,0,2,0], E7: [0,2,0,1,0,0],
    'D/F#': [2,-1,0,2,3,2], 'C/E': [0,3,2,0,1,0]
  };

  function findVoicings(chord, options = {}) {
    if (typeof chord === 'string') chord = parseChord(chord);
    const maxFret = Math.min(15, Math.max(3, Number(options.maxFret) || 12));
    const span = Math.min(4, Math.max(2, Number(options.span) || 3));
    const allowBarre = !options.noBarre;
    const allMask = chord.intervals.reduce((m, i) => m | (1 << i.pc), 0);
    const requiredMask = chord.intervals.filter(i => options.complete || !i.optional).reduce((m, i) => m | (1 << i.pc), 0);
    const allowedMask = allMask | (chord.bassPC === null ? 0 : (1 << chord.bassPC));
    const found = new Map();
    let examined = 0;
    const frets = Array(6).fill(-1);

    function accept(mask, count) {
      if (count < 3 || (mask & requiredMask) !== requiredMask) return;
      const key = frets.join(',');
      if (found.has(key)) return;
      const midi = frets.map((f, s) => f < 0 ? null : TUNING[s] + f);
      const lowest = Math.min(...midi.filter(n => n !== null));
      if (chord.bassPC !== null && mod(lowest) !== chord.bassPC) return;
      const grip = fingering(frets, allowBarre);
      if (!grip) return;
      const positive = frets.filter(f => f > 0);
      const min = positive.length ? Math.min(...positive) : 0;
      const max = Math.max(0, ...positive);
      const first = frets.findIndex(f => f >= 0);
      const last = frets.findLastIndex(f => f >= 0);
      const innerMutes = frets.slice(first, last + 1).filter(f => f < 0).length;
      // Keep strummable shapes; isolated interior mutes require targeted picking.
      if (innerMutes > 1) return;
      const omitted = chord.intervals.filter(i => !(mask & (1 << i.pc)));
      const rootBass = mod(lowest) === chord.rootPC;
      const score = omitted.length * 18 + (max - min) * 1.5 + min * 0.55 + grip.count * 0.8 +
        (grip.barre ? 2.4 + (grip.barre.end - grip.barre.start) * 0.3 : 0) +
        innerMutes * 7 + (rootBass || chord.bass ? 0 : 4) + (6 - count) * 0.8 - frets.filter(f => f === 0).length * 0.6;
      const known = familiar[chord.canonical];
      const preferred = known && known.join(',') === key;
      found.set(key, { frets: [...frets], midi, ...grip, omitted, minFret: min, maxFret: max,
        bassPC: mod(lowest), rootBass, innerMutes, score: score - (preferred ? 12 : 0), familiar: Boolean(preferred),
        difficulty: grip.barre || max - min > 2 || innerMutes ? '도전' : grip.count <= 3 && min <= 5 ? '쉬움' : '보통' });
    }

    for (let start = 1; start <= maxFret; start++) {
      const end = Math.min(start + span, maxFret);
      const candidates = TUNING.map(open => {
        const notes = [-1];
        if (allowedMask & (1 << mod(open))) notes.push(0);
        for (let f = start; f <= end; f++) if (allowedMask & (1 << mod(open + f))) notes.push(f);
        return notes;
      });
      const possible = Array(7).fill(0);
      for (let s = 5; s >= 0; s--) possible[s] = possible[s + 1] | candidates[s].reduce((m, f) => f < 0 ? m : m | (1 << mod(TUNING[s] + f)), 0);
      function visit(s, mask, count) {
        if (((mask | possible[s]) & requiredMask) !== requiredMask) return;
        if (s === 6) { examined++; accept(mask, count); return; }
        for (const f of candidates[s]) {
          frets[s] = f;
          visit(s + 1, f < 0 ? mask : mask | (1 << mod(TUNING[s] + f)), count + (f >= 0 ? 1 : 0));
        }
      }
      visit(0, 0, 0);
    }
    const sorted = [...found.values()].sort((a, b) => a.score - b.score || a.minFret - b.minFret || a.frets.join(',').localeCompare(b.frets.join(',')));
    // Select distinct grips first, then fill remaining places. All results are still valid.
    const selected = [];
    for (const candidate of sorted) {
      if (selected.length >= 24) break;
      if (selected.every(other => candidate.frets.filter((f, s) => f !== other.frets[s]).length >= 2)) selected.push(candidate);
    }
    for (const candidate of sorted) {
      if (selected.length >= 24) break;
      if (!selected.includes(candidate)) selected.push(candidate);
    }
    selected.sort((a, b) => a.score - b.score);
    return { voicings: selected, total: sorted.length, examined };
  }

  const api = { parseChord, findVoicings, fingering, TUNING, mod, notePC };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  scope.VoicingMusic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
