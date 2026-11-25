import { MAX_PATTERN_BARS, NUMBER_LIMITS, clampSetting, type NumberSetting, type Settings } from '../settings';
import { $ } from './dom';

export type Mode = 'idle' | 'test' | 'play' | 'replay' | 'cal' | 'lag';
export type ActiveMode = Exclude<Mode, 'idle'>;
type ToggleSetting = 'metronome' | 'sounds' | 'hearFirst' | 'lowLatency';

/** TEST's red light: off, dim while the pattern/count-in plays, lit while you're being recorded. */
export type RecordState = 'off' | 'lead' | 'rec';

/** Settings a routine overrides with its own per-pattern values. */
const PER_PATTERN = new Set(['bpm', 'bars', 'metronome']);

/** Each active mode has a button with this id that starts and stops it: [idle label, running label]. */
const LABELS: Record<ActiveMode, [string, string]> = {
  test: ['TEST', 'STOP'],
  play: ['PLAY', 'PAUSE'],
  replay: ['REPLAY', 'STOP'],
  cal: ['CALIBRATE', 'CANCEL'],
  lag: ['LAG TEST', 'CANCEL'],
};

export interface ControlEvents {
  toggle(mode: ActiveMode): void;
  nav(delta: number): void;
  /** a setting was edited */
  change(): void;
  /** the editor pattern's length (bars) was edited */
  length(bars: number): void;
}

export interface ControlState {
  mode: Mode;
  /** bars in the reviewable result; 0 if none */
  bars: number;
  reviewBar: number;
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
  private readonly prevBtn = $<HTMLButtonElement>('prev');
  private readonly nextBtn = $<HTMLButtonElement>('next');
  private readonly lengthInp = $<HTMLInputElement>('length');
  private readonly buttons = {} as Record<ActiveMode, HTMLButtonElement>;
  private readonly numbers = {} as Record<NumberSetting, HTMLInputElement>;
  private readonly toggles = {} as Record<ToggleSetting, HTMLButtonElement>;

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

    for (const id of ['metronome', 'sounds', 'hearFirst', 'lowLatency'] as const) {
      const b = (this.toggles[id] = $<HTMLButtonElement>(id));
      b.addEventListener('click', () => {
        settings[id] = !settings[id];
        this.syncInputs();
        ev.change();
      });
    }

    this.lengthInp.min = '1';
    this.lengthInp.max = String(MAX_PATTERN_BARS);
    this.lengthInp.addEventListener('change', () => {
      const v = Math.round(Number(this.lengthInp.value));
      ev.length(Number.isFinite(v) ? Math.min(MAX_PATTERN_BARS, Math.max(1, v)) : 1);
    });

    this.prevBtn.addEventListener('click', () => ev.nav(-1));
    this.nextBtn.addEventListener('click', () => ev.nav(1));
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

  /** The pattern length shown in LENGTH (bars). */
  setLength(bars: number) {
    this.lengthInp.value = String(bars);
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

  update({ mode, bars, reviewBar, routine }: ControlState) {
    const busy = mode !== 'idle';
    for (const [m, b] of Object.entries(this.buttons) as [ActiveMode, HTMLButtonElement][]) {
      const active = mode === m;
      b.textContent = LABELS[m][active ? 1 : 0];
      b.classList.toggle('lit', active);
      b.disabled = busy ? !active : m === 'replay' && bars === 0;
    }
    if (mode !== 'test') this.setRecording('off');
    for (const [id, el] of [...Object.entries(this.numbers), ...Object.entries(this.toggles)]) {
      (el as HTMLInputElement | HTMLButtonElement).disabled = busy || (routine && PER_PATTERN.has(id));
    }
    this.lengthInp.disabled = busy || routine;
    this.prevBtn.disabled = busy || bars === 0 || reviewBar === 0;
    this.nextBtn.disabled = busy || bars === 0 || reviewBar >= bars - 1;
  }
}
