import { PIANO_HIGH, PIANO_LOW, STEPS, STEPS_PER_BEAT, type PianoNote } from '../settings';
import { el } from './dom';

export interface PianoRollEvents {
  /** the notes were edited (the array passed to setNotes has been replaced) */
  change(notes: PianoNote[]): void;
  /** a note was placed: play it so you hear what you drew */
  audition(pitch: number): void;
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK = new Set([1, 3, 6, 8, 10]);
const FLASH_MS = 120;

export const noteName = (pitch: number) => `${NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`;

/**
 * Two-octave piano roll under the drum grid, with columns aligned to its steps.
 * Like the grid it shows one bar (page) of the pattern; notes stay within a bar.
 * Mouse down on an empty cell starts a note; drag right to lengthen; release to
 * commit. Clicking a note deletes it. Live keyboard notes flash their row.
 */
export class PianoRoll {
  private notes: PianoNote[] = [];
  private locked = false;
  private page = 0;
  private readonly rowOf = new Map<number, number>();
  private readonly heads = new Map<number, HTMLElement>();
  private readonly noteEls: HTMLElement[] = [];
  private readonly flashTimers = new Map<number, number>();
  /** note being drawn; `col` is its first column on the page */
  private drag: { pitch: number; col: number; el: HTMLElement } | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly ev: PianoRollEvents,
  ) {
    for (let pitch = PIANO_HIGH, row = 1; pitch >= PIANO_LOW; pitch--, row++) {
      this.rowOf.set(pitch, row);
      const black = BLACK.has(pitch % 12);
      const head = el('div', black ? 'keyhead black' : 'keyhead', root);
      head.style.gridRow = String(row);
      if (pitch % 12 === 0) head.textContent = noteName(pitch);
      this.heads.set(pitch, head);

      for (let s = 0; s < STEPS; s++) {
        const cls = ['rollcell', black ? 'black' : '', Math.floor(s / STEPS_PER_BEAT) % 2 ? 'alt' : '', pitch % 12 === 0 ? 'c' : ''];
        const cell = el('div', cls.filter(Boolean).join(' '), root);
        cell.style.gridRow = String(row);
        cell.style.gridColumn = String(s + 2);
        cell.addEventListener('mousedown', (e) => this.startDraw(e, pitch, s));
        cell.addEventListener('mouseenter', () => this.extendDraw(pitch, s));
      }
    }
    window.addEventListener('mouseup', () => this.endDraw());
  }

  setNotes(notes: readonly PianoNote[]) {
    this.notes = notes.map((n) => ({ ...n }));
    this.render();
  }

  /** Bar of the pattern to show (follows the drum grid). */
  setPage(page: number) {
    if (page === this.page) return;
    this.page = page;
    this.render();
  }

  setLocked(locked: boolean) {
    this.locked = locked;
    this.root.classList.toggle('locked', locked);
  }

  /** Lights a row's key while a live note is held. */
  flash(pitch: number) {
    const head = this.heads.get(pitch);
    if (!head) return;
    head.classList.add('flash');
    clearTimeout(this.flashTimers.get(pitch));
    this.flashTimers.set(pitch, window.setTimeout(() => head.classList.remove('flash'), FLASH_MS));
  }

  private render() {
    this.noteEls.splice(0).forEach((n) => n.remove());
    for (const n of this.notes) {
      if (Math.floor(n.step / STEPS) !== this.page) continue;
      const node = this.place(n.pitch, n.step % STEPS, n.len, 'rollnote');
      node.title = `${noteName(n.pitch)}  ${n.len}/16`;
      node.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        if (this.locked) return;
        this.commit(this.notes.filter((x) => x !== n));
      });
      this.noteEls.push(node);
    }
  }

  private place(pitch: number, col: number, len: number, cls: string) {
    const node = el('div', cls, this.root);
    node.style.gridRow = String(this.rowOf.get(pitch));
    node.style.gridColumn = `${col + 2} / span ${len}`;
    return node;
  }

  private startDraw(e: MouseEvent, pitch: number, col: number) {
    if (this.locked || e.button !== 0) return;
    e.preventDefault();
    this.drag = { pitch, col, el: this.place(pitch, col, 1, 'rollnote drawing') };
    this.ev.audition(pitch);
  }

  private extendDraw(pitch: number, col: number) {
    const d = this.drag;
    if (!d || pitch !== d.pitch || col < d.col) return;
    d.el.style.gridColumn = `${d.col + 2} / span ${col - d.col + 1}`;
  }

  private endDraw() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const len = Number(/span (\d+)/.exec(d.el.style.gridColumn)?.[1] ?? 1);
    d.el.remove();
    // A new note replaces any it overlaps on the same pitch.
    const step = this.page * STEPS + d.col;
    const end = step + len;
    const kept = this.notes.filter((n) => n.pitch !== d.pitch || n.step + n.len <= step || n.step >= end);
    this.commit([...kept, { pitch: d.pitch, step, len }]);
  }

  private commit(notes: PianoNote[]) {
    this.notes = notes;
    this.render();
    this.ev.change(notes.map((n) => ({ ...n })));
  }
}
