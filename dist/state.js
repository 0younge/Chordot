(function (scope) {
  'use strict';
  const LIMIT = 150;
  const defaults = { noBarre: false, complete: false, maxFret: 12, span: 3 };
  function cleanOptions(value = {}) {
    value = value && typeof value === 'object' ? value : {};
    return {
      noBarre: value.noBarre === true,
      complete: value.complete === true,
      maxFret: [5,9,12,15].includes(Number(value.maxFret)) ? Number(value.maxFret) : defaults.maxFret,
      span: [2,3,4].includes(Number(value.span)) ? Number(value.span) : defaults.span
    };
  }
  const validFrets = frets => Array.isArray(frets) && frets.length === 6 && frets.every(f => Number.isInteger(f) && f >= -1 && f <= 15) && frets.some(f => f >= 0);
  const key = record => record.chord + '|' + record.frets.join(',');
  function normalizeRecords(value) {
    if (!Array.isArray(value) || value.length > LIMIT) throw new Error('보관함은 최대 150개의 운지를 담을 수 있어요.');
    const records = [], seen = new Set();
    for (const item of value) {
      if (!item || typeof item.chord !== 'string' || !item.chord.trim() || item.chord.length > 60 || !validFrets(item.frets)) {
        throw new Error('보관함 파일의 코드 이름이나 프렛 정보가 올바르지 않아요.');
      }
      // Keep legacy fingerings even when newer musical validation rejects them.
      // The UI presents an explanation; it must never replace a saved grip silently.
      const record = { chord: item.chord.trim(), frets: [...item.frets], options: cleanOptions(item.options) };
      if (!seen.has(key(record))) { records.push(record); seen.add(key(record)); }
    }
    return records;
  }
  function readStored(raw) { return normalizeRecords(JSON.parse(raw || '[]')); }
  function backup(records) { return JSON.stringify({ format: 'voicing-backup', version: 1, saved: normalizeRecords(records) }, null, 2); }
  function readBackup(raw) {
    if (typeof raw !== 'string' || raw.length > 1024 * 1024) throw new Error('1MB 이하의 Voicing 보관함 파일을 선택해 주세요.');
    let data;
    try { data = JSON.parse(raw); } catch { throw new Error('JSON 형식의 Voicing 보관함 파일을 선택해 주세요.'); }
    if (Array.isArray(data)) return normalizeRecords(data);
    if (data?.format !== 'voicing-backup' || data?.version !== 1) throw new Error('지원하는 Voicing 보관함 파일이 아니에요.');
    return normalizeRecords(data.saved);
  }
  function mergeRecords(existing, incoming) {
    const merged = [...existing], seen = new Set(existing.map(key));
    for (const record of incoming) if (!seen.has(key(record))) { merged.push(record); seen.add(key(record)); }
    return normalizeRecords(merged);
  }
  function parseLocation(href) {
    const url = new URL(href);
    const p = url.searchParams;
    const rawShape = p.get('shape');
    const shape = rawShape && /^(-1|\d{1,2})(,(-1|\d{1,2})){5}$/.test(rawShape) ? rawShape.split(',').map(Number) : null;
    return {
      chord: p.has('chord') ? p.get('chord') : 'Cmaj9',
      options: cleanOptions({ noBarre: p.get('noBarre') === '1', complete: p.get('complete') === '1', maxFret: p.get('maxFret'), span: p.get('span') }),
      frets: validFrets(shape) ? shape : null,
      invalidShape: rawShape !== null && !validFrets(shape),
      view: p.get('view') === 'saved' ? 'saved' : 'search'
    };
  }
  function locationFor(href, value) {
    const url = new URL(href);
    for (const name of ['chord','noBarre','complete','maxFret','span','shape','view']) url.searchParams.delete(name);
    url.searchParams.set('chord', value.chord);
    const settings = cleanOptions(value.options);
    if (settings.noBarre) url.searchParams.set('noBarre', '1');
    if (settings.complete) url.searchParams.set('complete', '1');
    if (settings.maxFret !== defaults.maxFret) url.searchParams.set('maxFret', String(settings.maxFret));
    if (settings.span !== defaults.span) url.searchParams.set('span', String(settings.span));
    if (validFrets(value.frets)) url.searchParams.set('shape', value.frets.join(','));
    if (value.view === 'saved') url.searchParams.set('view', 'saved');
    return url.href;
  }
  const api = { LIMIT, cleanOptions, validFrets, key, readStored, backup, readBackup, mergeRecords, parseLocation, locationFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  scope.VoicingState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
