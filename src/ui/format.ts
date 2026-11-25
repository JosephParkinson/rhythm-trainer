import type { TimingStats } from '../scoring';

export const fmtMs = (ms: number) => `${ms >= 0 ? '+' : ''}${Math.round(ms)}ms`;

/** One LCD line of stats, column-aligned. */
export function formatStats(s: TimingStats) {
  const bias = Math.round(s.bias);
  const biasTxt = bias === 0 ? '0ms' : `${Math.abs(bias)}ms ${bias > 0 ? 'LATE' : 'EARLY'}`;
  return [
    `HIT ${`${s.hit}/${s.notes}`.padEnd(6)}`,
    `EXTRA ${String(s.extra).padEnd(3)}`,
    `AVG ${`${Math.round(s.avg)}ms`.padEnd(6)}`,
    `BIAS ${biasTxt}`,
  ].join(' ');
}

/** Columns shared by the breakdown and history tables. */
export const STAT_COLUMNS: { label: string; title: string }[] = [
  { label: 'HIT', title: 'Notes hit / notes in pattern' },
  { label: 'EXTRA', title: 'Hits on empty steps, or doubles' },
  { label: 'AVG', title: 'Mean distance from the grid (ms)' },
  { label: 'BIAS', title: 'Mean offset (ms). + late, - early' },
  { label: 'SD', title: 'Spread of offsets (ms). Lower = more consistent' },
  { label: 'P90', title: '90% of notes within this (ms)' },
];

export function statCells(s: TimingStats): string[] {
  const none = s.hit === 0;
  const n = (v: number) => (none ? '-' : v.toFixed(1));
  return [
    s.notes ? `${s.hit}/${s.notes}` : '-',
    String(s.extra),
    n(s.avg),
    none ? '-' : `${s.bias > 0 ? '+' : ''}${s.bias.toFixed(1)}`,
    n(s.sd),
    n(s.p90),
  ];
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function fmtDate(ms: number) {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())} ${MONTHS[d.getMonth()]} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
