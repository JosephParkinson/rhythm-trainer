import { expect, test } from 'vitest';
import { STEPS, clampSetting, defaultSettings, sanitize } from './settings';

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
