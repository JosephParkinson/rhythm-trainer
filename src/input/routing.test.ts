import { expect, test } from 'vitest';
import { defaultSettings } from '../core/settings';
import { routeNote } from './routing';

const PADS = 9; // channel 10
const KEYS = 0; // channel 1

test('defaults: GM drum notes on the drum channel play drums', () => {
  const s = defaultSettings();
  expect(routeNote(s, 36, PADS)).toEqual({ to: 'drum', track: 0 });
  expect(routeNote(s, 42, PADS)).toEqual({ to: 'drum', track: 2 });
});

test('a note assigned to a drum plays the drum on any channel, never the piano', () => {
  const s = defaultSettings(); // bindings learned on channel 10
  expect(routeNote(s, 36, KEYS)).toEqual({ to: 'drum', track: 0 });
  expect(routeNote(s, 38, 3)).toEqual({ to: 'drum', track: 1 });
});

test('an exact note+channel binding wins over a note-only match', () => {
  const s = { ...defaultSettings(), notes: [36, 36, null, null], noteChannels: [PADS, KEYS, null, null] };
  expect(routeNote(s, 36, KEYS)).toEqual({ to: 'drum', track: 1 });
  expect(routeNote(s, 36, PADS)).toEqual({ to: 'drum', track: 0 });
});

test('unassigned pads on a drum channel are ignored instead of playing piano', () => {
  expect(routeNote(defaultSettings(), 37, PADS)).toEqual({ to: 'ignore' });
});

test('unassigned notes on other channels play the piano', () => {
  expect(routeNote(defaultSettings(), 60, KEYS)).toEqual({ to: 'piano' });
});

test('pads and keys sharing channel 1: assigned pads play drums, the rest stay piano', () => {
  const s = { ...defaultSettings(), notes: [48, 50, null, null], noteChannels: [KEYS, KEYS, null, null] };
  expect(routeNote(s, 48, KEYS)).toEqual({ to: 'drum', track: 0 });
  expect(routeNote(s, 60, KEYS)).toEqual({ to: 'piano' });
});
