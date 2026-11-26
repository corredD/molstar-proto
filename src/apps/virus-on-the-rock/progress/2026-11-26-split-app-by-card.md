# Split app.tsx by card (2026-11-26, lane `split-app-by-card`)

## Brief

- **Asked** (Ludo's words, D15): "`app.tsx` is split by card (one file per sidebar card, a module for the CPU channels
  and the beat cycle), behaviour unchanged, so lanes can work in parallel and the channels can be tested."
  **Check:** checklist steps 1–10 of `_spec/features.md` §15 behave as before, on the lane's port (1350); and
  `node data-local/tests/clicksync.mjs` against the lane's build gives the same numbers as against `e5e30d568`.
- **Target layout** (in `src/apps/virus-on-the-rock/`):
  - `app.tsx`: `VirusOnTheRockApp` only (state, loading, presets, axis mode, entries), the entry `index.ts` unchanged.
  - `state.ts`: `VirusOnTheRockState`, `createInitialState`, the axis and cycle-target helpers (A:361–470).
  - `catalog.ts`: the constants and catalogs (A:109–177, 219–233: audio URLs, PDB and mesoscale examples, featured
    presets, effect knobs) and the representation params (A:239–343).
  - `beat-cycle.ts`: the beat-cycle detector (A:182–188, the math of `updateAxisCycle` A:1007–1040) as a small class,
    `feed(raw, now) → advance?`, with no viewer; the app keeps applying the cycle target.
  - `cpu-channels.ts`: the CPU channels (clip, camera zoom, spin and rock, camera step, background flash, opacity;
    A:190–217, 1666–1900) as one class the app owns and calls from `didDraw`, its drive-to-value math in pure
    functions.
  - `ui/controls.tsx`: `VirusOnTheRockControls`, composing one file per card in `ui/cards/`: `load-structure`,
    `audio`, `stem-separation`, `audio-routing` (with `RouteAffectRow`, `AudioRoutingLibrary`), `prominence`,
    `representation`, `audio-presets`, `motion-targets`, `clip-reactivity`, `axis-mode`, `visualizers`, `entries`
    (`EntriesTree`, `EntryRow`, `EntryWhoPicker`), `session`; `ui/control-card.tsx`; `ui/visualizer-overlay.tsx`
    (`AudioVisualizerOverlay`, wave path, radial colour, `getSceneVisualizerFrame`).
  - Moves are moves: no renames of exported or public members, no logic change, no label change (labels are D14's
    lane). Only the beat cycle and the CPU channels are reshaped, so they can be tested.
- **Principles** (Ludo, 2026-11-26: follow molstar `.scaffolds/principles/architecture/bootstrap-patterns/`, read from
  `upstream/master`), in Mol\*'s own terms (rxjs, `useBehavior`; no hand-rolled observable):
  - *Ports and adapters:* `BeatCycle` and `CpuChannels` never see the `Viewer`. They take narrow ports as constructor
    parameters: the drives they read, a clock (`now()`), and one `CpuChannelTarget` port holding the few camera,
    canvas-prop and render-object calls they make. `VirusOnTheRockApp.create` is the composition root: it builds the
    Canvas3D adapter and passes it in. Tests use an in-memory fake target. No module-level singleton holds a dependency
    or scratch state (`_sceneCenterScreen`, A:235, moves into its owner).
  - *Hot-loop allocations:* a steady frame of `BeatCycle.feed` and `CpuChannels.update` allocates nothing (scratch
    `Vec3`/`Vec4`/`Mat4` made once in the constructor, values written into them). At rest (audio paused, drives 0)
    each channel returns before touching the target. The clip pass over render objects stays one O(n) scan, with no
    lookup inside it. Guard tests: the rest case makes no target calls; the clip pass at n and 4n render objects grows
    linearly, with a quadratic control.
  - *API surfaces:* the pure math is sync; streams stay rxjs `Observable`/`BehaviorSubject`, returned, never callback
    parameters. `patchState` is the only write path: it emits once and only when a field changed (shallow, per field;
    today it emits on every call), in a commit of its own with its test. Each card subscribes to the slice of
    `app.state` it uses (`useBehavior` over a distinct selector), not the whole state, and never writes it directly.
