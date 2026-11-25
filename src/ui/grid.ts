import { scoreCell, type Take } from '../scoring';
import { MAX_PATTERN_BARS, STEPS, STEPS_PER_BEAT, TRACKS, patternBars, patternSteps, type Pattern } from '../settings';
import { el } from './dom';
import { fmtMs } from './format';

export interface GridEvents {
  /** a cell was clicked; `step` is the pattern step (page × 16 + column) */
  toggle(track: number, step: number): void;
  muteClick(track: number): void;
  /** a bar square inside the pattern was clicked: view that bar */
  pageClick(page: number): void;
  /** a dark square was clicked: extend to that many bars */
  extend(bars: number): void;
  /** a lit square was double- or right-clicked: delete every bar after it */
  cutAfter(page: number): void;
  /** the page shown changed (by click or by following playback) */
  pageChanged(page: number): void;
}

const FLASH_MS = 90;

/**
 * The step grid shows one bar (page) of the pattern at a time: step LEDs, track
 * rows (label light = mute toggle), cells with hit markers.
 * Four bar squares (in the transport row) show the pattern's length (amber) and
 * the bar on screen (bright), pulse on the beat for the bar PLAY is on, and set the
 * length: click a dark one to extend, double- or right-click a lit one to delete the bars after it.
 */
export class Grid {
  private readonly leds: HTMLElement[] = [];
  private readonly cells: HTMLElement[][] = [];
  private readonly labels: HTMLButtonElement[] = [];
  private readonly flashTimers: number[] = [];
  private readonly squares: HTMLButtonElement[] = [];
  private playingPage = -1;
  private beat = false;
  private ledsOff = false;
  private lengthLocked = false;
  /** the last single click was on a dark square */
  private clickExtended = false;
  private muted: readonly boolean[] = [];
  private pattern: Pattern = [];
  private page = 0;
  private playhead = -1;

