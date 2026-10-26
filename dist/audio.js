(function (scope) {
  'use strict';

  const HARMONICS = [1, 0.42, 0.20, 0.11, 0.065, 0.035, 0.018];
  const NOTE_DURATION = 2.8;
  const RELEASE = 0.018;

  function midiToFrequency(midi) {
    if (!Number.isFinite(midi) || midi < 0 || midi > 127) throw new RangeError('올바른 MIDI 음높이가 필요해요.');
    return 440 * 2 ** ((midi - 69) / 12);
  }

  function harmonicProfile(frequency, sampleRate) {
    if (!Number.isFinite(frequency) || frequency <= 0 || !Number.isFinite(sampleRate) || sampleRate <= frequency * 2) throw new RangeError('샘플링 주파수보다 낮은 음높이가 필요해요.');
    // Normalize the sum of partial amplitudes, giving a strict peak bound of 1.
    // The oscillator controls the fundamental exactly; no rounded delay line.
    const count = Math.min(HARMONICS.length, Math.max(1, Math.floor(sampleRate / (2 * frequency))));
    const sum = HARMONICS.slice(0, count).reduce((a, b) => a + b, 0);
    const real = new Float32Array(count + 1);
    const imag = new Float32Array(count + 1);
    for (let i = 1; i <= count; i++) imag[i] = HARMONICS[i - 1] / sum;
    return { real, imag };
  }

  function createPlayer({ createContext, onStateChange = () => {} } = {}) {
    let context = null, generation = 0, playing = false;
    const voices = new Set();
    const factory = createContext || (() => {
      const Audio = scope.AudioContext || scope.webkitAudioContext;
      if (!Audio) throw new Error('이 브라우저는 소리 재생을 지원하지 않아요.');
      return new Audio();
    });
    function setPlaying(value) {
      if (playing === value) return;
      playing = value;
      onStateChange(value);
    }
    function dispose(voice) {
      if (voice.disposed) return;
      voice.disposed = true;
      voices.delete(voice);
      voice.oscillator.onended = null;
      voice.oscillator.disconnect();
      voice.filter.disconnect();
      voice.gain.disconnect();
      if (!voices.size) setPlaying(false);
    }
    function stop() {
      generation++;
      const now = context ? context.currentTime : 0;
      for (const voice of [...voices]) {
        if (voice.stopping) continue;
        voice.stopping = true;
        try {
          if (voice.gain.gain.cancelAndHoldAtTime) voice.gain.gain.cancelAndHoldAtTime(now);
          else {
            const value = voice.gain.gain.value;
            voice.gain.gain.cancelScheduledValues(now);
            voice.gain.gain.setValueAtTime(value, now);
          }
          voice.gain.gain.setTargetAtTime(0, now, RELEASE / 3);
          voice.oscillator.stop(now + RELEASE);
        } catch { dispose(voice); }
      }
      setPlaying(false);
    }

    async function play(midiNotes, { arpeggio = false } = {}) {
      if (!Array.isArray(midiNotes) || !midiNotes.length || midiNotes.length > 6) throw new RangeError('1개에서 6개 음을 재생할 수 있어요.');
      const frequencies = midiNotes.map(midiToFrequency);
      stop();
      const requestedGeneration = generation;
      if (!context || context.state === 'closed') context = factory();
      try {
        if (context.state !== 'running') await context.resume();
      } catch (error) {
        if (requestedGeneration !== generation) return false;
        throw error;
      }
      // A pending resume must never resurrect a chord after a search or tab change.
      if (requestedGeneration !== generation) return false;
      if (context.state !== 'running') throw new Error('소리 재생이 허용되지 않았어요.');
      const start = context.currentTime + 0.025;
      const gap = arpeggio ? 0.32 : 0.035;
      const peak = 0.75 / frequencies.length;
      try {
        frequencies.forEach((frequency, i) => {
          const oscillator = context.createOscillator();
          const filter = context.createBiquadFilter();
          const gain = context.createGain();
          const at = start + i * gap;
          const voice = { oscillator, filter, gain, disposed: false };
          voices.add(voice);
          const profile = harmonicProfile(frequency, context.sampleRate);
          const wave = context.createPeriodicWave(profile.real, profile.imag, { disableNormalization: true });
          oscillator.setPeriodicWave(wave);
          oscillator.frequency.setValueAtTime(frequency, at);
          // A bright onset and quickly softening spectrum give a plucked-string feel.
          filter.type = 'lowpass';
          filter.Q.setValueAtTime(0.1, at);
          filter.frequency.setValueAtTime(Math.min(frequency * 10, context.sampleRate * 0.45), at);
          filter.frequency.exponentialRampToValueAtTime(Math.min(frequency * 2.2, context.sampleRate * 0.4), at + 0.7);
          gain.gain.setValueAtTime(0, at);
          gain.gain.linearRampToValueAtTime(peak, at + 0.006);
          gain.gain.exponentialRampToValueAtTime(peak * 0.15, at + 0.8);
          gain.gain.exponentialRampToValueAtTime(0.00001, at + NOTE_DURATION - 0.03);
          gain.gain.linearRampToValueAtTime(0, at + NOTE_DURATION);
          oscillator.connect(filter); filter.connect(gain); gain.connect(context.destination);
          oscillator.onended = () => dispose(voice);
          oscillator.start(at);
          oscillator.stop(at + NOTE_DURATION + 0.01);
        });
      } catch (error) {
        stop();
        throw error;
      }
      setPlaying(true);
      return true;
    }

    function destroy() {
      stop();
      for (const voice of [...voices]) dispose(voice);
      const old = context; context = null;
      if (old && old.state !== 'closed') return old.close();
      return Promise.resolve();
    }
    return { play, stop, destroy, getState: () => ({ playing, voices: [...voices].filter(v => !v.stopping).length }) };
  }

  const api = { createPlayer, midiToFrequency, harmonicProfile };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  scope.VoicingAudio = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
