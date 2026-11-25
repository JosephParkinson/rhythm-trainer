import { NUMBER_LIMITS, clampSetting, type NumberSetting, type Settings } from '../settings';
import { $ } from './dom';

export type Mode = 'idle' | 'play' | 'preview' | 'replay' | 'cal';
type CheckSetting = 'metronome' | 'sounds';
export type ActiveMode = Exclude<Mode, 'idle'>;

/** Each active mode has a button with this id that starts and stops it. */
const LABELS: Record<ActiveMode, string> = {
  play: 'PLAY',
  preview: 'PREVIEW',
  replay: 'REPLAY',
  cal: 'CALIBRATE',
};

export interface ControlEvents {
  toggle(mode: ActiveMode): void;
  clear(): void;
  nav(delta: number): void;
  /** a setting was edited */
  change(): void;
}

export interface ControlState {
  mode: Mode;
  /** bars in the reviewable take; 0 if none */
  bars: number;
  reviewBar: number;
}

/** LCD, transport buttons, settings inputs and MIDI indicator. */
export class Controls {
  private readonly lcd1 = $('lcd1');
  private readonly lcd2 = $('lcd2');
  private readonly midi = $('midi');
  private readonly clearBtn = $<HTMLButtonElement>('clear');
  private readonly prevBtn = $<HTMLButtonElement>('prev');
  private readonly nextBtn = $<HTMLButtonElement>('next');
  private readonly buttons = {} as Record<ActiveMode, HTMLButtonElement>;
  private readonly numbers = {} as Record<NumberSetting, HTMLInputElement>;
  private readonly checks: Record<CheckSetting, HTMLInputElement> = {
    metronome: $<HTMLInputElement>('metronome'),
    sounds: $<HTMLInputElement>('sounds'),
  };

  constructor(
    private readonly settings: Settings,
    ev: ControlEvents,
  ) {
    for (const m of Object.keys(LABELS) as ActiveMode[]) {
      this.buttons[m] = $<HTMLButtonElement>(m);
      this.buttons[m].addEventListener('click', () => ev.toggle(m));
    }

    for (const id of Object.keys(NUMBER_LIMITS) as NumberSetting[]) {
      const inp = (this.numbers[id] = $<HTMLInputElement>(id));
      [inp.min, inp.max] = NUMBER_LIMITS[id].map(String);
      inp.addEventListener('change', () => {
        settings[id] = clampSetting(id, Number(inp.value), settings[id]);
        inp.value = String(settings[id]);
        ev.change();
      });
    }

    for (const [id, box] of Object.entries(this.checks) as [CheckSetting, HTMLInputElement][]) {
      box.addEventListener('change', () => {
        settings[id] = box.checked;
        ev.change();
      });
    }

    this.clearBtn.addEventListener('click', () => ev.clear());
    this.prevBtn.addEventListener('click', () => ev.nav(-1));
    this.nextBtn.addEventListener('click', () => ev.nav(1));
    this.syncInputs();
  }

  /** Copies settings into the inputs (after something other than the inputs changed them). */
  syncInputs() {
    for (const [id, inp] of Object.entries(this.numbers)) inp.value = String(this.settings[id as NumberSetting]);
    for (const [id, box] of Object.entries(this.checks)) box.checked = this.settings[id as CheckSetting];
  }

  lcd(line1: string, line2 = '') {
    if (this.lcd1.textContent !== line1) this.lcd1.textContent = line1;
    if (this.lcd2.textContent !== line2) this.lcd2.textContent = line2;
  }

  /** null = MIDI unavailable in this browser. */
  setMidi(devices: string[] | null) {
    this.midi.classList.toggle('on', !!devices?.length);
    this.midi.title = devices === null ? 'MIDI unavailable in this browser' : devices.join('\n') || 'No MIDI devices';
  }

  update({ mode, bars, reviewBar }: ControlState) {
    const busy = mode !== 'idle';
    for (const [m, b] of Object.entries(this.buttons) as [ActiveMode, HTMLButtonElement][]) {
      const active = mode === m;
      b.textContent = active ? (m === 'cal' ? 'CANCEL' : 'STOP') : LABELS[m];
      b.classList.toggle('lit', active);
      b.disabled = busy ? !active : m === 'replay' && bars === 0;
    }
    this.clearBtn.disabled = busy;
    for (const inp of [...Object.values(this.numbers), ...Object.values(this.checks)]) inp.disabled = busy;
    this.prevBtn.disabled = busy || bars === 0 || reviewBar === 0;
    this.nextBtn.disabled = busy || bars === 0 || reviewBar >= bars - 1;
  }
}
