import { Engine } from './audio/engine';
import { History } from './history';
import { Bindings } from './input/bindings';
import type { NoteEvent } from './input/midi';
import { Library, type SavedPattern } from './library';
import { barRefs, editorPlan, routinePlan, type RunResult } from './plan';
import { CalibrateSession } from './sessions/calibrate';
import { LagSession } from './sessions/lag';
import { PlaySession } from './sessions/play';
import { ReplaySession } from './sessions/replay';
import { RunSession } from './sessions/run';
import type { Deps, Session } from './sessions/session';
import {
  STEPS,
  TRACKS,
  browserStore,
  clampSetting,
  cloneGrid,
  clonePiano,
  defaultClick,
  emptyClick,
  emptyPattern,
  loadSettings,
  patternBars,
  removeBar,
  removePianoBar,
  resizePattern,
  resizePiano,
  sameGrid,
  samePiano,
  saveSettings,
  type PianoNote,
} from './settings';
import { Breakdown } from './ui/breakdown';
import { Controls, type ActiveMode, type Mode } from './ui/controls';
import { confirmBox, promptText } from './ui/dialog';
import { $ } from './ui/dom';
import { BindPanel } from './ui/binds';
import { Grid } from './ui/grid';
import { PatternsView } from './ui/patterns-view';
import { PianoRoll } from './ui/piano-roll';
import { RoutinesView } from './ui/routines-view';

type View = 'trainer' | 'patterns' | 'routines';
const PRACTICE_VIEWS = ['patterns', 'routines'] as const;
const TABS = ['tab-trainer', 'tab-practice', 'tab-patterns', 'tab-routines'];
const MAX_NAME = 16;

/**
 * Top-level controller. Owns settings, the library and history, what the
 * trainer has loaded (the editor pattern or a routine), the last result and
 * review position, and runs at most one Session at a time (see sessions/session.ts).
 */
export class App {
  private readonly settings = loadSettings();
  private readonly library = new Library(browserStore());
  private readonly history = new History(browserStore());
  private readonly grid: Grid;
  private readonly roll: PianoRoll;
  private readonly controls: Controls;
  private readonly bindings: Bindings;
  private readonly binds: BindPanel;
  private readonly breakdown: Breakdown;
  /** Created on first use: browsers only allow audio after a user gesture. */
  private engine: Engine | null = null;
  private session: Session | null = null;
  private onSessionEnd: (completed: boolean) => void = () => {};
  /** routine loaded into the trainer; null = the editor pattern */
  private routineId: string | null = null;
  private result: RunResult | null = null;
  /** global bar index into the result */
  private reviewBar = 0;
  /** pattern step PLAY resumes from after a pause */
  private playFrom = 0;
  /** last PRACTICE sub-tab */
  private practiceView: (typeof PRACTICE_VIEWS)[number] = 'patterns';

