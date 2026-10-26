(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const music = window.VoicingMusic;
  const STORAGE = 'voicing-saved-v1';
  const escapeHTML = text => String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  let chord = null, result = null, activeIndex = 0, visibleCount = 3, requestId = 0, worker = null;
  let saved = [], toastTimeout, playTimeout, audioContext, playingNodes = [];
  let storageAvailable = true, currentOptions = {};
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE) || '[]');
    if (Array.isArray(raw)) saved = raw.filter(item => {
      try {
        music.parseChord(item.chord);
        return Array.isArray(item.frets) && item.frets.length === 6 && item.frets.every(f => Number.isInteger(f) && f >= -1 && f <= 15);
      } catch { return false; }
    }).slice(0, 150);
  } catch { storageAvailable = false; }
  function toast(message) {
    $('#toast').textContent = message;
    $('#toast').classList.add('visible');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => $('#toast').classList.remove('visible'), 3200);
  }
  function options() {
    return { noBarre: $('#no-barre').checked, complete: $('#complete').checked, maxFret: Number($('#max-fret').value), span: Number($('#span').value) };
  }
  function setOptions(value = {}) {
    $('#no-barre').checked = Boolean(value.noBarre);
    $('#complete').checked = Boolean(value.complete);
    $('#max-fret').value = [5,9,12,15].includes(Number(value.maxFret)) ? String(value.maxFret) : '12';
    $('#span').value = [2,3,4].includes(Number(value.span)) ? String(value.span) : '3';
  }
  function noteName(pc, parsed = chord) {
    const tone = parsed.intervals.find(i => i.pc === pc);
    if (tone) return tone.name;
    if (parsed.bassPC === pc) return parsed.bass.replace(/#/g, '♯').replace(/b/g, '♭');
    return ['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'][pc];
  }

  function diagram(voicing, parsed, mini = false) {
    const base = voicing.maxFret <= 4 ? 1 : Math.max(1, voicing.minFret);
    const rows = Math.max(4, voicing.maxFret - base + 1);
    const x = s => 45 + s * 32;
    const top = 49, rowHeight = 39;
    const bottom = top + rows * rowHeight;
    const height = bottom + 76;
    const y = f => top + (f - base + 0.5) * rowHeight;
    let svg = `<svg class="chord-diagram${mini ? ' mini-diagram' : ''}" viewBox="0 0 250 ${height}" role="img" aria-label="${escapeHTML(parsed.name)} 운지, 6번 줄부터 ${voicing.frets.map(f => f < 0 ? '뮤트' : f === 0 ? '개방' : f + '프렛').join(', ')}">`;
    svg += `<text x="19" y="${top + 24}" font-size="11" fill="#929987" text-anchor="middle">${base}</text>`;
    for (let f = 0; f <= rows; f++) svg += `<path d="M45 ${top + f * rowHeight}H205" stroke="${f === 0 && base === 1 ? '#404a38' : '#cfd4c4'}" stroke-width="${f === 0 && base === 1 ? 5 : 1.3}"/>`;
    for (let s = 0; s < 6; s++) svg += `<path d="M${x(s)} ${top}V${bottom}" stroke="#b6bfa9" stroke-width="${1.65 - s * 0.15}"/>`;
    for (let f = base; f < base + rows; f++) if ([3,5,7,9,12,15].includes(f)) {
      svg += `<circle cx="125" cy="${y(f)}" r="3" fill="#e5e8dd"/>`;
      if (f === 12) svg += `<circle cx="157" cy="${y(f)}" r="3" fill="#e5e8dd"/>`;
    }
    if (voicing.barre) {
      const bar = voicing.barre;
      svg += `<path d="M${x(bar.start)} ${y(bar.fret)}H${x(bar.end)}" stroke="#647453" stroke-width="18" stroke-linecap="round"/>`;
    }
    voicing.frets.forEach((f, s) => {
      const pc = f < 0 ? null : (music.TUNING[s] + f) % 12;
      const root = pc === parsed.rootPC;
      if (f < 0) svg += `<path d="m${x(s)-4} 24 8 8m-8 0 8-8" stroke="#9aa38d" stroke-width="1.7" stroke-linecap="round"/>`;
      else if (f === 0) svg += `<circle cx="${x(s)}" cy="28" r="5" fill="none" stroke="${root ? '#c8542d' : '#68755c'}" stroke-width="1.6"/>`;
      else {
        svg += `<circle cx="${x(s)}" cy="${y(f)}" r="11" fill="${root ? '#c8542d' : '#36432f'}"/>`;
        svg += `<text x="${x(s)}" y="${y(f) + 4}" text-anchor="middle" font-size="11" font-weight="600" fill="#fffefa">${voicing.fingers[s]}</text>`;
      }
      svg += `<text x="${x(s)}" y="${bottom + 24}" text-anchor="middle" font-size="11" fill="${f < 0 ? '#b3b9a9' : root ? '#c8542d' : '#536247'}">${f < 0 ? '–' : escapeHTML(noteName(pc, parsed))}</text>`;
      svg += `<text x="${x(s)}" y="${bottom + 43}" text-anchor="middle" font-size="9" fill="#a3aa96">${6-s}</text>`;
    });
    return svg + '</svg>';
  }

  function savedKey(name, frets) { return name + '|' + frets.join(','); }
  function isSaved(v) { return saved.some(s => savedKey(s.chord, s.frets) === savedKey(chord.canonical, v.frets)); }
  function position(v) { return v.maxFret === 0 ? '개방현' : `${v.minFret}–${v.maxFret}프렛`; }
  function titleHTML(parsed) {
    return `<div class="result-header"><div><p class="result-eyebrow">YOUR NEXT CHORD</p><h2 class="chord-title">${escapeHTML(parsed.name)}</h2><p class="chord-description">${escapeHTML(parsed.description)}${parsed.bass ? ' · 베이스 ' + escapeHTML(noteName(parsed.bassPC, parsed)) : ''}</p></div>${result ? `<span class="result-total">${result.total.toLocaleString()}개 후보 중 추천</span>` : ''}</div>`;
  }

  function renderResults() {
    if (!chord || !result) return;
    const container = $('#result-content');
    const v = result.voicings[activeIndex];
    if (!v) {
      const tooMany = currentOptions.complete && new Set(chord.intervals.map(i => i.pc).concat(chord.bassPC === null ? [] : [chord.bassPC])).size > 6;
      container.innerHTML = titleHTML(chord) + `<div class="empty-result"><div class="empty-icon">⌁</div><h3>조건에 맞는 운지가 없어요.</h3><p>${tooMany ? '필요한 음이 여섯 개를 넘어서 기타 여섯 줄에 모두 담을 수 없어요. ‘구성음 모두 포함’을 끄면 생략 가능한 음을 덜어낸 운지를 찾아요.' : '찾아볼 프렛을 늘리거나 바레·구성음 조건을 풀어 보세요. 현재 탐색 범위와 손가락 조건 안에서는 가능한 모양을 찾지 못했어요.'}</p><button id="relax-filters" class="secondary-button">조건 넓혀서 다시 찾기 ${icon('arrow')}</button></div>`;
      $('#relax-filters').addEventListener('click', () => { setOptions({ maxFret: 15, span: 4 }); search(chord.canonical); });
      return;
    }
    const savedState = isSaved(v);
    const missing = new Set(v.omitted.map(i => i.pc));
    const tonePills = chord.intervals.map(i => `<div class="note-pill${i.degree === 1 ? ' root' : ''}${missing.has(i.pc) ? ' omitted' : ''}" title="${escapeHTML(i.name)} · ${escapeHTML(i.label)}${missing.has(i.pc) ? ' · 생략' : ''}"><strong>${escapeHTML(i.name)}</strong><small>${escapeHTML(i.label)}${missing.has(i.pc) ? ' 생략' : ''}</small></div>`).join('');
    const extraBass = chord.bassPC !== null && !chord.intervals.some(i => i.pc === chord.bassPC);
    const notesText = v.omitted.length ? `<p class="note-explanation omission-note">${v.omitted.map(i => escapeHTML(i.name) + '(' + escapeHTML(i.label) + ')').join(', ')} 생략<br>코드의 주요 음을 남긴 운지예요.</p>` : '<p class="note-explanation">코드의 구성음이 모두 들어 있어요.</p>';
    const safeCount = Math.min(visibleCount, result.voicings.length);
    container.innerHTML = titleHTML(chord) + `
      <article class="main-card" aria-label="선택한 운지">
        <div class="card-top"><div class="card-top-left"><span class="badge">${icon('check')} ${activeIndex === 0 ? '추천 운지' : '선택한 운지'}</span><span class="card-position">${position(v)}</span></div><button class="save-button${savedState ? ' saved' : ''}" id="save-voicing" aria-pressed="${savedState}">${icon('bookmark')} ${savedState ? '저장됨' : '운지 저장'}</button></div>
        <div class="main-card-body"><div class="diagram-wrap">${diagram(v, chord)}<div class="diagram-legend"><span><i class="legend-root"></i>근음</span><span>○ 개방현</span><span>× 치지 않음</span></div></div>
          <div class="voicing-detail"><p class="detail-label">CHORD TONES <span style="font-weight:400;letter-spacing:0">· 구성음</span></p><div class="note-pills">${tonePills}</div>${notesText}${extraBass ? `<p class="note-explanation">지정 베이스 ${escapeHTML(noteName(chord.bassPC))} 추가</p>` : ''}<dl class="grip-meta"><div><dt>예상 난이도</dt><dd>${v.difficulty}</dd></div><div><dt>바레</dt><dd>${v.barre ? v.barre.fret + '프렛 · ' + v.fingers[v.barre.start] + '번 손가락' : '없음'}</dd></div><div><dt>가장 낮은 음</dt><dd>${escapeHTML(noteName(v.bassPC))}${v.rootBass ? ' · 근음' : ''}</dd></div></dl>${v.innerMutes ? '<p class="note-explanation omission-note" style="margin-top:12px">가운데 × 줄을 뮤트하거나 골라 쳐 주세요.</p>' : ''}<p class="fret-code" aria-label="6번 줄부터 프렛">${v.frets.map(f => f < 0 ? '×' : f).join(' ')}</p></div>
        </div><div class="listen-row"><button class="play-button" id="play-chord">${icon('play')} 소리 듣기</button><button class="arpeggio-button" id="play-arpeggio">한 음씩 듣기</button><span class="sound-hint">${icon('volume')} 합성 현악기 소리</span></div>
      </article>
      <div class="alternates-heading"><h3>같은 코드, 다른 모양</h3><span>${safeCount} / ${result.voicings.length}개</span></div>
      <div class="voicing-grid">${result.voicings.slice(0, safeCount).map((item, i) => `<button class="voicing-card${i === activeIndex ? ' selected' : ''}" data-voicing="${i}" aria-pressed="${i === activeIndex}" aria-label="운지 ${i + 1}, ${position(item)}, ${item.difficulty}${item.omitted.length ? ', 일부 음 생략' : ', 구성음 모두 포함'}"><div class="mini-card-heading"><span>VOICING ${String(i+1).padStart(2,'0')}</span><small>${position(item)}</small></div>${diagram(item, chord, true)}<div class="mini-bottom"><span>${item.difficulty}${item.omitted.length ? ' · 음 생략' : ' · 모든 음'}</span>${i === activeIndex ? '<span class="selected-check">선택됨 ✓</span>' : '<span>보기 ↗</span>'}</div></button>`).join('')}</div>
      ${safeCount < result.voicings.length ? `<button class="more-button" id="more-voicings">다른 운지 더 보기 ${icon('chevron')}</button>` : ''}
      <p class="result-footnote">${icon('info')}<span>손가락 번호와 난이도는 제안이에요. 직접 잡아 보며 편한 운지를 골라 주세요.<br>확장음의 옥타브 배치는 달라질 수 있어요. 표준 튜닝 · 카포 없음 기준이에요.</span></p>`;
    $('#save-voicing').addEventListener('click', toggleSave);
    $('#play-chord').addEventListener('click', () => play(v, false));
    $('#play-arpeggio').addEventListener('click', () => play(v, true));
    container.querySelectorAll('[data-voicing]').forEach(button => button.addEventListener('click', () => {
      stopSound(); activeIndex = Number(button.dataset.voicing); renderResults();
      const newButton = container.querySelector(`[data-voicing="${activeIndex}"]`);
      newButton?.focus({ preventScroll: true });
      $('#search-status').textContent = `운지 ${activeIndex + 1} 선택, ${position(result.voicings[activeIndex])}`;
    }));
    $('#more-voicings')?.addEventListener('click', () => {
      const previous = visibleCount; visibleCount += 6; renderResults();
      container.querySelector(`[data-voicing="${previous}"]`)?.focus({ preventScroll: true });
    });
  }

  let pending = null;
  try {
    if (location.protocol !== 'file:') {
      worker = new Worker('worker.js');
      worker.onmessage = ({ data }) => {
        if (!pending || data.id !== pending.id) return;
        if (data.error) pending.reject(new Error(data.error)); else pending.resolve(data.result);
        pending = null;
      };
      worker.onerror = () => {
        worker.terminate(); worker = null;
        if (pending) { pending.resolve(music.findVoicings(pending.chord, pending.options)); pending = null; }
      };
    }
  } catch { worker = null; }

  function calculate(parsed, settings, id) {
    // Resolve superseded requests so rapidly repeated searches do not retain promises.
    if (pending) { pending.resolve(null); pending = null; }
    if (!worker) return Promise.resolve(music.findVoicings(parsed, settings));
    return new Promise((resolve, reject) => {
      pending = { id, chord: parsed, options: settings, resolve, reject };
      worker.postMessage({ id, chord: parsed, options: settings });
    });
  }

  async function search(value, targetFrets = null) {
    const id = ++requestId;
    $('#search-input').value = value;
    $('#search-error').hidden = true;
    $('#search-input').removeAttribute('aria-invalid');
    stopSound();
    let parsed;
    try { parsed = music.parseChord(value); }
    catch (error) {
      $('#search-error').textContent = error.message;
      $('#search-error').hidden = false;
      $('#search-input').setAttribute('aria-invalid', 'true');
      $('#results').setAttribute('aria-busy', 'false');
      if (chord && result) renderResults();
      return;
    }
    const settings = options();
    $('#results').setAttribute('aria-busy', 'true');
    $('#result-content').innerHTML = '<div class="loading-state"><div class="spinner"></div>손끝에 맞는 운지를 찾고 있어요.</div>';
    try {
      const found = await calculate(parsed, settings, id);
      if (id !== requestId || !found) return;
      chord = parsed; result = found; currentOptions = settings;
      activeIndex = targetFrets ? Math.max(0, result.voicings.findIndex(v => v.frets.join(',') === targetFrets.join(','))) : 0;
      visibleCount = Math.max(3, Math.ceil((activeIndex + 1) / 3) * 3);
      renderResults();
      $('#search-status').textContent = `${chord.name}, ${result.voicings.length}개 운지를 추천해요.`;
      if (location.protocol !== 'file:') {
        const url = new URL(location.href); url.searchParams.set('chord', chord.canonical);
        history.replaceState(null, '', url);
      }
    } catch {
      $('#result-content').innerHTML = '<div class="empty-result"><h3>운지를 계산하지 못했어요.</h3><p>잠시 후 코드를 다시 검색해 주세요.</p></div>';
    } finally { if (id === requestId) $('#results').setAttribute('aria-busy', 'false'); }
  }

  function persistSaved(next) {
    try { localStorage.setItem(STORAGE, JSON.stringify(next)); saved = next; storageAvailable = true; }
    catch { storageAvailable = false; toast('브라우저 저장 공간에 접근할 수 없어요. 저장 설정을 확인해 주세요.'); return false; }
    $('#saved-count').textContent = String(saved.length);
    return true;
  }
  function toggleSave() {
    const v = result.voicings[activeIndex];
    const key = savedKey(chord.canonical, v.frets);
    const existing = saved.some(s => savedKey(s.chord, s.frets) === key);
    if (!existing && saved.length >= 150) { toast('보관함이 가득 찼어요. 사용하지 않는 운지를 지워 주세요.'); return; }
    const next = existing ? saved.filter(s => savedKey(s.chord, s.frets) !== key) : [{ chord: chord.canonical, frets: v.frets, options: currentOptions }, ...saved];
    if (persistSaved(next)) { renderResults(); $('#save-voicing')?.focus({ preventScroll: true }); toast(existing ? '보관함에서 운지를 지웠어요.' : '이 운지를 보관함에 저장했어요.'); }
  }
  function renderSaved() {
    if (!saved.length) {
      $('#saved-list').innerHTML = `<div class="empty-result"><div class="empty-icon">♧</div><h3>마음에 드는 운지를 모아 보세요.</h3><p>코드를 찾은 뒤 ‘운지 저장’을 누르면 여기에 모여요.</p><button class="secondary-button" id="empty-back">첫 코드 찾아보기 ${icon('arrow')}</button></div>`;
      $('#empty-back').addEventListener('click', () => showView('search'));
      return;
    }
    $('#saved-list').innerHTML = `<div class="saved-grid">${saved.map((item, i) => {
      const parsed = music.parseChord(item.chord);
      const grip = music.fingering(item.frets, !item.options?.noBarre) || music.fingering(item.frets);
      if (!grip) return '';
      const positive = item.frets.filter(f => f > 0);
      const v = { frets: item.frets, ...grip, minFret: positive.length ? Math.min(...positive) : 0, maxFret: Math.max(0,...positive) };
      return `<article class="saved-item"><div class="saved-item-top"><h3>${escapeHTML(parsed.name)}</h3><button data-delete="${i}" aria-label="${escapeHTML(parsed.name)} 운지 삭제">${icon('close')}</button></div>${diagram(v, parsed)}<button class="secondary-button" data-open-saved="${i}">이 운지 열기 ${icon('arrow')}</button></article>`;
    }).join('')}</div><p class="saved-storage-note">기기 간에 자동으로 동기화되지 않아요. 브라우저 데이터를 지우면 보관함도 지워져요.</p>`;
    $('#saved-list').querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', () => {
      if (persistSaved(saved.filter((_, i) => i !== Number(button.dataset.delete)))) { renderSaved(); toast('보관함에서 지웠어요.'); }
    }));
    $('#saved-list').querySelectorAll('[data-open-saved]').forEach(button => button.addEventListener('click', () => {
      const item = saved[Number(button.dataset.openSaved)]; setOptions(item.options); showView('search'); search(item.chord, item.frets);
    }));
  }
  function showView(view) {
    stopSound();
    $('#finder-view').hidden = view !== 'search'; $('#saved-view').hidden = view !== 'saved';
    for (const name of ['search','saved']) {
      $('#' + name + '-tab').classList.toggle('active', view === name);
      if (view === name) $('#' + name + '-tab').setAttribute('aria-current', 'page');
      else $('#' + name + '-tab').removeAttribute('aria-current');
    }
    if (view === 'saved') renderSaved(); else if (chord && result) renderResults();
  }

  function stopSound() {
    playingNodes.forEach(source => { try { source.stop(); } catch { /* already ended */ } });
    playingNodes = [];
    clearTimeout(playTimeout);
    $('#play-chord')?.classList.remove('playing');
  }
  // Karplus–Strong plucked-string synthesis. No recordings or external audio assets.
  function pluck(midi, when, level) {
    const sampleRate = audioContext.sampleRate, frequency = 440 * 2 ** ((midi - 69) / 12);
    const delay = sampleRate / frequency - 0.5;
    const length = Math.floor(delay), fraction = delay - length;
    const ring = new Float32Array(length + 1);
    for (let i = 0; i < ring.length; i++) ring[i] = Math.random() * 2 - 1;
    const buffer = audioContext.createBuffer(1, sampleRate * 3, sampleRate);
    const data = buffer.getChannelData(0);
    let cursor = 0, previous = 0;
    for (let i = 0; i < data.length; i++) {
      const current = ring[cursor];
      const next = ring[(cursor + 1) % ring.length];
      const sample = current * fraction + next * (1 - fraction);
      ring[cursor] = (sample + previous) * 0.497;
      previous = sample;
      data[i] = sample * Math.min(1, i / (sampleRate * 0.005)) * Math.min(1, (data.length - i) / (sampleRate * 0.04));
      cursor = (cursor + 1) % ring.length;
    }
    const source = audioContext.createBufferSource(); source.buffer = buffer;
    const gain = audioContext.createGain(); gain.gain.value = level;
    source.connect(gain); gain.connect(audioContext.destination); source.start(when);
    source.onended = () => { source.disconnect(); gain.disconnect(); };
    playingNodes.push(source);
  }
  async function play(v, arpeggio) {
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) throw new Error('unsupported');
      audioContext ||= new Audio();
      await audioContext.resume(); stopSound();
      const notes = v.midi.filter(n => n !== null);
      const gap = arpeggio ? 0.32 : 0.035;
      notes.forEach((midi, i) => pluck(midi, audioContext.currentTime + 0.04 + i * gap, 0.65 / Math.sqrt(notes.length)));
      $('#play-chord')?.classList.add('playing');
      playTimeout = setTimeout(() => $('#play-chord')?.classList.remove('playing'), (notes.length * gap + 1.5) * 1000);
      $('#search-status').textContent = arpeggio ? '6번 줄부터 한 음씩 재생해요.' : '선택한 운지의 소리를 재생해요.';
    } catch { toast('소리를 재생하지 못했어요. 브라우저의 소리 허용 설정을 확인해 주세요.'); }
  }

  const narrowScreen = matchMedia('(max-width: 760px)');
  function setFiltersOpen(open) {
    $('#filter-controls').hidden = !open;
    $('#filters-toggle').setAttribute('aria-expanded', String(open));
  }
  setFiltersOpen(!narrowScreen.matches);
  narrowScreen.addEventListener('change', event => setFiltersOpen(!event.matches));
  $('#filters-toggle').addEventListener('click', () => setFiltersOpen($('#filter-controls').hidden));
  $('#search-form').addEventListener('submit', event => { event.preventDefault(); search($('#search-input').value); });
  document.querySelectorAll('[data-chord]').forEach(button => button.addEventListener('click', () => search(button.dataset.chord)));
  ['#no-barre','#complete','#max-fret','#span'].forEach(selector => $(selector).addEventListener('change', () => search($('#search-input').value)));
  $('#reset-filters').addEventListener('click', () => { setOptions(); search($('#search-input').value); });
  $('#search-tab').addEventListener('click', () => showView('search'));
  $('#saved-tab').addEventListener('click', () => showView('saved'));
  $('#back-search').addEventListener('click', () => showView('search'));
  $('#saved-count').textContent = String(saved.length);
  $('#help-open').addEventListener('click', () => {
    const parsed = music.parseChord('C');
    const v = music.findVoicings(parsed).voicings[0];
    $('#help-diagram').innerHTML = diagram(v, parsed); $('#help-dialog').showModal();
  });
  $('#help-close').addEventListener('click', () => $('#help-dialog').close());
  $('#help-dialog').addEventListener('click', event => {
    if (event.target !== $('#help-dialog')) return;
    const bounds = $('#help-dialog').getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) $('#help-dialog').close();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopSound(); });
  const initial = new URL(location.href).searchParams.get('chord') || 'Cmaj9';
  search(initial).then(() => { if (!chord) search('Cmaj9'); });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* Core search works without offline support. */ });
  }
})();
