import { Scheduler } from '../audio/scheduler';
import { STEPS, STEPS_PER_BEAT, TRACKS } from '../settings';
import type { Deps, Session } from './session';

/** Loops the pattern until stopped. Reads the pattern live, so edits are heard on the next pass. */
export class PreviewSession implements Session {
  readonly mode = 'preview';
  private readonly sched: Scheduler;

  constructor(private readonly d: Deps) {
    const { eng, settings } = d;
    const stepDur = 60 / settings.bpm / STEPS_PER_BEAT;
    this.sched = new Scheduler(eng, eng.now + 0.1, stepDur, 0, Infinity, (step, t) => {
      const s = step % STEPS;
      TRACKS.forEach((track, i) => settings.pattern[i][s] && eng.schedule(track.voice, t));
      if (settings.metronome && s % STEPS_PER_BEAT === 0) eng.click(t, s === 0);
    });
    d.controls.lcd('PREVIEW', `${settings.bpm} BPM`);
  }

  frame() {
    const pos = this.sched.position();
    this.d.grid.setPlayhead(pos >= 0 ? Math.floor(pos) % STEPS : -1);
  }

  stop() {
    this.sched.stop();
  }
}
