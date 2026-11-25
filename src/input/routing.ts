import type { Settings } from '../settings';

export type Route = { to: 'drum'; track: number } | { to: 'piano' } | { to: 'ignore' };

/**
 * Where a MIDI note goes. A note matching a drum binding (note, plus channel if
 * the binding has one) plays that drum. Any other note on a channel used by a
 * drum binding is ignored, so pads that share note numbers with the keys (e.g.
 * MPK Mini pads on channel 10, keys on channel 1) never play the piano.
 * Everything else plays the piano.
 */
export function routeNote(s: Pick<Settings, 'notes' | 'noteChannels'>, note: number, channel: number): Route {
  const track = s.notes.findIndex((n, t) => n === note && (s.noteChannels[t] ?? channel) === channel);
  if (track >= 0) return { to: 'drum', track };
  if (s.noteChannels.includes(channel)) return { to: 'ignore' };
  return { to: 'piano' };
}
