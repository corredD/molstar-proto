# A route never stays NaN (2026-11-26, lane `router-nan-guard`)

## Brief

- **Asked** (Ludo, 2026-11-26, "just start the fix"): while testing PR #65 on port 1350, Chrome logged thousands of
  `<text> attribute y: Expected length, "NaN"` and `<path> attribute d: … NaN` from `AudioVisualizerOverlay`'s route
  lines. The overlay is unchanged by the split; the NaN comes from `AudioRouter.update`
  (`src/mol-plugin-state/manager/audio-routing.ts`): one non-finite source value (stem, band, amplitude, beat) makes
  `state.value` NaN, and from then on `target >= NaN` is false and the release keeps it NaN for good; in onset mode
  `state.previous` and `state.peak` stick the same way. The NaN also reaches the route's channel drive.
  **Check:** run the §15 checklist (features.md) on port 1351 with the console open: no NaN warnings, the wave lines
  draw; and a route fed one NaN frame recovers on the next frame (the test).
- **Fix:** in `AudioRouter.update`, a non-finite source value reads as 0 (one guard where `raw` is read, before the
  song average, onset and curve); a non-finite `dtMs` counts as 0. Nothing else in the route math changes (routing
  spec rule 1: one signal path, no reshaping). Then find the producer: with the stem separator (SCNet, step 6) the
  stems are the first suspect (`audio-stems/stem-separator.ts`, `applyAttackRelease`); if a producer emits NaN, fix it
  there in a commit of its own with its test; if it cannot be found, say so in the progress file.
- **Spec:** `_spec/audio-routing-spec.md` (Rules: a non-finite source reads as 0); `_spec/core-changes.md` (plugin-state:
  the guard, its commits); `features.md` §14 (the NaN on the overlay, fixed).
- **Tests** (fail first on `origin/virus-on-the-rock`), in `src/mol-plugin-state/manager/_spec/audio-routing.spec.ts`:
  a level route and an onset route fed one frame with a NaN stem, then finite frames: value and drive are finite and
  back to what a fresh route gives; the drive of the channel is finite on the NaN frame; same for a NaN band and a NaN
  `dtMs`. A producer fix gets its own failing test.
- **Touches:** `src/mol-plugin-state/manager/audio-routing.ts`, its spec, maybe `audio-stems/`; `_spec` pages above.
  **Stays off:** `src/apps/virus-on-the-rock/` code (`split-app-by-card`, PR #65, is moving every file there).
- **Principles:** hot-loop-allocations: the guard allocates nothing per frame (`Number.isFinite`, no new objects).
- **Size:** ~5–15 production lines (+ a producer fix if found); ~60 test lines.
- **Lane model:** Sonnet (default): a small guard and its tests.
- **Steps and models:** 1. failing tests (Sonnet) 2. the guard (Sonnet; the router is per-frame: Opus reviews it at
  the gate) 3. find the producer, fix test-first if found (Opus subagent: needs reading the stem pipeline) 4. spec
  pages (Sonnet) 5. checks of How we work and the §15 checklist on port 1351 with the console open (Sonnet) 6. gate
  (Opus).

## Built

- `AudioRouter.update` (audio-routing.ts): a non-finite source reads as 0 where `raw` is read (before song average,
  onset, curve); a non-finite `dtMs` counts as 0. 5 production lines, no allocation.
- Producer found (Opus subagent, read and run): `StemSeparator.onWorkerMessage` stored the worker's energies unchecked;
  one NaN or Infinity from the model stuck `mixPeak`/`peaks` and so every stem level for good (Infinity froze the
  other three stems at 0). Now a non-finite or non-positive energy is stored as 0 (-120 dB). 5 production lines.
- Tests: 4 router cases (NaN stem, infinite stem, NaN band and amplitude, NaN dt; each recovers as a fresh route) and
  3 separator cases (NaN, +/-Infinity); all 7 fail on origin/virus-on-the-rock.
- Spec: routing rule 5 (non-finite reads 0), core-changes (router and separator), features §14.

## Decided

- The guard reads at the source, not at the end, so the route math is untouched (routing rule 1).
- Energy <= 0 also maps to 0: energies are sums of squares, never negative, so valid input is unchanged.
- Left open (review nits 5, 6): `midsTreble` with an infinite band clamps at 2 instead of 0; the exp curve overflows
  to Infinity at a band of 309+, which the normalized FFT bands cannot reach. Neither is seen in the app.

## Learned

- Whether this separator NaN is the one seen on port 1350 is not shown: that run did not use SCNet by the brief. The
  fp16-on-WebGPU cause is read in `stem-models.ts` (an existing comment), not reproduced. The router guard covers
  any producer; the reactor (`AudioReactor.analyze`, prominence) also keeps a NaN dt or sample, but dt is clamped
  upstream (`tick`) and no NaN source was shown there.
- `Math.max(0, NaN)` and `target >= NaN` hide a NaN: a state that takes its max with its past never recovers.

## Size

12 production lines against ~5-15 (router 5 + separator 5 + comment); 70 test lines against ~60. Within the brief.

## Checks

`tsc` clean; `npm run lint` 0 errors (4 warnings in files not touched); jest `src/apps/virus-on-the-rock
src/mol-plugin-state src/mol-repr/structure` 39 passed before the last test line, `src/mol-plugin-state/manager` 36
after; `build.mjs -a virus-on-the-rock --prd` done. Port 1351: the page loads, no NaN SVG attribute and no console
message, but audio would not start in the automated browser (Playback stayed Stopped), so the wave lines were not
seen under music: Ludo checks that. clicksync not run (`data-local/` is not in this worktree; the route math for
finite input is unchanged).

## Review

| Finding | Severity | Verdict | Commit / open |
| ------- | -------- | ------- | ------------- |
| 1 core-changes misses the separator | must-fix | confirmed (read) | fixed, spec commit |
| 2 routing spec points at the wrong rule | should-fix | confirmed (read) | fixed, spec commit |
| 3 progress file empty, checks missing | should-fix | confirmed | fixed, this file |
| 4 dt comment wrong | nit | confirmed (probe) | fixed |
| 5 midsTreble Infinity reads 2 | nit | confirmed (probe) | open, harmless |
| 6 exp curve overflow at band 309+ | nit | confirmed (probe) | open, unreachable |
| 7 no songLoudness in the test set | nit | confirmed | fixed |

The skeptic pass was not run: the reviewer ran a probe for each finding, and 1, 2, 3 were re-read by the lane.