  constructor(
    root: HTMLElement,
    pagesRoot: HTMLElement,
    private readonly ev: GridEvents,
  ) {
    for (let p = 0; p < MAX_PATTERN_BARS; p++) {
      const sq = el('button', 'barsq', pagesRoot);
      sq.addEventListener('click', (e) => e.detail <= 1 && this.squareClick(p));
      sq.addEventListener('dblclick', () => !this.clickExtended && this.cutAfter(p));
      sq.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.cutAfter(p);
      });
      this.squares.push(sq);
    }

    el('div', '', root);
    for (let s = 0; s < STEPS; s++) this.leds.push(el('div', 'stepled', root));

    TRACKS.forEach((track, t) => {
      const head = el('div', 'rowhead', root);
      const label = el('button', 'lbl', head);
      label.textContent = track.name;
      label.title = 'Click to mute';
      label.addEventListener('click', () => ev.muteClick(t));
      this.labels.push(label);

      this.cells.push(
        Array.from({ length: STEPS }, (_, s) => {
          const cell = el('div', Math.floor(s / STEPS_PER_BEAT) % 2 ? 'cell alt' : 'cell', root);
          cell.addEventListener('mousedown', () => ev.toggle(t, this.page * STEPS + s));
          return cell;
        }),
      );
    });
  }

  get currentPage() {
    return this.page;
  }

  /** Shows a pattern (keeping the page if it still exists). */
  setPattern(p: Pattern) {
    this.pattern = p;
    const bars = patternBars(p);
    if (this.page >= bars) this.setPage(bars - 1);
    else this.renderPage();
  }

  /** The bar PLAY is on (-1: none). Its square pulses while `beat` is true. */
  setPlayingPage(page: number, beat = false) {
    if (page === this.playingPage && beat === this.beat) return;
    this.playingPage = page;
    this.beat = beat;
    this.renderSquares();
  }

  /** Lengths can only change while idle with the editor pattern loaded. */
  setLengthLocked(locked: boolean) {
    this.lengthLocked = locked;
    this.renderSquares();
  }

  setPage(page: number) {
    if (page === this.page) return;
    this.page = page;
    this.renderPage();
    this.ev.pageChanged(page);
  }

  /** Draws one cell's hits; `step` is the take's global step. In review, empty targets show as missed. */
  showCell(take: Take, pattern: Pattern, track: number, step: number, review: boolean) {
    const cell = this.cells[track][step % STEPS];
    const target = pattern[track][step % patternSteps(pattern)];
    const hits = this.muted[track] ? [] : take.at(track, step);
    cell.querySelectorAll('.mk').forEach((m) => m.remove());
    cell.classList.toggle('miss', review && target && hits.length === 0 && !this.muted[track]);

    const halfStepMs = take.stepDur * 500;
    for (const { hit, grade } of scoreCell(hits, target)) {
      const m = el('div', `mk ${grade}`, cell);
      // Centre line is on time; cell edges are ±half a 16th.
      m.style.left = `${Math.min(96, Math.max(4, 50 + (hit.err / halfStepMs) * 50))}%`;
      m.title = fmtMs(hit.err);
    }
  }

  /** Shows bar `bar` of a take: the matching pattern page plus that bar's hits. */
  showBar(take: Take, pattern: Pattern, bar: number, review: boolean) {
    if (pattern !== this.pattern) this.setPattern(pattern);
    this.setPage(bar % patternBars(pattern));
    for (let t = 0; t < TRACKS.length; t++) {
      for (let s = 0; s < STEPS; s++) this.showCell(take, pattern, t, bar * STEPS + s, review);
    }
  }

  clear() {
    for (const c of this.cells.flat()) {
      c.classList.remove('miss');
      c.querySelectorAll('.mk').forEach((m) => m.remove());
    }
  }

  /** Greys out the step lights (TEST without a metronome). */
  setStepLedsOff(off: boolean) {
    if (off === this.ledsOff) return;
    this.ledsOff = off;
    this.leds.forEach((l) => l.classList.toggle('off', off));
  }

  /** Column 0–15 of the current page; -1 hides it. */
  setPlayhead(step: number) {
    if (step === this.playhead) return;
    this.leds[this.playhead]?.classList.remove('lit');
    this.leds[step]?.classList.add('lit');
    this.playhead = step;
  }

  flash(track: number) {
    this.labels[track].classList.add('flash');
    clearTimeout(this.flashTimers[track]);
    this.flashTimers[track] = window.setTimeout(() => this.labels[track].classList.remove('flash'), FLASH_MS);
  }

  /** Muted rows: light off, cells dimmed, no hits shown. Redraw the bar afterwards to update markers. */
  setMuted(muted: readonly boolean[]) {
    this.muted = [...muted];
    this.labels.forEach((b, t) => {
      b.classList.toggle('muted', !!muted[t]);
      b.title = muted[t] ? 'Muted. Click to unmute' : 'Click to mute';
    });
    this.cells.forEach((row, t) => row.forEach((c) => c.classList.toggle('muted', !!muted[t])));
  }

  /** Mute lights stay clickable while idle or playing. */
  setMuteLocked(locked: boolean) {
    this.labels.forEach((b) => (b.disabled = locked));
  }

  /** First click of a click or double-click. */
  private squareClick(p: number) {
    this.clickExtended = p >= patternBars(this.pattern);
    if (!this.clickExtended) this.ev.pageClick(p);
    else if (!this.lengthLocked) this.ev.extend(p + 1);
  }

  /** Double-click or right-click on a lit square. (A double-click that started on a dark square only extends.) */
  private cutAfter(p: number) {
    if (p + 1 < patternBars(this.pattern) && !this.lengthLocked) this.ev.cutAfter(p);
  }

  private renderPage() {
    const base = this.page * STEPS;
    this.cells.forEach((row, t) => row.forEach((c, s) => c.classList.toggle('on', !!this.pattern[t]?.[base + s])));
    this.renderSquares();
  }

  private renderSquares() {
    const bars = patternBars(this.pattern);
    this.squares.forEach((sq, p) => {
      const inside = p < bars;
      sq.classList.toggle('in', inside);
      sq.classList.toggle('cur', p === this.page);
      sq.classList.toggle('beat', p === this.playingPage && this.beat);
      sq.disabled = !inside && this.lengthLocked;
      sq.title = inside
        ? `Bar ${p + 1}` + (p + 1 < bars && !this.lengthLocked ? `. Double-click or right-click to delete the bar${p + 2 < bars ? 's' : ''} after it` : '')
        : `Click to extend to ${p + 1} bars`;
    });
  }
}
