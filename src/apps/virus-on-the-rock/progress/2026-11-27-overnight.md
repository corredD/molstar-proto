# Overnight: the best audio-reactive system (2026-11-27, coordinator)

## Asked

Ludo, 2026-11-26 late: "you are allowed to restructure the full app, goal is to have the best audio reactive system.
you have until tomorrow morning." Input: the review of the night before,
[2026-11-26-audio-review.md](2026-11-26-audio-review.md) (12 findings, proven or graded).

## How the night runs

- **Staging branch `votr/overnight`** from `virus-on-the-rock`. Lanes branch from it and PR into it
  (`gh pr create -R corredD/molstar-proto --base votr/overnight`); the coordinator merges a lane after its gate.
  Nothing merges into `virus-on-the-rock` overnight: in the morning Ludo gets one PR, `votr/overnight` →
  `virus-on-the-rock`. Staging builds and passes the checks at every merge, so it is shippable if the night ends early.
- **Lanes are background agents** (Sonnet unless the brief says Opus), one worktree each in `~/molstar-votr-lanes/`,
  ports 1350+. The coordinator runs every gate itself (lane-reviewer, then lane-skeptic, then a fix step).
- **"Best" is numbers**, in `_spec/audio-routing-spec.md`'s expectations: sync measured against what is **heard**,
  exact rest when the sound stops, no route that moves nothing, nothing allocated per frame at rest.
- **The 18 decisions and the five routing rules stand.** Restructuring is not retuning the signal path. A decision
  that must bend is its own commit, flagged in the morning summary.
- At most 3 lanes at once, on disjoint files.

## Lanes

| Wave | Lane | Review items | Touches | Model |
| --- | --- | --- | --- | --- |
| 1 | `measure` | the measuring stick | new `_spec` harness, `scripts/`, routing spec table | Sonnet; harness design Opus |
| 1 | `motions-follow-routes` | 2 | `apps/virus-on-the-rock` (app, routing card), `audio-reactive-presets.ts` | Sonnet |
| 1 | `redraw-and-axes-cache` | 4, 7 | `mol-canvas3d/canvas3d.ts`, `assembly-symmetry-axis.ts` | Sonnet |
| 2 | `heard-frame` | 1 | `audio-reactive-animation.ts`, `animation-loop.ts`, the overlay, the beat cycle input | Opus |
| 2 | `narrowed-slots` | 5 (D3) | `audio-routing.ts` (slot overflow), routing card | Sonnet |
| 2 | `stem-separator-edges` | 9 | `audio-stems/stem-separator.ts` | Sonnet |
| 3 | `sound-stops` | 3, 6 (D2), 11 (TODO 13) | manager, router, separator tail | Opus |

Not tonight (comments, left in the queue): 8 (`hasNoise` gate), 10 (per-frame hierarchy syncs in every app, D12),
12 (`packSlot` ranges, no VotR path).

## Briefs

### `measure`

- **Asked:** the measuring stick for the night: every later lane proves "unchanged" or "better" with it.
- **Build:** (1) an offline harness (`src/mol-plugin-state/manager/_spec/audio-pipeline.spec.ts` or beside it):
  synthesized signals (a 120 BPM kick, a bass tone, silence, a song-like mix) through `AudioReactor.analyze`, the band
  stems fallback and `AudioRouter.update` for the default routes and two presets, frame by frame at 16 ms; golden
  traces of the drives recorded from today's code (sampled, rounded, inline), and the derived numbers: kick → peak
  frames, rest/peak, gain × 2. (2) `clicksync` in the repo: `scripts/votr-sync/` with a generated click track (no
  binary in git: the script writes it, or the page synthesizes it), a port argument, and a **heard** column from
  `AudioContext.getOutputTimestamp()` next to the media-clock one. (3) The routing spec's expectations table gains
  rows: kick → peak against what is heard, rest after pause (exactly 0), no route on a motion that is off.
- **Tests:** the harness itself (green at today's code; it is the baseline).
- **Size:** ~250 test/script lines, ~0 production.

### `motions-follow-routes` (review issue 2)

- **Asked:** a route never moves nothing because its motion is off. **Check:** Ambient Pulse, the capsid moves;
  Motion Targets › Instance Beats off, then + Add route: Instance Beats comes on; turn Instance Beats off again and edit
  a gain: it stays off.
- **Build:** `getPresetRoutes` makes no route for a motion the preset turns off. The app subscribes to
  `manager.state.routes` and calls `enableMotionsFor` only when the set of motions the enabled routes need **grows**
  (a gain or floor edit never re-enables a motion the user turned off); the call in `loadFrom` goes.
- **Tests:** the preset probe (every preset × its motion flags: no dead route; fails today on ambient-pulse); the
  needed-set function (grows on add and on a target change, not on a gain edit).
- **Size:** ~30 production lines.

### `redraw-and-axes-cache` (review issues 4, 7)

- **Build:** (4) `canvas3d.setAudioFrame` forces a render when the illumination or hue drive changed or is above 0,
  and once more when it returns to 0. (7) `syncStructureAssemblyAxes`' cache stores the bare key so it hits; the
  applied key keeps the count.
- **Tests:** (7) a spy on `AssemblySymmetryProvider.get`: 2,1,1,1 reads over four syncs (2,2,2,2 today); (4) a unit
  test of the force-render decision as a pure function.
- **Size:** ~20 production lines.

### `heard-frame` (review issue 1)

- **Asked:** the capsid moves when the kick is heard, on any output (built-in speakers, Bluetooth, AirPlay).
- **Build:** one presented snapshot that every consumer reads (the shader's audio frame: bands, amplitude, stems,
  drives, scope drives; the overlay's frame, spectrum and route values; the beat cycle's status), taken from a ring of
  the last ~1 s stamped with `ctx.currentTime` and read at `currentTime − outputLatency` (read live each frame;
  undefined → 0; clamped to the ring). Typed arrays allocated once. Releases, onsets and stems timing stay in real
  time. Clock and latency are ports, so the tests inject them.
- **Tests:** with latency 0 the presented trace equals today's (the `measure` harness); with latency L the presented
  trace is today's shifted by L, within a frame; no allocation per frame (a guard).
- **Check:** `clicksync` heard column: kick → peak between 0 and 50 ms + one frame, in Ludo's Chrome.

### `narrowed-slots` (review issue 5, D3)

- **Build:** the router drops a narrowed route when the 8 slots are full (never the global drive); the routing card
  disables the Who select of the other routes once 8 are narrowed, with a note (D3).
- **Tests:** 9 narrowed routes: global drive 0 (1 today); 8: unchanged.

### `stem-separator-edges` (review issue 9)

- **Build:** `setModel` re-checks the model after awaiting the tap; a failed tap setup clears `tapLoading` so a retry
  retries.
- **Tests:** the skeptic's two probes as specs (fake worker, worklet and context).

### `sound-stops` (review issues 3, 6, 11; D2, TODO 13)

- **Asked (D2):** Pause and Clear bring every drive to 0 over its release; Clear resets the router. With stems on,
  the visuals follow the delay line's tail after pause and at the end of a file, then rest.
- **Build:** one design for "the sound stopped": the router releases to exactly 0 (a cut-off below which a released
  value is 0; proposed 1e-3, Ludo's number to confirm, TODO 13); floors apply only while sound plays; Clear calls
  `router.reset()`; with a delay, the paused branch keeps reading the analyser until the delay has drained.
- **Tests:** pause → every drive 0 within the longest release (+1 frame); a released drive is exactly 0 (not 4e-323);
  Clear → drives 0 at once; with delay D, drives follow the tail for D after pause.
