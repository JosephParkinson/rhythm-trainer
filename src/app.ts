import { Engine } from './audio/engine';
import { History } from './history';
import { Bindings } from './input/bindings';
import { Library } from './library';
import { barRefs, editorPlan, routinePlan, type RunResult } from './plan';
import { timing } from './scoring';
import { CalibrateSession } from './sessions/calibrate';
import { LagSession } from './sessions/lag';
import { PreviewSession } from './sessions/preview';
import { ReplaySession } from './sessions/replay';
import { RunSession } from './sessions/run';
import type { Deps, Session } from './sessions/session';
import {
  TRACKS,
  browserStore,
  clampSetting,
  cloneGrid,
  defaultClick,
  emptyClick,
  emptyPattern,
  loadSettings,
  sameGrid,
  saveSettings,
} from './settings';
import { Breakdown } from './ui/breakdown';
import { Controls, type ActiveMode, type Mode } from './ui/controls';
import { confirmBox, promptText } from './ui/dialog';
import { $ } from './ui/dom';
import { formatStats } from './ui/format';
import { Grid } from './ui/grid';
import { PatternsView } from './ui/patterns-view';
import { RoutinesView } from './ui/routines-view';

type View = 'trainer' | 'patterns' | 'routines';
const PRACTICE_VIEWS = ['patterns', 'routines'] as const;
const TABS = ['tab-trainer', 'tab-practice', 'tab-patterns', 'tab-routines'];

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
  private readonly controls: Controls;
  private readonly bindings: Bindings;
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
  /** last PRACTICE sub-tab */
  private practiceView: (typeof PRACTICE_VIEWS)[number] = 'patterns';

  constructor() {
    this.grid = new Grid($('grid'), {
      toggle: (t, s) => this.editPattern(() => (this.settings.pattern[t][s] = !this.settings.pattern[t][s])),
      bindClick: (t) => this.bindings.learn(this.bindings.learning === t ? null : t),
    });
    this.controls = new Controls(this.settings, {
      toggle: (m) => (this.session?.mode === m ? this.end(this.session, false) : void this.start(m)),
      clear: () => this.editPattern(() => this.settings.pattern.forEach((row) => row.fill(false))),
      nav: (d) => this.showReview(this.reviewBar + d),
      change: () => {
        this.save();
        // A new buffer size needs a new AudioContext; it's created on next use.
        if (this.engine && this.engine.lowLatency !== this.settings.lowLatency && !this.session) {
          void this.engine.ctx.close();
          this.engine = null;
          this.controls.setOutputLatency(null);
        }
        if (!this.result && !this.session) this.showIdle();
      },
    });
    this.bindings = new Bindings(this.settings, (t, p, v) => this.hit(t, p, v), () => {
      this.save();
      this.grid.setBinds(this.bindings.labels(), this.bindings.learning);
    });
    this.bindings.startMidi((names) => this.controls.setMidi(names));
    this.breakdown = new Breakdown($('breakdown'), {
      select: (seg) => !this.session && this.showReview(this.segmentBars(seg).from),
      replay: (seg) => this.replaySegment(seg),
    });

    $('new').addEventListener('click', () => this.newPattern());
    $('save').addEventListener('click', () => void this.savePattern());
    $('exit').addEventListener('click', () => this.loadRoutine(null));
    $('tab-trainer').addEventListener('click', () => this.setView('trainer'));
    $('tab-practice').addEventListener('click', () => this.setView(this.practiceView));
    for (const v of PRACTICE_VIEWS) $(`tab-${v}`).addEventListener('click', () => this.setView(v));
    new PatternsView($('patterns'), this.library, this.history, (id) => this.loadPattern(id));
    new RoutinesView($('routines'), this.library, this.history, (id) => this.loadRoutine(id));
    this.library.onChange(() => this.libraryChanged());

    if (!this.library.pattern(this.settings.patternId)) this.settings.patternId = null;
    this.grid.setBinds(this.bindings.labels(), null);
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
      controls: this.controls,
      finish: (s) => this.end(s, true),
    };

    switch (mode) {
      case 'play': {
        const r = this.routine;
        const plan = r ? routinePlan(r, this.library, this.settings) : editorPlan(this.settings, this.patternName());
        if (!plan.segments.length) return this.controls.lcd('ROUTINE EMPTY');
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
      case 'preview': {
        const s = this.settings;
        let p = { pattern: s.pattern, bpm: s.bpm, click: s.metronome ? defaultClick() : emptyClick() };
        const r = this.routine;
        if (r) {
          // The routine pattern on screen, at its own tempo and click.
          const plan = this.result?.plan ?? routinePlan(r, this.library, s);
          const seg = plan.segments[this.result ? barRefs(this.result)[this.reviewBar].seg : 0];
          if (!seg) return;
          p = seg;
        }
        return this.run(new PreviewSession(d, p.pattern, p.bpm, p.click), () => this.showIdle());
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
        this.setResult(null);
        this.grid.clear();
        const s = new CalibrateSession(d, (ms) => this.setLatency(ms));
        return this.run(s, (done) => this.micTestEnded(done, 'CALIBRATION CANCELLED'));
      }
      case 'lag': {
        this.setResult(null);
        this.grid.clear();
        return this.run(new LagSession(d), (done) => this.micTestEnded(done, 'LAG TEST CANCELLED'));
      }
    }
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

  /** A finished mic test leaves its result on the LCD; a cancelled one says so. */
  private micTestEnded(done: boolean, cancelled: string) {
    if (done) return;
    this.showIdle();
    this.controls.lcd(cancelled);
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
    // Calibration needs silence so the mic only hears the key.
    if (!s?.mutesHits && this.settings.sounds) this.eng.trigger(TRACKS[track].voice, vel);
    this.grid.flash(track);
    s?.hit?.(track, perfMs, vel);
  }

  /** Saved patterns log runs only when played unmodified; routines always log. */
  private logHistory(r: RunResult) {
    if (r.plan.routineId) {
      this.history.add('routine', r.plan.routineId, r);
      return;
    }
    const saved = this.library.pattern(this.settings.patternId);
    if (saved && sameGrid(saved.grid, this.settings.pattern)) this.history.add('pattern', saved.id, r);
  }

  // ---------- loading & saving ----------

  private loadPattern(id: string) {
    const p = this.library.pattern(id);
    if (!p || this.session) return;
    this.settings.pattern = cloneGrid(p.grid);
    this.settings.bpm = p.bpm;
    this.settings.patternId = p.id;
    this.routineId = null;
    this.controls.syncInputs();
    this.save();
    this.setResult(null);
    this.setView('trainer');
    this.showIdle();
  }

  private loadRoutine(id: string | null) {
    if (this.session) return;
    this.routineId = id;
    this.setResult(null);
    this.setView('trainer');
    this.showIdle();
  }

  private newPattern() {
    if (this.session || this.routineId) return;
    this.settings.pattern = emptyPattern();
    this.settings.patternId = null;
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

  // ---------- state ----------

  /** The editor pattern is editable while idle or previewing, unless a routine is loaded. */
  private editPattern(edit: () => void) {
    if (this.routineId || (this.mode !== 'idle' && this.mode !== 'preview')) return;
    edit();
    this.grid.setPattern(this.settings.pattern);
    this.save();
    this.renderSource();
    if (this.mode === 'idle' && this.result) {
      this.breakdown.render(this.result); // re-score
      this.showReview();
    }
  }

  private setLatency(ms: number) {
    this.settings.latency = clampSetting('latency', ms, this.settings.latency);
    this.controls.syncInputs();
    this.save();
  }

  private setResult(r: RunResult | null) {
    this.result = r;
    this.breakdown.render(r);
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

  private patternName() {
    return this.library.pattern(this.settings.patternId)?.name ?? 'UNSAVED';
  }

  private showIdle() {
    if (this.result) return this.showReview();
    this.grid.clear();
    const r = this.routine;
    if (r) {
      const plan = routinePlan(r, this.library, this.settings);
      this.grid.setPattern(plan.segments[0]?.pattern ?? emptyPattern());
      const bars = plan.segments.reduce((a, s) => a + s.bars, 0);
      this.controls.lcd('READY', `${plan.segments.length} PATTERNS  ${bars} BARS`);
    } else {
      this.grid.setPattern(this.settings.pattern);
      this.controls.lcd('READY', `${this.settings.bpm} BPM  ${this.settings.bars} BARS`);
    }
    this.refresh();
  }

  private showReview(bar = this.reviewBar) {
    const r = this.result;
    if (!r) return;
    const refs = barRefs(r);
    this.reviewBar = Math.min(refs.length - 1, Math.max(0, bar));
    const { seg, bar: b } = refs[this.reviewBar];
    const spec = r.plan.segments[seg];
    const take = r.takes[seg];
    this.grid.setPattern(spec.pattern);
    this.grid.showBar(take, spec.pattern, b, true);

    const barLine = `BAR ${this.reviewBar + 1}/${refs.length}`.padEnd(10) + formatStats(timing(take, spec.pattern, { fromBar: b, toBar: b + 1 }));
    const segLine = r.plan.routineId
      ? `${seg + 1}/${r.takes.length} ${spec.name}`.slice(0, 24).padEnd(25) + `${spec.bpm} BPM`
      : 'TOTAL'.padEnd(10) + formatStats(timing(take, spec.pattern));
    this.controls.lcd(barLine, segLine);
    this.refresh();
  }

  private renderSource() {
    const r = this.routine;
    const saved = this.library.pattern(this.settings.patternId);
    $('srcKind').textContent = r ? 'ROUTINE' : 'PATTERN';
    $('srcName').textContent = r
      ? r.name
      : saved
        ? saved.name + (sameGrid(saved.grid, this.settings.pattern) ? '' : ' *')
        : 'UNSAVED';
    const busy = this.mode !== 'idle';
    for (const id of ['new', 'save'] as const) {
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
    this.controls.update({
      mode: this.mode,
      bars: this.result ? barRefs(this.result).length : 0,
      reviewBar: this.reviewBar,
      routine: !!this.routineId,
    });
    this.grid.setLocked(busy);
    if (this.result) {
      this.breakdown.setCurrent(barRefs(this.result)[this.reviewBar].seg, this.mode === 'replay');
      this.breakdown.setLocked(busy && this.mode !== 'replay');
    }
    for (const id of TABS) $<HTMLButtonElement>(id).disabled = busy;
    this.renderSource();
  }
}
