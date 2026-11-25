import { expect, test } from 'vitest';
import { defaultSettings } from '../settings';
import { routeNote } from './routing';

const PADS = 9; // channel 10
const KEYS = 0; // channel 1

test('defaults: GM drum notes on the drum channel play drums', () => {
  const s = defaultSettings();
  expect(routeNote(s, 36, PADS)).toEqual({ to: 'drum', track: 0 });
  expect(routeNote(s, 42, PADS)).toEqual({ to: 'drum', track: 2 });
});

test('the same note number from the keys plays piano, not a drum', () => {
  expect(routeNote(defaultSettings(), 36, KEYS)).toEqual({ to: 'piano' });
});

test('unbound pads on a drum channel are ignored instead of playing piano', () => {
  expect(routeNote(defaultSettings(), 37, PADS)).toEqual({ to: 'ignore' });
});

test('a binding learned without a channel matches any channel', () => {
  const s = { ...defaultSettings(), notes: [60, null, null, null], noteChannels: [null, null, null, null] };
  expect(routeNote(s, 60, KEYS)).toEqual({ to: 'drum', track: 0 });
  expect(routeNote(s, 61, KEYS)).toEqual({ to: 'piano' });
});

test('pads learned on channel 1 claim channel 1, so other keys there are ignored', () => {
  const s = { ...defaultSettings(), notes: [48, 50, null, null], noteChannels: [KEYS, KEYS, null, null] };
  expect(routeNote(s, 48, KEYS)).toEqual({ to: 'drum', track: 0 });
  expect(routeNote(s, 60, KEYS)).toEqual({ to: 'ignore' });
  expect(routeNote(s, 60, 1)).toEqual({ to: 'piano' });
});
