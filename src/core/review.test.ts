import { expect, test } from 'vitest';
import { defaultClick, emptyPattern } from './pattern';
import type { RunResult, SegmentSpec } from './plan';
import { Review } from './review';
import { Take } from './scoring';

const spec = (bars: number, patternBars: number): SegmentSpec => ({
  name: 'P',
  patternId: null,
  pattern: emptyPattern(patternBars),
  piano: [],
  click: defaultClick(),
  bpm: 120,
  bars,
});

/** Segment 0: 4 bars of a 2-bar pattern. Segment 1: 3 bars of a 4-bar pattern. */
function review() {
  const result: RunResult = {
    plan: { routineId: 'r', segments: [spec(4, 2), spec(3, 4)], hearFirst: false, countIn: 0 },
    takes: [new Take(0, 0.1, 4), new Take(10, 0.1, 3)],
  };
  return new Review(result);
}

test('numbers bars across segments and clamps moves', () => {
  const r = review();
  expect(r.bars).toHaveLength(7);
  r.goTo(5);
  expect(r.current).toEqual({ seg: 1, bar: 1 });
  r.goTo(99);
  expect(r.bar).toBe(6);
  r.goTo(-3);
  expect(r.bar).toBe(0);
  expect(r.segmentBars(1)).toEqual({ from: 4, to: 7 });
});

test('a bar square jumps within the pass on screen, never past the segment', () => {
  const r = review();
  r.goTo(3); // seg 0, bar 3: second pass of the 2-bar pattern
  expect(r.pageBar(0)).toBe(2);
  r.goTo(4); // seg 1, bar 0 of a 4-bar pattern played for 3 bars
  expect(r.pageBar(2)).toBe(6);
  expect(r.pageBar(3)).toBe(6);
});

test('replay starts at the segment start unless it was paused there', () => {
  const r = review();
  r.goTo(5);
  expect(r.replayStart(1)).toBe(4);
  r.pausedSeg = 1;
  expect(r.replayStart(1)).toBe(5);
  expect(r.replayStart(0)).toBe(0);
});
