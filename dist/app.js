(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const music = window.VoicingMusic;
  const state = window.VoicingState;
  const STORAGE = 'voicing-saved-v1';
  const escapeHTML = text => String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  let chord = null, result = null, activeIndex = 0, visibleCount = 3, requestId = 0, worker = null;
  let saved = [], toastTimeout, currentOptions = {}, currentView = 'search', storageReadable = true;
  let playing = false, arpeggioPlaying = false, storageError = '', rawSaved = null;
  const sound = window.VoicingAudio.createPlayer({ onStateChange(value) { playing = value; syncPlayback(); } });
  function readSaved() {
    rawSaved = null;
    try {
      rawSaved = localStorage.getItem(STORAGE) || '[]';
      saved = state.readStored(rawSaved); storageReadable = true; storageError = '';
    } catch {
      storageReadable = false;
      storageError = '보관함을 읽지 못했어요. 기존 데이터를 보호하기 위해 저장을 잠시 멈췄어요. 브라우저의 저장 허용 설정을 확인해 주세요.';
    }
    $('#saved-count').textContent = String(saved.length);
    $('#storage-warning').textContent = storageError;
    $('#storage-warning').hidden = !storageError;
  }
  readSaved();
  function hideToast() { $('#toast').classList.remove('visible'); $('#toast').inert = true; }
  function toast(message, undo) {
    $('#toast').replaceChildren();
    const text = document.createElement('span'); text.textContent = message; $('#toast').append(text);
    if (undo) {
      const button = document.createElement('button'); button.textContent = '되돌리기';
      button.addEventListener('click', () => { undo(); hideToast(); });
      $('#toast').append(button);
    }
    $('#toast').classList.add('visible');
    $('#toast').inert = false;
    clearTimeout(toastTimeout);
    const dismiss = () => {
      if ($('#toast').contains(document.activeElement)) toastTimeout = setTimeout(dismiss, 3000);
      else hideToast();
    };
    toastTimeout = setTimeout(dismiss, undo ? 8000 : 3500);
  }
  function options() {
    return { noBarre: $('#no-barre').checked, complete: $('#complete').checked, maxFret: Number($('#max-fret').value), span: Number($('#span').value) };
  }
  function setOptions(value = {}) {
    value = state.cleanOptions(value);
    $('#no-barre').checked = value.noBarre;
    $('#complete').checked = value.complete;
    $('#max-fret').value = String(value.maxFret);
    $('#span').value = String(value.span);
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
        svg += `<text x="${x(s)}" y="${y(f) + 4}" text-anchor="middle" font-size="12" font-weight="600" fill="#fffefa">${voicing.fingers[s]}</text>`;
      }
      svg += `<text x="${x(s)}" y="${bottom + 24}" text-anchor="middle" font-size="11" fill="${f < 0 ? '#b3b9a9' : root ? '#c8542d' : '#536247'}">${f < 0 ? '–' : escapeHTML(noteName(pc, parsed))}</text>`;
      svg += `<text x="${x(s)}" y="${bottom + 43}" text-anchor="middle" font-size="9" fill="#a3aa96">${6-s}</text>`;
    });
    return svg + '</svg>';
  }

  function savedKey(name, frets) { return name + '|' + frets.join(','); }
  function isSaved(v) { return saved.some(s => savedKey(s.chord, s.frets) === savedKey(chord.canonical, v.frets)); }
  function syncSaveButton() {
    const v = result?.voicings[activeIndex], button = $('#save-voicing');
    if (!chord || !v || !button) return;
    const yes = isSaved(v);
    button.setAttribute('aria-pressed', String(yes));
    button.classList.toggle('saved', yes);
    button.innerHTML = icon('bookmark') + (yes ? ' 저장됨' : ' 운지 저장');
  }
  function position(v) { return v.maxFret === 0 ? '개방현' : v.minFret === v.maxFret ? `${v.minFret}프렛` : `${v.minFret}–${v.maxFret}프렛`; }
  function titleHTML(parsed) {
    return `<div class="result-header"><div><p class="result-eyebrow">YOUR NEXT CHORD</p><h2 class="chord-title">${escapeHTML(parsed.name)}</h2><p class="chord-description">${escapeHTML(parsed.description)}${parsed.bass ? ' · 베이스 ' + escapeHTML(noteName(parsed.bassPC, parsed)) : ''}</p></div>${result ? `<span class="result-total">${result.voicings.length ? '최대 ' + result.voicings.length + '개 추천' : '조건에 맞는 결과 없음'}</span>` : ''}</div>`;
  }

  function renderResults() {
    if (!chord || !result) return;
    const container = $('#result-content');
    const v = result.voicings[activeIndex];
    if (!v) {
      const bassNotes = chord.bassPC === null ? [] : [chord.bassPC];
      const requiredCount = new Set(chord.intervals.filter(i => !i.optional).map(i => i.pc).concat(bassNotes)).size;
      const allCount = new Set(chord.intervals.map(i => i.pc).concat(bassNotes)).size;
      const impossible = requiredCount > 6;
      const tooMany = currentOptions.complete && allCount > 6;
      const canRelax = !impossible && (currentOptions.noBarre || currentOptions.complete || currentOptions.maxFret < 15 || currentOptions.span < 4);
      const explanation = impossible ? `이 표기에서 꼭 포함해야 하는 음이 ${requiredCount}개여서 기타 여섯 줄에 담을 수 없어요. 변화음을 덜 지정하거나 악보에서 생략할 수 있는 음을 확인해 주세요.` : tooMany ? '필요한 음이 여섯 개를 넘어서 기타 여섯 줄에 모두 담을 수 없어요. ‘구성음 모두 포함’을 끄면 생략 가능한 음을 덜어낸 운지를 찾아요.' : canRelax ? '찾아볼 프렛을 늘리거나 바레·구성음 조건을 풀어 보세요. 현재 탐색 범위와 손가락 조건 안에서는 가능한 모양을 찾지 못했어요.' : '15프렛까지, 네 손가락과 바레 하나를 사용하는 범위에서 운지를 찾지 못했어요. 현재 지원하는 범위 밖의 특수 운지는 포함하지 않아요.';
      container.innerHTML = titleHTML(chord) + `<div class="empty-result"><div class="empty-icon">⌁</div><h3>조건에 맞는 운지가 없어요.</h3><p>${explanation}</p><button id="relax-filters" class="secondary-button">${canRelax ? '조건 넓혀서 다시 찾기' : '다른 코드 입력하기'} ${icon('arrow')}</button></div>`;
      $('#relax-filters').addEventListener('click', () => {
        if (canRelax) { setOptions({ maxFret: 15, span: 4 }); search(chord.canonical); }
        else { $('#search-input').focus(); $('#search-input').select(); }
      });
      return;
    }
    const savedState = isSaved(v);
    const missing = new Set(v.omitted.map(i => i.pc));
    const tonePills = chord.intervals.map(i => `<div class="note-pill${i.degree === 1 ? ' root' : ''}${missing.has(i.pc) ? ' omitted' : ''}" title="${escapeHTML(i.name)} · ${escapeHTML(i.label)}${missing.has(i.pc) ? ' · 생략' : ''}"><strong>${escapeHTML(i.name)}</strong><small>${escapeHTML(i.label)}${missing.has(i.pc) ? ' 생략' : ''}</small></div>`).join('');
    const extraBass = chord.bassPC !== null && !chord.intervals.some(i => i.pc === chord.bassPC);
    const notesText = v.omitted.length ? `<p class="note-explanation omission-note">${v.omitted.map(i => escapeHTML(i.name) + '(' + escapeHTML(i.label) + ')').join(', ')} 생략<br>코드의 주요 음을 남긴 운지예요.</p>` : '<p class="note-explanation">코드의 구성음이 모두 들어 있어요.</p>';
    const safeCount = Math.min(visibleCount, result.voicings.length);
    container.innerHTML = titleHTML(chord) + `
      <article class="main-card" tabindex="-1" aria-label="${escapeHTML(chord.name)} 선택한 운지">
        <div class="card-top"><div class="card-top-left"><span class="badge">${icon('check')} ${activeIndex === 0 ? '추천 운지' : '선택한 운지'}</span><span class="card-position">${position(v)}</span></div><button class="save-button${savedState ? ' saved' : ''}" id="save-voicing" aria-pressed="${savedState}">${icon('bookmark')} ${savedState ? '저장됨' : '운지 저장'}</button></div>
        <div class="main-card-body"><div class="diagram-wrap">${diagram(v, chord)}<div class="diagram-legend"><span><i class="legend-root"></i>근음</span><span>○ 개방현</span><span>× 치지 않음</span></div></div>
          <div class="voicing-detail"><p class="detail-label">CHORD TONES <span style="font-weight:400;letter-spacing:0">· 구성음</span></p><div class="note-pills">${tonePills}</div>${notesText}${extraBass ? `<p class="note-explanation">지정 베이스 ${escapeHTML(noteName(chord.bassPC))} 추가</p>` : ''}<dl class="grip-meta"><div><dt>예상 난이도</dt><dd>${v.difficulty}</dd></div><div><dt>바레</dt><dd>${v.barre ? v.barre.fret + '프렛 · ' + v.fingers[v.barre.start] + '번 손가락' : '없음'}</dd></div><div><dt>가장 낮은 음</dt><dd>${escapeHTML(noteName(v.bassPC))}${v.rootBass ? ' · 근음' : ''}</dd></div></dl>${v.innerMutes ? '<p class="note-explanation omission-note" style="margin-top:12px">가운데 × 줄을 뮤트하거나 골라 쳐 주세요.</p>' : ''}<p class="fret-code" aria-label="6번 줄부터 프렛">${v.frets.map(f => f < 0 ? '×' : f).join(' ')}</p></div>
        </div><div class="listen-row"><button class="play-button" id="play-chord" aria-pressed="false">${icon('play')} 소리 듣기</button><button class="arpeggio-button" id="play-arpeggio" aria-pressed="false">한 음씩 듣기</button><button class="share-button" id="share-voicing" aria-label="이 운지의 링크 복사">${icon('link')}<span>링크</span></button></div>
      </article>
      <div class="alternates-heading"><h3>같은 코드, 다른 모양</h3><span>${safeCount} / ${result.voicings.length}개</span></div>
      <div class="voicing-grid">${result.voicings.slice(0, safeCount).map((item, i) => `<button class="voicing-card${i === activeIndex ? ' selected' : ''}" data-voicing="${i}" aria-pressed="${i === activeIndex}" aria-label="운지 ${i + 1}, ${position(item)}, ${item.difficulty}${item.omitted.length ? ', 일부 음 생략' : ', 구성음 모두 포함'}"><div class="mini-card-heading"><span>VOICING ${String(i+1).padStart(2,'0')}</span><small>${position(item)}</small></div>${diagram(item, chord, true)}<div class="mini-bottom"><span>${item.difficulty}${item.omitted.length ? ' · 음 생략' : ' · 모든 음'}</span>${i === activeIndex ? '<span class="selected-check">선택됨 ✓</span>' : '<span>보기 ↗</span>'}</div></button>`).join('')}</div>
      ${safeCount < result.voicings.length ? `<button class="more-button" id="more-voicings">다른 운지 더 보기 ${icon('chevron')}</button>` : ''}
      <p class="result-footnote">${icon('info')}<span>손가락 번호와 난이도는 제안이에요. 직접 잡아 보며 편한 운지를 골라 주세요.<br>확장음의 옥타브 배치는 달라질 수 있어요. 표준 튜닝 · 카포 없음 기준이에요.</span></p>`;
    $('#save-voicing').addEventListener('click', toggleSave);
    $('#play-chord').addEventListener('click', () => play(v, false));
    $('#play-arpeggio').addEventListener('click', () => play(v, true));
    $('#share-voicing').addEventListener('click', copyLink);
    container.querySelectorAll('[data-voicing]').forEach(button => button.addEventListener('click', event => {
      stopSound(); activeIndex = Number(button.dataset.voicing); renderResults();
      updateLocation('replace');
      if (event.detail > 0 && matchMedia('(max-width: 760px)').matches) {
        $('.main-card').focus({ preventScroll: true });
        $('.main-card').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      } else container.querySelector(`[data-voicing="${activeIndex}"]`)?.focus({ preventScroll: true });
      $('#search-status').textContent = `운지 ${activeIndex + 1} 선택, ${position(result.voicings[activeIndex])}`;
    }));
    $('#more-voicings')?.addEventListener('click', () => {
      const previous = visibleCount; visibleCount += 6; renderResults();
      container.querySelector(`[data-voicing="${previous}"]`)?.focus({ preventScroll: true });
    });
    syncPlayback();
  }

  let pending = null;
  try {
    if (location.protocol !== 'file:') {
      worker = new Worker('worker.js');
      worker.onmessage = ({ data }) => {
        if (!pending || data.id !== pending.id) return;
        clearTimeout(pending.timer);
        if (data.error) pending.reject(new Error(data.error)); else pending.resolve(data.result);
        pending = null;
      };
      worker.onerror = () => {
        worker.terminate(); worker = null;
        if (pending) {
          const request = pending; pending = null; clearTimeout(request.timer);
          try { request.resolve(music.findVoicings(request.chord, request.options)); } catch (error) { request.reject(error); }
        }
      };
    }
  } catch { worker = null; }

  function calculate(parsed, settings, id) {
    cancelPending();
    if (!worker) return Promise.resolve(music.findVoicings(parsed, settings));
    return new Promise((resolve, reject) => {
      pending = { id, chord: parsed, options: settings, resolve, reject };
      pending.timer = setTimeout(() => {
        if (!pending || pending.id !== id) return;
        worker?.terminate(); worker = null; pending = null;
        try { resolve(music.findVoicings(parsed, settings)); } catch (error) { reject(error); }
      }, 7000);
      worker.postMessage({ id, chord: parsed, options: settings });
    });
  }

  function cancelPending() {
    if (pending) { clearTimeout(pending.timer); pending.resolve(null); pending = null; }
  }

  function writeLocation(href, mode) {
    if (mode === 'none' || location.protocol === 'file:') return;
    if (href === location.href) return;
    try { history[mode === 'push' ? 'pushState' : 'replaceState'](null, '', href); } catch { /* File and restricted frames can still search. */ }
  }

  function updateLocation(mode = 'replace') {
    if (chord && result) {
      writeLocation(state.locationFor(location.href, { chord: chord.canonical, options: currentOptions, frets: result.voicings[activeIndex]?.frets, view: currentView }), mode);
    } else {
      // Errors and in-flight searches still have a navigable address. Preserve
      // their input, including malformed shape data, when only the view changes.
      const url = new URL(location.href);
      if (currentView === 'saved') url.searchParams.set('view', 'saved'); else url.searchParams.delete('view');
      writeLocation(url.href, mode);
    }
  }

  function showError(message, parsed = null, targetFrets = null) {
    chord = null; result = null;
    $('#results').setAttribute('aria-busy', 'false');
    $('#result-content').innerHTML = `<div class="empty-result"><div class="empty-icon">⌁</div><h3>${targetFrets ? '저장된 운지를 확인해 주세요.' : '코드를 다시 확인해 주세요.'}</h3><p>${escapeHTML(message)}</p>${targetFrets ? `<p class="invalid-frets">저장된 프렛: ${targetFrets.map(f => f < 0 ? '×' : f).join(' · ')}</p>` : ''}<button class="secondary-button" id="retry-search">${parsed ? '이 코드의 다른 운지 찾기' : 'Cmaj9 예시로 시작하기'} ${icon('arrow')}</button></div>`;
    $('#retry-search').addEventListener('click', () => { setOptions(); search(parsed?.canonical || 'Cmaj9'); });
    $('#search-status').textContent = message;
  }

  async function search(value, targetFrets = null, historyMode = 'push') {
    const id = ++requestId;
    cancelPending();
    $('#search-input').value = value;
    $('#search-error').hidden = true;
    $('#search-input').removeAttribute('aria-invalid');
    stopSound();
    const settings = options();
    chord = null; result = null; currentOptions = settings;
    let parsed, parseError;
    try { parsed = music.parseChord(value); } catch (error) { parseError = error; }
    // Record the request before calculation so failed searches and a
    // refresh during calculation never reopen an unrelated successful result.
    const requestedHref = state.locationFor(location.href, { chord: parsed?.canonical || value, options: settings, frets: targetFrets, view: currentView });
    const previous = state.parseLocation(location.href);
    if (!targetFrets) previous.frets = null;
    const sameSearch = !previous.invalidShape && state.locationFor(location.href, previous) === requestedHref;
    writeLocation(requestedHref, historyMode === 'push' && sameSearch ? 'replace' : historyMode);
    if (parseError) {
      $('#search-error').textContent = parseError.message;
      $('#search-error').hidden = false;
      $('#search-input').setAttribute('aria-invalid', 'true');
      $('#results').setAttribute('aria-busy', 'false');
      showError(parseError.message);
      return;
    }
    $('#results').setAttribute('aria-busy', 'true');
    $('#result-content').innerHTML = '<div class="loading-state"><div class="spinner"></div>손끝에 맞는 운지를 찾고 있어요.</div>';
    try {
      const found = await calculate(parsed, settings, id);
      if (id !== requestId || !found) return;
      if (targetFrets) {
        const exact = music.inspectVoicing(parsed, targetFrets, settings);
        if (!exact.valid) { showError(exact.reason, parsed, targetFrets); return; }
        const index = found.voicings.findIndex(v => v.frets.join(',') === targetFrets.join(','));
        if (index < 0) found.voicings.unshift(exact.voicing);
      }
      chord = parsed; result = found; currentOptions = settings;
      activeIndex = targetFrets ? Math.max(0, result.voicings.findIndex(v => v.frets.join(',') === targetFrets.join(','))) : 0;
      visibleCount = Math.max(3, Math.ceil((activeIndex + 1) / 3) * 3);
      renderResults();
      $('#search-status').textContent = result.voicings.length ? `${chord.name}, ${result.voicings.length}개 운지를 추천해요.` : `${chord.name}, 조건에 맞는 운지가 없어요.`;
      updateLocation(historyMode === 'none' ? 'none' : 'replace');
    } catch {
      if (id !== requestId) return;
      showError('운지를 계산하지 못했어요. 코드를 다시 검색해 주세요.', parsed);
    } finally { if (id === requestId) $('#results').setAttribute('aria-busy', 'false'); }
  }

  async function changeSaved(transform) {
    const write = () => {
      readSaved();
      if (!storageReadable) { toast(storageError); return false; }
      try {
        const next = state.readStored(JSON.stringify(transform(saved)));
        localStorage.setItem(STORAGE, JSON.stringify(next)); saved = next;
        $('#saved-count').textContent = String(saved.length);
        syncSaveButton();
        return true;
      } catch (error) { toast(error.name === 'QuotaExceededError' ? '저장 공간이 부족해요. 보관함을 내보낸 뒤 공간을 확인해 주세요.' : error.message || '보관함을 저장하지 못했어요.'); return false; }
    };
    if (navigator.locks?.request) {
      try { return await navigator.locks.request(STORAGE, write); }
      catch { /* Restricted file origins may offer Web Locks but reject acquisition. */ }
    }
    return write();
  }
  async function toggleSave() {
    const v = result.voicings[activeIndex];
    const entry = { chord: chord.canonical, frets: [...v.frets], options: {...currentOptions} };
    const key = state.key(entry); let existing = false;
    if (await changeSaved(list => {
      existing = list.some(s => state.key(s) === key);
      return existing ? list.filter(s => state.key(s) !== key) : state.mergeRecords([entry], list);
    })) {
      renderResults(); $('#save-voicing')?.focus({ preventScroll: true });
      toast(existing ? '보관함에서 운지를 지웠어요.' : '이 운지를 보관함에 저장했어요.', existing ? async () => {
        if (await changeSaved(list => state.mergeRecords([entry], list))) { renderResults(); if (currentView === 'saved') renderSaved(); }
      } : null);
    }
  }
  function renderSaved() {
    readSaved();
    $('#export-saved').disabled = rawSaved === null || (storageReadable && saved.length === 0);
    if (!saved.length) {
      $('#saved-list').innerHTML = `<div class="empty-result"><div class="empty-icon">♧</div><h3>${storageReadable ? '마음에 드는 운지를 모아 보세요.' : '기존 보관함을 읽지 못했어요.'}</h3><p>${storageReadable ? '코드를 찾은 뒤 ‘운지 저장’을 누르면 여기에 모여요. 백업 파일이 있다면 ‘불러오기’로 복원할 수 있어요.' : '기존 데이터는 덮어쓰지 않았어요. 내보내기로 원본을 보관할 수 있어요.'}</p><button class="secondary-button" id="empty-back">코드 찾아보기 ${icon('arrow')}</button></div>`;
      $('#empty-back').addEventListener('click', () => showView('search'));
      return;
    }
    $('#saved-list').innerHTML = `<div class="saved-grid">${saved.map((item, i) => {
      let parsed = null, inspection;
      try { parsed = music.parseChord(item.chord); inspection = music.inspectVoicing(parsed, item.frets, item.options); }
      catch (error) { inspection = {valid:false,reason:error.message}; }
      return `<article class="saved-item"><div class="saved-item-top"><h3>${escapeHTML(parsed?.name || item.chord)}</h3><button data-delete="${i}" aria-label="${escapeHTML(parsed?.name || item.chord)} 운지 삭제">${icon('close')}</button></div>${inspection.valid ? diagram(inspection.voicing, parsed) : `<p class="saved-invalid">${escapeHTML(inspection.reason)}<br>저장된 프렛: ${item.frets.map(f => f < 0 ? '×' : f).join(' · ')}</p>`}<button class="secondary-button" data-open-saved="${i}">${inspection.valid ? '이 운지 열기' : '저장된 운지 확인'} ${icon('arrow')}</button></article>`;
    }).join('')}</div><p class="saved-storage-note">기기 간에 자동으로 동기화되지 않아요. 브라우저 데이터를 지우면 보관함도 지워져요.</p>`;
    $('#saved-list').querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', async () => {
      const index = Number(button.dataset.delete), entry = saved[index];
      if (!entry) return;
      if (await changeSaved(list => list.filter(s => state.key(s) !== state.key(entry)))) {
        renderSaved();
        ($('#saved-list').querySelectorAll('[data-delete]')[Math.min(index, saved.length - 1)] || $('#empty-back'))?.focus({preventScroll:true});
        toast('보관함에서 지웠어요.', async () => { if (await changeSaved(list => state.mergeRecords([entry], list))) renderSaved(); });
      }
    }));
    $('#saved-list').querySelectorAll('[data-open-saved]').forEach(button => button.addEventListener('click', () => {
      const item = saved[Number(button.dataset.openSaved)]; setOptions(item.options); showView('search', false); search(item.chord, item.frets);
    }));
  }
  function showView(view, writeHistory = true) {
    stopSound();
    currentView = view;
    $('#finder-view').hidden = view !== 'search'; $('#saved-view').hidden = view !== 'saved';
    for (const name of ['search','saved']) {
      $('#' + name + '-tab').classList.toggle('active', view === name);
      if (view === name) $('#' + name + '-tab').setAttribute('aria-current', 'page');
      else $('#' + name + '-tab').removeAttribute('aria-current');
    }
    if (view === 'saved') renderSaved(); else if (chord && result) renderResults();
    if (writeHistory) updateLocation('push');
  }

  function stopSound() {
    sound.stop(); playing = false; syncPlayback();
  }
  function syncPlayback() {
    const chordButton = $('#play-chord'), arpeggioButton = $('#play-arpeggio');
    if (!chordButton || !arpeggioButton) return;
    chordButton.classList.toggle('playing', playing && !arpeggioPlaying);
    arpeggioButton.classList.toggle('playing', playing && arpeggioPlaying);
    chordButton.setAttribute('aria-pressed', String(playing && !arpeggioPlaying));
    arpeggioButton.setAttribute('aria-pressed', String(playing && arpeggioPlaying));
    chordButton.innerHTML = icon(playing && !arpeggioPlaying ? 'stop' : 'play') + (playing && !arpeggioPlaying ? '재생 중지' : '소리 듣기');
    arpeggioButton.textContent = playing && arpeggioPlaying ? '재생 중지' : '한 음씩 듣기';
  }
  async function play(v, arpeggio) {
    try {
      if (playing && arpeggioPlaying === arpeggio) { stopSound(); return; }
      arpeggioPlaying = arpeggio;
      const started = await sound.play(v.midi.filter(n => n !== null), { arpeggio });
      if (!started) return;
      $('#search-status').textContent = arpeggio ? '6번 줄부터 한 음씩 재생해요.' : '선택한 운지의 소리를 재생해요.';
    } catch { toast('소리를 재생하지 못했어요. 브라우저의 소리 허용 설정을 확인해 주세요.'); }
  }

  async function copyLink() {
    updateLocation('replace');
    if (location.protocol === 'file:') { toast('사이트 주소로 접속하면 운지 링크를 복사할 수 있어요.'); return; }
    const href = state.locationFor(location.href, { chord: chord.canonical, options: currentOptions, frets: result.voicings[activeIndex].frets });
    try { await navigator.clipboard.writeText(href); toast('선택한 운지와 검색 조건의 링크를 복사했어요.'); }
    catch { $('#share-link').value = href; $('#share-dialog').showModal(); $('#share-link').select(); }
  }
  $('#share-close').addEventListener('click', () => $('#share-dialog').close());
  $('#export-saved').addEventListener('click', () => {
    readSaved();
    if (rawSaved === null) { toast('저장 공간에 접근할 수 없어 내보내지 못했어요. 브라우저 설정을 확인해 주세요.'); return; }
    const data = storageReadable ? state.backup(saved) : rawSaved;
    const url = URL.createObjectURL(new Blob([data], {type:'application/json'}));
    const link = document.createElement('a'); link.href = url;
    link.download = `voicing-${storageReadable ? 'backup' : 'recovery'}-${new Date().toLocaleDateString('sv-SE')}.json`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast(storageReadable ? '보관함 파일을 내려받아요. 다른 기기에서 불러올 수 있어요.' : '읽지 못한 원본 데이터를 복구용 파일로 내려받아요.');
  });
  $('#import-saved').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error('1MB 이하의 보관함 파일을 선택해 주세요.');
      const imported = state.readBackup(await file.text());
      let added = 0;
      if (await changeSaved(list => { const merged = state.mergeRecords(list, imported); added = merged.length - list.length; return merged; })) {
        renderSaved(); toast(added ? `${added}개의 운지를 추가했어요. 기존 보관함도 그대로 있어요.` : '이미 보관 중인 운지예요.');
      }
    } catch (error) { toast(error.message || '보관함 파일을 읽지 못했어요.'); }
  });
  window.addEventListener('storage', event => {
    if (event.key !== STORAGE && event.key !== null) return;
    readSaved();
    if (currentView === 'saved') renderSaved();
    syncSaveButton();
  });

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
  ['#no-barre','#complete','#max-fret','#span'].forEach(selector => $(selector).addEventListener('change', () => search($('#search-input').value, null, 'replace')));
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
  function loadLocation() {
    const value = state.parseLocation(location.href);
    $('#search-error').hidden = true; $('#search-input').removeAttribute('aria-invalid');
    setOptions(value.options); showView(value.view, false);
    if (value.invalidShape) {
      ++requestId; cancelPending(); $('#search-input').value = value.chord;
      let parsed = null; try { parsed = music.parseChord(value.chord); } catch { /* Show the original input as an error. */ }
      showError('주소에 들어 있는 운지 정보가 올바르지 않아요.', parsed);
      return;
    }
    search(value.chord, value.frets, 'none');
  }
  window.addEventListener('popstate', loadLocation);
  loadLocation();
  function connectionState() { $('#offline-status').hidden = navigator.onLine; }
  connectionState(); window.addEventListener('online', connectionState); window.addEventListener('offline', connectionState);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    let waiting = null, applyUpdate = false;
    const announce = registration => {
      if (registration.waiting) { waiting = registration.waiting; $('#update-notice').hidden = false; }
    };
    $('#apply-update').addEventListener('click', () => {
      if (!waiting) return;
      applyUpdate = true; updateLocation('replace'); stopSound(); waiting.postMessage({type:'SKIP_WAITING'});
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (applyUpdate) location.reload(); });
    navigator.serviceWorker.register('sw.js', {updateViaCache:'none'}).then(registration => {
      announce(registration);
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        installing?.addEventListener('statechange', () => { if (installing.state === 'installed') announce(registration); });
      });
      if (navigator.onLine) registration.update().catch(() => {});
    }).catch(() => { /* Core search and saving do not depend on offline installation. */ });
  }
})();
