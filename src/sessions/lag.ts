import { LAG_TAPS, LagTest } from '../audio/lag';
import { errorText, type Deps, type Session } from './session';

/** Measures tap → sound lag with the mic. Hits beep instead of playing drums. */
export class LagSession implements Session {
  readonly mode = 'lag';
  readonly mutesHits = true;
  private readonly test: LagTest;
  private cancelled = false;

  constructor(d: Deps) {
    const { controls, eng } = d;
    this.test = new LagTest(eng);
    controls.lcd('MIC...');
    this.test
      .run((taps) => controls.lcd(`TAP SLOWLY  ${taps}/${LAG_TAPS}`, 'SPEAKERS ON, NO HEADPHONES'))
      .then(
        (r) =>
          controls.lcd(`TAP TO SOUND ${r.lag}MS  ±${r.jitter}MS`, `BROWSER OUTPUT ${eng.outputLatencyMs}MS  (${r.used} TAPS)`),
        (e) => this.cancelled || controls.lcd('LAG TEST FAILED', errorText(e)),
      )
      .finally(() => d.finish(this));
  }

  hit(_track: number, perfMs: number) {
    this.test.tap(perfMs);
  }

  stop() {
    this.cancelled = true;
    this.test.cancel();
  }
}
