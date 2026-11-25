import { Scheduler, playClickStep, playPatternStep, playPianoStep } from '../audio/scheduler';
import { stepDurFor } from '../plan';
import { STEPS, type ClickPattern, type Pattern, type PianoNote } from '../settings';
import type { Deps, Session } from './session';

/** Loops a pattern until stopped. Reads the pattern live, so edits are heard on the next pass. */
export class PreviewSession implements Session {
  readonly mode = 'preview';
  private readonly sched: Scheduler;

  constructor(
    private readonly d: Deps,
    pattern: Pattern,
    piano: readonly PianoNote[],
    bpm: number,
    click: ClickPattern,
  ) {
    const { eng } = d;
    const stepDur = stepDurFor(bpm);
    this.sched = new Scheduler(eng, eng.now + 0.1, stepDur, 0, Infinity, (step, t) => {
      // Mutes and the pattern/piano are read live, so edits mid-preview are heard.
      playPatternStep(eng, pattern, step % STEPS, t, d.settings.muted);
      if (!d.settings.pianoMuted) playPianoStep(eng, piano, step % STEPS, t, stepDur);
      playClickStep(eng, click, step % STEPS, t);
    });
    d.grid.setPattern(pattern);
    d.roll.setNotes(piano);
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
