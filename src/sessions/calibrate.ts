import { CAL_TAPS, Calibration } from '../audio/calibration';
import { errorText, type Deps, type Session } from './session';

/** Runs mic calibration and reports the measured latency. Hits are silent and go to the calibrator. */
export class CalibrateSession implements Session {
  readonly mode = 'cal';
  readonly mutesHits = true;
  private readonly cal: Calibration;
  private cancelled = false;

  constructor(d: Deps, onLatency: (ms: number) => void) {
    const { controls } = d;
    this.cal = new Calibration(d.eng);
    controls.testStatus('MIC...');
    this.cal
      .run((listening, taps) =>
        controls.testStatus(listening ? 'LISTEN...' : `TAP BETWEEN CLICKS  ${taps}/${CAL_TAPS}`, 'SPEAKERS ON, NO HEADPHONES'),
      )
      .then(
        (r) => {
          onLatency(r.latency);
          controls.testStatus(`LATENCY SET TO ${d.settings.latency}MS`, `JITTER ±${r.jitter}MS  (${r.used} TAPS)`);
        },
        (e) => this.cancelled || controls.testStatus('CALIBRATION FAILED', errorText(e)),
      )
      .finally(() => d.finish(this));
  }

  hit(_track: number, perfMs: number) {
    this.cal.tap(perfMs);
  }

  stop() {
    this.cancelled = true;
    this.cal.cancel();
  }
}

