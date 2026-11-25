import { Scheduler, playClickStep, playPatternStep, playPianoStep } from '../audio/scheduler';
import { stepDurFor } from '../plan';
import { STEPS, patternSteps, type ClickPattern, type Pattern, type PianoNote } from '../settings';
import type { Deps, Session } from './session';

/**
 * PLAY: loops a pattern until paused, starting from `fromStep` (to resume).
 * The pattern, keyboard part and mutes are read live, so edits are heard on the
 * next pass. The grid follows the playhead across the pattern's pages.
 */
export class PlaySession implements Session {
  readonly mode = 'play';
  private readonly sched: Scheduler;
  private readonly len: number;

  constructor(
    private readonly d: Deps,
    pattern: Pattern,
    piano: readonly PianoNote[],
    bpm: number,
    click: ClickPattern,
    fromStep = 0,
  ) {
    const { eng } = d;
    const stepDur = stepDurFor(bpm);
    this.len = patternSteps(pattern);
    const start = eng.now + 0.1 - fromStep * stepDur;
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
    this.d.grid.setPage(Math.floor(s / STEPS));
    this.d.grid.setPlayhead(s % STEPS);
  }

  stop() {
    this.sched.stop();
    this.d.eng.cancelScheduled();
  }
}
