import { STEPS, STEPS_PER_BEAT, TRACKS, patternSteps, type Pattern } from './settings';

export const GOOD_MS = 20;
export const OK_MS = 45;

export interface Hit {
  track: number;
  /** global 16th index from the start of the take */
  step: number;
  /** ms from that 16th; positive = late */
  err: number;
  /** 0–1; always 1 for computer keys */
  vel: number;
}

/** One recorded run of one pattern: hits snapped to the 16th grid, indexed by cell. */
export class Take {
  readonly hits: Hit[] = [];
  private readonly cells = new Map<number, Hit[]>();

  /** `start` is the AudioContext time of the first 16th. */
  constructor(
    readonly start: number,
    readonly stepDur: number,
    readonly bars: number,
  ) {}

  get steps() {
    return this.bars * STEPS;
  }

  get end() {
    return this.start + this.steps * this.stepDur;
  }

  /** Snaps a hit at AudioContext time `t` to the nearest 16th; null if outside the take. */
  record(track: number, t: number, vel: number): Hit | null {
    const rel = t - this.start;
    const step = Math.round(rel / this.stepDur) || 0; // no -0
    if (step < 0 || step >= this.steps) return null;
    const hit: Hit = { track, step, err: (rel - step * this.stepDur) * 1000, vel };
    this.hits.push(hit);
    const key = this.key(track, step);
    const cell = this.cells.get(key);
    if (cell) cell.push(hit);
    else this.cells.set(key, [hit]);
    return hit;
  }

  at(track: number, step: number): readonly Hit[] {
    return this.cells.get(this.key(track, step)) ?? [];
  }

  private key(track: number, step: number) {
    return step * TRACKS.length + track;
  }
}

export type Grade = 'good' | 'ok' | 'bad' | 'extra';

export const gradeErr = (err: number): Grade =>
  Math.abs(err) <= GOOD_MS ? 'good' : Math.abs(err) <= OK_MS ? 'ok' : 'bad';

const closest = (hits: readonly Hit[]) =>
  hits.reduce<Hit | undefined>((b, h) => (!b || Math.abs(h.err) < Math.abs(b.err) ? h : b), undefined);

/**
 * Grades the hits in one cell. On a target step the closest hit is graded and
 * the rest are extras; on any other step every hit is an extra.
 */
export function scoreCell(hits: readonly Hit[], target: boolean): { hit: Hit; grade: Grade }[] {
  const best = target ? closest(hits) : undefined;
  return hits.map((hit) => ({ hit, grade: hit === best ? gradeErr(hit.err) : 'extra' }));
}

/** Raw material for stats; samples from several takes can be summarised together. */
export interface Sample {
  /** error of the best hit on each hit target, ms */
  errs: number[];
  /** target notes */
  notes: number;
  extra: number;
}

export interface CellFilter {
  track?: number;
  /** position in the beat: 0 = on the beat, 1 = e, 2 = &, 3 = a */
  sub?: number;
  fromBar?: number;
  toBar?: number;
  /** per track: skipped entirely (no targets, no extras) */
  muted?: readonly boolean[];
}

export function collect(take: Take, pattern: Pattern, f: CellFilter = {}): Sample {
  const errs: number[] = [];
  let notes = 0;
  let extra = 0;
  const len = patternSteps(pattern); // the pattern loops over the take
  for (let step = (f.fromBar ?? 0) * STEPS; step < (f.toBar ?? take.bars) * STEPS; step++) {
    if (f.sub !== undefined && step % STEPS_PER_BEAT !== f.sub) continue;
    for (let t = 0; t < TRACKS.length; t++) {
      if ((f.track !== undefined && t !== f.track) || f.muted?.[t]) continue;
      const hits = take.at(t, step);
      if (pattern[t][step % len]) {
        notes++;
        const best = closest(hits);
        if (best) errs.push(best.err);
        extra += Math.max(0, hits.length - 1);
      } else extra += hits.length;
    }
  }
  return { errs, notes, extra };
}

/** Timing metrics in ms, to 0.1. */
export interface TimingStats {
  notes: number;
  hit: number;
  extra: number;
  /** mean absolute error */
  avg: number;
  /** mean signed error; positive = late */
  bias: number;
  /** standard deviation of signed error: consistency */
  sd: number;
  /** 90th percentile of absolute error */
  p90: number;
}

export function summarize(samples: Sample[]): TimingStats {
  const errs = samples.flatMap((s) => s.errs);
  const n = errs.length;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const abs = errs.map(Math.abs).sort((a, b) => a - b);
  const bias = mean(errs);
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    notes: samples.reduce((a, s) => a + s.notes, 0),
    hit: n,
    extra: samples.reduce((a, s) => a + s.extra, 0),
    avg: r1(mean(abs)),
    bias: r1(bias),
    sd: r1(Math.sqrt(mean(errs.map((e) => (e - bias) ** 2)))),
    p90: r1(n ? abs[Math.ceil(0.9 * n) - 1] : 0),
  };
}

export const timing = (take: Take, pattern: Pattern, f?: CellFilter) => summarize([collect(take, pattern, f)]);
