import { TRACKS, type Settings } from '../settings';
import { initMidi, type NoteEvent } from './midi';
import { routeNote } from './routing';

export type HitHandler = (track: number, perfMs: number, vel: number) => void;
/** A MIDI note for the keyboard instrument (on or off). */
export type PianoHandler = (e: NoteEvent) => void;

/**
 * Routes computer keys and MIDI notes to drum tracks, and other MIDI notes to
 * the keyboard instrument (see routing.ts). Each track has one key and one
 * note+channel. After learn(track), the next key or note becomes that track's
 * binding of that kind and is removed from any other track.
 */
export class Bindings {
  learning: number | null = null;

  constructor(
    private readonly settings: Settings,
    private readonly onHit: HitHandler,
    /** bindings or learn state changed */
    private readonly onChange: () => void,
    private readonly onPiano: PianoHandler,
  ) {
    window.addEventListener('keydown', (e) => this.onKey(e));
    // Clicking anywhere except a binding button cancels learn.
    window.addEventListener('mousedown', (e) => {
      if (this.learning !== null && !(e.target as Element).closest('.bind')) this.learn(null);
    });
  }

  /** `onDevices(null)` means MIDI is unavailable. */
  startMidi(onDevices: (names: string[] | null) => void) {
    void initMidi((e) => this.onNote(e), onDevices).then((ok) => ok || onDevices(null));
  }

  learn(track: number | null) {
    if (track === this.learning) return;
    this.learning = track;
    this.onChange();
  }

  labels(): string[] {
    return TRACKS.map((_, t) => {
      const k = this.settings.keys[t];
      const n = this.settings.notes[t];
      const parts = [k === ' ' ? 'SPC' : k.toUpperCase(), n === null ? '' : String(n)];
      return parts.filter(Boolean).join(' ') || '-';
    });
  }

  private onKey(e: KeyboardEvent) {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (this.learning !== null) {
      if (e.key === 'Tab') return;
      e.preventDefault();
      if (e.key === 'Escape') this.learn(null);
      else if (e.key.length === 1) this.assignKey(this.learning, key);
      return;
    }
    const tgt = e.target;
    if (tgt instanceof HTMLInputElement && tgt.type !== 'checkbox' && !tgt.disabled) return; // typing in a box
    if (tgt instanceof HTMLSelectElement || (tgt instanceof Element && tgt.closest('.overlay'))) return;
    const track = this.settings.keys.indexOf(key);
    if (track < 0) return;
    e.preventDefault();
    this.onHit(track, e.timeStamp, 1);
  }

  private onNote(e: NoteEvent) {
    if (this.learning !== null) {
      if (e.on) this.assignNote(this.learning, e.note, e.channel);
      return;
    }
    const route = routeNote(this.settings, e.note, e.channel);
    if (route.to === 'drum') {
      if (e.on) this.onHit(route.track, e.timeStamp, e.vel);
    } else if (route.to === 'piano') this.onPiano(e);
  }

  private assignKey(track: number, key: string) {
    this.settings.keys = rebind(this.settings.keys, track, key, '');
    this.learnDone();
  }

  /** Binds note+channel, so the same note number on another channel stays free for the keyboard. */
  private assignNote(track: number, note: number, channel: number) {
    const { notes, noteChannels } = this.settings;
    const clash = notes.findIndex((n, t) => n === note && noteChannels[t] === channel);
    if (clash >= 0) {
      notes[clash] = null;
      noteChannels[clash] = null;
    }
    notes[track] = note;
    noteChannels[track] = channel;
    this.learnDone();
  }

  private learnDone() {
    this.learning = null;
    this.onChange();
  }
}

/** Gives `value` to `track`, unbinding it from any other track. */
function rebind<T>(list: T[], track: number, value: T, unbound: T): T[] {
  const next = list.map((v) => (v === value ? unbound : v));
  next[track] = value;
  return next;
}
