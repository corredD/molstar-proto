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

## Decided

## Learned

## Size

<measured> against ~5–15; what took the room.

## Review

| Finding | Severity | Verdict | Commit / open |
| ------- | -------- | ------- | ------------- |
