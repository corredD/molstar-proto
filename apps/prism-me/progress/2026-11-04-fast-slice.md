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

Library commits on `me/fast-slice` (from `origin/master` c1b8ecb82, pushed to the fork for upstream), cherry-picked here
with `-x`. Only `packages/graphics/src/repr/volume/slice.ts` changes; `util.ts` did not need to (its only reader,
`createVolumeSliceCellLocationIterator`, reads `mapping.cell.length`).

- `3c92cb7ff` test first: the grid slice built as before is kept in `_test/slice.test.ts` as the reference
  (`referenceGridImage`, its `getSliceInfo`). The new `createImage` (`mode: 'grid'`) must give the same `imageArray`,
  `groupArray`, `valueArray` (bytes: NaNs and signed zeros), `mapping.instance`, `mapping.cell` and every index lookup
  (every cell, every instance × cell when periodic, and keys beyond), for x, y, z (each index) and relative, a uniform
  and the volume-value theme, on a skewed grid transform with entries no float holds exactly (two axis orders, and a
  copied space without strides) and two periodic volumes (every tile drawn, a tile missing). The plane and frame
  sampler's index is checked against the pixels that mapped a cell, pushed in order.
- `cd001f6b5` step 2, the index: a non-periodic grid slice's `index.get(cell)` is computed (the cell's coordinates by
  `getCoords`, on the slice or `undefined`, its pixel from the build's order); a periodic slice, a space without strides
  and `getSampledImage` (plane, frame) make their Map on the first lookup, from `instance`/`cell` and a byte per pixel
  that maps a cell. `eachSlice` (the only reader of `.index`) is unchanged: `index` keeps the `get(key)` shape.
- `e493ae114` step 3: a uniform theme's color is taken once, no position computed (the portal gains nothing, see
  Decided).
- `a7cd64022` a test theme coloring by a hash of the position's bits: the volume-value theme rounded a position off by
  an ulp away, so a sum in another order passed; with this theme it fails (checked by swapping the order).
- `27fbb6f09` step 4: the position is `Vec3.transformMat4` inlined for an affine transform, its sums in its order (`w`
  is 1), so the same bits; any other transform still calls it.
- `aa907b82e` `CHANGELOG.md` line (applies to 5.x); `.v6/changelogs/fast-slice.md` here.

### Measured (headed Chromium, WebGPU, M-series Mac, port 1352; a Sonnet helper, the script in the session's scratchpad)

TS_08 level 0 (928×928×450), 12 Z steps (+5 each), `api.run('cryoet.slice', …)` plus two frames, awaited one at a time;
Chrome CPU profile through CDP, 100 µs sampling; ms a step, one session:

| after                 | step, median (range) | `createGridImage` (self) | `trilinearlyInterpolate` | `transformMat4` | GC  | upload (`writeTexture` + `flipRows2`) |
| --------------------- | -------------------- | ------------------------ | ------------------------ | --------------- | --- | ------------------------------------- |
| before                | 273 (231–363)        | 260 (189)                | 26                       | 49              | 6.7 | 6.6                                   |
| 2, the index          | 108 (102–141)        | 94 (49)                  | 26                       | 20              | 2.4 | 6.6                                   |
| 3, uniform color once | 104 (98–132)         | 93 (50)                  | 25                       | 19              | 1.5 | 6.4                                   |
| 4, the position       | 87 (78–97)           | 73 (53)                  | 21                       | 0               | 0.8 | 6.4                                   |

3.1× a step (2.9× at the slowest). This session's "before" (273) is below #53's 436–449 (another session); the ratio is
what holds. The remaining 73 ms of the build: the volume-value theme's call (its own `transformMat4`, now inlined in the
profile, and the trilinear read) and the loop's own work (value, group packing).

## Decided

- **Step 1, the theme** (lane, from the code): the portal slice is `volume-value` (`cryoet/src/operations.ts`
  `sliceParams`: `color: 'volume-value'`, a custom domain mean ± kσ, black → white), granularity `vertex`: its `color()`
  samples the volume trilinearly at `l.position`. So "the color once for a uniform theme" gains nothing on TS_08 (the
  table's step 3 is noise); it is kept for every other grid slice with a uniform theme (Mol*'s default for a slice).
- **The index computed, not lazy, for a non-periodic grid slice** (lane): a lazy Map would only move its cost to the
  first hover after each step (picking is `voxel` by default, so a hover reads it); each pixel of such a slice shows its
  own cell, so the lookup is arithmetic and nothing is built. Lazy for the rest, where a cell can have several pixels.
- **The position in `transformMat4`'s order, not "origin + ix·a + iy·b + iz·c"** (lane): the brief's sum in another
  order changes the last bit of a position, and a position theme's pixels with it (the bits-theme test fails on it).
- **Step 5 skipped** (lane): reading the cell instead of interpolating would need the slice to know volume-value's
  internals (a file outside this lane), and the theme's own Cartesian → grid round trip can land at k − ε on a real
  transform (13.48 Å voxels), where the interpolated value differs from the cell's in the last bits: pixels equal only
  most of the time. Its ceiling was the theme's ~21 ms. Not needed: the step is under the 130 ms bar without it.
- A strided read of the cell (`data[o]` instead of `space.get` and `dataOffset`) was tried: no gain in Node (167 ms for
  a 928×928 slice either way), not kept.

## Learned

- The Map was the step: 861k `Map.set` with an array each cost ~165 ms of a 273 ms step (and the GC with it); the pixels
  themselves were cheap.
- The volume-value theme is a poor test of "same pixels": its palette quantization hides a position off by an ulp. A
  theme hashing the position's bits is the sensitive one.
- On prism-me, `slice.test.ts` already had a periodic-slice describe (`5affa6d17`, `ea7dc5d3e`); the cherry-pick of the
  test commit conflicted there and kept both.

## Size

Brief: ~60–100 production lines. `slice.ts`: +105 −40 (the two index helpers and their docs ~55, the producers ~25, the
loop ~25). Tests: +360 (the reference build ~130, the fixtures and themes ~120, the cases ~110). On size.

## Review

| Finding | Severity | Verdict | Commit / open |
| ------- | -------- | ------- | ------------- |