  constructor() {
    this.grid = new Grid($('grid'), $('pages'), {
      toggle: (t, s) => this.editPattern(() => (this.settings.pattern[t][s] = !this.settings.pattern[t][s])),
      muteClick: (t) => this.toggleMute(t),
      pageClick: (p) => this.pageClick(p),
      extend: (bars) => this.extend(bars),
      deleteBar: (p) => void this.deleteBar(p),
      pageChanged: (p) => this.roll.setPage(p),
    });
    this.roll = new PianoRoll($('roll'), {
      change: (notes) => this.editPiano(notes),
      audition: (pitch) => !this.session?.mutesHits && this.eng.pianoAudition(pitch),
    });
    this.controls = new Controls(this.settings, {
      toggle: (m) => (this.session?.mode === m ? this.end(this.session, false) : void this.start(m)),
      change: () => {
        this.save();
        // A new buffer size needs a new AudioContext; it's created on next use.
        if (this.engine && this.engine.lowLatency !== this.settings.lowLatency && !this.session) {
          void this.engine.ctx.close();
          this.engine = null;
          this.controls.setOutputLatency(null);
        }
      },
    });
    this.binds = new BindPanel($('binds'), (t) => this.bindings.learn(this.bindings.learning === t ? null : t));
    this.bindings = new Bindings(
      this.settings,
      (t, p, v) => this.hit(t, p, v),
      () => {
        this.save();
        this.binds.set(this.bindings.labels(), this.bindings.learning);
      },
      (e) => this.pianoNote(e),
      () => this.playPause(),
      (d) => !this.session && this.result && this.showReview(this.reviewBar + d),
    );
    const startMidi = () => this.bindings.startMidi((names) => this.controls.setMidi(names));
    startMidi();
    $('midi').addEventListener('click', startMidi);
    this.breakdown = new Breakdown($('breakdown'), {
      select: (seg) => !this.session && this.showReview(this.segmentBars(seg).from),
      replay: (seg) => this.replaySegment(seg),
    });

    $('new').addEventListener('click', () => this.newPattern());
    $('load').addEventListener('click', () => this.setView('patterns'));
    $('save').addEventListener('click', () => void this.savePattern());
    $('exit').addEventListener('click', () => this.loadRoutine(null));
    $('cog').addEventListener('click', () => this.toggleSettings());
    $('pianoLed').addEventListener('click', () => this.togglePianoMute());
    $('pianoClear').addEventListener('click', () => this.editPiano([]));
    $('pianoToggle').addEventListener('click', () => {
      this.settings.pianoOpen = !this.settings.pianoOpen;
      this.save();
      this.renderPianoPanel();
    });
    $('tab-trainer').addEventListener('click', () => this.setView('trainer'));
    $('tab-practice').addEventListener('click', () => this.setView(this.practiceView));
    for (const v of PRACTICE_VIEWS) $(`tab-${v}`).addEventListener('click', () => this.setView(v));
    new PatternsView($('patterns'), this.library, this.history, (id) => this.loadPattern(id));
    new RoutinesView($('routines'), this.library, this.history, (id) => this.loadRoutine(id));
    this.library.onChange(() => this.libraryChanged());

    if (!this.library.pattern(this.settings.patternId)) this.settings.patternId = null;
    this.binds.set(this.bindings.labels(), null);
    this.grid.setMuted(this.settings.muted);
    this.renderPianoPanel();
    this.setView('trainer');
    this.showIdle();
    window.setInterval(() => this.controls.setOutputLatency(this.engine?.outputLatencyMs ?? null), 1000);
  }

  private get mode(): Mode {
    return this.session?.mode ?? 'idle';
  }

  private get eng(): Engine {
    this.engine ??= new Engine(this.settings.lowLatency);
    if (this.engine.ctx.state !== 'running') void this.engine.ctx.resume();
    return this.engine;
  }

  private get routine() {
    return this.library.routine(this.routineId);
  }

  // ---------- sessions ----------

  private async start(mode: ActiveMode) {
    if (this.session) return;
    await this.eng.ctx.resume();
    if (this.session) return; // another start won the race
    (document.activeElement as HTMLElement | null)?.blur();

    const d: Deps = {
      eng: this.eng,
      settings: this.settings,
      grid: this.grid,
      roll: this.roll,
      controls: this.controls,
      finish: (s) => this.end(s, true),
    };

    switch (mode) {
      case 'test': {
        const r = this.routine;
        const plan = r ? routinePlan(r, this.library, this.settings) : editorPlan(this.settings, this.patternName());
        if (!plan.segments.length) return this.controls.status('ROUTINE EMPTY');
        this.setResult(null);
        this.grid.clear();
        const s = new RunSession(d, plan);
        return this.run(s, (done) => {
          if (done) {
            this.reviewBar = 0;
            this.setResult(s.result);
            this.logHistory(s.result);
          }
          this.showIdle();
        });
      }
      case 'play': {
        const s = this.settings;
        let p = { pattern: s.pattern, piano: s.piano, bpm: s.bpm, click: s.metronome ? defaultClick() : emptyClick() };
        const r = this.routine;
        if (r) {
          // The routine pattern on screen, at its own tempo and click.
          const plan = this.result?.plan ?? routinePlan(r, this.library, s);
          const seg = plan.segments[this.result ? barRefs(this.result)[this.reviewBar].seg : 0];
          if (!seg) return;
          p = seg;
        }
        this.grid.clear();
        const session = new PlaySession(d, p.pattern, p.piano, p.bpm, p.click, this.playFrom);
        return this.run(session, () => {
          this.playFrom = session.position;
          this.showIdle();
        });
      }
      case 'replay': {
        // From the bar on screen to the end of its pattern.
        if (!this.result) return;
        const from = this.reviewBar;
        const { to } = this.segmentBars(barRefs(this.result)[from].seg);
        this.showReview(from);
        const s = new ReplaySession(d, this.result, from, to, (bar) => this.showReview(bar));
        return this.run(s, () => this.showReview(from));
      }
      case 'cal': {
        const s = new CalibrateSession(d, (ms) => this.setLatency(ms));
        return this.run(s, (done) => done || this.controls.testStatus('CALIBRATION CANCELLED'));
      }
      case 'lag':
        return this.run(new LagSession(d), (done) => done || this.controls.testStatus('LAG TEST CANCELLED'));
    }
  }

