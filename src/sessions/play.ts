import { Scheduler } from '../audio/scheduler';
import { Take } from '../scoring';
import { BEATS_PER_BAR, STEPS, STEPS_PER_BEAT } from '../settings';
import type { Deps, Session } from './session';

const LEAD_IN = 0.25;

/** Count-in, then records hits against the pattern for `settings.bars` bars. */
export class PlaySession implements Session {
  readonly mode = 'play';
  readonly take: Take;
  private readonly sched: Scheduler;
  // Copied at start so the run is consistent even if settings change.
  private readonly latency: number;
  private readonly countIn: number;
  private readonly bpm: number;
  private shownBar = -1;

  constructor(private readonly d: Deps) {
    const { eng, settings: s } = d;
    const stepDur = 60 / s.bpm / STEPS_PER_BEAT;
    const start = eng.now + LEAD_IN + s.countIn * STEPS * stepDur;
    this.take = new Take(start, stepDur, s.bars);
    this.latency = s.latency / 1000;
    this.countIn = s.countIn;
    this.bpm = s.bpm;

    const metronome = s.metronome;
    this.sched = new Scheduler(eng, start, stepDur, -s.countIn * STEPS, this.take.steps, (step, t) => {
      // The count-in always clicks; the metronome setting covers the practice bars.
      if (step % STEPS_PER_BEAT === 0 && (step < 0 || metronome)) eng.click(t, step % STEPS === 0);
    });
    this.showBar(0);
  }

  frame() {
    const { grid, controls } = this.d;
    const pos = this.sched.position();
    const steps = this.take.steps;
    if (pos >= steps + 1) return this.d.finish(this);

    if (pos < 0) {
      const sinceStart = pos + this.countIn * STEPS;
      const beat = (Math.floor(sinceStart / STEPS_PER_BEAT) % BEATS_PER_BAR) + 1;
      controls.lcd(sinceStart < 0 ? 'READY' : `COUNT-IN  ${beat}`, `${this.bpm} BPM`);
      grid.setPlayhead(-1);
      return;
    }
    const step = Math.min(Math.floor(pos), steps - 1);
    const bar = Math.floor(step / STEPS);
    this.showBar(bar);
    grid.setPlayhead(pos < steps ? step % STEPS : -1);
    controls.lcd(`BAR ${bar + 1}/${this.take.bars}`, `${this.bpm} BPM`);
  }

  hit(track: number, perfMs: number, vel: number) {
    const h = this.take.record(track, this.d.eng.heardTime(perfMs) - this.latency, vel);
    if (h && Math.floor(h.step / STEPS) === this.shownBar) {
      this.d.grid.showCell(this.take, this.d.settings.pattern, track, h.step, false);
    }
  }

  stop() {
    this.sched.stop();
  }

  private showBar(bar: number) {
    if (bar === this.shownBar) return;
    this.shownBar = bar;
    this.d.grid.showBar(this.take, this.d.settings.pattern, bar, false);
  }
}
