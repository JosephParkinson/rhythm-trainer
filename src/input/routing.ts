import { GM_DRUM_CHANNEL, type Settings } from '../settings';

export type Route = { to: 'drum'; track: number } | { to: 'piano' } | { to: 'ignore' };

/**
 * Where a MIDI note goes:
 * 1. A note assigned to a drum always plays that drum, never the piano. An exact
 *    note+channel binding wins; otherwise the note number alone matches.
 * 2. Any other note on the General MIDI drum channel (10) is ignored, so
 *    unassigned pads (e.g. MPK Mini pads on channel 10) don't play the piano.
 *    Other channels aren't ignored: pads and keys may share one.
 * 3. Everything else plays the piano.
 */
export function routeNote(s: Pick<Settings, 'notes' | 'noteChannels'>, note: number, channel: number): Route {
  const exact = s.notes.findIndex((n, t) => n === note && (s.noteChannels[t] ?? channel) === channel);
  const track = exact >= 0 ? exact : s.notes.indexOf(note);
  if (track >= 0) return { to: 'drum', track };
  if (channel === GM_DRUM_CHANNEL) return { to: 'ignore' };
  return { to: 'piano' };
}
