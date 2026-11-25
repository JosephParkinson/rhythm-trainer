import { Scheduler, playClickStep, playPatternStep, playPianoStep } from '../audio/scheduler';
import { stepDurFor } from '../plan';
import { Take } from '../scoring';
import { STEPS, STEPS_PER_BEAT, patternSteps, type ClickPattern, type Pattern, type PianoNote } from '../settings';
import type { Deps, Session } from './session';

/**
 * PLAY: loops a pattern until paused, starting from `fromStep` (to resume).
 * The pattern, keyboard part and mutes are read live, so edits are heard on the
 * next pass. The grid stays on the bar you're looking at: the playing bar's
 * square pulses on each beat, and the step lights only run while it's the bar on screen.
 * Live hits are graded and drawn like TEST's, but only for the current pass: the
 * markers are wiped as each loop begins. Nothing is kept or logged.
 */
export class PlaySession implements Session {
  readonly mode = 'play';
  private readonly sched: Scheduler;
  private readonly len: number;
  private readonly start: number;
  private readonly stepDur: number;
  private readonly latency: number;
  /** hits of the current pass */
  private take: Take | null = null;
  private pass = -Infinity;
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
    const stepDur = (this.stepDur = stepDurFor(bpm));
    this.len = patternSteps(pattern);
    this.latency = d.settings.latency / 1000;
    const start = (this.start = eng.now + 0.1 - fromStep * stepDur);
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
    // Markers are wiped as each pass begins (half a step early, so an early hit on the 1 stays).
    this.showPass(this.passAt(pos * this.stepDur));
  }

  /** Live hits are graded against the pattern and drawn for the current pass only. */
  hit(track: number, perfMs: number, vel: number) {
    const rel = this.d.eng.heardTime(perfMs) - this.latency - this.start;
    this.showPass(this.passAt(rel));
    const h = this.take?.record(track, rel + this.start, vel);
    if (h && Math.floor(h.step / STEPS) === this.d.grid.currentPage) {
      this.d.grid.showCell(this.take!, this.pattern, track, h.step, false);
    }
  }

  /** Pass index for a time relative to the start; a pass begins half a step before its first 16th. */
  private passAt(rel: number) {
    return Math.floor((rel / this.stepDur + 0.5) / this.len);
  }

  /** Starts a new (empty) take when the pass changes, and redraws when the pass or the bar on screen changes. */
  private showPass(pass: number) {
    const page = this.d.grid.currentPage;
    if (pass > this.pass) {
      this.pass = pass;
      this.take = new Take(this.start + pass * this.len * this.stepDur, this.stepDur, this.len / STEPS);
    } else if (page === this.shownPage) return;
    this.shownPage = page;
    if (this.take) this.d.grid.showBar(this.take, this.pattern, page, false);
  }

  stop() {
    this.d.grid.setPlayingPage(-1);
    this.sched.stop();
    this.d.eng.cancelScheduled();
  }
}
