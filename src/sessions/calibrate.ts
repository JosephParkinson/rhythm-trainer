import { CAL_TAPS, Calibration } from '../audio/calibration';
import type { Deps, Session } from './session';

/** Runs mic calibration and reports the measured latency. Hits are silent and go to the calibrator. */
export class CalibrateSession implements Session {
  readonly mode = 'cal';
  private readonly cal: Calibration;
  private cancelled = false;

  constructor(d: Deps, onLatency: (ms: number) => void) {
    const { controls } = d;
    this.cal = new Calibration(d.eng);
    controls.lcd('MIC...');
    this.cal
      .run((listening, taps) =>
        controls.lcd(listening ? 'LISTEN...' : `TAP BETWEEN CLICKS  ${taps}/${CAL_TAPS}`, 'SPEAKERS ON, NO HEADPHONES'),
      )
      .then(
        (r) => {
          onLatency(r.latency);
          controls.lcd(`LATENCY SET TO ${d.settings.latency}MS`, `JITTER ±${r.jitter}MS  (${r.used} TAPS)`);
        },
        (e) => this.cancelled || controls.lcd('CALIBRATION FAILED', errorText(e)),
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

function errorText(e: unknown) {
  if (e instanceof DOMException && e.name === 'NotAllowedError') return 'MIC ACCESS DENIED';
  return e instanceof Error ? e.message.toUpperCase() : 'ERROR';
}
