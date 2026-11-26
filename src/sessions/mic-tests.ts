import { CAL_TAPS, Calibration } from '../audio/calibration';
import { LAG_TAPS, LagTest } from '../audio/lag';
import type { Deps, Session } from './session';

/** A mic-based measurement: taps go to it, and it reports through the settings panel readout. */
interface MicTest {
  tap(perfMs: number): void;
  cancel(): void;
}

/**
 * Wraps a mic test as a session. `run` resolves with the two readout lines to
 * show when it succeeds. Hits make no drum sound so the mic only hears the key.
 */
function micTestSession(d: Deps, mode: 'cal' | 'lag', label: string, test: MicTest, run: () => Promise<[string, string]>): Session {
  const { controls } = d;
  let ended = false;
  const session: Session = {
    mode,
    mutesHits: true,
    hit: (_track, perfMs) => test.tap(perfMs),
    stop(completed) {
      ended = true;
      test.cancel();
      if (!completed) controls.testStatus(`${label} CANCELLED`);
    },
  };
  controls.testStatus('MIC...');
  run()
    .then(
      ([l1, l2]) => controls.testStatus(l1, l2),
      (e) => ended || controls.testStatus(`${label} FAILED`, errorText(e)),
    )
    .finally(() => d.finish(session));
  return session;
}

const HINT = 'SPEAKERS ON, NO HEADPHONES';

/** CALIBRATE: measures input latency and stores it via `onLatency`. */
export function calibrateSession(d: Deps, onLatency: (ms: number) => void): Session {
  const cal = new Calibration(d.eng);
  return micTestSession(d, 'cal', 'CALIBRATION', cal, async () => {
    const r = await cal.run((listening, taps) =>
      d.controls.testStatus(listening ? 'LISTEN...' : `TAP BETWEEN CLICKS  ${taps}/${CAL_TAPS}`, HINT),
    );
    onLatency(r.latency);
    return [`LATENCY SET TO ${d.settings.latency}MS`, `JITTER ±${r.jitter}MS  (${r.used} TAPS)`];
  });
}

/** LAG TEST: measures tap-to-sound delay. */
export function lagSession(d: Deps): Session {
  const test = new LagTest(d.eng);
  return micTestSession(d, 'lag', 'LAG TEST', test, async () => {
    const r = await test.run((taps) => d.controls.testStatus(`TAP SLOWLY  ${taps}/${LAG_TAPS}`, HINT));
    return [`TAP TO SOUND ${r.lag}MS  ±${r.jitter}MS`, `BROWSER OUTPUT ${d.eng.outputLatencyMs}MS  (${r.used} TAPS)`];
  });
}

function errorText(e: unknown) {
  if (e instanceof DOMException && e.name === 'NotAllowedError') return 'MIC ACCESS DENIED';
  return e instanceof Error ? e.message.toUpperCase() : 'ERROR';
}
