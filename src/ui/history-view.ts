import type { RunRecord } from '../history';
import { lineChart } from './chart';
import { el } from './dom';
import { STAT_COLUMNS, fmtDate, statCells } from './format';
import { table } from './table';
import { heading } from './widgets';

// Validated with the dataviz palette checker against the LCD background #0c180a.
const AVG_COLOR = '#c4841c';
const SD_COLOR = '#3f8ee6';

/** Progress over attempts: AVG and SD chart, then every run as a table (newest first). */
export function renderHistory(parent: HTMLElement, records: RunRecord[], title: string) {
  heading(parent, `HISTORY  ${title}`);
  if (!records.length) {
    el('div', 'empty', parent).textContent = 'NO RUNS YET';
    return;
  }

  lineChart(
    parent,
    [
      { name: 'AVG', color: AVG_COLOR, values: records.map((r) => r.total.avg) },
      { name: 'SD', color: SD_COLOR, values: records.map((r) => r.total.sd) },
    ],
    (i) => {
      const t = records[i].total;
      return `#${i + 1}  ${fmtDate(records[i].date)}\nAVG ${t.avg}  SD ${t.sd}  BIAS ${t.bias}\nHIT ${t.hit}/${t.notes}  EXTRA ${t.extra}`;
    },
  );

  const bpm = (r: RunRecord) => {
    const set = new Set(r.segments.map((s) => s.bpm));
    return set.size === 1 ? String([...set][0]) : 'MIX';
  };
  const rows = records
    .map((r, i) => ({ cells: [String(i + 1), fmtDate(r.date), bpm(r), ...statCells(r.total)] }))
    .reverse();
  const box = el('div', 'tablescroll', parent);
  table(box, [{ label: '#' }, { label: 'DATE' }, { label: 'BPM' }, ...STAT_COLUMNS], rows);
}
