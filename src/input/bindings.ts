import { TRACKS, type Settings } from '../settings';
import { initMidi } from './midi';

export type HitHandler = (track: number, perfMs: number, vel: number) => void;

/**
 * Routes computer keys and MIDI notes to tracks. Each track has one key and one
 * note. After learn(track), the next key or note becomes that track's binding
 * of that kind and is removed from any other track.
 */
export class Bindings {
  learning: number | null = null;

  constructor(
    private readonly settings: Settings,
    private readonly onHit: HitHandler,
    /** bindings or learn state changed */
    private readonly onChange: () => void,
  ) {
    window.addEventListener('keydown', (e) => this.onKey(e));
    // Clicking anywhere except a binding button cancels learn.
    window.addEventListener('mousedown', (e) => {
      if (this.learning !== null && !(e.target as Element).closest('.bind')) this.learn(null);
    });
  }

  /** `onDevices(null)` means MIDI is unavailable. */
  startMidi(onDevices: (names: string[] | null) => void) {
    void initMidi((note, vel, ts) => this.onNote(note, vel, ts), onDevices).then((ok) => ok || onDevices(null));
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
    const track = this.settings.keys.indexOf(key);
    if (track < 0) return;
    e.preventDefault();
    this.onHit(track, e.timeStamp, 1);
  }

  private onNote(note: number, vel: number, ts: number) {
    if (this.learning !== null) return this.assignNote(this.learning, note);
    const track = this.settings.notes.indexOf(note);
    if (track >= 0) this.onHit(track, ts, vel);
  }

  private assignKey(track: number, key: string) {
    this.settings.keys = rebind(this.settings.keys, track, key, '');
    this.learnDone();
  }

  private assignNote(track: number, note: number) {
    this.settings.notes = rebind(this.settings.notes, track, note, null);
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
