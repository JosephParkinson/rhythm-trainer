import { Engine } from './audio/engine';
import { Bindings } from './input/bindings';
import { Take, stats } from './scoring';
import { CalibrateSession } from './sessions/calibrate';
import { PlaySession } from './sessions/play';
import { PreviewSession } from './sessions/preview';
import { ReplaySession } from './sessions/replay';
import type { Deps, Session } from './sessions/session';
import { TRACKS, clampSetting, loadSettings, saveSettings } from './settings';
import { Controls, type ActiveMode, type Mode } from './ui/controls';
import { $ } from './ui/dom';
import { formatStats } from './ui/format';
import { Grid } from './ui/grid';

/**
 * Top-level controller. Owns settings, the last take and review position, and
 * runs at most one Session at a time (see sessions/session.ts).
 */
export class App {
  private readonly settings = loadSettings();
  private readonly grid: Grid;
  private readonly controls: Controls;
  private readonly bindings: Bindings;
  /** Created on first use: browsers only allow audio after a user gesture. */
  private engine: Engine | null = null;
  private session: Session | null = null;
  private onSessionEnd: (completed: boolean) => void = () => {};
  private take: Take | null = null;
  private reviewBar = 0;

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
        if (!this.take && !this.session) this.showIdle();
      },
    });
    this.bindings = new Bindings(this.settings, (t, p, v) => this.hit(t, p, v), () => {
      this.save();
      this.grid.setBinds(this.bindings.labels(), this.bindings.learning);
    });
    this.bindings.startMidi((names) => this.controls.setMidi(names));

    this.grid.setPattern(this.settings.pattern);
    this.grid.setBinds(this.bindings.labels(), null);
    this.showIdle();
  }

  private get mode(): Mode {
    return this.session?.mode ?? 'idle';
  }

  private get eng(): Engine {
    this.engine ??= new Engine();
    if (this.engine.ctx.state !== 'running') void this.engine.ctx.resume();
    return this.engine;
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
        this.take = null;
        this.grid.clear();
        const s = new PlaySession(d);
        return this.run(s, (done) => {
          if (done) this.take = s.take;
          else this.grid.clear();
          this.showIdle(0);
        });
      }
      case 'preview':
        return this.run(new PreviewSession(d), () => this.showIdle());
      case 'replay': {
        if (!this.take) return;
        const from = this.reviewBar;
        const s = new ReplaySession(d, this.take, from, (bar) => this.showReview(bar));
        return this.run(s, () => this.showReview(from));
      }
      case 'cal': {
        this.take = null;
        this.grid.clear();
        const s = new CalibrateSession(d, (ms) => this.setLatency(ms));
        return this.run(s, (done) => done || this.controls.lcd('CALIBRATION CANCELLED'));
      }
    }
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
    if (s?.mode !== 'cal' && this.settings.sounds) this.eng.trigger(TRACKS[track].voice, vel);
    this.grid.flash(track);
    s?.hit?.(track, perfMs, vel);
  }

  // ---------- state ----------

  /** Pattern edits are allowed while idle or previewing. */
  private editPattern(edit: () => void) {
    if (this.mode !== 'idle' && this.mode !== 'preview') return;
    edit();
    this.grid.setPattern(this.settings.pattern);
    this.save();
    if (this.mode === 'idle' && this.take) this.showReview(); // re-score
  }

  private setLatency(ms: number) {
    this.settings.latency = clampSetting('latency', ms, this.settings.latency);
    this.controls.syncInputs();
    this.save();
  }

  private save() {
    saveSettings(this.settings);
  }

  // ---------- display ----------

  private showIdle(reviewBar = this.reviewBar) {
    if (this.take) return this.showReview(reviewBar);
    const { bpm, bars } = this.settings;
    this.controls.lcd('READY', `${bpm} BPM  ${bars} BARS`);
    this.refresh();
  }

  private showReview(bar = this.reviewBar) {
    const take = this.take;
    if (!take) return;
    this.reviewBar = Math.min(take.bars - 1, Math.max(0, bar));
    const { pattern } = this.settings;
    this.grid.showBar(take, pattern, this.reviewBar, true);
    this.controls.lcd(
      `BAR ${this.reviewBar + 1}/${take.bars}`.padEnd(10) + formatStats(stats(take, pattern, this.reviewBar, this.reviewBar + 1)),
      'TOTAL'.padEnd(10) + formatStats(stats(take, pattern, 0, take.bars)),
    );
    this.refresh();
  }

  private refresh() {
    this.controls.update({ mode: this.mode, bars: this.take?.bars ?? 0, reviewBar: this.reviewBar });
    this.grid.setLocked(this.mode !== 'idle');
  }
}
