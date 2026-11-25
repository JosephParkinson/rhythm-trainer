import { Scheduler, playClickStep, playPatternStep } from '../audio/scheduler';
import { stepDurFor } from '../plan';
import { STEPS, type ClickPattern, type Pattern } from '../settings';
import type { Deps, Session } from './session';

/** Loops a pattern until stopped. Reads the pattern live, so edits are heard on the next pass. */
export class PreviewSession implements Session {
  readonly mode = 'preview';
  private readonly sched: Scheduler;

  constructor(
    private readonly d: Deps,
    pattern: Pattern,
    bpm: number,
    click: ClickPattern,
  ) {
    const { eng } = d;
    this.sched = new Scheduler(eng, eng.now + 0.1, stepDurFor(bpm), 0, Infinity, (step, t) => {
      playPatternStep(eng, pattern, step % STEPS, t);
      playClickStep(eng, click, step % STEPS, t);
    });
    d.grid.setPattern(pattern);
    d.controls.lcd('PREVIEW', `${bpm} BPM`);
  }

  frame() {
    const pos = this.sched.position();
    this.d.grid.setPlayhead(pos >= 0 ? Math.floor(pos) % STEPS : -1);
  }

  stop() {
    this.sched.stop();
    this.d.eng.cancelScheduled();
  }
}
