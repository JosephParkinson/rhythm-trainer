import { NUMBER_LIMITS, clampSetting, type NumberSetting, type Settings } from '../settings';
import { $ } from './dom';

export type Mode = 'idle' | 'test' | 'play' | 'replay' | 'cal' | 'lag';
export type ActiveMode = Exclude<Mode, 'idle'>;
type ToggleSetting = 'metronome' | 'sounds' | 'hearFirst' | 'lowLatency';

/** TEST's red light: off, dim while the pattern/count-in plays, lit while you're being recorded. */
export type RecordState = 'off' | 'lead' | 'rec';

/** Settings a routine overrides with its own per-pattern values. */
const PER_PATTERN = new Set(['bpm', 'bars', 'metronome']);

/** Modes with a button (id = mode) that starts and stops them: [idle label, running label]. REPLAY is started from the breakdown. */
type ButtonMode = Exclude<ActiveMode, 'replay'>;
const LABELS: Record<ButtonMode, [string, string]> = {
  test: ['TEST', 'STOP'],
  play: ['PLAY', 'PAUSE'],
  cal: ['CALIBRATE', 'CANCEL'],
  lag: ['LAG TEST', 'CANCEL'],
};

export interface ControlEvents {
  toggle(mode: ButtonMode): void;
  /** a setting was edited */
  change(): void;
}

export interface ControlState {
  mode: Mode;
  /** a routine is loaded */
  routine: boolean;
}

/** Transport buttons, settings inputs and LED toggles, status readouts and the MIDI light. */
export class Controls {
  private readonly statusEl = $('status');
  private readonly test1 = $('testStatus1');
  private readonly test2 = $('testStatus2');
  private readonly midi = $('midi');
  private readonly outLat = $('outlat');
  private readonly buttons = {} as Record<ButtonMode, HTMLButtonElement>;
  private readonly numbers = {} as Record<NumberSetting, HTMLInputElement>;
  private readonly toggles = {} as Record<ToggleSetting, HTMLButtonElement>;

  constructor(
    private readonly settings: Settings,
    ev: ControlEvents,
  ) {
    for (const m of Object.keys(LABELS) as ButtonMode[]) {
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

    for (const id of ['metronome', 'sounds', 'hearFirst', 'lowLatency'] as const) {
      const b = (this.toggles[id] = $<HTMLButtonElement>(id));
      b.addEventListener('click', () => {
        settings[id] = !settings[id];
        this.syncInputs();
        ev.change();
      });
    }

    this.syncInputs();
  }

  /** Copies settings into the inputs (after something other than the inputs changed them). */
  syncInputs() {
    for (const [id, inp] of Object.entries(this.numbers)) inp.value = String(this.settings[id as NumberSetting]);
    for (const [id, b] of Object.entries(this.toggles)) {
      const on = this.settings[id as ToggleSetting];
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }

  /** The small readout next to the transport: count-in, bar counter, routine progress, messages. */
  status(text: string) {
    if (this.statusEl.textContent !== text) this.statusEl.textContent = text;
  }

  /** The readout in the settings panel, for CALIBRATE and LAG TEST. */
  testStatus(line1: string, line2 = '') {
    if (this.test1.textContent !== line1) this.test1.textContent = line1;
    if (this.test2.textContent !== line2) this.test2.textContent = line2;
  }

  setRecording(state: RecordState) {
    this.buttons.test.classList.toggle('rec-lead', state === 'lead');
    this.buttons.test.classList.toggle('rec-on', state === 'rec');
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

  update({ mode, routine }: ControlState) {
    const busy = mode !== 'idle';
    for (const [m, b] of Object.entries(this.buttons) as [ButtonMode, HTMLButtonElement][]) {
      const active = mode === m;
      b.textContent = LABELS[m][active ? 1 : 0];
      b.classList.toggle('lit', active);
      b.disabled = busy && !active;
    }
    if (mode !== 'test') this.setRecording('off');
    for (const [id, el] of [...Object.entries(this.numbers), ...Object.entries(this.toggles)]) {
      (el as HTMLInputElement | HTMLButtonElement).disabled = busy || (routine && PER_PATTERN.has(id));
    }
  }
}
