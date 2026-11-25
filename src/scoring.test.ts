import { describe, expect, test } from 'vitest';
import { Take, scoreCell, stats } from './scoring';
import { STEPS, emptyPattern } from './settings';

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

describe('stats', () => {
  test('counts hits, misses and extras, and averages the best hit per target', () => {
    const pattern = emptyPattern();
    pattern[0][0] = pattern[0][8] = pattern[1][4] = true; // 3 targets per bar
    const take = new Take(0, STEP, 2);
    take.record(0, 0.01, 1); // +10ms
    take.record(0, -0.03, 1); // extra in the same cell
    take.record(1, 4 * STEP - 0.02, 1); // -20ms
    take.record(1, 5 * STEP, 1); // off-pattern extra
    take.record(0, (STEPS + 8) * STEP + 0.04, 1); // bar 2: +40ms

    expect(stats(take, pattern, 0, 1)).toEqual({ hit: 2, total: 3, extra: 2, avg: 15, bias: -5 });
    expect(stats(take, pattern, 0, 2)).toEqual({ hit: 3, total: 6, extra: 2, avg: 23, bias: 10 });
  });
});
