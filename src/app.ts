import { Engine } from './audio/engine';
import { History, type RunKind } from './core/history';
import { Library, type SavedPattern } from './core/library';
import {
  STEPS,
  TRACKS,
  clonePiano,
  cloneGrid,
  emptyPattern,
  hasContentFrom,
  patternBars,
  resizePattern,
  resizePiano,
  sameGrid,
  samePiano,
  type Pattern,
  type PianoNote,
} from './core/pattern';
import { editorPlan, metronomeClick, routinePlan, usesMetronome, type RunResult } from './core/plan';
import { Review } from './core/review';
import { clampSetting, loadSettings, saveSettings } from './core/settings';
import { browserStore } from './core/storage';
import { Bindings } from './input/bindings';
import type { NoteEvent } from './input/midi';
import { calibrateSession, lagSession } from './sessions/mic-tests';
import { PlaySession } from './sessions/play';
import { ReplaySession } from './sessions/replay';
import { RunSession } from './sessions/run';
import type { Deps, Session } from './sessions/session';
import { BindPanel } from './ui/bind-panel';
import { Breakdown } from './ui/breakdown';
import { Controls, type ActiveMode, type Mode } from './ui/controls';
import { confirmBox, promptText } from './ui/dialog';
import { $ } from './ui/dom';
import { segmentStatus } from './ui/format';
import { Grid } from './ui/grid';
import { renderHistory } from './ui/history-view';
import { KeysPanel } from './ui/keys-panel';
import { PatternsView } from './ui/patterns-view';
import { PianoRoll } from './ui/piano-roll';
import { RoutinesView } from './ui/routines-view';
import { SourcePanel } from './ui/source-panel';
import { Tabs } from './ui/tabs';

/**
 * Top-level controller. Owns the models (settings, library, history), what the
 * trainer has loaded (the editor pattern or a routine) and the review of the
 * last run, and runs at most one Session at a time (see sessions/session.ts).
 * UI components report what the user did; App changes the models and redraws.
 */
export class App {
  private readonly store = browserStore();
  private readonly settings = loadSettings(this.store);
  private readonly library = new Library(this.store);
  private readonly history = new History(this.store);

  private readonly tabs = new Tabs();
  private readonly grid: Grid;
  private readonly roll: PianoRoll;
  private readonly keys: KeysPanel;
  private readonly controls: Controls;
  private readonly source: SourcePanel;
  private readonly bindPanel: BindPanel;
  private readonly bindings: Bindings;
  private readonly breakdown: Breakdown;

  /** Created on first use: browsers only allow audio after a user gesture. */
  private engine: Engine | null = null;
  private session: Session | null = null;
  private onSessionEnd: (completed: boolean) => void = () => {};
  /** routine loaded into the trainer; null = the editor pattern */
  private routineId: string | null = null;
  /** the last TEST, until the pattern or routine changes */
  private review: Review | null = null;
  /** pattern step PLAY resumes from after a pause */
  private playFrom = 0;

