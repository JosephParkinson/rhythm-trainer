import { STEPS_PER_BEAT, TRACKS } from './pattern';
import { usesMetronome, type RunResult } from './plan';
import { collect, summarize, timing, type Sample, type TimingStats } from './scoring';
import { Listeners, newId, readJson, writeJson, type KeyValueStore } from './storage';
import { isObj } from './validate';

export interface SegmentRecord {
  patternId: string | null;
  name: string;
  bpm: number;
  bars: number;
  total: TimingStats;
  /** per track */
  tracks: TimingStats[];
}

/** A run's figures: what the breakdown shows and history keeps (never raw hits). */
export interface RunSummary {
  total: TimingStats;
  /** per track, across all segments */
  tracks: TimingStats[];
  /** per position in the beat (1, e, &, a), across all segments */
  subs: TimingStats[];
  segments: SegmentRecord[];
  /**
   * Played with a metronome. Runs without one are harder, so history keeps
   * them apart. Missing on records from before the flag existed.
   */
  metronome?: boolean;
}

/** Old records predate the flag; the metronome was on by default then. */
export const withMetronome = (r: RunSummary) => r.metronome !== false;

export type RunKind = 'pattern' | 'routine';

export interface RunRecord extends RunSummary {
  id: string;
  /** ms since epoch */
  date: number;
  kind: RunKind;
  /** saved pattern or routine id */
  refId: string;
}

const STORE_KEY = 'rhythm-trainer-history';
const MAX_RECORDS = 2000;

/** `muted` tracks are left out of every figure. */
export function summariseRun(r: RunResult, muted: readonly boolean[] = []): RunSummary {
  const across = (f: (seg: number) => Sample) => summarize(r.takes.map((_, i) => f(i)));
  const pattern = (i: number) => r.plan.segments[i].pattern;
  return {
    metronome: usesMetronome(r.plan),
    total: across((i) => collect(r.takes[i], pattern(i), { muted })),
    tracks: TRACKS.map((_, track) => across((i) => collect(r.takes[i], pattern(i), { track, muted }))),
    subs: Array.from({ length: STEPS_PER_BEAT }, (_, sub) => across((i) => collect(r.takes[i], pattern(i), { sub, muted }))),
    segments: r.takes.map((take, i) => {
      const spec = r.plan.segments[i];
      return {
        patternId: spec.patternId,
        name: spec.name,
        bpm: spec.bpm,
        bars: spec.bars,
        total: timing(take, spec.pattern, { muted }),
        tracks: TRACKS.map((_, track) => timing(take, spec.pattern, { track, muted })),
      };
    }),
  };
}

const isRecord = (x: unknown): x is RunRecord =>
  isObj(x) && typeof x.id === 'string' && typeof x.refId === 'string' && typeof x.date === 'number' && isObj(x.total);

/** Completed runs of saved patterns and routines, for progress tracking. */
export class History {
  private records: RunRecord[];
  private readonly listeners = new Listeners();

  constructor(private readonly store: KeyValueStore) {
    const raw = readJson(store, STORE_KEY);
    this.records = Array.isArray(raw) ? raw.filter(isRecord) : [];
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
  }

  /** Oldest first. */
  for(kind: RunKind, refId: string): RunRecord[] {
    return this.records.filter((r) => r.kind === kind && r.refId === refId);
  }

  add(kind: RunKind, refId: string, result: RunResult, date = Date.now()): RunRecord {
    const rec: RunRecord = { id: newId(), date, kind, refId, ...summariseRun(result) };
    this.records.push(rec);
    if (this.records.length > MAX_RECORDS) this.records.splice(0, this.records.length - MAX_RECORDS);
    this.commit();
    return rec;
  }

  remove(kind: RunKind, refId: string) {
    this.records = this.records.filter((r) => !(r.kind === kind && r.refId === refId));
    this.commit();
  }

  private commit() {
    writeJson(this.store, STORE_KEY, this.records);
    this.listeners.notify();
  }
}
