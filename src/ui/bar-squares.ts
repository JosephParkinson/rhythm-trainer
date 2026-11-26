import { MAX_PATTERN_BARS } from '../core/pattern';
import { el } from './dom';

export interface BarSquareEvents {
  /** a square inside the pattern was clicked */
  view(page: number): void;
  /** a dark square was clicked: extend to that many bars */
  extend(bars: number): void;
  /** a lit square was double- or right-clicked: delete every bar after it */
  cutAfter(page: number): void;
}

interface State {
  /** pattern length */
  bars: number;
  /** bar on screen */
  page: number;
  /** bar PLAY is on (-1: none) */
  playing: number;
  /** PLAY is on the first 16th of a beat: its square pulses */
  beat: boolean;
  /** the length can't change */
  locked: boolean;
}

/**
 * The four bar squares in the transport row: amber = inside the pattern,
 * bright = on screen, a pulse on each beat for the bar PLAY is on. They also
 * set the length: click a dark square to extend, double- or right-click a lit
 * one to delete the bars after it.
 */
export class BarSquares {
  private readonly squares: HTMLButtonElement[] = [];
  private state: State = { bars: 1, page: 0, playing: -1, beat: false, locked: false };
  /** the last single click extended the pattern, so a double-click it starts mustn't delete */
  private clickExtended = false;

  constructor(
    root: HTMLElement,
    private readonly ev: BarSquareEvents,
  ) {
    for (let p = 0; p < MAX_PATTERN_BARS; p++) {
      const sq = el('button', 'barsq', root);
      sq.addEventListener('click', (e) => e.detail <= 1 && this.click(p));
      sq.addEventListener('dblclick', () => !this.clickExtended && this.cutAfter(p));
      sq.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.cutAfter(p);
      });
      this.squares.push(sq);
    }
    this.render();
  }

  update(changes: Partial<State>) {
    const next = { ...this.state, ...changes };
    if ((Object.keys(next) as (keyof State)[]).every((k) => next[k] === this.state[k])) return;
    this.state = next;
    this.render();
  }

  private click(p: number) {
    const { bars, locked } = this.state;
    this.clickExtended = p >= bars;
    if (!this.clickExtended) this.ev.view(p);
    else if (!locked) this.ev.extend(p + 1);
  }

  private cutAfter(p: number) {
    if (p + 1 < this.state.bars && !this.state.locked) this.ev.cutAfter(p);
  }

  private render() {
    const { bars, page, playing, beat, locked } = this.state;
    this.squares.forEach((sq, p) => {
      const inside = p < bars;
      sq.classList.toggle('in', inside);
      sq.classList.toggle('cur', p === page);
      sq.classList.toggle('beat', p === playing && beat);
      sq.disabled = !inside && locked;
      const after = p + 2 < bars ? 'bars' : 'bar';
      sq.title = inside
        ? `Bar ${p + 1}` + (p + 1 < bars && !locked ? `. Double-click or right-click to delete the ${after} after it` : '')
        : `Click to extend to ${p + 1} bars`;
    });
  }
}
