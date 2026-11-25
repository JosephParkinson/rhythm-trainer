import { STEPS, TRACKS, type Pattern } from './settings';

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

/** One recorded run: hits snapped to the 16th grid, indexed by cell. */
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

export interface Stats {
  hit: number;
  /** target notes */
  total: number;
  extra: number;
  /** mean absolute error, ms */
  avg: number;
  /** mean signed error, ms; positive = late */
  bias: number;
}

/** Scores bars [fromBar, toBar) against the pattern. */
export function stats(take: Take, pattern: Pattern, fromBar: number, toBar: number): Stats {
  let total = 0;
  let extra = 0;
  const errs: number[] = [];
  for (let step = fromBar * STEPS; step < toBar * STEPS; step++) {
    TRACKS.forEach((_, t) => {
      const hits = take.at(t, step);
      if (pattern[t][step % STEPS]) {
        total++;
        const best = closest(hits);
        if (best) errs.push(best.err);
        extra += Math.max(0, hits.length - 1);
      } else extra += hits.length;
    });
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    hit: errs.length,
    total,
    extra,
    avg: Math.round(mean(errs.map(Math.abs))),
    bias: Math.round(mean(errs)),
  };
}
