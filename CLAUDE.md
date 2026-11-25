# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser-based rhythm trainer for finger drumming on a computer keyboard or MIDI pads. You program a 16-step pattern (kick, snare, hat, open hat), play it against a metronome, and each hit is scored against the grid. Vite + TypeScript with no framework. Target browsers are Chrome and Edge; Safari has no Web MIDI.

## Commands

```bash
npm install
npm run dev                          # dev server
npm run build                        # tsc typecheck + production build
npm test                             # vitest, all tests
npx vitest run src/scoring.test.ts   # one file
npx vitest run -t "recovers input"   # tests matching a name
```

Tests cover the pure logic: scoring, settings sanitising, and calibration analysis on synthetic recordings. Anything touching `AudioContext` or the DOM is untested, so check it in a browser.

## Architecture

`App` (`src/app.ts`) is the controller. It owns the settings, the last `Take` and the review position, and it runs **at most one `Session` at a time**. A session is one transport activity:

- `sessions/play.ts`: count-in, then records hits into a `Take`.
- `sessions/replay.ts`: plays a take's hits back at their real times.
- `sessions/preview.ts`: loops the pattern, reading `settings.pattern` live so edits are heard.
- `sessions/calibrate.ts`: runs mic latency calibration.

`App.run()` drives `session.frame()` from `requestAnimationFrame` and forwards hits to `session.hit()`. A session ends either by calling `deps.finish(this)` itself (completed) or when the user presses the same button again (cancelled). Either way `stop()` is called exactly once, then the `onEnd(completed)` callback passed to `run()`. To add a mode:

1. Add a button whose id is the mode name.
2. Add the mode to `LABELS` in `ui/controls.ts`.
3. Implement `Session`.
4. Add a case to `App.start()`.

**Timing model.** Everything is measured on the AudioContext clock:

- `Engine.heardTime(perfMs)` maps an input event's `timeStamp` (keyboard and MIDI share the `performance.now()` clock) to the context time that was *audible* at that moment, using `getOutputTimestamp()`. That cancels the output latency.
- `settings.latency` is subtracted on top to cover input latency. CALIBRATE measures it.
- `Take.record()` snaps each hit to the nearest 16th and stores a global `step` plus `err` in ms (positive means late).

**Scheduling.** `audio/scheduler.ts` is a lookahead sequencer (25 ms timer, about 0.1 s plus half a step ahead) used by play, replay and preview. The extra half step lets replay place early hits (negative `err`) before their step. Everything scheduled goes through the `Engine`'s scheduled bus, which `cancelScheduled()` swaps out. `Engine.trigger()` is for live hits, plays immediately and can't be cancelled.

**Scoring** (`scoring.ts`) happens at render time, never at record time. Per cell, the closest hit on a target step is graded (`GOOD_MS`/`OK_MS`) and every other hit is "extra". So editing the pattern after a run re-scores the review.

**Calibration** (`audio/calibration.ts`):

1. Plays 1 kHz clicks while the user taps between them.
2. Records the mic through an inline AudioWorklet. Channel 0 is high-passed and used for onset timing; channel 1 is band-passed at 1 kHz and used to find the clicks.
3. Finds the speaker-to-mic delay by aligning click-band energy across all clicks.
4. For each tap, compares the true click-to-clack gap in the recording with the gap the app measured. The median difference becomes `settings.latency`.

The mic must be opened with echoCancellation, noiseSuppression and autoGainControl off, or the click gets filtered out. `analyseCalibration()` is pure and tested.

**Input** (`input/bindings.ts`). Each track has one key (`settings.keys`, `''` when unbound) and one MIDI note (`settings.notes`, `null` when unbound, defaulting to GM 36/38/42/46). `learn(track)` makes the next key or note that track's binding and removes it from any other track. Hits are silent during calibration so the mic only hears the key.

**Settings** (`settings.ts`) persist in `localStorage` under `rhythm-trainer`. `sanitize()` validates stored data field by field, so adding a setting only needs a default. `NUMBER_LIMITS` is the single source for input min/max values; don't put them in `index.html`. `STEPS`, `STEPS_PER_BEAT` and `TRACKS` define the grid. The UI (`ui/grid.ts`, `ui/controls.ts`) builds itself from them.

## UI style

Retro 2000s drum-machine look: bevelled grey panels, LED indicators, green LCD text. Use the minimum text needed and keep labels terse and uppercase. Avoid modern flat or "slick" styling.
