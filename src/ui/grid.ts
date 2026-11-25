import { scoreCell, type Take } from '../scoring';
import { STEPS, STEPS_PER_BEAT, TRACKS, patternBars, patternSteps, type Pattern } from '../settings';
import { el } from './dom';
import { fmtMs } from './format';

export interface GridEvents {
  /** a cell was clicked; `step` is the pattern step (page × 16 + column) */
  toggle(track: number, step: number): void;
  bindClick(track: number): void;
  muteClick(track: number): void;
  /** a page button was clicked */
  pageClick(page: number): void;
  /** the page shown changed (by click or by following playback) */
  pageChanged(page: number): void;
}

const SUBDIVISIONS = ['', 'e', '&', 'a'];
const FLASH_MS = 90;

/**
 * The step grid shows one bar (page) of the pattern at a time: step LEDs, track
 * rows (label light = mute toggle, binding button), cells with hit markers.
 * Page buttons above it pick the bar; they're hidden for one-bar patterns.
 */
export class Grid {
  private readonly leds: HTMLElement[] = [];
  private readonly cells: HTMLElement[][] = [];
  private readonly labels: HTMLButtonElement[] = [];
  private readonly binds: HTMLButtonElement[] = [];
  private readonly flashTimers: number[] = [];
  private pageButtons: HTMLButtonElement[] = [];
  private muted: readonly boolean[] = [];
  private pattern: Pattern = [];
  private page = 0;
  private playhead = -1;

  constructor(
    root: HTMLElement,
    private readonly pagesRoot: HTMLElement,
    private readonly ev: GridEvents,
  ) {
    el('div', '', root);
    for (let s = 0; s < STEPS; s++) this.leds.push(el('div', 'stepled', root));

    TRACKS.forEach((track, t) => {
      const head = el('div', 'rowhead', root);
      const label = el('button', 'lbl', head);
      label.textContent = track.name;
      label.title = 'Click to mute';
      label.addEventListener('click', () => ev.muteClick(t));
      this.labels.push(label);

      const bind = el('button', 'bind', head);
      bind.title = 'Click, then press a key or pad';
      bind.addEventListener('click', () => ev.bindClick(t));
      this.binds.push(bind);

      this.cells.push(
        Array.from({ length: STEPS }, (_, s) => {
          const cell = el('div', Math.floor(s / STEPS_PER_BEAT) % 2 ? 'cell alt' : 'cell', root);
          cell.addEventListener('mousedown', () => ev.toggle(t, this.page * STEPS + s));
          return cell;
        }),
      );
    });

    el('div', '', root);
    for (let s = 0; s < STEPS; s++) {
      const sub = s % STEPS_PER_BEAT;
      el('div', 'beatnum', root).textContent = sub ? SUBDIVISIONS[sub] : String(s / STEPS_PER_BEAT + 1);
    }
  }

  get currentPage() {
    return this.page;
  }

  /** Shows a pattern (keeping the page if it still exists). */
  setPattern(p: Pattern) {
    this.pattern = p;
    const bars = patternBars(p);
    if (this.pageButtons.length !== bars) this.buildPages(bars);
    if (this.page >= bars) this.setPage(bars - 1);
    else this.renderPage();
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

  setBinds(labels: string[], learning: number | null) {
    this.binds.forEach((b, t) => {
      b.textContent = learning === t ? '...' : labels[t];
      b.classList.toggle('listen', learning === t);
    });
  }

  setLocked(locked: boolean) {
    this.binds.forEach((b) => (b.disabled = locked));
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

  private buildPages(bars: number) {
    this.pagesRoot.replaceChildren();
    this.pagesRoot.hidden = bars < 2;
    this.pageButtons = Array.from({ length: bars }, (_, p) => {
      const b = el('button', 'pagebtn', this.pagesRoot);
      b.textContent = String(p + 1);
      b.title = `Bar ${p + 1}`;
      b.addEventListener('click', () => this.ev.pageClick(p));
      return b;
    });
  }

  private renderPage() {
    const base = this.page * STEPS;
    this.cells.forEach((row, t) => row.forEach((c, s) => c.classList.toggle('on', !!this.pattern[t]?.[base + s])));
    this.pageButtons.forEach((b, p) => b.classList.toggle('on', p === this.page));
  }
}
