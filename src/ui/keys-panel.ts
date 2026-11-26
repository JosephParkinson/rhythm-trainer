import { $ } from './dom';
import { setMuteLight } from './widgets';

interface KeysPanelEvents {
  muteClick(): void;
  clear(): void;
  /** show or hide the roll */
  toggleOpen(): void;
}

/** The toolbar above the piano roll: KEYS (mute light), CLEAR and SHOW/HIDE. */
export class KeysPanel {
  private readonly led = $<HTMLButtonElement>('pianoLed');
  private readonly clear = $<HTMLButtonElement>('pianoClear');
  private readonly toggle = $<HTMLButtonElement>('pianoToggle');
  private readonly roll = $('roll');

  constructor(ev: KeysPanelEvents) {
    this.led.addEventListener('click', () => ev.muteClick());
    this.clear.addEventListener('click', () => ev.clear());
    this.toggle.addEventListener('click', () => ev.toggleOpen());
  }

  render(open: boolean, muted: boolean) {
    this.roll.hidden = !open;
    this.toggle.textContent = open ? 'HIDE' : 'SHOW';
    setMuteLight(this.led, muted);
    this.roll.classList.toggle('muted', muted);
  }

  /** `editable`: CLEAR works; `muteLocked`: the KEYS light doesn't. */
  setLocked(editable: boolean, muteLocked: boolean) {
    this.clear.disabled = !editable;
    this.led.disabled = muteLocked;
  }
}
