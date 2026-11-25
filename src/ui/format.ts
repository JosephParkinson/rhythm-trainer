import type { Stats } from '../scoring';

export const fmtMs = (ms: number) => `${ms >= 0 ? '+' : ''}${Math.round(ms)}ms`;

/** One LCD line of stats, column-aligned. */
export function formatStats(s: Stats) {
  const bias = s.bias === 0 ? '0ms' : `${Math.abs(s.bias)}ms ${s.bias > 0 ? 'LATE' : 'EARLY'}`;
  return [
    `HIT ${`${s.hit}/${s.total}`.padEnd(6)}`,
    `EXTRA ${String(s.extra).padEnd(3)}`,
    `AVG ${`${s.avg}ms`.padEnd(6)}`,
    `BIAS ${bias}`,
  ].join(' ');
}
