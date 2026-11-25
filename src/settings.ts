import type { Voice } from './audio/engine';

/** 16ths per bar. */
export const STEPS = 16;
export const STEPS_PER_BEAT = 4;
export const BEATS_PER_BAR = STEPS / STEPS_PER_BEAT;

export interface Track {
  name: string;
  voice: Voice;
}

export const TRACKS: readonly Track[] = [
  { name: 'K', voice: 'kick' },
  { name: 'S', voice: 'snare' },
  { name: 'HH', voice: 'hat' },
  { name: 'OH', voice: 'openhat' },
];

/** pattern[track][step] */
export type Pattern = boolean[][];

/** click[0] = accented (high) click, click[1] = normal click; [row][step]. */
export type ClickPattern = boolean[][];
export const CLICK_ROWS = ['HI', 'LO'];

export interface Settings {
  bpm: number;
  countIn: number;
  bars: number;
  /** ms subtracted from every hit */
  latency: number;
  metronome: boolean;
  /** drum sound on live hits */
  sounds: boolean;
  /** play one bar of the pattern before the count-in */
  hearFirst: boolean;
  /** smallest audio output buffer */
  lowLatency: boolean;
  /** per track; '' = unbound */
  keys: string[];
  /** per track MIDI note; null = unbound */
  notes: (number | null)[];
  /** the editor's pattern */
  pattern: Pattern;
  /** saved pattern the editor was loaded from / saved to */
  patternId: string | null;
}

export const NUMBER_LIMITS = {
  bpm: [40, 240],
  countIn: [0, 4],
  bars: [1, 64],
  latency: [-200, 300],
} as const satisfies Record<string, readonly [number, number]>;

export type NumberSetting = keyof typeof NUMBER_LIMITS;

const row = (on: number[] = []) => Array.from({ length: STEPS }, (_, i) => on.includes(i));

export const emptyPattern = (): Pattern => TRACKS.map(() => row());
export const defaultClick = (): ClickPattern => [row([0]), row([4, 8, 12])];
export const emptyClick = (): ClickPattern => [row(), row()];
export const cloneGrid = (g: boolean[][]) => g.map((r) => [...r]);
export const sameGrid = (a: boolean[][], b: boolean[][]) => a.every((r, i) => r.every((v, j) => v === b[i]?.[j]));

export function defaultSettings(): Settings {
  return {
    bpm: 90,
    countIn: 1,
    bars: 4,
    latency: 0,
    metronome: true,
    sounds: true,
    hearFirst: false,
    lowLatency: true,
    keys: ['a', 's', 'd', 'f'],
    notes: [36, 38, 42, 46], // General MIDI kick, snare, closed hat, open hat
    pattern: [row([0, 8]), row([4, 12]), row([0, 2, 4, 6, 8, 10, 12, 14]), row()],
    patternId: null,
  };
}

/** Rounds and clamps to the setting's limits; non-finite input returns `fallback`. */
export function clampSetting(id: NumberSetting, value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  const [min, max] = NUMBER_LIMITS[id];
  return Math.min(max, Math.max(min, Math.round(value)));
}

export const isArrayOf = <T>(x: unknown, len: number, ok: (v: unknown) => boolean): x is T[] =>
  Array.isArray(x) && x.length === len && x.every(ok);

/** A boolean grid with `rows` rows of STEPS steps. */
export const isGrid = (x: unknown, rows: number): x is boolean[][] =>
  isArrayOf(x, rows, (r) => isArrayOf(r, STEPS, (b) => typeof b === 'boolean'));

/** Builds settings from untrusted stored data, keeping defaults for anything missing or malformed. */
export function sanitize(raw: unknown): Settings {
  const s = defaultSettings();
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Record<string, unknown>;

  for (const id of Object.keys(NUMBER_LIMITS) as NumberSetting[]) {
    if (typeof r[id] === 'number') s[id] = clampSetting(id, r[id], s[id]);
  }
  for (const id of ['metronome', 'sounds', 'hearFirst', 'lowLatency'] as const) {
    if (typeof r[id] === 'boolean') s[id] = r[id];
  }
  if (isArrayOf<string>(r.keys, TRACKS.length, (k) => typeof k === 'string' && k.length <= 1)) s.keys = r.keys;
  if (isArrayOf<number | null>(r.notes, TRACKS.length, (n) => n === null || (Number.isInteger(n) && (n as number) >= 0 && (n as number) < 128))) {
    s.notes = r.notes;
  }
  if (isGrid(r.pattern, TRACKS.length)) s.pattern = r.pattern;
  if (typeof r.patternId === 'string') s.patternId = r.patternId;
  return s;
}

const STORE_KEY = 'rhythm-trainer';

export function loadSettings(): Settings {
  try {
    return sanitize(JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null'));
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings last for this visit only */
  }
}

/** Key-value storage (localStorage, or a fake in tests). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** localStorage if usable, else null (data then lasts for this visit only). */
export function browserStore(): KeyValueStore | null {
  try {
    localStorage.getItem('');
    return localStorage;
  } catch {
    return null;
  }
}

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
