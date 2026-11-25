import { expect, test } from 'vitest';
import type { Recording } from './analysis';
import { analyseLag } from './lag';

const SR = 48000;
const START_FRAME = 2000;

/** Same response as BiquadFilterNode { type: 'bandpass', frequency: 1000, Q: 8 } (RBJ cookbook). */
function bandpass(x: Float32Array, f = 1000, Q = 8) {
  const w = (2 * Math.PI * f) / SR;
  const alpha = Math.sin(w) / (2 * Q);
  const [b0, b2, a0, a1, a2] = [alpha, -alpha, 1 + alpha, -2 * Math.cos(w), 1 - alpha];
  const y = new Float32Array(x.length);
  let [x1, x2, y1, y2] = [0, 0, 0, 0];
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    [x2, x1, y2, y1] = [x1, x[i], y1, v];
    y[i] = v;
  }
  return y;
}

function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
}

/**
 * 12 taps at irregular intervals. Each tap's noise reaches the mic `lag` before
 * its beep; both appear in the recording `roundTrip` after the beep was triggered.
 * Each tap also makes a release noise 100 ms after the press.
 */
function simulate({ lag = 0.025, roundTrip = 0.15, jitter = 0.002, noise = 0.002, tapAmp = 0.15 } = {}) {
  const rand = rng(7);
  const triggers: number[] = [];
  let t = 0.5;
  for (let i = 0; i < 12; i++) triggers.push((t += 0.7 + Math.abs(rand()) * 0.5));
  const len = Math.ceil((t + 1.5) * SR);
  const hp = new Float32Array(len);
  for (let i = 0; i < len; i++) hp[i] = rand() * noise;
  const at = (time: number) => Math.round(time * SR) - START_FRAME;
  const burst = (time: number, amp: number) => {
    const s = at(time);
    for (let j = 0; j < SR * 0.015; j++) hp[s + j] += amp * rand() * Math.exp(-j / SR / 0.003);
  };

  for (const trig of triggers) {
    const beep = trig + roundTrip;
    const tap = beep - lag - rand() * jitter;
    burst(tap, tapAmp); // press
    burst(tap + 0.1, tapAmp * 0.7); // release
    for (let j = 0; j < SR * 0.03; j++) {
      hp[at(beep) + j] += 0.3 * Math.sin((2 * Math.PI * 1000 * j) / SR) * Math.exp(-j / SR / 0.008);
    }
  }
  // The tone channel is the same mic signal through the recorder's band-pass filter.
  const rec: Recording = { hp, bp: bandpass(hp), sampleRate: SR, startFrame: START_FRAME };
  return { rec, triggers };
}

test.each([
  { lag: 0.025, roundTrip: 0.15 },
  { lag: 0.008, roundTrip: 0.05 },
  { lag: 0.06, roundTrip: 0.3, jitter: 0.006, noise: 0.008 },
  { lag: 0.18, roundTrip: 0.4 }, // e.g. Bluetooth speakers
])('recovers tap-to-sound lag of $lag s', (opts) => {
  const { rec, triggers } = simulate(opts);
  const r = analyseLag(rec, triggers);
  expect(Math.abs(r.lag - opts.lag * 1000)).toBeLessThanOrEqual(3);
  expect(r.used).toBe(12);
});

test('fails when taps are inaudible', () => {
  const { rec, triggers } = simulate({ tapAmp: 0 });
  expect(() => analyseLag(rec, triggers)).toThrow('TAPS HEARD');
});