  /** Space bar: PLAY / PAUSE. */
  private playPause() {
    if (this.session?.mode === 'play') this.end(this.session, false);
    else if (!this.session) void this.start('play');
  }

  /** Replays one pattern of the result from its first bar, switching from any replay in progress. */
  private replaySegment(seg: number) {
    if (!this.result) return;
    if (this.session?.mode === 'replay') this.end(this.session, false);
    if (this.session) return;
    this.reviewBar = this.segmentBars(seg).from;
    void this.start('replay');
  }

  /** Global bar range [from, to) of a result segment. */
  private segmentBars(seg: number) {
    const refs = this.result ? barRefs(this.result) : [];
    return { from: refs.findIndex((r) => r.seg === seg), to: refs.findLastIndex((r) => r.seg === seg) + 1 };
  }

  private run(s: Session, onEnd: (completed: boolean) => void) {
    this.session = s;
    this.onSessionEnd = onEnd;
    this.bindings.learn(null);
    this.refresh();
    const loop = () => {
      if (this.session !== s) return;
      s.frame?.();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private end(s: Session, completed: boolean) {
    if (this.session !== s) return;
    this.session = null;
    s.stop();
    this.grid.setPlayhead(-1);
    this.refresh();
    this.onSessionEnd(completed);
  }

  private hit(track: number, perfMs: number, vel: number) {
    const s = this.session;
    // Mic tests need silence so the mic only hears the key.
    if (!s?.mutesHits && this.settings.sounds) this.eng.trigger(TRACKS[track].voice, vel);
    this.grid.flash(track);
    s?.hit?.(track, perfMs, vel);
  }

  /** Live keyboard notes (MIDI that isn't routed to a drum). Silent during mic tests. */
  private pianoNote(e: NoteEvent) {
    if (e.on) {
      if (this.session?.mutesHits) return;
      this.eng.pianoDown(e.note, e.vel);
      this.roll.flash(e.note);
    } else this.engine?.pianoUp(e.note);
  }

  /**
   * Saved patterns log runs only when played unmodified; routines always log.
   * Runs with muted parts are practice of a subset, so they're never logged.
   */
  private logHistory(r: RunResult) {
    if (this.settings.muted.some(Boolean)) return;
    if (r.plan.routineId) {
      this.history.add('routine', r.plan.routineId, r);
      return;
    }
    const saved = this.library.pattern(this.settings.patternId);
    if (saved && this.isUnmodified(saved)) this.history.add('pattern', saved.id, r);
  }

  /** The editor still matches the saved pattern it was loaded from. */
  private isUnmodified(saved: SavedPattern) {
    return sameGrid(saved.grid, this.settings.pattern) && samePiano(saved.piano, this.settings.piano);
  }

  // ---------- loading & saving ----------

  private loadPattern(id: string) {
    const p = this.library.pattern(id);
    if (!p || this.session) return;
    this.settings.pattern = cloneGrid(p.grid);
    this.settings.piano = clonePiano(p.piano);
    this.settings.bpm = p.bpm;
    this.settings.patternId = p.id;
    this.routineId = null;
    this.playFrom = 0;
    this.controls.syncInputs();
    this.save();
    this.setResult(null);
    this.setView('trainer');
    this.showIdle();
  }

  private loadRoutine(id: string | null) {
    if (this.session) return;
    this.routineId = id;
    this.playFrom = 0;
    this.setResult(null);
    this.setView('trainer');
    this.showIdle();
  }

  private newPattern() {
    if (this.session || this.routineId) return;
    this.settings.pattern = emptyPattern();
    this.settings.piano = [];
    this.settings.patternId = null;
    this.playFrom = 0;
    this.save();
    this.setResult(null);
    this.showIdle();
  }

  private async savePattern() {
    if (this.session || this.routineId) return;
    const current = this.library.pattern(this.settings.patternId);
    const name = await promptText('SAVE PATTERN', current?.name ?? '');
    if (!name) return;
    const same = this.library.patterns.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (same && same.id !== current?.id && !(await confirmBox(`REPLACE "${same.name}"?`, 'REPLACE'))) return;
    const target = same ?? null;
    const saved = this.library.savePattern({
      id: target?.id,
      name,
      folderId: target?.folderId ?? current?.folderId ?? null,
      bpm: this.settings.bpm,
      grid: this.settings.pattern,
      piano: this.settings.piano,
    });
    this.settings.patternId = saved.id;
    this.save();
    this.renderSource();
  }

  private libraryChanged() {
    if (!this.library.pattern(this.settings.patternId)) {
      this.settings.patternId = null;
      this.save();
    }
    if (this.routineId && !this.routine) this.loadRoutine(null);
    else if (!this.session && !this.result) this.showIdle();
    else this.renderSource();
  }

  // ---------- editing ----------

  /** Edits are allowed while idle or playing (heard on the next pass), unless a routine is loaded. */
  private get editable() {
    return !this.routineId && (this.mode === 'idle' || this.mode === 'play');
  }

  private editPattern(edit: () => void) {
    if (!this.editable) return;
    edit();
    this.grid.setPattern(this.settings.pattern);
    this.save();
    this.renderSource();
    if (this.mode === 'idle' && this.result) {
      this.breakdown.render(this.result, this.settings.muted); // re-score
      this.showReview();
    }
  }

  /** The array is updated in place so a playing pattern (which holds a reference) hears the change. */
  private editPiano(notes: PianoNote[]) {
    if (!this.editable) return this.roll.setNotes(this.settings.piano);
    this.settings.piano.splice(0, this.settings.piano.length, ...notes);
    this.roll.setNotes(this.settings.piano);
    this.save();
    this.renderSource();
  }

  /** Clicking a dark bar square: grow to `bars`, repeating the existing bars, and show the bar clicked. */
  private extend(bars: number) {
    const from = patternBars(this.settings.pattern);
    if (!this.lengthEditable || bars <= from) return;
    this.settings.pattern = resizePattern(this.settings.pattern, bars);
    this.settings.piano = resizePiano(this.settings.piano, from, bars);
    this.lengthChanged(bars - 1);
  }

  /** Double-clicking a lit bar square: delete that bar (asks first if it has anything in it). */
  private async deleteBar(bar: number) {
    const bars = patternBars(this.settings.pattern);
    if (!this.lengthEditable || bars < 2 || bar >= bars) return;
    if (this.hasContentIn(bar) && !(await confirmBox(`DELETE BAR ${bar + 1}?`, 'DELETE'))) return;
    this.settings.pattern = removeBar(this.settings.pattern, bar);
    this.settings.piano = removePianoBar(this.settings.piano, bar);
    this.lengthChanged(Math.min(bar, bars - 2));
  }

  private get lengthEditable() {
    return this.mode === 'idle' && !this.routineId;
  }

  private lengthChanged(page: number) {
    this.playFrom = 0;
    this.save();
    this.setResult(null); // the review no longer matches the pattern
    this.showIdle();
    this.grid.setPage(page);
  }

  /** Any drum step or keyboard note in bar `bar`. */
  private hasContentIn(bar: number) {
    const [a, b] = [bar * STEPS, (bar + 1) * STEPS];
    return this.settings.pattern.some((r) => r.slice(a, b).some(Boolean)) || this.settings.piano.some((n) => n.step >= a && n.step < b);
  }

  private pageClick(page: number) {
    if (this.result && this.mode === 'idle') {
      // In review, jump to that bar of the pattern within the current pass.
      const bars = patternBars(this.result.plan.segments[barRefs(this.result)[this.reviewBar].seg].pattern);
      this.showReview(this.reviewBar - (this.reviewBar % bars) + page);
    } else this.grid.setPage(page);
  }

  /** Muting is allowed while idle (re-scores the review) or playing (heard on the next step). */
  private toggleMute(t: number) {
    if (this.mode !== 'idle' && this.mode !== 'play') return;
    this.settings.muted[t] = !this.settings.muted[t];
    this.grid.setMuted(this.settings.muted);
    this.save();
    if (this.mode === 'idle' && this.result) {
      this.breakdown.render(this.result, this.settings.muted);
      this.showReview();
    }
  }

  private togglePianoMute() {
    if (this.mode !== 'idle' && this.mode !== 'play') return;
    this.settings.pianoMuted = !this.settings.pianoMuted;
    this.save();
    this.renderPianoPanel();
  }

  private setLatency(ms: number) {
    this.settings.latency = clampSetting('latency', ms, this.settings.latency);
    this.controls.syncInputs();
    this.save();
  }

  private setResult(r: RunResult | null) {
    this.result = r;
    this.breakdown.render(r, this.settings.muted);
  }

  private save() {
    saveSettings(this.settings);
  }

  // ---------- display ----------

  private setView(v: View) {
    if (v !== 'trainer') this.practiceView = v;
    $('view-trainer').hidden = v !== 'trainer';
    $('view-practice').hidden = v === 'trainer';
    $('tab-trainer').classList.toggle('lit', v === 'trainer');
    $('tab-practice').classList.toggle('lit', v !== 'trainer');
    for (const p of PRACTICE_VIEWS) {
      $(p).hidden = p !== v;
      $(`tab-${p}`).classList.toggle('lit', p === v);
    }
  }

  private toggleSettings() {
    const panel = $('settingsPanel');
    panel.hidden = !panel.hidden;
    $('cog').classList.toggle('lit', !panel.hidden);
  }

  private renderPianoPanel() {
    $('roll').hidden = !this.settings.pianoOpen;
    $('pianoToggle').textContent = this.settings.pianoOpen ? 'HIDE' : 'SHOW';
    const led = $('pianoLed');
    led.classList.toggle('muted', this.settings.pianoMuted);
    led.title = this.settings.pianoMuted ? 'Muted. Click to unmute' : 'Click to mute';
    $('roll').classList.toggle('muted', this.settings.pianoMuted);
  }

  private patternName() {
    return this.library.pattern(this.settings.patternId)?.name ?? 'UNSAVED';
  }

  private showIdle() {
    if (this.result) return this.showReview();
    this.grid.clear();
    const r = this.routine;
    if (r) {
      const seg = routinePlan(r, this.library, this.settings).segments[0];
      this.grid.setPattern(seg?.pattern ?? emptyPattern());
      this.roll.setNotes(seg?.piano ?? []);
    } else {
      this.grid.setPattern(this.settings.pattern);
      this.roll.setNotes(this.settings.piano);
    }
    this.controls.status('');
    this.refresh();
  }

  private showReview(bar = this.reviewBar) {
    const r = this.result;
    if (!r) return;
    const refs = barRefs(r);
    this.reviewBar = Math.min(refs.length - 1, Math.max(0, bar));
    const { seg, bar: b } = refs[this.reviewBar];
    const spec = r.plan.segments[seg];
    this.grid.showBar(r.takes[seg], spec.pattern, b, true);
    this.roll.setNotes(spec.piano);
    const where = `BAR ${this.reviewBar + 1}/${refs.length}`;
    this.controls.status(r.plan.routineId ? `${seg + 1}/${r.takes.length} ${spec.name.slice(0, MAX_NAME)}  ${where}` : where);
    this.refresh();
  }

  private renderSource() {
    const r = this.routine;
    const saved = this.library.pattern(this.settings.patternId);
    $('srcKind').textContent = r ? 'ROUTINE' : 'PATTERN';
    $('srcName').textContent = r ? r.name : saved ? saved.name + (this.isUnmodified(saved) ? '' : ' *') : 'UNSAVED';
    const busy = this.mode !== 'idle';
    for (const id of ['new', 'load', 'save'] as const) {
      const b = $<HTMLButtonElement>(id);
      b.hidden = !!r;
      b.disabled = busy;
    }
    const exit = $<HTMLButtonElement>('exit');
    exit.hidden = !r;
    exit.disabled = busy;
  }

  private refresh() {
    const busy = this.mode !== 'idle';
    this.controls.update({ mode: this.mode, routine: !!this.routineId });
    this.binds.setLocked(busy);
    this.grid.setLengthLocked(busy || !!this.routineId);
    this.grid.setMuteLocked(busy && this.mode !== 'play');
    this.roll.setLocked(!this.editable);
    $<HTMLButtonElement>('pianoClear').disabled = !this.editable;
    $<HTMLButtonElement>('pianoLed').disabled = busy && this.mode !== 'play';
    if (this.result) {
      this.breakdown.setCurrent(barRefs(this.result)[this.reviewBar].seg, this.mode === 'replay');
      this.breakdown.setLocked(busy && this.mode !== 'replay');
    }
    for (const id of TABS) $<HTMLButtonElement>(id).disabled = busy;
    this.renderSource();
  }
}
