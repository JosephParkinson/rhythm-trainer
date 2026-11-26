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
npx vitest run src/core/scoring.test.ts   # one file
npx vitest run -t "recovers input"   # tests matching a name

npm run serve                        # production build on http://localhost:5173 (install as an app from Edge/Chrome)
npm run app                          # build and open the desktop (Electron) app
npm run dist:win-portable            # Windows portable .exe → release/ (works from Linux/WSL)
npm run dist:win                     # Windows installer + portable (installer needs Windows or wine)
npm run dist:mac                     # macOS .dmg, arm64 + x64 (needs macOS)
```

**Installable web app.** `public/manifest.webmanifest`, `public/sw.js` and `src/platform/pwa.ts` make the web build installable from Chrome or Edge. This is the main route on locked-down Windows machines, where the unsigned `.exe` is blocked. Details:

- The service worker fetches from the network first and falls back to its cache, so an installed app runs offline and picks up new builds whenever a server is reachable.
- It's registered only in production builds served over http(s). It's skipped in `vite` dev and in Electron.
- The INSTALL button shows only when the browser fires `beforeinstallprompt`.
- `localStorage` is per origin. `npm run serve` uses port 5173, the same as `npm run dev`, so data saved in either is shared.
- Bump `CACHE` in `sw.js` if the caching strategy ever changes.

Icons are rendered from `public/icon.svg` into `public/icon-*.png`, `public/apple-touch-icon.png` and `build/icon.png`; electron-builder picks up the last one automatically. `.github/workflows/pages.yml` can publish `dist/` to GitHub Pages when run manually.

**Mac self-update.** `scripts/update-mac.sh` does the whole update:
1. quit the app
2. back up `~/Library/Application Support/Rhythm Trainer` into `… Rhythm Trainer Backups/` (keeps 10)
3. `git pull --ff-only`, then `npm install`
4. build this Mac's architecture as a plain `.app`
5. replace `/Applications/Rhythm Trainer.app`, then reopen it

Details:
- Run it with `npm run update:mac`, or with the UPDATE button.
- On failure the old app is left in place and reopened. The log is in `~/Library/Logs/Rhythm Trainer/update.log`.
- `npm install` and the electron-builder step each get one retry (after clearing the old build output), because on macOS they sometimes fail once with ENOTEMPTY and then succeed. The new app is copied in beside the old one before the old one is deleted.
- The script's body is a `main()` function, so bash has read all of it before `git pull` can change the file.
- The button (`src/platform/desktop.ts`) talks to the wrapper through `electron/preload.cjs` (`window.desktop`). It only shows on macOS when the build recorded `repoPath`, which `dist:mac` and the script pass via `-c.extraMetadata.repoPath`.
- The main process launches the script through a login zsh to pick up the user's PATH, and runs it detached so it outlives the app.
- A real auto-updater (electron-updater) would need a signed app.

**Desktop app.** `electron/main.cjs` serves `dist/` from a privileged `app://rhythm-trainer/` origin. That makes it a secure context, which mic, MIDI and AudioWorklet need. It also gives a stable origin, so `localStorage` persists between launches. Only `media`, `midi` and `midiSysex` permissions are granted (Chromium asks for Web MIDI as `midiSysex`). `vite.config.ts` uses `base: './'` so one build works both on the web and in Electron. Packaging config lives under `build` in `package.json`. `.github/workflows/desktop.yml` builds the Mac and Windows apps on manual dispatch or a `v*` tag, and attaches them to a release when triggered by a tag. Builds are unsigned.

## Architecture

### Layers

Dependencies point one way: `app.ts` → `sessions/`, `ui/`, `input/`, `audio/` → `core/`. Nothing in `core/` touches the DOM or Web Audio, so all of it is unit-tested.

