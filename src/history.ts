import type { RunResult } from './plan';
import { collect, summarize, type Sample, type TimingStats } from './scoring';
import { STEPS_PER_BEAT, TRACKS, newId, type KeyValueStore } from './settings';

export interface SegmentRecord {
  patternId: string | null;
  name: string;
  bpm: number;
  bars: number;
  total: TimingStats;
  /** per track */
  tracks: TimingStats[];
}

export interface RunSummary {
  total: TimingStats;
  /** per track, across all segments */
  tracks: TimingStats[];
  /** per position in the beat (1, e, &, a), across all segments */
  subs: TimingStats[];
  segments: SegmentRecord[];
}

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

export function summariseRun(r: RunResult): RunSummary {
  const per = (f: (seg: number) => Sample) => summarize(r.takes.map((_, i) => f(i)));
  const pattern = (i: number) => r.plan.segments[i].pattern;
  return {
    total: per((i) => collect(r.takes[i], pattern(i))),
    tracks: TRACKS.map((_, track) => per((i) => collect(r.takes[i], pattern(i), { track }))),
    subs: Array.from({ length: STEPS_PER_BEAT }, (_, sub) => per((i) => collect(r.takes[i], pattern(i), { sub }))),
    segments: r.takes.map((take, i) => {
      const spec = r.plan.segments[i];
      return {
        patternId: spec.patternId,
        name: spec.name,
        bpm: spec.bpm,
        bars: spec.bars,
        total: summarize([collect(take, spec.pattern)]),
        tracks: TRACKS.map((_, track) => summarize([collect(take, spec.pattern, { track })])),
      };
    }),
  };
}

/** Completed runs of saved patterns and routines, for progress tracking. */
export class History {
  private records: RunRecord[];
  private readonly listeners = new Set<() => void>();

  constructor(private readonly store: KeyValueStore | null) {
    let raw: unknown = null;
    try {
      raw = JSON.parse(store?.getItem(STORE_KEY) ?? 'null');
    } catch {
      /* corrupt: start empty */
    }
    this.records = Array.isArray(raw)
      ? raw.filter(
          (x): x is RunRecord =>
            !!x && typeof x.id === 'string' && typeof x.refId === 'string' && typeof x.date === 'number' && !!x.total,
        )
      : [];
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
    try {
      this.store?.setItem(STORE_KEY, JSON.stringify(this.records));
    } catch {
      /* quota or unavailable: keep in memory */
    }
    this.listeners.forEach((fn) => fn());
  }
}