- **Spec:** `_spec/architecture.md` §4 (the app's files) and §5 if a weakness moves; `_spec/README.md` "The parts";
  the 48 `A:<line>` references (47 in `features.md`, 1 in `architecture.md`) become `file › symbol`, which survive
  edits; `features.md` §14 (the probe, see below).
- **Tests** (new, characterization, written against the code at `e5e30d568` before the move):
  `_spec/beat-cycle.spec.ts` (trigger at 0.75, release at 0.3, 400 ms minimum interval, peak decay, every-N count);
  `_spec/cpu-channels.spec.ts` (zoom per drive and its cap, rock angle over its period, camera step every 16 rises,
  flash per drive, cap and 400 ms interval, opacity per drive and floor); `song-change.spec.ts` unchanged.
- **Touches:** every file of `src/apps/virus-on-the-rock/` but `index.ts`, `song-change.ts`, `random-structures.ts`,
  `style.scss`; nothing outside the app folder. **Stays off:** nothing else is in flight; per How we work, no other
  lane touches the app until this merges.
- **The probe** (`window.__vorProbe`, A:755, marked TEMP): `data-local/tests/clicksync.mjs`, `sync.mjs` and `keep.mjs`
  read it, and clicksync is the routing contract's measurement. Decided (Ludo, 2026-11-26): keep it, same global and
  shape, the TEMP comment replaced by the scripts that read it; `features.md` §14 says so.
- **`patchState`** emitting only on change: decided (Ludo, 2026-11-26) in this lane, its own commit, test first.
- **Size:** ~3.25k lines moved, not new; ~230 new production lines (module boundaries, `BeatCycle`, `CpuChannels`
  and their pure functions, the `CpuChannelTarget` port and its Canvas3D adapter, `patchState`'s diff, the card
  selectors); ~350 test lines (characterization, the fake target, the guards).
- **Lane model:** Sonnet (default): the lane is mostly moving code.
- **Steps and models:** 1. characterization tests for the beat cycle and the channels, against the current code
  (Opus: they pin the per-frame numbers) 2. design the port, extract `beat-cycle.ts` and `cpu-channels.ts` with the
  adapter in the composition root, tests and guards green (Opus: per-frame hot path) 3. `patchState` diff, test first
  (Opus) 4. move state, catalog, overlay and cards, each card on its slice, one commit per file group, checks after
  each (Sonnet) 5. spec references and §4 (Sonnet) 6. checks of How we work, checklist 1–10 and clicksync on port 1350
  (Sonnet; the hand check is Ludo's) 7. gate (Opus), the reviewer also holding the diff to the three principles.

## Built

- `app.tsx` 3251 → 1174 lines: `VirusOnTheRockApp` only. Moved out, as moves: `catalog.ts`, `state.ts`, `ui/controls.tsx`,
  12 files in `ui/cards/`, `ui/control-card.tsx`, `ui/visualizer-overlay.tsx`. Each card reads its slice of `app.state`
  (`ui/state-slice.ts`, `useStateSlice`: a shallow-equal slice behind `useBehavior`) and writes only through app methods.
- `beat-cycle.ts` (`BeatCycle`, ports `canStep`/`every`) and `cpu-channels.ts` (`CpuChannels`, ports drives, clip, `now`,
  `CpuChannelTarget`; the drive-to-value maths as pure functions). The Canvas3D adapter is
  `canvas3d-channel-target.ts`, built in `VirusOnTheRockApp.create`. Tests: `_spec/beat-cycle`, `cpu-channels`
  (incl. rest guard and a linear scaling guard at n and 4n with a quadratic control), `canvas3d-channel-target`,
  `state-patch`, `state-slice`.
- `patchState` emits once and only when a field changed (`state-patch.ts`, test first).
- `_spec`: 48 `A:<line>` references became `file › symbol`; §4, §5, README "The parts", features §14 (probe kept).
- D15 removed from TODO.md.
- Review gate: 2 reviewers + skeptic; every confirmed must/should fixed except the two below left open.

## Decided

- Ludo, 2026-11-26 (brief): the probe stays, same global and shape; `patchState` diffs in this lane.
- Lane (Sonnet/Opus subagents, for Ludo to veto): `BeatCycle` takes `canStep()`/`every()` ports, not drive/clock ports
  (`feed(raw, now)` carries the time); `_sceneCenterScreen` went into the overlay component, not `CpuChannels`
  (only the overlay uses it).
- Behaviour changes, declared in architecture §4: patchState emits only on change; the clip pass at rest writes base
  values back once, then makes no calls; hidden clip objects are restored by that pass.

## Learned

- The beat cycle's 0.75/0.3 levels apply to the drive's excess over its 400 ms average divided by the running peak, not
  to the raw drive: the brief did not say so, the tests pin it.
- A released route's drive decays to a denormal (~4e-323) and never reaches 0: an exact `=== 0` rest check never
  fires with an enabled clip route and audio paused. Left open: the cut-off number is Ludo's (queue item 13); D2
  (Pause and Clear rest) may fix it in the router instead.
- `Canvas3D.getRenderObjects()` allocates an O(n) array each call, so a frame with a non-zero clip or opacity drive is not
  allocation-free (pre-existing, in core). Left open to the queue: the adapter would cache the list per `commited`.
- CPU-channel expectations were worked out by hand and the beat-cycle ones from a transcription of the old maths; clicksync
  below is the check against the real old code.
- clicksync (playwright from an npx cache; scripts need `data-local/`, which only `~/molstar-votr` has).

## Size

Production: ~+260 new lines (module boundaries, `BeatCycle`, `CpuChannels` and pure functions, port + adapter, patchState
diff, `state-slice`, the card selectors, review fixes) against ~150 new in the brief's section / ~230 in its Size line;
~3.25k moved. Tests: ~740 lines against ~350: one test per pinned number, the fake target, the guards, the review
fixes' tests. What took the room: the characterization numbers and the rest/scaling/throw guards.

## Check (port 1350, 2026-11-26)

`lint` 0 errors (2 old unused-disable warnings), `tsc` clean, jest (app, mol-plugin-state, mol-repr/structure) 9 suites
69 tests pass at 157014171 and the app's 6 suites / 44 tests at HEAD, `--prd` build done. clicksync, lane vs `e5e30d568`
(2 runs each), full preset x1: kick→peak lag median 41–47 ms vs 34–47; peak median 11.76–11.94 vs 11.95–12.15;
rest/peak median 0.43–0.44 vs 0.41–0.42; gain x2 ratio 2.04/2.02 vs 2.00/1.94: same within run-to-run noise.
keep.mjs: route kept, identical to baseline. sync.mjs: corr with drums 0.85 vs 0.82. Checklist 1–10 by hand: Ludo's.

## Review

| Finding | Severity | Verdict | Commit / open |
| ------- | -------- | ------- | ------------- |
| `_sceneCenterScreen` still module-level (visualizer-overlay) | should | confirmed | b5544072c |
| `canStep()` evaluated first, allocates per status frame | should | confirmed | 7c5c652b0 (test), 5aa5b900a |
| background adapter rebuilds props per flash frame | should | confirmed | 6ec9b8646 (test), 0016f33ce |
| frameObjects/clipAtRest stale after a throw | nit | confirmed | 01e9b738a (test), 834ff1daa |
| TODO.md still lists D15 | should | confirmed | b25f5dad3 |
| docs: "three places", state-slice wording | nit | confirmed | 4ebcea494 |
| clip rest check `=== 0` never true after a release | should | confirmed, narrower than first stated | open: needs a number (TODO 13) |
| `getRenderObjects()` allocates O(n) per frame (core) | should | confirmed (skeptic) | open: queue |
| dead `cycleAxes.length <= 1` check | nit | confirmed | open (taste; pre-existing) |
| 8 exports without outside users, `AudioAnalysisWarning` imported across cards | nit | not fixed | open |
