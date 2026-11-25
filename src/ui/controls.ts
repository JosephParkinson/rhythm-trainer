import { NUMBER_LIMITS, clampSetting, type NumberSetting, type Settings } from '../settings';
import { $ } from './dom';

export type Mode = 'idle' | 'play' | 'preview' | 'replay' | 'cal' | 'lag';
type CheckSetting = 'metronome' | 'sounds' | 'hearFirst' | 'lowLatency';

/** Settings a routine overrides with its own per-pattern values. */
const PER_PATTERN = new Set(['bpm', 'bars', 'metronome']);
export type ActiveMode = Exclude<Mode, 'idle'>;

/** Each active mode has a button with this id that starts and stops it. */
const LABELS: Record<ActiveMode, string> = {
  play: 'PLAY',
  preview: 'PREVIEW',
  replay: 'REPLAY',
  cal: 'CALIBRATE',
  lag: 'LAG TEST',
};

/** Modes whose button reads CANCEL rather than STOP while running. */
const CANCELLABLE = new Set<ActiveMode>(['cal', 'lag']);

export interface ControlEvents {
  toggle(mode: ActiveMode): void;
  clear(): void;
  nav(delta: number): void;
  /** a setting was edited */
  change(): void;
}

export interface ControlState {
  mode: Mode;
  /** bars in the reviewable result; 0 if none */
  bars: number;
  reviewBar: number;
  /** a routine is loaded */
  routine: boolean;
}

/** LCD, transport buttons, settings inputs and MIDI indicator. */
export class Controls {
  private readonly lcd1 = $('lcd1');
  private readonly lcd2 = $('lcd2');
  private readonly midi = $('midi');
  private readonly outLat = $('outlat');
  private readonly clearBtn = $<HTMLButtonElement>('clear');
  private readonly prevBtn = $<HTMLButtonElement>('prev');
  private readonly nextBtn = $<HTMLButtonElement>('next');
  private readonly buttons = {} as Record<ActiveMode, HTMLButtonElement>;
  private readonly numbers = {} as Record<NumberSetting, HTMLInputElement>;
  private readonly checks: Record<CheckSetting, HTMLInputElement> = {
    metronome: $<HTMLInputElement>('metronome'),
    sounds: $<HTMLInputElement>('sounds'),
    hearFirst: $<HTMLInputElement>('hearFirst'),
    lowLatency: $<HTMLInputElement>('lowLatency'),
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

  /** Output delay readout; null until audio has started. */
  setOutputLatency(ms: number | null) {
    const text = ms === null ? 'OUT --' : `OUT ${ms}MS`;
    if (this.outLat.textContent !== text) this.outLat.textContent = text;
  }

  /** null = MIDI unavailable in this browser. */
  setMidi(devices: string[] | null) {
    this.midi.classList.toggle('on', !!devices?.length);
    const status = devices === null ? 'MIDI unavailable' : devices.join('\n') || 'No MIDI devices';
    this.midi.title = `${status}\nClick to rescan`;
  }

  update({ mode, bars, reviewBar, routine }: ControlState) {
    const busy = mode !== 'idle';
    for (const [m, b] of Object.entries(this.buttons) as [ActiveMode, HTMLButtonElement][]) {
      const active = mode === m;
      b.textContent = active ? (CANCELLABLE.has(m) ? 'CANCEL' : 'STOP') : LABELS[m];
      b.classList.toggle('lit', active);
      b.disabled = busy ? !active : m === 'replay' && bars === 0;
    }
    this.clearBtn.disabled = busy || routine;
    for (const [id, inp] of [...Object.entries(this.numbers), ...Object.entries(this.checks)]) {
      inp.disabled = busy || (routine && PER_PATTERN.has(id));
    }
    this.prevBtn.disabled = busy || bars === 0 || reviewBar === 0;
    this.nextBtn.disabled = busy || bars === 0 || reviewBar >= bars - 1;
  }
}
