import type { Engine } from '../audio/engine';
import type { Settings } from '../settings';
import type { ActiveMode, Controls } from '../ui/controls';
import type { Grid } from '../ui/grid';

export interface Deps {
  eng: Engine;
  settings: Settings;
  grid: Grid;
  controls: Controls;
  /** Ends `session` as completed. No-op if it's no longer the current session. */
  finish(session: Session): void;
}

/**
 * Something the transport is doing: playing a take, replaying, previewing or
 * calibrating. The App runs one at a time, calls frame() every animation
 * frame, forwards hits, and calls stop() exactly once when it ends.
 */
export interface Session {
  readonly mode: ActiveMode;
  /** Hits make no drum sound (mic tests need to hear only the pad/key). */
  readonly mutesHits?: boolean;
  frame?(): void;
  hit?(track: number, perfMs: number, vel: number): void;
  /** Release timers and cancel scheduled audio. */
  stop(): void;
}

/** LCD text for a failed mic test. */
export function errorText(e: unknown) {
  if (e instanceof DOMException && e.name === 'NotAllowedError') return 'MIC ACCESS DENIED';
  return e instanceof Error ? e.message.toUpperCase() : 'ERROR';
}
