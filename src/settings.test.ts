import { expect, test } from 'vitest';
import {
  STEPS,
  clampSetting,
  defaultSettings,
  emptyPattern,
  isPatternGrid,
  patternBars,
  removeBar,
  removePianoBar,
  resizePattern,
  resizePiano,
  samePiano,
  sanitize,
  sanitizePiano,
} from './settings';

test('garbage falls back to defaults', () => {
  expect(sanitize(null)).toEqual(defaultSettings());
  expect(sanitize('nope')).toEqual(defaultSettings());
});

test('keeps valid fields, clamps numbers, drops malformed ones', () => {
  const pattern = Array.from({ length: 4 }, () => Array<boolean>(STEPS).fill(true));
  const s = sanitize({
    bpm: 999,
    bars: 2.6,
    sounds: false,
    keys: ['q', 'w', '', 'r'],
    notes: [36, 'x', 42, 46],
    pattern,
    extra: 'ignored',
  });
  expect(s.bpm).toBe(240);
  expect(s.bars).toBe(3);
  expect(s.sounds).toBe(false);
  expect(s.keys).toEqual(['q', 'w', '', 'r']);
  expect(s.notes).toEqual(defaultSettings().notes);
  expect(s.pattern).toEqual(pattern);
  expect(s).not.toHaveProperty('extra');
});

test('rejects a pattern of the wrong shape', () => {
  expect(sanitize({ pattern: [[true]] }).pattern).toEqual(defaultSettings().pattern);
});

test('clampSetting', () => {
  expect(clampSetting('latency', -500, 0)).toBe(-200);
  expect(clampSetting('latency', NaN, 7)).toBe(7);
});

test('muted keeps a valid per-track mask only', () => {
  expect(sanitize({ muted: [true, false, false, true] }).muted).toEqual([true, false, false, true]);
  expect(sanitize({ muted: [true] }).muted).toEqual([false, false, false, false]);
});

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
  expect(sanitize({ piano: 'nope' }).piano).toEqual([]);
});

test('samePiano ignores order', () => {
  const a = [{ pitch: 60, step: 0, len: 2 }, { pitch: 64, step: 4, len: 1 }];
  expect(samePiano(a, [...a].reverse())).toBe(true);
  expect(samePiano(a, a.slice(1))).toBe(false);
});

test('note channels: valid mask kept, defaults to the GM drum channel', () => {
  expect(defaultSettings().noteChannels).toEqual([9, 9, 9, 9]);
  expect(sanitize({ noteChannels: [0, null, 15, 9] }).noteChannels).toEqual([0, null, 15, 9]);
  expect(sanitize({ noteChannels: [16, 0, 0, 0] }).noteChannels).toEqual([9, 9, 9, 9]);
});

test('patterns can be 1 to 4 bars', () => {
  expect(isPatternGrid(emptyPattern(1))).toBe(true);
  expect(isPatternGrid(emptyPattern(4))).toBe(true);
  expect(isPatternGrid(emptyPattern(5))).toBe(false);
  expect(isPatternGrid([[true]])).toBe(false);
  expect(patternBars(sanitize({ pattern: emptyPattern(3) }).pattern)).toBe(3);
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

test('removing a bar drops it and moves later bars up', () => {
  const p = emptyPattern(3);
  p[0][1] = true; // bar 1
  p[0][STEPS + 2] = true; // bar 2
  p[0][2 * STEPS + 3] = true; // bar 3
  const out = removeBar(p, 1);
  expect(out[0].length).toBe(2 * STEPS);
  expect([out[0][1], out[0][STEPS + 2], out[0][STEPS + 3]]).toEqual([true, false, true]);

  const notes = [
    { pitch: 60, step: 1, len: 1 },
    { pitch: 61, step: 18, len: 1 },
    { pitch: 62, step: 35, len: 1 },
  ];
  expect(removePianoBar(notes, 1).map((n) => [n.pitch, n.step])).toEqual([
    [60, 1],
    [62, 19],
  ]);
});

test('piano notes may sit in later bars but not cross a bar line', () => {
  expect(sanitizePiano([{ pitch: 60, step: 30, len: 2 }], 32)).toHaveLength(1);
  expect(sanitizePiano([{ pitch: 60, step: 14, len: 4 }], 32)).toHaveLength(0);
  expect(sanitizePiano([{ pitch: 60, step: 40, len: 1 }], 32)).toHaveLength(0);
});
