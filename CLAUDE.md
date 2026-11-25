# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser-based rhythm trainer for finger drumming on a computer keyboard or MIDI pads. You program a 16-step pattern (kick, snare, hat, open hat), play it against a metronome, and each hit is scored against the grid. Patterns can be saved into folders and chained into routines (per-pattern bars, BPM and click track), and every run of a saved pattern or routine is logged for progress tracking. Vite + TypeScript with no framework. Target browsers are Chrome and Edge; Safari has no Web MIDI.

## Commands

```bash
npm install
npm run dev                          # dev server
npm run build                        # tsc typecheck + production build
npm test                             # vitest, all tests
npx vitest run src/scoring.test.ts   # one file
npx vitest run -t "recovers input"   # tests matching a name

npm run serve                        # production build on http://localhost:5173 (install as an app from Edge/Chrome)
npm run app                          # build and open the desktop (Electron) app
npm run dist:win-portable            # Windows portable .exe → release/ (works from Linux/WSL)
npm run dist:win                     # Windows installer + portable (installer needs Windows or wine)
npm run dist:mac                     # macOS .dmg, arm64 + x64 (needs macOS)
```

**Installable web app.** `public/manifest.webmanifest`, `public/sw.js` and `src/pwa.ts` make the web build installable from Chrome or Edge. This is the main route on locked-down Windows machines, where the unsigned `.exe` is blocked. Details:

- The service worker fetches from the network first and falls back to its cache, so an installed app runs offline and picks up new builds whenever a server is reachable.
- It's registered only in production builds served over http(s). It's skipped in `vite` dev and in Electron.
- The INSTALL button shows only when the browser fires `beforeinstallprompt`.
- `localStorage` is per origin. `npm run serve` uses port 5173, the same as `npm run dev`, so data saved in either is shared.
- Bump `CACHE` in `sw.js` if the caching strategy ever changes.

Icons are rendered from `public/icon.svg` into `public/icon-*.png`, `public/apple-touch-icon.png` and `build/icon.png`; electron-builder picks up the last one automatically. `.github/workflows/pages.yml` can publish `dist/` to GitHub Pages when run manually.

**Desktop app.** `electron/main.cjs` serves `dist/` from a privileged `app://rhythm-trainer/` origin. That makes it a secure context, which mic, MIDI and AudioWorklet need. It also gives a stable origin, so `localStorage` persists between launches. Only `media` and `midi` permissions are granted. `vite.config.ts` uses `base: './'` so one build works both on the web and in Electron. Packaging config lives under `build` in `package.json`. `.github/workflows/desktop.yml` builds the Mac and Windows apps on manual dispatch or a `v*` tag, and attaches them to a release when triggered by a tag. Builds are unsigned.

Tests cover the pure logic: scoring, settings and library sanitising, library operations, plans, history, and calibration analysis on synthetic recordings. Anything touching `AudioContext` or the DOM is untested, so check it in a browser.

## Architecture

`App` (`src/app.ts`) is the controller. It owns:

- settings
- the `Library` and `History`
- what the trainer has loaded: the editor pattern, or a routine (`routineId`)
- the last `RunResult` and the review position

It runs **at most one `Session` at a time**. A session is one transport activity:

- `sessions/run.ts`: plays a `RunPlan` and records a `Take` per segment.
- `sessions/replay.ts`: plays a result's hits back at their real times, with the click that was heard, for a global bar range. REPLAY plays from the bar on screen to the end of its pattern (segment). In the breakdown table, ▶ replays one pattern, and clicking a pattern row jumps the review to it.
- `sessions/preview.ts`: loops one pattern, reading it live so edits are heard.
- `sessions/calibrate.ts`: runs mic latency calibration.
- `sessions/lag.ts`: LAG TEST, which measures tap-to-sound delay with the mic.

Mic tests set `mutesHits`, so hits make no drum sound.

`App.run()` drives `session.frame()` from `requestAnimationFrame` and forwards hits to `session.hit()`. A session ends either by calling `deps.finish(this)` itself (completed) or when the user presses the same button again (cancelled). Either way `stop()` is called exactly once, then the `onEnd(completed)` callback passed to `run()`. To add a mode:

1. Add a button whose id is the mode name.
2. Add the mode to `LABELS` in `ui/controls.ts`.
3. Implement `Session`.
4. Add a case to `App.start()`.

**Plans and results** (`plan.ts`). PLAY always runs a `RunPlan`, a list of segments, each with its own pattern, click track, BPM and bars:

- `editorPlan()` makes one segment that *shares* the editor's pattern array, so editing after a run re-scores the review.
- `routinePlan()` makes one segment per routine item, copying each pattern.

Before its played bars, each segment has a lead-in: one bar of the pattern if `hearFirst` is on, then `countIn` bars of quarter-note click. A `RunResult` is the plan plus one `Take` per segment. Review navigates a global bar index across segments via `barRefs()`.

**Timing model.** Everything is measured on the AudioContext clock:

- `Engine.heardTime(perfMs)` maps an input event's `timeStamp` (keyboard and MIDI share the `performance.now()` clock) to the context time that was *audible* at that moment, using `getOutputTimestamp()`. That cancels the output latency.
- `settings.latency` is subtracted on top to cover input latency. CALIBRATE measures it.
- `Take.record()` snaps each hit to the nearest 16th and stores a global `step` plus `err` in ms (positive means late).
- `RunSession` routes each hit to the first segment whose take accepts it. Hits during lead-ins are dropped.