```
src/
  main.ts          entry: stylesheets, App, PWA and desktop hooks
  app.ts           the controller (below)
  core/            pure model and logic, every file has a .test.ts
    pattern.ts       grid constants, TRACKS, Pattern / PianoNote / ClickPattern and their helpers
    settings.ts      Settings, defaults, NUMBER_LIMITS, sanitize(), load/save
    storage.ts       KeyValueStore (localStorage or MemoryStore), readJson/writeJson, Listeners, newId
    validate.ts      type guards for sanitising stored JSON
    plan.ts          RunPlan / SegmentSpec / RunResult, editorPlan(), routinePlan(), barRefs()
    scoring.ts       Take (recorded hits), per-cell grading, collect() / summarize() → TimingStats
    review.ts        Review: position in a finished run, page jumps, replay resume point
    library.ts       saved patterns, folders, routines
    history.ts       per-run summaries for progress tracking
  audio/           Engine (AudioContext, synth voices, epiano.ts), Scheduler, mic recorder + analysis, calibration, lag test
  input/           Bindings (keys + MIDI → drums or piano), midi.ts (Web MIDI), routing.ts (pure, tested)
  sessions/        one class or factory per transport activity (below)
  ui/              DOM components; each reports user actions through an events object
  platform/        pwa.ts (install + service worker), desktop.ts (Electron UPDATE button)
  styles/          base.css (tokens, panels, buttons, LEDs, LCDs, dialogs), trainer.css, practice.css
```

Tests cover everything in `core/`, `input/routing.ts` and the mic-test analysis (on synthetic recordings). Anything touching `AudioContext` or the DOM is untested, so check it in a browser.

### The controller

`App` (`src/app.ts`) owns the models (settings, `Library`, `History`), what the trainer has loaded (the editor pattern, or a routine via `routineId`), the `Review` of the last TEST, and the PLAY resume point. UI components never change models themselves (except the PRACTICE views, which edit the `Library` directly); they call back into `App`, which updates the model and redraws. `refresh()` enables and disables everything for the current mode; call it after anything that changes the mode or what's loaded.

Edit permissions are three getters: `editable` (cells and piano roll: idle or PLAY, no routine), `lengthEditable` (bar squares: idle, no routine) and `mutable` (mute lights: idle or PLAY).

### Sessions

`App` runs **at most one `Session` at a time** (`sessions/session.ts`). A session gets `Deps` (engine, settings, grid, roll, controls, `finish`). `App.run()` drives `session.frame()` from `requestAnimationFrame` and forwards hits to `session.hit()`. A session ends either by calling `deps.finish(this)` (completed) or when the user presses its button again (cancelled). Either way `stop(completed)` is called exactly once, then the `onEnd(completed)` callback passed to `run()`.

- `run.ts` (mode `test`, TEST): plays a `RunPlan`, records a `Take` per segment. Drives TEST's red light (`controls.setRecording`: dim during the lead-in, lit while recording). In a segment with no click, the step lights are greyed out (`grid.setStepLedsOff`) so they can't act as a visual metronome.
- `play.ts` (mode `play`, PLAY or the space bar): loops one pattern, reading it live so edits are heard. Pausing stores `position`; the next PLAY resumes there. Live hits go into one endless `Take` and are drawn like TEST's markers (bar on screen only). Each column keeps the last pass's markers until the playhead comes round again: half a step before the column (`WIPE_AHEAD`) it switches to the new pass, so an early hit on that step isn't wiped. Nothing is kept or logged.
- `replay.ts` (mode `replay`): plays a result's hits back at their real times with the click that was heard, for a global bar range. No transport button: ▶ in the breakdown replays that pattern and becomes ❚❚ (pause) while it plays; `Review.pausedSeg` lets ▶ resume. The space bar also pauses it.
- `mic-tests.ts` (modes `cal`, `lag`): CALIBRATE and LAG TEST, both wrapped by `micTestSession()`, which reports through the settings-panel readout. They set `mutesHits`, so hits make no drum sound.

MUTE ON TEST (`settings.muteOnTest`) silences live drum hits during TEST only; the pattern, click and keyboard part still play.

**To add a mode:** add a button whose id is the mode name, add it to `LABELS` in `ui/controls.ts`, implement `Session`, and add a case to `App.start()`.

### Plans, results and review

TEST always runs a `RunPlan` (`core/plan.ts`): a list of segments, each with its own pattern, click track, BPM and bars.

- `editorPlan()` makes one segment that *shares* the editor's pattern and piano arrays, so editing after a run re-scores the review.
- `routinePlan()` makes one segment per routine item, copying each pattern.

Before its played bars, each segment has a lead-in (`leadIn()`): the whole pattern once if `hearFirst` is on, then `countIn` bars of quarter-note click. A `RunResult` is the plan plus one `Take` per segment. `Review` (`core/review.ts`) numbers bars globally across segments (`barRefs()`); the ← → keys step through them, clicking a pattern row in the breakdown jumps to it, and a bar square jumps within the pass on screen (`pageBar()`).

### Timing model