  constructor() {
    this.grid = new Grid($('grid'), $('pages'), {
      toggle: (t, s) => this.editPattern(() => (this.settings.pattern[t][s] = !this.settings.pattern[t][s])),
      muteClick: (t) => this.toggleMute(t),
      pageClick: (p) => this.pageClick(p),
      extend: (bars) => this.extend(bars),
      cutAfter: (p) => void this.cutAfter(p),
      pageChanged: (p) => this.roll.setPage(p),
    });
    this.roll = new PianoRoll($('roll'), {
      change: (notes) => this.editPiano(notes),
      audition: (pitch) => !this.session?.mutesHits && this.eng.pianoAudition(pitch),
    });
    this.keys = new KeysPanel({
      muteClick: () => this.togglePianoMute(),
      clear: () => this.editPiano([]),
      toggleOpen: () => {
        this.settings.pianoOpen = !this.settings.pianoOpen;
        this.save();
        this.renderKeys();
      },
    });
    this.controls = new Controls(this.settings, {
      toggle: (m) => (this.session?.mode === m ? this.end(this.session, false) : void this.start(m)),
      change: () => this.settingsChanged(),
    });
    this.source = new SourcePanel({
      newPattern: () => this.newPattern(),
      load: () => this.tabs.show('patterns'),
      save: () => void this.savePattern(),
      exit: () => this.loadRoutine(null),
    });
    this.bindPanel = new BindPanel($('binds'), (t) => this.bindings.learn(this.bindings.learning === t ? null : t));
    this.bindings = new Bindings(this.settings, {
      hit: (t, perfMs, vel) => this.hit(t, perfMs, vel),
      piano: (e) => this.pianoNote(e),
      change: () => {
        this.save();
        this.renderBinds();
      },
      space: () => this.playPause(),
      arrow: (d) => this.review && !this.session && this.showReview(this.review.bar + d),
    });
    this.breakdown = new Breakdown($('breakdown'), {
      select: (seg) => this.review && !this.session && this.showReview(this.review.segmentBars(seg).from),
      replay: (seg) => this.replaySegment(seg),
    });
    new PatternsView($('patterns'), this.library, this.history, (id) => this.loadPattern(id));
    new RoutinesView($('routines'), this.library, this.history, (id) => this.loadRoutine(id));

    const startMidi = () => this.bindings.startMidi((names) => this.controls.setMidi(names));
    startMidi();
    $('midi').addEventListener('click', startMidi);
    this.library.onChange(() => this.libraryChanged());
    this.history.onChange(() => this.renderRunHistory());
    window.setInterval(() => this.controls.setOutputLatency(this.engine?.outputLatencyMs ?? null), 1000);

    if (!this.library.pattern(this.settings.patternId)) this.settings.patternId = null;
    this.renderBinds();
    this.grid.setMuted(this.settings.muted);
    this.renderKeys();
    this.tabs.show('trainer');
    this.showIdle();
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
      case 'test':
        return this.startTest(d);
      case 'play':
        return this.startPlay(d);
      case 'replay':
        return this.startReplay(d);
      case 'cal':
        return this.run(calibrateSession(d, (ms) => this.setLatency(ms)));
      case 'lag':
        return this.run(lagSession(d));
    }
  }

  private startTest(d: Deps) {
    const r = this.routine;
    const plan = r ? routinePlan(r, this.library, this.settings) : editorPlan(this.settings, this.patternName());
    if (!plan.segments.length) return this.controls.status('ROUTINE EMPTY');
    this.setReview(null);
    this.grid.clear();
    const s = new RunSession(d, plan);
    this.run(s, (done) => {
      if (done) {
        this.setReview(new Review(s.result));
        this.logHistory(s.result);
      }
      this.showIdle();
    });
  }

  /** Loops the editor pattern, or with a routine loaded, the routine pattern on screen at its own tempo and click. */
  private startPlay(d: Deps) {
    const s = this.settings;
    const r = this.routine;
    const p = !r
      ? { pattern: s.pattern, piano: s.piano, bpm: s.bpm, click: metronomeClick(s.metronome) }
      : (this.review?.spec ?? routinePlan(r, this.library, s).segments[0]);
    if (!p) return;
    this.grid.clear();
    const session = new PlaySession(d, p.pattern, p.piano, p.bpm, p.click, this.playFrom);
    this.run(session, () => {
      this.playFrom = session.position;
      this.showIdle();
    });
  }

  /** Replays from the bar on screen to the end of its pattern. */
  private startReplay(d: Deps) {
    const rv = this.review;
    if (!rv) return;
    const from = rv.bar;
    const seg = rv.current.seg;
    const { from: first, to } = rv.segmentBars(seg);
    rv.pausedSeg = null;
    this.showReview(from);
    const s = new ReplaySession(d, rv.result, from, to, (bar) => this.showReview(bar));
    this.run(s, (done) => {
      // Finished: back to the pattern's first bar. Paused: stay on the bar it stopped on.
      rv.pausedSeg = done ? null : seg;
      this.showReview(done ? first : rv.bar);
    });
  }

  /** Space bar: PLAY / pause, or pauses a replay. */
  private playPause() {
    if (this.mode === 'play' || this.mode === 'replay') this.end(this.session!, false);
    else if (!this.session) void this.start('play');
  }

  /**
   * A pattern's ▶ in the breakdown: replays it, or pauses it if it's the one
   * replaying. After a pause ▶ resumes where it stopped; otherwise it starts
   * from the pattern's first bar (switching from any other replay).
   */
  private replaySegment(seg: number) {
    const rv = this.review;
    if (!rv) return;
    if (this.session?.mode === 'replay') {
      const playing = rv.current.seg;
      this.end(this.session, false);
      if (playing === seg) return; // that was a pause
    }
    if (this.session) return;
    rv.goTo(rv.replayStart(seg));
    void this.start('replay');
  }

  private run(s: Session, onEnd: (completed: boolean) => void = () => {}) {
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
    s.stop(completed);
    this.grid.setPlayhead(-1);
    this.refresh();
    this.onSessionEnd(completed);
  }

  private hit(track: number, perfMs: number, vel: number) {
    const s = this.session;
    // Mic tests need silence so the mic only hears the key; MUTE ON TEST silences hits during TEST.
    const silent = s?.mutesHits || (s?.mode === 'test' && this.settings.muteOnTest);
    if (!silent && this.settings.sounds) this.eng.trigger(TRACKS[track].voice, vel);
    this.grid.flash(track);
    s?.hit?.(track, perfMs, vel);
  }

  /** Live keyboard notes (MIDI that isn't routed to a drum). Silent during mic tests. */
  private pianoNote(e: NoteEvent) {
    if (!e.on) return this.engine?.pianoUp(e.note);
    if (this.session?.mutesHits) return;
    this.eng.pianoDown(e.note, e.vel);
    this.roll.flash(e.note);
  }

  // ---------- history ----------

  /** The saved routine or pattern a run belongs to. */
  private historyRef(r: RunResult): { kind: RunKind; id: string; name: string } | null {
    const routine = r.plan.routineId ? this.library.routine(r.plan.routineId) : null;
    if (routine) return { kind: 'routine', id: routine.id, name: routine.name };
    const pattern = !r.plan.routineId ? this.library.pattern(this.settings.patternId) : null;
    return pattern ? { kind: 'pattern', id: pattern.id, name: pattern.name } : null;
  }

  /**
   * Routines always log; a saved pattern logs only when played unmodified.
   * Runs with muted parts are practice of a subset, so they're never logged.
   */
  private logHistory(r: RunResult) {
    const ref = this.historyRef(r);
    if (!ref || this.settings.muted.some(Boolean)) return;
    if (ref.kind === 'pattern' && !this.isUnmodified(this.library.pattern(ref.id)!)) return;
    this.history.add(ref.kind, ref.id, r);
  }

  /** Under the run's breakdown: the history of what was run, opened on runs with the same metronome setting. */
  private renderRunHistory() {
    const box = $('runHistory');
    box.replaceChildren();
    const r = this.review?.result;
    const ref = r ? this.historyRef(r) : null;
    box.hidden = !ref;
    if (r && ref) renderHistory(box, this.history.for(ref.kind, ref.id), ref.name, usesMetronome(r.plan));
  }

  // ---------- loading & saving ----------

  /** Puts a pattern in the editor (`patternId`: the saved pattern it came from, if any). */
  private setEditor(pattern: Pattern, piano: PianoNote[], patternId: string | null) {
    this.settings.pattern = pattern;
    this.settings.piano = piano;
    this.settings.patternId = patternId;
    this.routineId = null;
    this.playFrom = 0;
    this.save();
    this.setReview(null);
    this.showIdle();
  }

  private loadPattern(id: string) {
    const p = this.library.pattern(id);
    if (!p || this.session) return;
    this.settings.bpm = p.bpm;
    this.controls.syncInputs();
    this.setEditor(cloneGrid(p.grid), clonePiano(p.piano), p.id);
    this.tabs.show('trainer');
  }

  private newPattern() {
    if (this.session || this.routineId) return;
    this.setEditor(emptyPattern(), [], null);
  }

  private loadRoutine(id: string | null) {
    if (this.session) return;
    this.routineId = id;
    this.playFrom = 0;
    this.setReview(null);
    this.tabs.show('trainer');
    this.showIdle();
  }

  private async savePattern() {
    if (this.session || this.routineId) return;
    const current = this.library.pattern(this.settings.patternId);
    const name = await promptText('SAVE PATTERN', current?.name ?? '');
    if (!name) return;
    const same = this.library.patterns.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (same && same.id !== current?.id && !(await confirmBox(`REPLACE "${same.name}"?`, 'REPLACE'))) return;
    const saved = this.library.savePattern({
      id: same?.id,
      name,
      folderId: same?.folderId ?? current?.folderId ?? null,
      bpm: this.settings.bpm,
      grid: this.settings.pattern,
      piano: this.settings.piano,
    });
    this.settings.patternId = saved.id;
    this.save();
    this.renderSource();
    this.renderRunHistory(); // the review now belongs to this saved pattern
  }

  private libraryChanged() {
    if (!this.library.pattern(this.settings.patternId)) {
      this.settings.patternId = null;
      this.save();
    }
    if (this.routineId && !this.routine) this.loadRoutine(null);
    else if (!this.session && !this.review) this.showIdle();
    else this.renderSource();
    this.renderRunHistory(); // a rename or delete changes its title or whether it shows
  }

  /** The editor still matches the saved pattern it was loaded from. */
  private isUnmodified(saved: SavedPattern) {
    return sameGrid(saved.grid, this.settings.pattern) && samePiano(saved.piano, this.settings.piano);
  }

  private patternName() {
    return this.library.pattern(this.settings.patternId)?.name ?? 'UNSAVED';
  }

  private save() {
    saveSettings(this.store, this.settings);
  }

  private settingsChanged() {
    this.save();
    // A new buffer size needs a new AudioContext; it's created on next use.
    if (this.engine && this.engine.lowLatency !== this.settings.lowLatency && !this.session) {
      void this.engine.ctx.close();
      this.engine = null;
      this.controls.setOutputLatency(null);
    }
  }

  private setLatency(ms: number) {
    this.settings.latency = clampSetting('latency', ms, this.settings.latency);
    this.controls.syncInputs();
    this.save();
  }

  // ---------- editing ----------

  /** The editor pattern can be edited while idle or playing (heard on the next pass), unless a routine is loaded. */
  private get editable() {
    return !this.routineId && (this.mode === 'idle' || this.mode === 'play');
  }

  /** Its length only while idle. */
  private get lengthEditable() {
    return !this.routineId && this.mode === 'idle';
  }

  /** Mutes can change while idle (re-scoring the review) or playing (heard on the next step). */
  private get mutable() {
    return this.mode === 'idle' || this.mode === 'play';
  }

  private editPattern(edit: () => void) {
    if (!this.editable) return;
    edit();
    this.grid.setPattern(this.settings.pattern);
    this.save();
    this.renderSource();
    this.rescore();
  }

  /** The array is updated in place so a playing pattern (which holds a reference) hears the change. */
  private editPiano(notes: PianoNote[]) {
    if (!this.editable) return this.roll.setNotes(this.settings.piano);
    this.settings.piano.splice(0, this.settings.piano.length, ...notes);
    this.roll.setNotes(this.settings.piano);
    this.save();
    this.renderSource();
  }

  /** A dark bar square: grow to `bars`, repeating the existing bars, and show the bar clicked. */
  private extend(bars: number) {
    const from = patternBars(this.settings.pattern);
    if (!this.lengthEditable || bars <= from) return;
    this.resize(from, bars, bars - 1);
  }

  /** Double- or right-clicking a lit bar square: delete every bar after it, asking first if they have anything in them. */
  private async cutAfter(bar: number) {
    const from = patternBars(this.settings.pattern);
    if (!this.lengthEditable || bar + 1 >= from) return;
    if (hasContentFrom(this.settings.pattern, this.settings.piano, (bar + 1) * STEPS)) {
      const which = bar + 2 === from ? `BAR ${from}` : `BARS ${bar + 2}-${from}`;
      if (!(await confirmBox(`DELETE ${which}?`, 'DELETE'))) return;
    }
    this.resize(from, bar + 1, bar);
  }

  private resize(from: number, to: number, showPage: number) {
    this.settings.pattern = resizePattern(this.settings.pattern, to);
    this.settings.piano = resizePiano(this.settings.piano, from, to);
    this.playFrom = 0;
    this.save();
    this.setReview(null); // the review no longer matches the pattern
    this.showIdle();
    this.grid.setPage(showPage);
  }

  private pageClick(page: number) {
    // In review, jump to that bar of the pattern within the pass on screen.
    if (this.review && this.mode === 'idle') this.showReview(this.review.pageBar(page));
    else this.grid.setPage(page);
  }

  private toggleMute(t: number) {
    if (!this.mutable) return;
    this.settings.muted[t] = !this.settings.muted[t];
    this.grid.setMuted(this.settings.muted);
    this.save();
    this.rescore();
  }

  private togglePianoMute() {
    if (!this.mutable) return;
    this.settings.pianoMuted = !this.settings.pianoMuted;
    this.save();
    this.renderKeys();
  }

  /** Pattern edits and mutes apply to the review too (scoring happens at render time). */
  private rescore() {
    if (!this.review || this.mode !== 'idle') return;
    this.breakdown.render(this.review.result, this.settings.muted);
    this.showReview();
  }

  // ---------- display ----------

  private setReview(r: Review | null) {
    this.review = r;
    this.breakdown.render(r?.result ?? null, this.settings.muted);
    this.renderRunHistory();
  }

  /** The trainer at rest: the review if there is one, else the loaded pattern. */
  private showIdle() {
    if (this.review) return this.showReview();
    this.grid.clear();
    const r = this.routine;
    const first = r ? routinePlan(r, this.library, this.settings).segments[0] : null;
    this.grid.setPattern(r ? (first?.pattern ?? emptyPattern()) : this.settings.pattern);
    this.roll.setNotes(r ? (first?.piano ?? []) : this.settings.piano);
    this.controls.status('');
    this.refresh();
  }

  private showReview(bar?: number) {
    const rv = this.review;
    if (!rv) return;
    if (bar !== undefined) rv.goTo(bar);
    const { seg, bar: b } = rv.current;
    this.grid.showBar(rv.take, rv.spec.pattern, b, true);
    this.roll.setNotes(rv.spec.piano);
    this.controls.status(segmentStatus(rv.result.plan, seg, `BAR ${rv.bar + 1}/${rv.bars.length}`));
    this.refresh();
  }

  private renderSource() {
    const r = this.routine;
    const saved = this.library.pattern(this.settings.patternId);
    const name = r ? r.name : saved ? saved.name + (this.isUnmodified(saved) ? '' : ' *') : 'UNSAVED';
    this.source.render(!!r, name, this.mode !== 'idle');
  }

  private renderKeys() {
    this.keys.render(this.settings.pianoOpen, this.settings.pianoMuted);
  }

  private renderBinds() {
    this.bindPanel.set(this.bindings.labels(), this.bindings.learning);
  }

  /** Enables and disables everything for the current mode. */
  private refresh() {
    const busy = this.mode !== 'idle';
    this.controls.update(this.mode, !!this.routineId);
    this.tabs.setLocked(busy);
    this.bindPanel.setLocked(busy);
    this.grid.setLengthLocked(!this.lengthEditable);
    this.grid.setMuteLocked(!this.mutable);
    this.roll.setLocked(!this.editable);
    this.keys.setLocked(this.editable, !this.mutable);
    if (this.review) {
      this.breakdown.setCurrent(this.review.current.seg, this.mode === 'replay');
      this.breakdown.setLocked(busy && this.mode !== 'replay');
    }
    this.renderSource();
  }
}