**Scheduling.** `audio/scheduler.ts` is a lookahead sequencer (25 ms timer, about 0.1 s plus half a step ahead):

- The extra half step lets replay place early hits (negative `err`) before their step.
- Routines create one scheduler per segment up front. Later ones just wait until their start time comes within range.
- `Scheduler.stop()` only stops scheduling. Sessions call `Engine.cancelScheduled()` to silence what's already queued; it swaps out the bus that all scheduled sound goes through.
- `Engine.trigger()` is for live hits, plays immediately and can't be cancelled.

**Scoring** (`scoring.ts`) happens at render time, never at record time:

- Per cell, the closest hit on a target step is graded (`GOOD_MS`/`OK_MS`) and every other hit is "extra".
- `collect()` gathers raw errors with an optional filter by track, beat position (`sub`) or bar range.
- `summarize()` merges samples into `TimingStats`: notes, hit, extra, avg (mean |err|), bias (mean err), sd, p90. Everything is raw ms, with no composite scores.

**Library and history** (`library.ts`, `history.ts`) are stored in `localStorage` under `rhythm-trainer-library` and `rhythm-trainer-history`. Both take an injectable `KeyValueStore`, which the tests replace with an in-memory store. Rules:

- Folders are one level deep.
- Deleting a pattern removes it from every routine.
- Every `Library` mutation saves and notifies `onChange` listeners. The views re-render from scratch on change.
- History keeps a `summariseRun()` summary per run, not raw hits, capped at 2000 records.
- Routines always log. A single PLAY logs only if the editor holds a saved pattern *unmodified* (`sameGrid`).

**UI** (`ui/`):

- `grid.ts` and `controls.ts` make up the trainer.
- `breakdown.ts` is the per-run table.
- `patterns-view.ts` and `routines-view.ts` are the PRACTICE tab.
- `history-view.ts` and `chart.ts` show progress.
- `dialog.ts` provides the prompt and confirm windows.
- `widgets.ts` and `table.ts` are small DOM builders.

The views call `Library` directly and tell `App` only to load a pattern or routine into the trainer. When a routine is loaded, BPM, BARS, METRONOME and CLEAR are disabled, because the routine supplies its own values.

**Mic tests.** `audio/recorder.ts` records the mic on the AudioContext clock: channel 0 is high-passed, channel 1 band-passed at 1 kHz. `audio/analysis.ts` holds the pure helpers both tests use: envelopes, onset detection, and finding the speaker-to-recording delay by aligning 1 kHz tones (`findRoundTrip`). The analysis functions are pure and tested against synthetic recordings. `lag.test.ts` runs its tone channel through a real band-pass filter, matching the browser.

**Lag test** (`audio/lag.ts`):

1. Each tap (at least 600 ms apart) triggers a 1 kHz beep through the same path a drum hit takes.
2. In the recording, each beep is located by its tone band, because the tap's own noise sits only milliseconds before it.
3. The tap is found as the first broadband onset in the 300 ms before its beep.
4. The median gap is the tap-to-sound lag. It reads about 1–2 ms high, because of the filter's ring-up.

**Output buffer.** `Engine` takes `lowLatency`, which requests `latencyHint: 0`, the browser's smallest buffer. Changing the setting closes the AudioContext, and a new one is created on next use. The OUT readout shows `baseLatency + outputLatency`.

**Calibration** (`audio/calibration.ts`):

1. Plays 1 kHz clicks while the user taps between them.
2. Records the mic through an inline AudioWorklet. Channel 0 is high-passed and used for onset timing; channel 1 is band-passed at 1 kHz and used to find the clicks.
3. Finds the speaker-to-mic delay by aligning click-band energy across all clicks.
4. For each tap, compares the true click-to-clack gap in the recording with the gap the app measured. The median difference becomes `settings.latency`.

The mic must be opened with echoCancellation, noiseSuppression and autoGainControl off, or the click gets filtered out. `analyseCalibration()` is pure and tested.

**Input** (`input/bindings.ts`). Each track has one key (`settings.keys`, `''` when unbound) and one MIDI note (`settings.notes`, `null` when unbound, defaulting to GM 36/38/42/46). `learn(track)` makes the next key or note that track's binding and removes it from any other track. Keys are ignored while typing in inputs, dropdowns or dialogs. Hits are silent during calibration so the mic only hears the key.

**Settings** (`settings.ts`) persist under `rhythm-trainer`:

- `sanitize()` validates stored data field by field, so adding a setting only needs a default.
- `NUMBER_LIMITS` is the single source for input min/max values; don't put them in `index.html`.
- `STEPS`, `STEPS_PER_BEAT` and `TRACKS` define the grid, and the UI builds itself from them.

## UI style

Retro 2000s drum-machine look: bevelled grey panels, LED indicators, green LCD text, Courier for data. Use the minimum text needed and keep labels terse and uppercase. Put explanations in `title` tooltips rather than on the page. Avoid modern flat or "slick" styling.

The history chart's series colours (AVG `#c4841c`, SD `#3f8ee6`) were checked with the dataviz palette validator against the LCD background `#0c180a`. Re-check if you add a series or change the background.
