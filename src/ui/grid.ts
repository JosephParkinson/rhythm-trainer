import { STEPS, STEPS_PER_BEAT, TRACKS, patternBars, patternSteps, type Pattern } from '../core/pattern';
import { scoreCell, type Take } from '../core/scoring';
import { BarSquares } from './bar-squares';
import { el } from './dom';
import { fmtMs } from './format';
import { setMuteLight } from './widgets';

export interface GridEvents {
  /** a cell was clicked; `step` is the pattern step (page × 16 + column) */
  toggle(track: number, step: number): void;
  muteClick(track: number): void;
  /** a bar square inside the pattern was clicked */
  pageClick(page: number): void;
  /** a dark bar square was clicked: extend to that many bars */
  extend(bars: number): void;
  /** a lit bar square was double- or right-clicked: delete every bar after it */
  cutAfter(page: number): void;
  /** the page shown changed (by click or by following playback) */
  pageChanged(page: number): void;
}

const FLASH_MS = 90;

/**
 * The step grid. Shows one bar (page) of the pattern at a time: step lights,
 * track rows (label light = mute switch) and cells with hit markers. Owns the
 * bar squares, which show and set which page is on screen.
 */
export class Grid {
  private readonly leds: HTMLElement[] = [];
  private readonly cells: HTMLElement[][] = [];
  private readonly labels: HTMLButtonElement[] = [];
  private readonly flashTimers: number[] = [];
  private readonly squares: BarSquares;
  private muted: readonly boolean[] = [];
  private pattern: Pattern = [];
  private page = 0;
  private playhead = -1;

  constructor(
    root: HTMLElement,
    squaresRoot: HTMLElement,
    private readonly ev: GridEvents,
  ) {
    this.squares = new BarSquares(squaresRoot, {
      view: (p) => ev.pageClick(p),
      extend: (bars) => ev.extend(bars),
      cutAfter: (p) => ev.cutAfter(p),
    });

    el('div', '', root);
    for (let s = 0; s < STEPS; s++) this.leds.push(el('div', 'stepled', root));

    TRACKS.forEach((track, t) => {
      const label = el('button', 'lbl', el('div', 'rowhead', root));
      label.textContent = track.name;
      label.addEventListener('click', () => ev.muteClick(t));
      setMuteLight(label, false);
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

  setPage(page: number) {
    if (page === this.page) return;
    this.page = page;
    this.renderPage();
    this.ev.pageChanged(page);
  }

  /** The bar PLAY is on (-1: none); its square pulses while `beat`. */
  setPlayingPage(page: number, beat = false) {
    this.squares.update({ playing: page, beat });
  }

  /** The length can only change while idle with the editor pattern loaded. */
  setLengthLocked(locked: boolean) {
    this.squares.update({ locked });
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

  /** Removes all hit markers. */
  clear() {
    for (const c of this.cells.flat()) {
      c.classList.remove('miss');
      c.querySelectorAll('.mk').forEach((m) => m.remove());
    }
  }

  /** Column 0–15 of the current page; -1 hides it. */
  setPlayhead(step: number) {
    if (step === this.playhead) return;
    this.leds[this.playhead]?.classList.remove('lit');
    this.leds[step]?.classList.add('lit');
    this.playhead = step;
  }

  /** Greys out the step lights (TEST without a metronome). */
  setStepLedsOff(off: boolean) {
    this.leds.forEach((l) => l.classList.toggle('off', off));
  }

  /** Flashes a track's light for a live hit. */
  flash(track: number) {
    this.labels[track].classList.add('flash');
    clearTimeout(this.flashTimers[track]);
    this.flashTimers[track] = window.setTimeout(() => this.labels[track].classList.remove('flash'), FLASH_MS);
  }

  /** Muted rows: light off, cells dimmed, no hits shown. Redraw the bar afterwards to update markers. */
  setMuted(muted: readonly boolean[]) {
    this.muted = [...muted];
    this.labels.forEach((b, t) => setMuteLight(b, !!muted[t]));
    this.cells.forEach((row, t) => row.forEach((c) => c.classList.toggle('muted', !!muted[t])));
  }

  setMuteLocked(locked: boolean) {
    this.labels.forEach((b) => (b.disabled = locked));
  }

  private renderPage() {
    const base = this.page * STEPS;
    this.cells.forEach((row, t) => row.forEach((c, s) => c.classList.toggle('on', !!this.pattern[t]?.[base + s])));
    this.squares.update({ bars: patternBars(this.pattern), page: this.page });
  }
}