Everything is measured on the AudioContext clock:

- `Engine.heardTime(perfMs)` maps an input event's `timeStamp` (keyboard and MIDI share the `performance.now()` clock) to the context time that was *audible* at that moment, using `getOutputTimestamp()`. That cancels the output latency.
- `settings.latency` is subtracted on top to cover input latency. CALIBRATE measures it.
- `Take.record()` snaps each hit to the nearest 16th and stores a global `step` plus `err` in ms (positive means late).
- `RunSession` routes each hit to the first segment whose take accepts it. Hits during lead-ins are dropped.

**Scheduling.** `audio/scheduler.ts` is a lookahead sequencer (25 ms timer, about 0.1 s plus half a step ahead):

- The extra half step lets replay place early hits (negative `err`) before their step.
- Routines create one scheduler per segment up front. Later ones just wait until their start time comes within range.
- `Scheduler.stop()` only stops scheduling. Sessions call `Engine.cancelScheduled()` to silence what's already queued; it swaps out the bus that all scheduled sound goes through.
- `Engine.trigger()` is for live hits, plays immediately and can't be cancelled.

**Output buffer.** `Engine` takes `lowLatency`, which requests `latencyHint: 0`, the browser's smallest buffer. Changing the setting closes the AudioContext; a new one is created on next use. The OUT readout shows `baseLatency + outputLatency`.

### Scoring

`core/scoring.ts` scores at render time, never at record time:

