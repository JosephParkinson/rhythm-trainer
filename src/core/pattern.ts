/*
 * The musical data model: the step grid, drum tracks, drum patterns, the drawn
 * keyboard part and click tracks, with the helpers that edit and validate them.
 */
import { isArrayOf, isBool, isObj } from './validate';

/** 16ths per bar. */
export const STEPS = 16;
export const STEPS_PER_BEAT = 4;
export const BEATS_PER_BAR = STEPS / STEPS_PER_BEAT;
/** Patterns are 1 to 4 bars long. */
export const MAX_PATTERN_BARS = 4;

/** Seconds per 16th. */
export const stepDurFor = (bpm: number) => 60 / bpm / STEPS_PER_BEAT;

// ---------- drum tracks ----------

export type Voice = 'kick' | 'snare' | 'hat' | 'openhat';

export interface Track {
  name: string;
  voice: Voice;
}

/** The UI, settings and scoring all size themselves from this list. */
export const TRACKS: readonly Track[] = [
  { name: 'K', voice: 'kick' },
  { name: 'S', voice: 'snare' },
  { name: 'HH', voice: 'hat' },
  { name: 'OH', voice: 'openhat' },
];

// ---------- drum patterns ----------

/** pattern[track][step]; every row is STEPS × (1–4 bars) long. */
export type Pattern = boolean[][];

export const patternSteps = (p: Pattern) => p[0]?.length ?? STEPS;
export const patternBars = (p: Pattern) => Math.max(1, Math.round(patternSteps(p) / STEPS));

/** One bar of STEPS booleans with the given steps on. */
export const stepRow = (on: number[] = []) => Array.from({ length: STEPS }, (_, i) => on.includes(i));

export const emptyPattern = (bars = 1): Pattern => TRACKS.map(() => Array<boolean>(bars * STEPS).fill(false));

export const cloneGrid = (g: boolean[][]) => g.map((r) => [...r]);
export const sameGrid = (a: boolean[][], b: boolean[][]) =>
  a.length === b.length && a.every((r, i) => r.length === b[i].length && r.every((v, j) => v === b[i][j]));

/** New length in bars. Growing repeats the existing bars; shrinking drops the end. */
export function resizePattern(p: Pattern, bars: number): Pattern {
  const n = bars * STEPS;
  return p.map((r) => Array.from({ length: n }, (_, i) => r[i % r.length]));
}

/** A drum pattern: one row per track, all the same length of 1–4 whole bars. */
export function isPatternGrid(x: unknown): x is Pattern {
  if (!Array.isArray(x) || x.length !== TRACKS.length || !Array.isArray(x[0])) return false;
  const len = x[0].length;
  if (len % STEPS || len < STEPS || len > MAX_PATTERN_BARS * STEPS) return false;
  return x.every((r) => isArrayOf(r, len, isBool));
}

// ---------- keyboard part ----------

/** A drawn keyboard note: MIDI pitch, start step, length in 16ths. Never crosses a bar line. */
export interface PianoNote {
  pitch: number;
  step: number;
  len: number;
}

/** Piano roll range: C3 to B4. */
export const PIANO_LOW = 48;
export const PIANO_HIGH = 71;

export const clonePiano = (p: readonly PianoNote[]) => p.map((n) => ({ ...n }));

export function samePiano(a: readonly PianoNote[], b: readonly PianoNote[]) {
  const key = (n: PianoNote) => `${n.pitch}:${n.step}:${n.len}`;
  const keys = new Set(a.map(key));
  return a.length === b.length && b.every((n) => keys.has(key(n)));
}

/** Matches resizePattern: notes in repeated bars are copied, notes past the end dropped. */
export function resizePiano(notes: readonly PianoNote[], fromBars: number, toBars: number): PianoNote[] {
  const out: PianoNote[] = [];
  for (let bar = 0; bar < toBars; bar++) {
    for (const n of notes) {
      if (Math.floor(n.step / STEPS) === bar % fromBars) out.push({ ...n, step: (n.step % STEPS) + bar * STEPS });
    }
  }
  return out;
}

/** Keeps only well-formed notes inside the roll's range and `steps`, that don't cross a bar line. */
export function sanitizePiano(raw: unknown, steps = MAX_PATTERN_BARS * STEPS): PianoNote[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isObj)
    .map((n) => ({ pitch: Number(n.pitch), step: Number(n.step), len: Number(n.len) }))
    .filter(
      (n) =>
        Number.isInteger(n.pitch) && n.pitch >= PIANO_LOW && n.pitch <= PIANO_HIGH &&
        Number.isInteger(n.step) && n.step >= 0 && n.step < steps &&
        Number.isInteger(n.len) && n.len >= 1 && (n.step % STEPS) + n.len <= STEPS,
    );
}

// ---------- a pattern with its keyboard part ----------

/** Any drum step or keyboard note at or after `step`. */
export const hasContentFrom = (pattern: Pattern, piano: readonly PianoNote[], step: number) =>
  pattern.some((r) => r.slice(step).some(Boolean)) || piano.some((n) => n.step >= step);

// ---------- click tracks ----------

/** One bar: click[0] = accented (high) click, click[1] = normal click; [row][step]. */
export type ClickPattern = boolean[][];
export const CLICK_ROWS = ['HI', 'LO'];

export const defaultClick = (): ClickPattern => [stepRow([0]), stepRow([4, 8, 12])];
export const emptyClick = (): ClickPattern => [stepRow(), stepRow()];
/** At least one click, i.e. the metronome is on. */
export const hasClick = (c: ClickPattern) => c.some((r) => r.some(Boolean));

export const isClickPattern = (x: unknown): x is ClickPattern =>
  isArrayOf(x, CLICK_ROWS.length, (r) => isArrayOf(r, STEPS, isBool));
