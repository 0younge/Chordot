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
    if (/[△Δ](?!\s*\d)/.test(input)) throw new Error('△ 표기는 C△7 또는 C△9처럼 숫자까지 적어 주세요.');
    let text = input.trim().replace(/\s/g, '').replace(/♯/g, '#').replace(/♭/g, 'b').replace(/[△Δ]/g, 'maj').replace(/[°º]/g, 'dim').replace(/[−–]/g, '-');
    if (!text) throw new Error('찾고 싶은 코드를 입력해 주세요.');
    const rootMatch = text.match(/^([A-Ga-g])(##|bb|#|b)?/);
    if (!rootMatch) throw new Error('C, D, E, F, G, A, B 중 하나로 시작해 주세요. 예: F#m7b5');
    const root = rootMatch[1].toUpperCase() + (rootMatch[2] || '');
    let suffix = text.slice(rootMatch[0].length);
    let bass = null;
    const bassMatch = suffix.match(/\/([A-Ga-g](?:##|bb|#|b)?)$/);
    if (bassMatch) {
      bass = bassMatch[1][0].toUpperCase() + bassMatch[1].slice(1);
      suffix = suffix.slice(0, -bassMatch[0].length);
    }
    // Only complete, nonempty groups are discarded; malformed punctuation must
    // never turn a typo into a different, apparently valid chord.
    let depth = 0;
    for (const char of suffix) {
      if (char === '(' && ++depth > 1) throw new Error('괄호는 한 겹으로 묶어 주세요. 예: C7(b9,#11)');
      if (char === ')' && --depth < 0) throw new Error('코드의 괄호를 확인해 주세요.');
    }
    if (depth) throw new Error('코드의 괄호를 확인해 주세요.');
    if (/\(\)|,,|\(,|,\)|,$|^,/.test(suffix)) throw new Error('빈 괄호나 쉼표를 확인해 주세요. 예: C7(b9,#11)');
    suffix = suffix.replace(/[(),]/g, '').replace(/major|maj/gi, 'maj').replace(/minor|min/gi, 'm').replace(/M(?=\d|$)/g, 'maj').replace(/-5/g, 'b5').replace(/^-/, 'm').replace(/6\/9/g, '69');
    suffix = suffix.replace(/^(?:ø|Ø)(13|11|9|7)?/, (_, ext) => 'm' + (ext || '7') + 'b5');
    if (/^o(7|9|11|13)?/.test(suffix)) suffix = suffix.replace(/^o/, 'dim');
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
    const omittedDegrees = new Set();
    const canonicalModifiers = [];
    let suspension = quality.startsWith('sus') ? Number(quality.slice(3)) : null;
    while (tail) {
      const modifier = tail.match(/^(add([#b]?)(13|11|9|6|4|2)|(?:no|omit)(3|5)|sus(2|4)?|([#b])(13|11|9|5))/);
      if (!modifier) throw new Error('아직 지원하지 않는 표기예요. 예: Cmaj9, F#m7b5, G7(b9), C/E');
      if (modifier[0].startsWith('add')) {
        const d = Number(modifier[3]);
        if (omittedDegrees.has(d)) throw new Error('같은 음을 추가하고 생략할 수 없어요. 코드 표기를 확인해 주세요.');
        add(d, modifier[2] === '#' ? 1 : modifier[2] === 'b' ? -1 : 0);
        explicitDegrees.add(d);
        canonicalModifiers.push('add' + modifier[2] + d);
      } else if (modifier[4]) {
        const degree = Number(modifier[4]);
        if (explicitDegrees.has(degree)) throw new Error('같은 음을 바꾸고 생략할 수 없어요. 코드 표기를 확인해 주세요.');
        intervals = intervals.filter(i => i.degree !== degree);
        omittedDegrees.add(degree);
        canonicalModifiers.push('no' + degree);
      } else if (modifier[0].startsWith('sus')) {
        const degree = Number(modifier[5] || 4);
        if (extension === '5') throw new Error('sus 코드는 Csus4처럼 입력해 주세요.');
        if (suspension !== null && suspension !== degree) throw new Error('sus2와 sus4 중 하나를 골라 주세요. 두 음을 원하면 sus2(add4)로 입력해 주세요.');
        if (['m', 'dim'].includes(quality) || omittedDegrees.has(3)) throw new Error('sus는 3도를 대신해요. C7sus4 또는 Cm7(add11)처럼 구분해서 입력해 주세요.');
        intervals = intervals.filter(i => i.degree !== 3);
        add(degree);
        suspension = degree;
      } else {
        const d = Number(modifier[7]);
        if (omittedDegrees.has(d)) throw new Error('같은 음을 바꾸고 생략할 수 없어요. 코드 표기를 확인해 주세요.');
        intervals = intervals.filter(i => !(i.degree === d && i.alteration === 0));
        add(d, modifier[6] === '#' ? 1 : -1);
        explicitDegrees.add(d);
        canonicalModifiers.push(modifier[6] + d);
      }
      tail = tail.slice(modifier[0].length);
    }
    const rootPC = notePC(root);
    if (new Set(intervals.map(i => mod(i.semitones))).size < 2) throw new Error('코드를 표현하려면 서로 다른 음이 두 개 이상 필요해요.');
    intervals.sort((a, b) => a.degree - b.degree || a.semitones - b.semitones);
    intervals = intervals.map(i => ({ ...i,
      pc: mod(rootPC + i.semitones),
      name: spell(root, i.degree, i.semitones),
      label: i.degree === 1 ? 'R' : (i.alteration < 0 ? '♭'.repeat(-i.alteration) : '♯'.repeat(i.alteration)) + i.degree,
      optional: i.alteration === 0 && !explicitDegrees.has(i.degree) &&
        ((i.degree === 5 && intervals.length > 3) || (i.degree === 9 && [11,13].includes(ext)) || (i.degree === 11 && ext === 13))
    }));
    const description = extension === '5' ? '파워 코드' :
      (suspension ? '서스펜디드' : quality === 'm' ? '마이너' : quality === 'dim' ? '디미니시드' : quality === 'aug' ? '어그먼티드' : majorSeventh ? '메이저' : [7,9,11,13].includes(ext) ? '도미넌트' : '메이저') +
      (ext && ext !== 69 ? ` ${ext}` : ext === 69 ? ' 6/9' : '') + (majorSeventh && quality === 'm' ? ' · 메이저 7 포함' : '');
    // Normalize equivalent spellings so saved chords and known grips agree.
    let canonicalQuality = quality;
    if (quality.startsWith('sus')) canonicalQuality = '';
    if (quality === 'maj' && ![7,9,11,13].includes(ext)) canonicalQuality = '';
    if (quality === 'm' && majorSeventh) canonicalQuality = 'mmaj';
    const canonicalSuffix = canonicalQuality + (extension === '69' ? '6/9' : extension) +
      (suspension ? 'sus' + suspension : '');
    // A leading alteration needs a boundary from the root: C(b5) is not Cb5.
    // Keep modifier order and repetitions: add9,b9,add9 restores the natural 9.
    const modifiers = canonicalModifiers.join('');
    const canonical = root + canonicalSuffix + (!canonicalSuffix && /^[#b]/.test(modifiers) ? `(${modifiers})` : modifiers) + (bass ? '/' + bass : '');
    if (canonical.length > 60) throw new Error('코드 표기를 정리한 이름이 60자를 넘어요. 반복되는 표기를 줄여 주세요.');
    return { input, root, rootPC, bass, bassPC: bass ? notePC(bass) : null, canonical,
      name: pretty(canonical), description, intervals };
  }

  // Conservative fingering: four fingers and at most one straight barre. A barre
  // never crosses an open, muted, or lower note. Its finger need not be the index:
  // a ring-finger barre above an index note is essential for grips such as C9.
  function fingering(frets, allowBarre = true) {
    if (!Array.isArray(frets) || frets.length !== 6 || frets.some(f => !Number.isInteger(f) || f < -1 || f > 24)) return null;
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
        solutions.push({ barre: { fret, start, end }, groups: [covered, ...rest.map(n => [n])] });
      }
    }
    if (!solutions.length) return null;
    for (const solution of solutions) {
      solution.groups.sort((a, b) => a[0].f - b[0].f || a[0].s - b[0].s);
      let bestNumbers = [], bestCost = Infinity;
      function assign(numbers, next) {
        if (numbers.length === solution.groups.length) {
          let cost = numbers.length ? (numbers[0] - 1) * 2 : 0;
          for (let i = 1; i < numbers.length; i++) {
            const fretsApart = solution.groups[i][0].f - solution.groups[i - 1][0].f;
            const fingersApart = numbers[i] - numbers[i - 1];
            cost += Math.max(0, fretsApart - fingersApart) * 3 + Math.max(0, fingersApart - Math.max(1, fretsApart)) * 0.3;
          }
          if (cost < bestCost) { bestCost = cost; bestNumbers = numbers; }
          return;
        }
        for (let finger = next; finger <= 4; finger++) assign([...numbers, finger], finger + 1);
      }
      assign([], 1);
      solution.numbers = bestNumbers;
      let barreCost = 0;
      if (solution.barre) {
        const barreIndex = solution.groups.findIndex(group => group.length > 1);
        const finger = bestNumbers[barreIndex];
        barreCost = 0.65 + (solution.barre.end - solution.barre.start) * 0.08 + (finger - 1) * 2 + (finger === 4 ? 1 : 0);
      }
      solution.cost = bestCost + solution.groups.length * 0.75 + barreCost;
    }
    solutions.sort((a, b) => a.cost - b.cost);
    const best = solutions[0], fingers = Array(6).fill(0);
    best.groups.forEach((group, i) => group.forEach(n => { fingers[n.s] = best.numbers[i]; }));
    return { fingers, barre: best.barre, count: best.groups.length };
  }

  const familiar = {
    C: [-1,3,2,0,1,0], D: [-1,-1,0,2,3,2], E: [0,2,2,1,0,0], G: [3,2,0,0,0,3], A: [-1,0,2,2,2,0],
    Am: [-1,0,2,2,1,0], Em: [0,2,2,0,0,0], Dm: [-1,-1,0,2,3,1], F: [1,3,3,2,1,1],
    Cmaj7: [-1,3,2,0,0,0], Cmaj9: [-1,3,2,4,3,0], Cadd9: [-1,3,2,0,3,0],
    G7: [3,2,0,0,0,1], D7: [-1,-1,0,2,1,2], A7: [-1,0,2,0,2,0], E7: [0,2,0,1,0,0],
    'D/F#': [2,-1,0,2,3,2], 'C/E': [0,3,2,0,1,0],
    B: [-1,2,4,4,4,2], Bm: [-1,2,4,4,3,2], Cm: [-1,3,5,5,4,3], Fm: [1,3,3,1,1,1], Gm: [3,5,5,3,3,3],
    Dsus4: [-1,-1,0,2,3,3], Dsus2: [-1,-1,0,2,3,0], Asus2: [-1,0,2,2,0,0], Asus4: [-1,0,2,2,3,0],
    Esus4: [0,2,2,2,0,0], Esus2: [0,2,4,4,0,0], Gsus4: [3,3,0,0,1,3], Gsus2: [3,0,0,0,3,3],
    Csus2: [-1,3,0,0,1,3], Csus4: [-1,3,3,0,1,1],
    Dmaj7: [-1,-1,0,2,2,2], Emaj7: [0,2,1,1,0,0], Fmaj7: [-1,-1,3,2,1,0], Gmaj7: [3,2,0,0,0,2], Amaj7: [-1,0,2,1,2,0],
    Am7: [-1,0,2,0,1,0], Em7: [0,2,0,0,0,0], Dm7: [-1,-1,0,2,1,1], Bm7: [-1,2,4,2,3,2], B7: [-1,2,1,2,0,2],
    C6: [-1,3,2,2,1,0], A6: [-1,0,2,2,2,2], D6: [-1,-1,0,2,0,2], E6: [0,2,2,1,2,0], 'C6/9': [-1,3,2,2,3,3],
    C9: [-1,3,2,3,3,3], D9: [-1,5,4,5,5,5], E9: [-1,7,6,7,7,7],
    C13: [-1,3,2,3,3,5], G13: [3,-1,3,4,5,5]
  };

  const chordSignature = chord => [chord.rootPC, chord.bassPC, [...new Set(chord.intervals.map(i => i.pc))].sort((a,b) => a-b).join(',')].join('|');
  const familiarByNotes = new Map(Object.entries(familiar).map(([symbol, frets]) => [chordSignature(parseChord(symbol)), frets.join(',')]));
  // These authored fingerings keep familiar transitions (D -> Dsus4, for example)
  // instead of needlessly moving the ring finger to another string.
  const familiarFingers = {
    A: [0,0,1,2,3,0], Dsus4: [0,0,0,1,3,4], Dsus2: [0,0,0,1,3,0], Gsus4: [2,3,0,0,1,4]
  };
  const fingersByNotes = new Map(Object.entries(familiarFingers).map(([symbol, fingers]) => [chordSignature(parseChord(symbol)), fingers]));

  function settings(options = {}) {
    options = options && typeof options === 'object' ? options : {};
    const max = Number(options.maxFret), spread = Number(options.span);
    return {
      maxFret: Number.isFinite(max) && max > 0 ? Math.min(15, Math.max(3, Math.floor(max))) : 12,
      span: Number.isFinite(spread) && spread > 0 ? Math.min(4, Math.max(2, Math.floor(spread))) : 3,
      noBarre: Boolean(options.noBarre), complete: Boolean(options.complete)
    };
  }

  function inspectVoicing(chord, frets, options = {}) {
    const invalid = reason => ({ valid: false, voicing: null, reason });
    try { if (typeof chord === 'string') chord = parseChord(chord); }
    catch (error) { return invalid(error.message); }
    if (!chord || !Array.isArray(chord.intervals)) return invalid('코드 정보를 확인해 주세요.');
    const config = settings(options);
    if (!Array.isArray(frets) || frets.length !== 6 || frets.some(f => !Number.isInteger(f) || f < -1 || f > 15)) return invalid('표준 기타의 여섯 줄과 0–15프렛으로 된 운지가 필요해요.');
    const midi = frets.map((f, s) => f < 0 ? null : TUNING[s] + f);
    const sounding = midi.filter(n => n !== null), count = sounding.length;
    if (count < (chord.intervals.length === 2 ? 2 : 3)) return invalid('코드를 표현하기에 울리는 줄이 부족해요.');
    const pcs = new Set(sounding.map(mod));
    const allowed = new Set(chord.intervals.map(i => i.pc));
    if (chord.bassPC !== null) allowed.add(chord.bassPC);
    if ([...pcs].some(pc => !allowed.has(pc))) return invalid('이 운지에 코드 구성음이 아닌 음이 들어 있어요.');
    const omitted = chord.intervals.filter(i => !pcs.has(i.pc));
    if (omitted.some(i => config.complete || !i.optional)) return invalid('이 운지에 필요한 구성음이 빠져 있어요.');
    const lowest = Math.min(...sounding), bassPC = mod(lowest);
    if (chord.bassPC !== null && bassPC !== chord.bassPC) return invalid('가장 낮은 음이 지정된 슬래시 베이스와 달라요.');
    const positive = frets.filter(f => f > 0);
    const min = positive.length ? Math.min(...positive) : 0, max = Math.max(0, ...positive);
    if (max > config.maxFret) return invalid('이 운지가 설정한 프렛 범위를 넘어가요.');
    if (max - min > config.span) return invalid('이 운지가 설정한 손가락 벌림을 넘어가요.');
    const first = frets.findIndex(f => f >= 0), last = frets.findLastIndex(f => f >= 0);
    const innerMutes = frets.slice(first, last + 1).filter(f => f < 0).length;
    if (innerMutes > 1) return invalid('가운데 뮤트가 여러 개라 현재의 보수적인 운지 기준에서 제외돼요.');
    let grip = fingering(frets, !config.noBarre);
    if (!grip) return invalid(config.noBarre ? '바레 없이 네 손가락으로 잡을 수 있는 제안을 찾지 못했어요.' : '네 손가락과 바레 하나로 잡을 수 있는 제안을 찾지 못했어요.');
    const rootBass = bassPC === chord.rootPC;
    const preferred = familiarByNotes.get(chordSignature(chord)) === frets.join(',');
    const familiarHand = preferred ? fingersByNotes.get(chordSignature(chord)) : null;
    if (familiarHand) grip = { fingers: [...familiarHand], barre: null, count: new Set(familiarHand.filter(n => n > 0)).size };
    const openCount = frets.filter(f => f === 0).length;
    const score = omitted.reduce((n, i) => n + (i.degree === 5 ? 5 : 7), 0) + (max - min) * 1.3 + min * 0.45 + grip.count * 0.75 +
      (grip.barre ? 2.4 + (grip.barre.end - grip.barre.start) * 0.3 : 0) + innerMutes * 8 +
      (rootBass || chord.bass !== null ? 0 : 15) + Math.max(0, 4 - count) * 9 - Math.max(0, count - 4) * 0.45 - openCount * 0.15 - (preferred ? 19 : 0);
    const voicing = { frets: [...frets], midi, ...grip, omitted, minFret: min, maxFret: max, bassPC, rootBass, innerMutes, score,
      familiar: preferred, soundingStrings: count,
      difficulty: (grip.barre && grip.barre.end - grip.barre.start >= 3) || max - min > 2 || innerMutes ? '도전' : !grip.barre && grip.count <= 3 && min <= 5 ? '쉬움' : '보통' };
    return { valid: true, voicing, reason: null };
  }

  function findVoicings(chord, options = {}) {
    if (typeof chord === 'string') chord = parseChord(chord);
    const config = settings(options), { maxFret, span } = config;
    const allMask = chord.intervals.reduce((m, i) => m | (1 << i.pc), 0);
    const requiredMask = chord.intervals.filter(i => config.complete || !i.optional).reduce((m, i) => m | (1 << i.pc), 0);
    const allowedMask = allMask | (chord.bassPC === null ? 0 : (1 << chord.bassPC));
    const found = new Map();
    const seen = new Set();
    let examined = 0;
    const frets = Array(6).fill(-1);

    function accept(mask, count) {
      if (count < (chord.intervals.length === 2 ? 2 : 3) || (mask & requiredMask) !== requiredMask) return;
      const key = frets.join(',');
      if (seen.has(key)) return;
      seen.add(key);
      const inspected = inspectVoicing(chord, frets, config);
      if (inspected.valid) found.set(key, inspected.voicing);
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

  const api = { parseChord, findVoicings, inspectVoicing, fingering, TUNING, mod, notePC };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  scope.VoicingMusic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
