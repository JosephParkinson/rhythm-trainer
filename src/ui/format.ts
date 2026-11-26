import type { RunPlan } from '../core/plan';
import type { TimingStats } from '../core/scoring';

/** Signed ms, e.g. "+12ms". */
export const fmtMs = (ms: number) => `${ms >= 0 ? '+' : ''}${Math.round(ms)}ms`;

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

const MAX_NAME = 16;

/** Transport readout for a segment of a run: in a routine, prefixed with the pattern's number and name. */
export function segmentStatus(plan: RunPlan, seg: number, text: string) {
  if (!plan.routineId) return text;
  return `${seg + 1}/${plan.segments.length} ${plan.segments[seg].name.slice(0, MAX_NAME)}  ${text}`;
}