- Per cell, the closest hit on a target step is graded (good ≤ 20 ms, ok ≤ 45 ms, else bad) and every other hit is "extra".
- `collect()` gathers raw errors with an optional filter by track, beat position (`sub`), bar range or muted tracks; `timing()` is the one-take shortcut.
- `settings.muted` (a track's light: green = on, dark = muted) is applied at render time, so muting after a run re-scores it, the same as pattern edits. Muted tracks are also silent in HEAR FIRST, PLAY and replay. Runs with anything muted aren't logged.
- `summarize()` merges samples into `TimingStats`: notes, hit, extra, avg (mean |err|), bias (mean err), sd, p90. Raw ms only, no composite scores.

### Storage, library and history

Settings, library and history are JSON in one `KeyValueStore` (`core/storage.ts`): `localStorage`, or a `MemoryStore` when that's unavailable and in tests. Keys: `rhythm-trainer`, `rhythm-trainer-library`, `rhythm-trainer-history`. Every load goes through a sanitiser that keeps what's valid field by field, so old or hand-edited data never breaks the app, and **adding a field only needs a default**.

- `NUMBER_LIMITS` (`core/settings.ts`) is the single source for number input min/max; don't put them in `index.html`.
- Folders are one level deep. Deleting a pattern removes it from every routine.
- `Library` and `History` mutations save and notify `onChange` listeners; views re-render from scratch.
- History keeps a `summariseRun()` summary per run, not raw hits, capped at 2000 records. Each record notes whether the metronome was on; the history view shows METRONOME and NO METRONOME runs separately (records from before the flag count as metronome-on, `withMetronome`).
- Routines always log. A single TEST logs only if the editor holds a saved pattern *unmodified* (`sameGrid` + `samePiano`; the same check drives the `*` after the name).

### Patterns, pages and bar squares

A pattern is 1–4 bars: each row is 16 × bars long and the length is derived from it (`patternBars`). The grid and piano roll show one bar (page) at a time; `Grid.setPage` fires `pageChanged`, which keeps the roll in sync. Anywhere a take step meets the pattern it indexes `step % patternSteps(pattern)`, so the pattern loops over BARS.

`ui/bar-squares.ts` (owned by `Grid`, shown at the right of the transport row): amber = inside the pattern, bright = on screen, a brightness pulse on each beat for PLAY's bar. Click a dark square to extend (repeats the existing bars); double-click or right-click a lit square to delete the bars after it (asks first if they have content). A double-click that starts on a dark square only extends. TEST and replay follow the playing bar; PLAY stays on the bar you're looking at and only runs the step lights there.

### Keyboard part

- **Drawing:** `ui/piano-roll.ts`, a C3–B4 roll under the grid with columns aligned to its steps. Notes are `PianoNote {pitch, step, len}` and never cross a bar line. Stored as `settings.piano`, `SavedPattern.piano` and `SegmentSpec.piano`. `ui/keys-panel.ts` is its toolbar (mute light, CLEAR, SHOW/HIDE).
- **Sound:** an FM electric piano (`audio/epiano.ts`). Live notes use `Engine.pianoDown/Up`; the backing uses `schedulePiano`.
- **Playback:** the backing loops in HEAR FIRST, PLAY, TEST's played bars and replay (`playPianoStep`). Never scored. `settings.pianoMuted` silences it.
- **Edits** happen in place on `settings.piano`, so PLAY hears them while looping.

### Input

Each track has one key (`settings.keys`, `''` when unbound) and one MIDI note plus channel (`settings.notes`, `settings.noteChannels`; defaults GM 36/38/42/46 on channel 10; a `null` channel means any). `input/routing.ts` decides where each note goes: a note assigned to a drum always plays that drum, never the piano (an exact note+channel binding wins, otherwise the note number alone); any other note on GM channel 10 is ignored, so unassigned pads stay silent; everything else plays the piano. The assignment boxes are in the settings panel (`ui/bind-panel.ts`). `Bindings.learn(track)` makes the next key or note that track's binding and removes it from any other track. Keys are ignored while typing in inputs, dropdowns or dialogs. The space bar is PLAY/pause unless it's bound to a drum.

### UI components

- Trainer: `grid.ts` (+ `bar-squares.ts`), `piano-roll.ts`, `keys-panel.ts`, `controls.ts` (transport, settings row, settings panel behind the cog, readouts, MIDI light), `bind-panel.ts`, `source-panel.ts` (loaded pattern/routine, NEW/LOAD/SAVE/EXIT), `breakdown.ts` (per-run table), `tabs.ts`.
- PRACTICE: `patterns-view.ts`, `routines-view.ts`. When a routine is loaded, BPM, BARS and METRONOME are disabled because the routine supplies its own.
- Progress: `history-view.ts` + `chart.ts`, shown in PRACTICE and under a run's breakdown (`#runHistory`; hidden for unsaved patterns).
- Shared: `dialog.ts` (prompt/confirm windows), `widgets.ts` (buttons, list boxes, selects, step rows, mute lights), `table.ts`, `format.ts`, `dom.ts`.

There's no main LCD: `controls.status()` writes the readout next to the transport (count-in, BAR n/m, routine progress via `segmentStatus()`); `controls.testStatus()` writes the readout in the settings panel.

### Mic tests

`audio/recorder.ts` records the mic on the AudioContext clock through an inline AudioWorklet (`withMicRecording()` always releases the mic): channel 0 high-passed for onset timing, channel 1 band-passed at 1 kHz to find test tones. The mic must be opened with echoCancellation, noiseSuppression and autoGainControl off, or the tone gets filtered out. `audio/analysis.ts` holds the pure helpers: envelopes, onset detection, and finding the speaker-to-recording delay by aligning 1 kHz tones (`findRoundTrip`). `lag.test.ts` runs its tone channel through a real band-pass filter, matching the browser.

**Calibration** (`audio/calibration.ts`): plays 1 kHz clicks while the user taps between them; for each tap, compares the true click-to-clack gap in the recording with the gap the app measured. The median difference becomes `settings.latency`. `analyseCalibration()` is pure and tested.

**Lag test** (`audio/lag.ts`): each tap (at least 600 ms apart) triggers a 1 kHz beep through the same path a drum hit takes. Each beep is found by its tone band (the tap's noise sits only milliseconds before it), the tap as the first broadband onset in the 300 ms before; the median gap is the tap-to-sound lag. It reads about 1–2 ms high because of the filter's ring-up.

## UI style

Retro 2000s drum-machine look: bevelled grey panels, LED indicators, green LCD text, Courier for data. On/off settings are LED toggles (`.toggle`, like the MIDI light), never browser checkboxes. Icons are small inline SVGs in `currentColor`. Use the minimum text needed and keep labels terse and uppercase. Put explanations in `title` tooltips rather than on the page. Avoid modern flat or "slick" styling.

The history chart uses the app's own colours: AVG in LED amber `#ffb02e` (`--led`) and SD in a darker LCD green `#45a535`. Both were checked with the dataviz palette validator against the LCD background `#0c180a`. Colour-blind separation (ΔE 10), normal-vision separation and contrast pass. The amber is deliberately brighter than the validator's lightness band, to match the LEDs. Amber against green only separates for red-green colour blindness through a lightness difference, so keep the green darker than the amber. Re-check if you add a series or change the background.
