import { expect, test } from 'vitest';
import { analyseCalibration, tapsByClick, type Recording } from './calibration';

const SR = 48000;
const BEAT = 60 / 90;
const T0 = 0.5;
const START_FRAME = 1000;

/** Seeded PRNG so failures are reproducible. */
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
}

/**
 * Builds a mic recording of 20 clicks with a key clack after clicks 4–19, and
 * the tap times the app would have measured given `inputLatency`.
 */
function simulate({ inputLatency = 0.025, roundTrip = 0.12, jitter = 0.003, noise = 0.002 } = {}) {
  const rand = rng(42);
  const clicks = Array.from({ length: 20 }, (_, k) => T0 + k * BEAT);
  const len = Math.ceil((T0 + 21 * BEAT + 0.7) * SR);
  const hp = new Float32Array(len);
  const bp = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    hp[i] = rand() * noise;
    bp[i] = hp[i] * 0.2;
  }
  const at = (t: number) => Math.round(t * SR) - START_FRAME;

  for (const t of clicks) {
    const s = at(t + roundTrip);
    for (let j = 0; j < SR * 0.03; j++) {
      const v = 0.3 * Math.sin((2 * Math.PI * 1000 * j) / SR) * Math.exp(-j / SR / 0.008);
      hp[s + j] += v;
      bp[s + j] += v;
    }
  }

  const taps: number[] = [];
  for (let k = 4; k < 20; k++) {
    const trueOffset = BEAT / 2 + rand() * 0.03;
    const s = at(clicks[k] + trueOffset + roundTrip);
    for (let j = 0; j < SR * 0.015; j++) {
      const v = 0.15 * rand() * Math.exp(-j / SR / 0.003);
      hp[s + j] += v;
      bp[s + j] += v * 0.1;
    }
    taps.push(clicks[k] + trueOffset + inputLatency + rand() * jitter);
  }

  const rec: Recording = { hp, bp, sampleRate: SR, startFrame: START_FRAME };
  return { rec, clicks, taps: tapsByClick(taps, clicks) };
}

test.each([
  { inputLatency: 0.025, roundTrip: 0.12 },
  { inputLatency: 0.008, roundTrip: 0.35 },
  { inputLatency: 0.04, roundTrip: 0.05, jitter: 0.008, noise: 0.01 },
  { inputLatency: -0.01, roundTrip: 0.2 },
])('recovers input latency $inputLatency s (round trip $roundTrip s)', (opts) => {
  const { rec, clicks, taps } = simulate(opts);
  const r = analyseCalibration(rec, clicks, taps);
  expect(Math.abs(r.latency - opts.inputLatency * 1000)).toBeLessThanOrEqual(3);
  expect(r.used).toBe(16);
});

test('fails when no clicks reach the mic', () => {
  const { rec, clicks, taps } = simulate();
  rec.bp.fill(0);
  expect(() => analyseCalibration(rec, clicks, taps)).toThrow('CLICKS NOT HEARD');
});

test('tapsByClick ignores the intro and keeps the first tap per click', () => {
  const clicks = Array.from({ length: 20 }, (_, k) => T0 + k * BEAT);
  const m = tapsByClick([clicks[1] + 0.3, clicks[5] + 0.3, clicks[5] + 0.4], clicks);
  expect([...m]).toEqual([[5, clicks[5] + 0.3]]);
});
