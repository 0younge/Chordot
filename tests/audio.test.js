const { test } = require('node:test');
const assert = require('node:assert/strict');
const { midiToFrequency, harmonicProfile, createPlayer } = require('../dist/audio.js');

function fakeContext(state = 'running') {
  function param() {
    return {
      value: 0, events: [],
      setValueAtTime(value, at) { this.value = value; this.events.push(['set', value, at]); },
      linearRampToValueAtTime(value, at) { this.events.push(['linear', value, at]); },
      exponentialRampToValueAtTime(value, at) { this.events.push(['exponential', value, at]); },
      cancelScheduledValues(at) { this.events.push(['cancel', at]); },
      setTargetAtTime(value, at, constant) { this.events.push(['target', value, at, constant]); }
    };
  }
  const nodes = [];
  function node(type) {
    const value = { type, connections: [], disconnected: false,
      connect(target) { this.connections.push(target); },
      disconnect() { this.disconnected = true; }
    };
    nodes.push(value); return value;
  }
  const ctx = {
    state, currentTime: 12, sampleRate: 48000, destination: {}, nodes,
    createOscillator() {
      return Object.assign(node('oscillator'), {
        frequency: param(), setPeriodicWave(wave) { this.wave = wave; },
        start(at) { this.startAt = at; }, stop(at) { this.stopAt = at; },
        end() { this.onended?.(); }
      });
    },
    createGain() { return Object.assign(node('gain'), { gain: param() }); },
    createBiquadFilter() { return Object.assign(node('filter'), { frequency: param(), Q: param() }); },
    createPeriodicWave(real, imag, options) { return { real, imag, options }; },
    async resume() { this.state = 'running'; },
    async close() { this.state = 'closed'; }
  };
  return ctx;
}
const oscillators = ctx => ctx.nodes.filter(n => n.type === 'oscillator');

test('standard guitar strings and A4 map to independently known frequencies', () => {
  const cases = [[40,82.406889],[45,110],[50,146.832384],[55,195.997718],[59,246.941651],[64,329.627557],[69,440]];
  for (const [midi, expected] of cases) assert.ok(Math.abs(midiToFrequency(midi) - expected) < 0.000001);
  for (let midi = 40; midi <= 79; midi++) assert.ok(Math.abs(midiToFrequency(midi + 12) / midiToFrequency(midi) - 2) < 1e-12);
  for (const value of [NaN, Infinity, -1, 128, '69', null]) assert.throws(() => midiToFrequency(value));
});

test('harmonics are bounded, keep a fundamental, and stay below Nyquist', () => {
  for (const sampleRate of [44100,48000]) for (let midi = 40; midi <= 79; midi++) {
    const frequency = midiToFrequency(midi);
    const { real, imag } = harmonicProfile(frequency, sampleRate);
    assert.ok(imag[1] > 0.5);
    assert.ok(Math.abs(imag.reduce((a,b) => a + Math.abs(b), 0) - 1) < 1e-6);
    assert.ok(real.every(v => v === 0));
    assert.ok((imag.length - 1) * frequency <= sampleRate / 2);
  }
});

test('a chord has one exact oscillator frequency per string and a shared timing origin', async () => {
  const ctx = fakeContext();
  const player = createPlayer({ createContext: () => ctx });
  await player.play([40,47,52,56,59,64]);
  const sources = oscillators(ctx);
  assert.equal(sources.length, 6);
  sources.forEach((source, i) => {
    assert.equal(source.frequency.events[0][1], midiToFrequency([40,47,52,56,59,64][i]));
    assert.ok(Math.abs(source.startAt - (12.025 + i * 0.035)) < 1e-10);
    assert.equal(source.wave.options.disableNormalization, true);
  });
  const gains = ctx.nodes.filter(n => n.type === 'gain');
  const totalPeak = gains.reduce((sum, gain) => sum + gain.gain.events.find(e => e[0] === 'linear')[1], 0);
  assert.ok(totalPeak <= 0.750001, 'simultaneous voices cannot sum above the declared peak');
  assert.deepEqual(player.getState(), { playing: true, voices: 6 });
});

test('playing status lasts until all voices end and every node is released', async () => {
  const ctx = fakeContext(), states = [];
  const player = createPlayer({ createContext: () => ctx, onStateChange: state => states.push(state) });
  await player.play([45,52,60], { arpeggio: true });
  const sources = oscillators(ctx);
  assert.ok(Math.abs(sources[2].startAt - sources[0].startAt - 0.64) < 1e-10);
  sources[0].end(); sources[1].end();
  assert.equal(player.getState().playing, true);
  sources[2].end();
  assert.deepEqual(player.getState(), { playing: false, voices: 0 });
  assert.deepEqual(states, [true,false]);
  assert.ok(ctx.nodes.every(node => node.disconnected));
});

test('stop during suspended resume prevents stale playback', async () => {
  const ctx = fakeContext('suspended');
  let resume;
  ctx.resume = () => new Promise(resolve => { resume = () => { ctx.state = 'running'; resolve(); }; });
  const player = createPlayer({ createContext: () => ctx });
  const playing = player.play([40,47,52]);
  player.stop(); resume();
  assert.equal(await playing, false);
  assert.equal(oscillators(ctx).length, 0);
  assert.deepEqual(player.getState(), { playing: false, voices: 0 });
});

test('a newer request wins when two resume promises complete out of order', async () => {
  const ctx = fakeContext('suspended'), resumes = [];
  ctx.resume = () => new Promise(resolve => resumes.push(() => { ctx.state = 'running'; resolve(); }));
  const player = createPlayer({ createContext: () => ctx });
  const older = player.play([40]); const newer = player.play([69]);
  resumes[1](); assert.equal(await newer, true);
  resumes[0](); assert.equal(await older, false);
  assert.equal(oscillators(ctx).length, 1);
  assert.equal(oscillators(ctx)[0].frequency.events[0][1], 440);
});

test('replacement releases old voices without ending the newer playing state', async () => {
  const ctx = fakeContext(), states = [];
  const player = createPlayer({ createContext: () => ctx, onStateChange: s => states.push(s) });
  await player.play([40,47,52]); const oldSources = oscillators(ctx);
  await player.play([60]);
  assert.equal(player.getState().voices, 1);
  for (const source of oldSources) { assert.equal(source.stopAt, 12.018); source.end(); }
  assert.equal(player.getState().playing, true);
  await player.destroy();
  assert.equal(ctx.state, 'closed');
  assert.ok(ctx.nodes.every(node => node.disconnected));
  assert.deepEqual(player.getState(), { playing: false, voices: 0 });
});

test('invalid inputs fail before creating audio nodes', async () => {
  const ctx = fakeContext(); const player = createPlayer({ createContext: () => ctx });
  for (const notes of [[], [null], [Infinity], Array(7).fill(60), null]) await assert.rejects(() => player.play(notes));
  assert.equal(ctx.nodes.length, 0);
});
