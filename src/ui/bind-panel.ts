import { TRACKS } from '../core/pattern';
import { el } from './dom';

/** Key / MIDI assignment per track, in the settings panel. Click a box, then press a key or pad. */
export class BindPanel {
  private readonly buttons: HTMLButtonElement[] = [];

  constructor(root: HTMLElement, onClick: (track: number) => void) {
    TRACKS.forEach((track, t) => {
      const label = el('label', '', root);
      label.append(track.name);
      const b = el('button', 'bind', label);
      b.title = 'Click, then press a key or pad';
      b.addEventListener('click', () => onClick(t));
      this.buttons.push(b);
    });
  }

  set(labels: string[], learning: number | null) {
    this.buttons.forEach((b, t) => {
      b.textContent = learning === t ? '...' : labels[t];
      b.classList.toggle('listen', learning === t);
    });
  }

  setLocked(locked: boolean) {
    this.buttons.forEach((b) => (b.disabled = locked));
  }
}
