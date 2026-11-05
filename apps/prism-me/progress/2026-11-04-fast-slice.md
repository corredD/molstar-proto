# A level-0 slice step fast enough to drag (2026-11-04, lane `fast-slice`)

## Brief

- **Asked** (Ludo, 2026-11-04, after #53's measurement): "this is promising", go as a lane. A slice slider on a
  full-resolution volume follows the drag. **Check:**
  http://localhost:1352/apps/prism-me/build/?portal-dataset=10003&portal-run=TS_08, Data › Level 0, drag the Z slice: it
  follows the pointer about 3× more often than today (#53: 436–449 ms a step).
- **What #53 measured** (`progress/2026-11-04-live-forms.md`, Item 7): one level-0 step (928×928 image) is 89 %
  `createGridImage` (`packages/graphics/src/repr/volume/slice.ts`): self 333 ms, `trilinearlyInterpolate` 39,
  `transformMat4` 16, GC 23. Per pixel: a theme `color()` call, a `Vec3.transformMat4`, and `mapping.index.set(o, [i])`
  (a Map of 861k entries with an array each, rebuilt every step).
- **Base and delivery** (apps/prism-me/AGENTS.md, How we work: a library fix is its own lane from `origin/master`):
  - `me/fast-slice` from `origin/master`, library commits only, no prism-me file; pushed to the fork for upstream (Ludo
    decides when). `createGridImage` is identical on master and prism-me (only `createPlaneImage` differs).
  - `me/fast-slice-pm` from `origin/prism-me`: those commits cherry-picked (`-x`), plus this progress file and the
    changelog; the PR goes from it (`-R corredD/molstar-proto --base prism-me`), listing the library SHAs for upstream.
- **Steps, in order, measuring after each** (Chrome CPU profile through CDP, as #53; TS_08 level 0, 12 Z steps):
  1. **Which theme the portal slice uses.** `trilinearlyInterpolate` in the profile says the slice's colour samples the
     volume at `l.position` (contrast/windowing), not a uniform theme. Find it and say so in this file: it decides
     whether "colour once for a uniform theme" gains anything here.
  2. **The pixel→cell index.** Readers: `slice.ts` and `util.ts` (`getSampledImage`, the oblique slice, builds the same
     `SampledImageMapping`); grep every reader of `meta.mapping` / `.index` first. Make it lazy (built on the first
     lookup) or a typed array, both producers together, the readers unchanged where possible.
  3. **The colour.** Once for a uniform theme; for a position theme, keep the call but make the position cheap.
  4. **The position.** Computed as origin + ix·a + iy·b + iz·c (never accumulated: float32 drift would change a position
     theme's pixels).
  5. A theme sampling exactly at grid points may read the cell instead of interpolating, only if the pixels stay equal.
- **Stop:** steps 2 and 3 of #53's proposal (a coarser level while dragging, a GPU slice) are not this lane. If the step
  is still over ~130 ms after 1–5, report the numbers and stop.
- **Spec:** none of prism-me's changes; `.v6/changelogs/fast-slice.md` (and `CHANGELOG.md` if it applies to 5.x).
- **Tests** (`packages/graphics/src/repr/volume/_test/slice.test.ts`): old and new builds give identical `imageArray`,
  `groupArray`, `valueArray`, `mapping.instance`, `mapping.cell` and index lookups (pick → loci, loci → pixels), for a
  uniform and a position-dependent theme, x / y / z, periodic and not, small grids. Keep the old build in the test as
  the reference (or record its arrays first).
- **Touches:** `packages/graphics/src/repr/volume/slice.ts`, `util.ts`; **stays off:** `packages/extensions/cryoet`,
  `apps/prism-me/src/url.ts` (lane `empiar`).
- **Size:** ~60–100 production lines.
- **Steps and models:** 1 theme check and profiling (Opus), 2–5 author (Opus), checks (Sonnet), gate (Opus).
- **Port:** 1352 (the `-pm` worktree's dev server).

## Built

## Decided

## Learned

## Size

## Review

| Finding | Severity | Verdict | Commit / open |
| ------- | -------- | ------- | ------------- |
