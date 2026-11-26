import { expect, test } from 'vitest';
import {
  STEPS,
  emptyPattern,
  hasContentFrom,
  isPatternGrid,
  resizePattern,
  resizePiano,
  sameGrid,
  samePiano,
  sanitizePiano,
} from './pattern';

test('piano notes: keeps valid ones inside the range and the bar', () => {
  expect(
    sanitizePiano([
      { pitch: 60, step: 0, len: 4 },
      { pitch: 30, step: 0, len: 1 }, // below the roll
      { pitch: 62, step: 14, len: 4 }, // runs past the bar
      { pitch: 64, step: 2, len: 0 },
      'junk',
    ]),
  ).toEqual([{ pitch: 60, step: 0, len: 4 }]);
});

test('samePiano ignores order', () => {
  const a = [{ pitch: 60, step: 0, len: 2 }, { pitch: 64, step: 4, len: 1 }];
  expect(samePiano(a, [...a].reverse())).toBe(true);
  expect(samePiano(a, a.slice(1))).toBe(false);
});

test('patterns can be 1 to 4 bars', () => {
  expect(isPatternGrid(emptyPattern(1))).toBe(true);
  expect(isPatternGrid(emptyPattern(4))).toBe(true);
  expect(isPatternGrid(emptyPattern(5))).toBe(false);
  expect(isPatternGrid([[true]])).toBe(false);
});

test('resizing repeats bars when growing and drops them when shrinking', () => {
  const p = emptyPattern(1);
  p[0][0] = true;
  const two = resizePattern(p, 2);
  expect(two[0].length).toBe(2 * STEPS);
  expect(two[0][STEPS]).toBe(true);
  expect(resizePattern(two, 1)[0].length).toBe(STEPS);

  const notes = [{ pitch: 60, step: 4, len: 2 }];
  expect(resizePiano(notes, 1, 3).map((n) => n.step)).toEqual([4, 20, 36]);
  expect(resizePiano([...notes, { pitch: 62, step: 20, len: 1 }], 2, 1)).toEqual(notes);
});

test('piano notes may sit in later bars but not cross a bar line', () => {
  expect(sanitizePiano([{ pitch: 60, step: 30, len: 2 }], 32)).toHaveLength(1);
  expect(sanitizePiano([{ pitch: 60, step: 14, len: 4 }], 32)).toHaveLength(0);
  expect(sanitizePiano([{ pitch: 60, step: 40, len: 1 }], 32)).toHaveLength(0);
});

test('sameGrid compares length as well as steps', () => {
  const one = emptyPattern(1);
  expect(sameGrid(one, emptyPattern(1))).toBe(true);
  expect(sameGrid(one, emptyPattern(2))).toBe(false);
});

test('hasContentFrom looks at drums and keyboard notes from a step on', () => {
  const p = emptyPattern(2);
  expect(hasContentFrom(p, [], STEPS)).toBe(false);
  expect(hasContentFrom(p, [{ pitch: 60, step: 20, len: 1 }], STEPS)).toBe(true);
  p[1][STEPS + 3] = true;
  expect(hasContentFrom(p, [], STEPS)).toBe(true);
});
