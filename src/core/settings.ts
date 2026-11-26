import { TRACKS, isPatternGrid, patternSteps, sanitizePiano, stepRow, type Pattern, type PianoNote } from './pattern';
import { readJson, writeJson, type KeyValueStore } from './storage';
import { isArrayOf, isBool, isInt, isObj } from './validate';

/** General MIDI drum channel (10, zero-based). */
export const GM_DRUM_CHANNEL = 9;

/** Everything the trainer remembers between visits, including the pattern being edited. */
export interface Settings {
  bpm: number;
  countIn: number;
  /** bars played in TEST */
  bars: number;
  /** ms subtracted from every hit */
  latency: number;
  metronome: boolean;
  /** drum sound on live hits */
  sounds: boolean;
  /** no drum sound on live hits during TEST */
  muteOnTest: boolean;
  /** play the whole pattern once before the count-in */
  hearFirst: boolean;
  /** smallest audio output buffer */
  lowLatency: boolean;
  /** per track; '' = unbound */
  keys: string[];
  /** per track MIDI note; null = unbound */
  notes: (number | null)[];
  /** per track MIDI channel (0–15) the note must arrive on; null = any channel */
  noteChannels: (number | null)[];
  /** per track: silent in playback and not scored */
  muted: boolean[];
  /** the editor's pattern */
  pattern: Pattern;
  /** the editor's drawn keyboard part */
  piano: PianoNote[];
  /** keyboard part silent in playback */
  pianoMuted: boolean;
  /** piano roll panel expanded */
  pianoOpen: boolean;
  /** saved pattern the editor was loaded from / saved to */
  patternId: string | null;
}

/** The single source of min/max for number settings and their inputs. */
export const NUMBER_LIMITS = {
  bpm: [40, 240],
  countIn: [0, 4],
  bars: [1, 64],
  latency: [-200, 300],
} as const satisfies Record<string, readonly [number, number]>;

export type NumberSetting = keyof typeof NUMBER_LIMITS;

const FLAGS = ['metronome', 'sounds', 'muteOnTest', 'hearFirst', 'lowLatency', 'pianoMuted', 'pianoOpen'] as const;
export type FlagSetting = (typeof FLAGS)[number];

export function defaultSettings(): Settings {
  return {
    bpm: 90,
    countIn: 1,
    bars: 4,
    latency: 0,
    metronome: true,
    sounds: true,
    muteOnTest: false,
    hearFirst: false,
    lowLatency: true,
    keys: ['a', 's', 'd', 'f'],
    notes: [36, 38, 42, 46], // General MIDI kick, snare, closed hat, open hat
    noteChannels: TRACKS.map(() => GM_DRUM_CHANNEL),
    muted: TRACKS.map(() => false),
    pattern: [stepRow([0, 8]), stepRow([4, 12]), stepRow([0, 2, 4, 6, 8, 10, 12, 14]), stepRow()],
    piano: [],
    pianoMuted: false,
    pianoOpen: true,
    patternId: null,
  };
}

/** Rounds and clamps to the setting's limits; non-finite input returns `fallback`. */
export function clampSetting(id: NumberSetting, value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  const [min, max] = NUMBER_LIMITS[id];
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Builds settings from untrusted stored data, field by field: a new setting only needs a default. */
export function sanitize(raw: unknown): Settings {
  const s = defaultSettings();
  if (!isObj(raw)) return s;
  const n = TRACKS.length;

  for (const id of Object.keys(NUMBER_LIMITS) as NumberSetting[]) {
    if (typeof raw[id] === 'number') s[id] = clampSetting(id, raw[id], s[id]);
  }
  for (const id of FLAGS) if (isBool(raw[id])) s[id] = raw[id];
  if (isArrayOf<string>(raw.keys, n, (k) => typeof k === 'string' && k.length <= 1)) s.keys = raw.keys;
  if (isArrayOf<number | null>(raw.notes, n, (v) => v === null || isInt(v, 0, 127))) s.notes = raw.notes;
  if (isArrayOf<number | null>(raw.noteChannels, n, (v) => v === null || isInt(v, 0, 15))) s.noteChannels = raw.noteChannels;
  if (isArrayOf<boolean>(raw.muted, n, isBool)) s.muted = raw.muted;
  if (isPatternGrid(raw.pattern)) s.pattern = raw.pattern;
  s.piano = sanitizePiano(raw.piano, patternSteps(s.pattern));
  if (typeof raw.patternId === 'string') s.patternId = raw.patternId;
  return s;
}

const STORE_KEY = 'rhythm-trainer';

export const loadSettings = (store: KeyValueStore) => sanitize(readJson(store, STORE_KEY));
export const saveSettings = (store: KeyValueStore, s: Settings) => writeJson(store, STORE_KEY, s);
