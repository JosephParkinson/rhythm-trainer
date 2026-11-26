import { Scheduler, playClickStep, playPatternStep, playPianoStep } from '../audio/scheduler';
import { STEPS, STEPS_PER_BEAT, TRACKS, patternSteps, stepDurFor, type ClickPattern, type Pattern, type PianoNote } from '../core/pattern';
import { Take } from '../core/scoring';
import type { Deps, Session } from './session';

/** How far ahead of a step its old markers are wiped, in steps: early enough, but not so early that an early hit on it is lost. */
const WIPE_AHEAD = 0.5;

/**
 * PLAY: loops a pattern until paused, starting from `fromStep` (to resume).
 * The pattern, keyboard part and mutes are read live, so edits are heard on the
 * next pass. The grid stays on the bar you're looking at: the playing bar's
 * square pulses on each beat, and the step lights only run while it's the bar on screen.
 *
 * Live hits are graded and drawn like TEST's. Each column keeps showing the last
 * pass's hits until the playhead comes round to it again: half a step before
 * it, the column switches to the new pass. Nothing is kept or logged.
 */
export class PlaySession implements Session {
  readonly mode = 'play';
  private readonly sched: Scheduler;
  private readonly len: number;
  private readonly latency: number;
  /** every hit since PLAY started, on one endless timeline (global steps) */
  private readonly take: Take;
  /** global step drawn in each column of the page on screen */
  private readonly shown: number[] = Array<number>(STEPS).fill(NaN);
  private shownPage = -1;

  constructor(
    private readonly d: Deps,
    private readonly pattern: Pattern,
    piano: readonly PianoNote[],
    bpm: number,
    click: ClickPattern,
    fromStep = 0,
  ) {
    const { eng } = d;
    const stepDur = stepDurFor(bpm);
    this.len = patternSteps(pattern);
    this.latency = d.settings.latency / 1000;
    const start = eng.now + 0.1 - fromStep * stepDur;
    this.take = new Take(start, stepDur, Infinity);
    this.sched = new Scheduler(eng, start, stepDur, fromStep, Infinity, (step, t) => {
      const s = step % this.len;
      playPatternStep(eng, pattern, s, t, d.settings.muted);
      if (!d.settings.pianoMuted) playPianoStep(eng, piano, s, t, stepDur);
      playClickStep(eng, click, s % STEPS, t);
    });
    d.grid.setPattern(pattern);
    d.roll.setNotes(piano);
    d.controls.status('');
  }

  /** Pattern step being heard; PLAY resumes from here after a pause. */
  get position() {
    return Math.max(0, Math.floor(this.sched.position())) % this.len;
  }

  frame() {
    const pos = this.sched.position();
    if (pos < 0) return;
    const s = Math.floor(pos) % this.len;
    const page = Math.floor(s / STEPS);
    // The playing bar's square pulses for the first 16th of each beat.
    this.d.grid.setPlayingPage(page, Math.floor(pos) % STEPS_PER_BEAT === 0);
    this.d.grid.setPlayhead(page === this.d.grid.currentPage ? s % STEPS : -1);
    this.drawPage(pos);
  }

  hit(track: number, perfMs: number, vel: number) {
    const h = this.take.record(track, this.d.eng.heardTime(perfMs) - this.latency, vel);
    // Draw it now if its column is on screen and already showing this pass.
    if (h && this.shown[h.step % STEPS] === h.step && this.pageOf(h.step) === this.shownPage) {
      this.d.grid.showCell(this.take, this.pattern, track, h.step, false);
    }
  }

  /** Redraws each column of the page on screen whose pass changed (or all of them after a page change). */
  private drawPage(pos: number) {
    const page = this.d.grid.currentPage;
    const all = page !== this.shownPage;
    this.shownPage = page;
    for (let col = 0; col < STEPS; col++) {
      const step = this.latestPass(page * STEPS + col, pos);
      if (!all && step === this.shown[col]) continue;
      this.shown[col] = step;
      for (let t = 0; t < TRACKS.length; t++) this.d.grid.showCell(this.take, this.pattern, t, step, false);
    }
  }

  /**
   * The global step of pattern step `ps` in the latest pass the playhead has
   * reached (from WIPE_AHEAD before it). Before the first pass, its first pass.
   */
  private latestPass(ps: number, pos: number) {
    return ps + Math.max(0, Math.floor((pos + WIPE_AHEAD - ps) / this.len)) * this.len;
  }

  /** Pattern page a global step falls on. */
  private pageOf(step: number) {
    return Math.floor((step % this.len) / STEPS);
  }

  stop() {
    this.d.grid.setPlayingPage(-1);
    this.sched.stop();
    this.d.eng.cancelScheduled();
  }
}
