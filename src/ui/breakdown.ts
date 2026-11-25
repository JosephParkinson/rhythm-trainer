import { summariseRun } from '../history';
import type { RunResult } from '../plan';
import type { TimingStats } from '../scoring';
import { TRACKS } from '../settings';
import { STAT_COLUMNS, statCells } from './format';
import { table } from './table';
import { button, heading } from './widgets';

const POSITIONS = ['1', 'E', '&', 'A'];
const PLAY = '▶';
const PAUSE = '❚❚';

export interface BreakdownEvents {
  /** a pattern row was clicked */
  select(seg: number): void;
  /** a pattern's ▶ (or, while it replays, its pause) was clicked */
  replay(seg: number): void;
}

/**
 * Raw timing table for a finished run: per pattern, per drum, and per beat
 * position. Pattern rows can be clicked to review that pattern, and ▶ replays it.
 */
export class Breakdown {
  /** table row of each segment */
  private segRows: HTMLTableRowElement[] = [];
  private playButtons: HTMLButtonElement[] = [];

  constructor(
    private readonly root: HTMLElement,
    private readonly ev: BreakdownEvents,
  ) {}

  /** `muted` tracks are left out of the figures. */
  render(result: RunResult | null, muted: readonly boolean[] = []) {
    this.root.replaceChildren();
    this.root.hidden = !result;
    this.segRows = [];
    this.playButtons = [];
    if (!result) return;

    const sum = summariseRun(result, muted);
    const routine = !!result.plan.routineId;
    const rows: { cells: string[]; cls?: string }[] = [];
    const segIndex: number[] = []; // table row → segment, -1 for other rows
    const add = (label: string, bpm: string, bars: string, s: TimingStats, cls: string, seg = -1) => {
      rows.push({ cells: [label, bpm, bars, ...statCells(s)], cls });
      segIndex.push(seg);
    };
    const drums = (stats: TimingStats[]) =>
      stats.forEach((s, t) => (s.notes || s.extra) && add(`  ${TRACKS[t].name}`, '', '', s, 'sub'));

    sum.segments.forEach((seg, i) => {
      add(routine ? `${i + 1}. ${seg.name}` : seg.name, String(seg.bpm), String(seg.bars), seg.total, 'seg pick', i);
      drums(seg.tracks);
    });
    if (sum.segments.length > 1) {
      const bars = sum.segments.reduce((a, s) => a + s.bars, 0);
      add('TOTAL', '', String(bars), sum.total, 'seg total');
      drums(sum.tracks);
    }
    rows.push({ cells: ['POSITION'], cls: 'group' });
    segIndex.push(-1);
    sum.subs.forEach((s, i) => s.notes && add(`  ${POSITIONS[i]}`, '', '', s, 'sub'));

    heading(this.root, 'BREAKDOWN (MS)');
    const t = table(this.root, [{ label: '' }, { label: 'BPM' }, { label: 'BARS' }, ...STAT_COLUMNS], rows);

    [...t.tBodies[0].rows].forEach((tr, r) => {
      const seg = segIndex[r];
      if (seg < 0) return;
      this.segRows[seg] = tr;
      tr.title = 'Review this pattern';
      tr.addEventListener('click', () => this.ev.select(seg));
      const play = button(tr.cells[0], PLAY, () => this.ev.replay(seg), 'btn tiny');
      play.title = 'Replay this pattern';
      play.addEventListener('click', (e) => e.stopPropagation());
      tr.cells[0].prepend(play);
      this.playButtons[seg] = play;
    });
  }

  /** Highlights the pattern under review; the one being replayed gets a lit pause button. */
  setCurrent(seg: number, replaying: boolean) {
    this.segRows.forEach((tr, i) => tr.classList.toggle('cur', i === seg));
    this.playButtons.forEach((b, i) => {
      const on = replaying && i === seg;
      b.classList.toggle('lit', on);
      b.textContent = on ? PAUSE : PLAY;
      b.title = on ? 'Pause' : 'Replay this pattern';
    });
  }

  /** Locks the ▶ buttons and row clicks (e.g. during a preview or calibration). */
  setLocked(locked: boolean) {
    this.playButtons.forEach((b) => (b.disabled = locked));
    this.segRows.forEach((tr) => tr.classList.toggle('locked', locked));
  }
}
