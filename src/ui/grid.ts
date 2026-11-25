import { scoreCell, type Take } from '../scoring';
import { STEPS, STEPS_PER_BEAT, TRACKS, type Pattern } from '../settings';
import { el } from './dom';
import { fmtMs } from './format';

export interface GridEvents {
  toggle(track: number, step: number): void;
  bindClick(track: number): void;
}

const SUBDIVISIONS = ['', 'e', '&', 'a'];
const FLASH_MS = 90;

/** The step grid: step LEDs, track rows with binding buttons, cells with hit markers. */
export class Grid {
  private readonly leds: HTMLElement[] = [];
  private readonly cells: HTMLElement[][] = [];
  private readonly labels: HTMLElement[] = [];
  private readonly binds: HTMLButtonElement[] = [];
  private readonly flashTimers: number[] = [];
  private playhead = -1;

  constructor(root: HTMLElement, ev: GridEvents) {
    el('div', '', root);
    for (let s = 0; s < STEPS; s++) this.leds.push(el('div', 'stepled', root));

    TRACKS.forEach((track, t) => {
      const head = el('div', 'rowhead', root);
      const label = el('span', 'lbl', head);
      label.textContent = track.name;
      this.labels.push(label);

      const bind = el('button', 'bind', head);
      bind.title = 'Click, then press a key or pad';
      bind.addEventListener('click', () => ev.bindClick(t));
      this.binds.push(bind);

      this.cells.push(
        Array.from({ length: STEPS }, (_, s) => {
          const cell = el('div', Math.floor(s / STEPS_PER_BEAT) % 2 ? 'cell alt' : 'cell', root);
          cell.addEventListener('mousedown', () => ev.toggle(t, s));
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

  setPattern(p: Pattern) {
    this.cells.forEach((row, t) => row.forEach((c, s) => c.classList.toggle('on', p[t][s])));
  }

  /** Draws one cell's hits; `step` is the take's global step. In review, empty targets show as missed. */
  showCell(take: Take, pattern: Pattern, track: number, step: number, review: boolean) {
    const s = step % STEPS;
    const cell = this.cells[track][s];
    const target = pattern[track][s];
    const hits = take.at(track, step);
    cell.querySelectorAll('.mk').forEach((m) => m.remove());
    cell.classList.toggle('miss', review && target && hits.length === 0);

    const halfStepMs = take.stepDur * 500;
    for (const { hit, grade } of scoreCell(hits, target)) {
      const m = el('div', `mk ${grade}`, cell);
      // Centre line is on time; cell edges are ±half a 16th.
      m.style.left = `${Math.min(96, Math.max(4, 50 + (hit.err / halfStepMs) * 50))}%`;
      m.title = fmtMs(hit.err);
    }
  }

  showBar(take: Take, pattern: Pattern, bar: number, review: boolean) {
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

  /** -1 hides it. */
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
}
