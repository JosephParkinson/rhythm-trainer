import { describe, expect, test } from 'vitest';
import { Take, collect, scoreCell, summarize, timing } from './scoring';
import { STEPS, emptyPattern } from './pattern';

const STEP = 0.1; // s per 16th

describe('Take.record', () => {
  test('snaps to the nearest 16th with signed error', () => {
    const take = new Take(10, STEP, 1);
    expect(take.record(0, 10 + 3 * STEP + 0.01, 1)).toMatchObject({ step: 3, err: expect.closeTo(10, 6) });
    expect(take.record(1, 10 + 5 * STEP - 0.03, 0.5)).toMatchObject({ step: 5, err: expect.closeTo(-30, 6), vel: 0.5 });
  });

  test('early hit on the first step counts; outside the take does not', () => {
    const take = new Take(10, STEP, 1);
    expect(take.record(0, 10 - 0.04, 1)?.step).toBe(0);
    expect(take.record(0, 10 - 0.06, 1)).toBeNull();
    expect(take.record(0, 10 + STEPS * STEP, 1)).toBeNull();
    expect(take.hits).toHaveLength(1);
  });

  test('indexes hits by cell', () => {
    const take = new Take(0, STEP, 2);
    take.record(2, 17 * STEP, 1);
    take.record(2, 17 * STEP + 0.02, 1);
    take.record(1, 17 * STEP, 1);
    expect(take.at(2, 17)).toHaveLength(2);
    expect(take.at(1, 17)).toHaveLength(1);
    expect(take.at(2, 1)).toHaveLength(0);
  });
});

describe('scoreCell', () => {
  const hit = (err: number) => ({ track: 0, step: 0, err, vel: 1 });

  test('on a target, the closest hit is graded and the rest are extra', () => {
    const marks = scoreCell([hit(30), hit(-5), hit(60)], true);
    expect(marks.map((m) => m.grade)).toEqual(['extra', 'good', 'extra']);
  });

  test('grades by distance', () => {
    expect(scoreCell([hit(20)], true)[0].grade).toBe('good');
    expect(scoreCell([hit(-45)], true)[0].grade).toBe('ok');
    expect(scoreCell([hit(46)], true)[0].grade).toBe('bad');
  });

  test('off-pattern hits are extra', () => {
    expect(scoreCell([hit(0)], false)[0].grade).toBe('extra');
  });
});

describe('timing stats', () => {
  const pattern = emptyPattern();
  pattern[0][0] = pattern[0][8] = pattern[1][4] = true; // 3 targets per bar
  const take = new Take(0, STEP, 2);
  take.record(0, 0.01, 1); // +10ms
  take.record(0, -0.03, 1); // extra in the same cell
  take.record(1, 4 * STEP - 0.02, 1); // -20ms
  take.record(1, 5 * STEP, 1); // off-pattern extra
  take.record(0, (STEPS + 8) * STEP + 0.04, 1); // bar 2: +40ms

  test('per bar and overall', () => {
    expect(timing(take, pattern, { fromBar: 0, toBar: 1 })).toEqual({
      notes: 3, hit: 2, extra: 2, avg: 15, bias: -5, sd: 15, p90: 20,
    });
    expect(timing(take, pattern)).toMatchObject({ notes: 6, hit: 3, extra: 2, avg: 23.3, bias: 10, p90: 40 });
  });

  test('filters by track and beat position', () => {
    expect(timing(take, pattern, { track: 1 })).toMatchObject({ notes: 2, hit: 1, extra: 1, bias: -20 });
    // position 0 (on the beat) holds steps 0, 4, 8, 12 of each bar
    expect(timing(take, pattern, { sub: 0 })).toMatchObject({ notes: 6, hit: 3 });
    expect(timing(take, pattern, { sub: 1 })).toMatchObject({ notes: 0, hit: 0, extra: 1 });
  });

  test('muted tracks are left out entirely', () => {
    const muted = [false, true, false, false]; // snare
    expect(timing(take, pattern, { muted })).toMatchObject({ notes: 4, hit: 2, extra: 1 });
    expect(timing(take, pattern, { track: 1, muted })).toMatchObject({ notes: 0, hit: 0, extra: 0 });
  });

  test('summarize merges samples from several takes', () => {
    const a = collect(take, pattern, { fromBar: 0, toBar: 1 });
    const b = collect(take, pattern, { fromBar: 1, toBar: 2 });
    expect(summarize([a, b])).toEqual(timing(take, pattern));
  });

  test('empty sample is all zero', () => {
    expect(summarize([])).toEqual({ notes: 0, hit: 0, extra: 0, avg: 0, bias: 0, sd: 0, p90: 0 });
  });
});

test('a 2-bar pattern loops over a 4-bar take', () => {
  const pattern = emptyPattern(2);
  pattern[0][0] = true; // kick on bar 1 only
  pattern[1][STEPS + 4] = true; // snare on bar 2 only
  const take = new Take(0, STEP, 4);
  take.record(0, 2 * STEPS * STEP, 1); // bar 3 = pattern bar 1: kick is a target
  take.record(1, (3 * STEPS + 4) * STEP, 1); // bar 4 = pattern bar 2: snare is a target
  take.record(1, 4 * STEP, 1); // bar 1 has no snare: extra
  expect(timing(take, pattern)).toMatchObject({ notes: 4, hit: 2, extra: 1 });
});
