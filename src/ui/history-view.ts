import { withMetronome, type RunRecord } from '../history';
import { lineChart } from './chart';
import { el } from './dom';
import { STAT_COLUMNS, fmtDate, statCells } from './format';
import { table } from './table';
import { heading } from './widgets';

// The app's own colours: LED amber (--led) and a darker LCD green. Checked with the
// dataviz palette validator against the LCD background #0c180a: colour-blind and
// normal-vision separation and contrast pass; the amber is brighter than the
// validator's lightness band, which is accepted to match the LEDs.
const AVG_COLOR = '#ffb02e';
const SD_COLOR = '#45a535';

/**
 * Progress over attempts, kept apart for runs with and without the metronome
 * (no metronome is harder). Two tabs pick which; `metronome` picks the first one
 * shown (default: the latest run's). Chart of AVG and SD, then every run as a
 * table (newest first).
 */
export function renderHistory(parent: HTMLElement, all: RunRecord[], title: string, metronome?: boolean) {
  let showing = metronome ?? (all.length ? withMetronome(all[all.length - 1]) : true);

  const head = el('div', 'histhead', parent);
  heading(head, `HISTORY  ${title}`);
  const tabs = el('div', 'tabs push', head);
  const body = el('div', '', parent);
  const buttons = ([true, false] as const).map((on) => {
    const b = el('button', 'btn tab small', tabs);
    b.textContent = `${on ? 'METRONOME' : 'NO METRONOME'} ${all.filter((r) => withMetronome(r) === on).length}`;
    b.title = on ? 'Runs with the metronome on' : 'Runs with the metronome off';
    b.addEventListener('click', () => {
      showing = on;
      render();
    });
    return b;
  });

  const render = () => {
    buttons.forEach((b, i) => b.classList.toggle('lit', showing === (i === 0)));
    body.replaceChildren();
    renderRecords(
      body,
      all.filter((r) => withMetronome(r) === showing),
    );
  };
  render();
}

function renderRecords(parent: HTMLElement, records: RunRecord[]) {
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
