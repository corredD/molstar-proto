# slice-window (brief, 2026-11-14)

Ludo: "what can we do to make the slice slider be interactive at any resolution. there is always a delay" → "could we do
a buffer approach, we have 20 slices in memory and we move the window?" → "yes lets try".

Slug `slice-window`, branch `me/slice-window` from prism-me fca6a3980, port 1380. Lane model: **Opus** (a Mol\* core
visual, a shader, a hot path).

## Measured (coordinator, 2026-11-14, prism-me ebe21bd07, headless Chrome WebGPU)

Ludo's `~/Downloads/7-2_cryolithe_bin2.mrc` (512 × 720 × 225, 13.36 Å), its Z slice, one index step through
`plugin.build().to(slice).update(...).commit()`: **~65 ms** with the default `volume-value` theme, **~35 ms** with
`uniform`; a canvas frame 14 ms. Script `~/prism-me-lanes/slice-speed.cjs` (port 1343 = prism-me's dev server). Where:
`packages/graphics/src/repr/volume/slice.ts` `createGridImage` rebuilds the image on the CPU at every step (a color
callback per pixel, group/value arrays, upload), through the state tree; a drag's steps queue (lag grows).

## Wanted

The grid slice (x, y, z; `mode: 'grid'`) moves at frame rate while its slider is dragged, whatever the volume's size.

1. **A GPU window of slices (ring buffer).** For a grid slice: a 3D texture (or 2D array) of **N = 32** consecutive
   slices along its axis around the current index, raw values (normalized: 8 bit, or 16 bit if the device and the data
   need it — decide and say why), not colors. The slice is drawn by sampling the window at the current layer (a
   uniform). Colors in the shader: the theme's value → color as a 1D LUT (the `volume-value` palette, its domain; other
   themes: build their LUT from values when the theme depends on the value only, else the CPU path).
2. **The window follows.** Moving within the window changes the uniform only. Near an edge, the window recenters by
   replacing only the slices that left with the ones that entered (`texSubImage3D` on layer `index mod N` — a ring), one
   plane copy each; a jump far away refills it. Never reallocates while the axis and grid stay.
3. **A drag path off the state tree.** While dragging, the slider sets the visual's index directly (latest value wins,
   one per frame); the state (and the one history step) is updated on release. Picking: the voxel under the pointer from
   the drawn layer (group = voxel index, as now). Labels/hover report the drawn slice.
4. **Fallbacks**: oblique/plane-mode slices, themes that are not value-only, a device without the texture format → the
   current CPU path, unchanged. Isosurface and direct volume untouched.
5. Memory: N × plane at the chosen precision per shown axis (Ludo's: 32 × 512 × 720 × 1 B ≈ 12 MB for Z); freed when the
   slice is removed or hidden long.

Where it lives: a Mol\* core change (graphics: a slice visual or a mode of `slice.ts`, its shader on WebGL2 and WebGPU)
on prism-me, as commits of their own (no app/extension hunks), recorded in a "Core changes" section of this file (the
coordinator moves them to `_spec/core-changes.md`). The app wiring (the slider's drag path in cryoet / Prism's volume
view) separate. First find where the slice slider lives and how it commits today (debounce? history step per tick?).

## Tests (fail first)

- The window: index i → layer i mod N; recentering replaces exactly the slices that left (count of plane copies); a jump
  refills; the axis/grid change reallocates.
- The drawn values: for indices inside the window, the shader-path pixel values equal the CPU path's `createGridImage`
  values (render both, compare, tolerance of the precision chosen), WebGL2 and WebGPU where the test harness allows.
- Picking at a pixel gives the same voxel as the CPU path.
- A drag of 100 steps commits the state once (one history step), the final index right.
- Perf guard (the repo's perf rule): one step within the window < 2 ms CPU; a recentering step < 5 ms on Ludo's size.

## Check (port 1380)

Ludo's MRC (and a larger one if at hand, or a synthetic 1k × 1k × 500): drag the Z slider fast end to end; per-step time
and frames dropped, before (prism-me) vs after; a screen recording or frame-time log; screenshots of the slice identical
(CPU vs GPU path) at one index.

## Size

~350–500 production lines (core visual + shader + ring; app drag path).

## Out of scope

Oblique slices on the GPU (need the whole volume or bricks: a later lane); direct volume / isosurface speed.

## Rules

Tests fail first; checks pass; gate (lane-reviewer, lane-skeptic); no PR, no merge, no push to prism-me; push
`me/slice-window`. No `git stash pop`. `@author Ludovic Autin <autin@scripps.edu>` on new files.

## Built (2026-11-15)

- **Core (graphics):** a grid slice colored by `uniform` or `volume-value` is drawn from a window of its planes on the
  GPU (`repr/volume/slice-window.ts`): `SliceRing` (32 indices, a band a quarter in from each edge; past it the window
  follows plane by plane, a jump refills), `SliceWindow` (a 3d `r32float` texture; each plane in the CPU image's pixel
  order; z planes of an x-fastest grid uploaded as views of the data, x/y planes gathered; the plane shown copied at
  once, the rest of the window in idle time, 4 ms at a time, nearest first). The image renderable gains `dSliceWindow`,
  `tSliceTex`, `uSliceLayer`, `uSliceDomain`; both shaders fetch the texel (rows flipped as the CPU image's), filter
  (cubic) the value in the color domain, then color it (the palette, or `uColor` × value), and cut the iso level by a
  bilinear value in the grid's range — the CPU path's math. `VolumeVisualBuilder.updateGeometry`: an index, contrast or
  iso change moves the window in place (no new geometry, markers, colors; marks cleared). `Texture.loadLayer` (WebGL2
  `texSubImage3D`, WebGPU `writeTexture` after a flush). Picking/marking: the mapping follows the drawn slice (cells
  computed on the first pick after a move).
- **MRC files** are periodic maps of one tile: drawn from the window too, in their tile's grid (else the window would
  never be used for Ludo's files).
- **App (cryoet):** `CryoetApi.previewSlice` shows a windowed slice's index outside the state, once a frame (latest
  wins); the Slice slider previews with it and commits once on release (`api.group('Slice', cryoet.slice)`, one undo
  step). Keys, and slices not windowed, go through `gestureSteps` as before. A pending preview is dropped when the state
  is set and skipped when the slice is gone; a drag that ends without a change (back at its start) commits nothing.
- **Fallbacks, unchanged:** frame/plane modes, other themes, periodic volumes of several tiles, no 3d textures (WebGL1),
  a window past 128 MB.

## Decided (by me, Ludo away: "best performance")

- **32-bit float planes, not 8 or 16 bit.** Ludo's map has min −20.7, max 16.6, σ 0.59: ±3σ is 10 % of the range, 24 of
  256 levels at 8 bit over min/max (visible banding). 8 bit over the color domain would need a refill per contrast
  change; 16 bit (half float) a conversion per voxel per plane (JS) and still filtering differences. Floats: no
  conversion (a z plane is a view of the data: copies cost an upload only), exact iso, contrast a uniform, CPU-identical
  pixels. Cost: 4 B a texel, 47 MB for Ludo's Z window (x 21 MB, y 15 MB).
- **A byte budget of 128 MB per window**: a larger plane gets fewer planes (≥ 4), past that the CPU path (a 2048² plane:
  8 planes; 8192²: CPU).
- **The plane shown copied at once, the window filled in idle time**: a click far on the track costs a plane (≈ 1 ms)
  instead of a refill (23–43 ms measured).
- **Band hysteresis of N/4**: a reversal within 16 planes copies nothing; a steady drag copies one plane a step.
- **Drag preview through the representation** (`repr.createOrUpdate` of the dimension only) rather than a new core API:
  the core's in-place path makes it cheap, and the release's state update is then a no-op for the visual.
- **Not built, open (TODO for Ludo):** freeing a hidden slice's window after a while (brief Wanted 5): the visual has no
  visibility hook, and a hidden slice of Ludo's map keeps ≤ 47 MB; it is freed on removal, axis change, fallback,
  context switch. A WebGL2 automated test (no WebGL2 harness in Node: checked in Chrome instead, below).

## Measurements (headless Chrome, M1 Pro, Ludo's `7-2_cryolithe_bin2.mrc` 512 × 720 × 225)

| What                                                                         | Before (prism-me, 1343)                                               | After (1380)                                                     |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------- |
| A Z step through the state tree (`slice-speed.cjs`, volume-value)            | 60–74 ms                                                              | 1–3 ms (first 6)                                                 |
| Same, uniform theme                                                          | 32–34 ms                                                              | 1–2 ms                                                           |
| Real drag of the Z slider end to end, 3 s (`slice-window-drag.cjs`)          | 226 frames, p95 50 ms, max 67 ms, 25 frames > 33 ms, 24 state commits | 271 frames, p95 16.7 ms, max 16.8 ms, 0 frames > 33 ms, 1 commit |
| A step of the representation within the window (z / x / y)                   | —                                                                     | 0.1 / 0.1 / 0 ms                                                 |
| A step at the window's edge (median, max)                                    | —                                                                     | z 0.8, 1.3; x 1.0, 10 (once, an idle chunk); y 0.3, 0.4 ms       |
| A jump far away                                                              | (a CPU image: ~60 ms)                                                 | z 0.7, x 1.2, y 0.4 ms (was 23–43 ms with an immediate refill)   |
| WebGL2 (navigator.gpu removed)                                               | 55 ms median                                                          | windowed, 0.1 ms median, 2.6 ms max                              |
| Screenshot z 150, CPU path (1343) vs window (1380)                           |                                                                       | WebGPU and WebGL2: max difference 1 level, 0 pixels > 3          |
| Hover at the canvas center after moving outside the state (z 40, 41, 180, 7) |                                                                       | the cell reported is on the drawn slice each time                |

Scripts: `~/prism-me-lanes/slice-window-drag.cjs [port]`, `slice-speed-port.cjs [port]`, `slice-window-steps.cjs`,
`slice-window-webgl.cjs`, `slice-window-pick.cjs`. Screenshots:
`/private/tmp/claude-501/-Users-ludovicautin-molstar-proto-git/bc8a7dcf-b4ed-4027-911e-5f56df74a469/scratchpad/slice-window/`.

## Tests

- graphics `repr/volume/_test/slice-window.test.ts` (ring: layer i mod N, copies per recenter, jump refills, short axis,
  memory budget), `slice.test.ts` (window path along x, y, z: the drawn layer equals the CPU image's values, groups,
  mapping, index, corners; fallbacks; a step in place: no new geometry, a plane per edge step, idle fill, jump; picking
  the drawn voxel; contrast as a uniform; marks cleared; destroy frees), `slice-window.timing.test.ts` (`itWithin`:
  within the window < 2 ms, edge < 5 ms, jump < 5 ms at 512 × 720).
- plugin-headless (Dawn): `webgpu-texture-layer.test.ts` (`loadLayer`), `webgpu-slice-window.test.ts` (CPU vs window
  pixels, x/y/z, nearest and cubic, uniform and volume-value, with and without an iso cut: 0 pixels > 3 levels apart
  without iso; a broken row flip fails it).
- cryoet `slice-controls.test.tsx`: a drag of 99 steps previews outside the state and commits once (one undo step, final
  index); keys and a slice not windowed through the state; a drag left without its release commits; a drag back to its
  start commits nothing; a pending preview neither undoes the commit nor touches a removed slice (viewer).
- Checks: `npx tsc -b`, `npx tsc --noEmit -p apps/prism-me`, the brief's vitest set (2790 passed; only the known
  backend-neutral false match fails), Dawn tests, heavy timing lane, `pnpm lint`. `pnpm format:check` fails on Markdown
  files the lane did not write; `check:workspace` fails on `@molstar/plugin-ui ./*.css` (not built here; unrelated).
  `webgpu-points.test.ts` failed once in a full headless run and passed 3/3 alone and on the base (flaky).

## Review

lane-reviewer: 5 must, 5 should, 2 nit; lane-skeptic re-ran the probes (and added 3): 11 confirmed, 1 refuted as stated,
1 new nit.

| #   | Finding                                                            | Verdict                                 | Outcome                                              |
| --- | ------------------------------------------------------------------ | --------------------------------------- | ---------------------------------------------------- |
| 1   | a step in place kept the marks of voxels no longer drawn           | confirmed (should)                      | fixed 1078e6b65, test first                          |
| 2   | a preview frame after the release's commit moved the slice back    | confirmed (must)                        | fixed 23398dfc3, test first                          |
| 3   | progress file without results / precision decision                 | partly refuted (written after the gate) | this file                                            |
| 4   | WebGL2 never compiled/drawn                                        | mostly refuted (Chrome check)           | recorded above; no Node harness                      |
| 5   | "freed when hidden long" not built                                 | confirmed (should)                      | left open, Decided above                             |
| 6   | a preview after the slice's removal made a visual                  | confirmed (should)                      | fixed 23398dfc3, test first                          |
| 7   | a drag back to its start left the knob on it, unmount committed it | confirmed (must)                        | fixed 7b71fa008, test first                          |
| 8   | timing bound on `show`, not a visual step                          | confirmed (nit)                         | open; skeptic's probe: a visual step 0.015 ms median |
| 9   | per-step allocations (tile volume per step for MRC)                | confirmed (nit)                         | tile cached 2ca5b975b; small literals left           |
| 10  | no memory budget                                                   | confirmed (should)                      | fixed 17f84c2aa, test first                          |
| 11  | dispose before a first image                                       | confirmed (nit)                         | fixed 2ca5b975b                                      |
| 12  | NaN voxels; group texture re-upload off the in-place path          | confirmed (nit)                         | open                                                 |
| 13  | preview update without `catch`                                     | new nit                                 | fixed 23398dfc3                                      |

## Learned

- MRC maps are `periodicity: 'xyz'` with one tile: a "non-periodic only" fast path never runs on Ludo's files.
- Most of the old 65 ms was the CPU image and its uploads; through the state tree the in-place path is 1–3 ms, so the
  drag path's gain is mostly the 24 → 1 state commits (UI watchers re-run per commit).
- A jump's refill (32 planes, x planes strided) was the last frame drop; idle filling removes it.

## Size against the brief

Brief ~350–500 production lines; built ~930 (13 files, 900 net). What took the room: the shaders twice (GLSL, WGSL), the
lazily computed mapping for picking/marking, the periodic tile case, idle fill, the memory budget, the app's drag path
and its edge cases (race, removal, drag back). Tests ~850 lines.

## Core changes (for `_spec/core-changes.md`; not upstream)

| What                                                                      | Why                                                           | Files                                                                                                                                   | Commits                         |
| ------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `SliceRing`, `SliceWindow` (window of planes, idle fill, 128 MB budget)   | slice slider at frame rate                                    | `graphics/src/repr/volume/slice-window.ts`                                                                                              | 531caf4a6, bee32711a, 17f84c2aa |
| `Texture.loadLayer` (WebGL2, WebGPU)                                      | a plane into one layer of a 3d texture                        | `graphics/src/gl/texture.ts`, `gl/webgl/texture.ts`, `gl/webgpu/texture.ts`                                                             | fc078d262                       |
| `getVolumeValueDomain`                                                    | the palette's domain in values, shared with the direct volume | `graphics/src/theme/color/volume-value.ts`                                                                                              | 6a9610edb                       |
| `VolumeVisualBuilder.updateGeometry`; marks cleared after it              | a geometry updated in place                                   | `graphics/src/repr/volume/visual.ts`                                                                                                    | d79ca6ba3, 1078e6b65            |
| Image `dSliceWindow`/`tSliceTex`/`uSliceLayer`/`uSliceDomain` and shaders | an image from a layer of raw values, colored in the shader    | `graphics/src/gl/renderable/image.ts`, `geo/geometry/image/image.ts`, `gl/webgl/shader/image.frag.ts`, `gl/webgpu/shader/image.wgsl.ts` | 182d8bd85                       |
| Slice: window path, MRC tile, tile cache, dispose guard                   | grid slices from the window                                   | `graphics/src/repr/volume/slice.ts`                                                                                                     | 63d50a378, 6dc341825, 2ca5b975b |
| Tests                                                                     |                                                               | `graphics/.../_test/slice*.ts`, `plugin/headless/src/_test/webgpu-slice-window.test.ts`, `webgpu-texture-layer.test.ts`                 | with the above                  |

## Decisions for Ludo

1. Float planes (47 MB GPU for your Z window, ~82 MB for the three slices of your map) vs 16-bit (half, a conversion per
   plane) — kept float for exact pixels and contrast as a uniform.
2. Free a hidden slice's window after a while? Not built: the x and y slices an MRC load makes hidden get their windows
   at load too (filled in idle time: x 21 MB, y 15 MB on your map).
3. Upstream the core commits (they are self-contained, no app hunks)?

## How Ludo checks it (port 1380)

`http://localhost:1380/apps/prism-me/build/`, drop `7-2_cryolithe_bin2.mrc`, pick Slice Z, drag the Slice slider end to
end fast: the slice follows the pointer, one undo step (Undo returns to the start). Click far along the track: it jumps
at once. Change the contrast: immediate. Hover the slice after a drag: the cell label is on the drawn slice.

## Ludo's answers (2026-11-15) and the follow-up

1. Float32 planes: OK. 2. Free a hidden slice's window: **yes, built**. 3. Core commits upstream later: OK.

New ask: "when using full resolution of a volume of ~2 GB, can we use the bin2 buffer instead when using the slider?" —
built.

### Built

- **Hidden slices:** `VolumeVisualBuilder.setVisibility` (core); a slice hidden (or made hidden, never shown) frees its
  windows after 5 s (`SliceWindowHiddenMs`); shown again, the window is made again at the slice drawn (its plane at
  once, the rest in idle time, a redraw asked for). Changes while hidden (contrast, a step, another axis) only record
  the slice; nothing is allocated until it is shown.
- **Binned planes while a big slice moves:** a volume of ≥ 2^28 voxels (1 GiB of floats:
  `SliceWindowConfig.coarseVoxels`) is binned 2× by `binGrid` (each voxel the mean of its 2×2×2 block, as the MRC
  Level's 2×) in the background once one of its slices is shown (a Task yielding every 8 ms; `binGrid` now yields in its
  averaging pass too, in memory order). A step the full window does not hold shows the binned plane of the pair
  (`index >> 1`, a window of 32 binned planes: 64 slices, a plane a quarter of the size); the shader reads texel `p / 2`
  after the row flip, so the binned plane covers the full one exactly (same quad, same Å). 150 ms after the last move
  the full-resolution plane is copied and shown (`settleMs`, a redraw asked for); the binned window is freed 5 s after
  that (`coarseHoldMs`).

### Decided

- **Threshold by voxel count (2^28), not plane size**: the costly planes are the strided x/y ones of big maps, whatever
  their own size; Ludo's map (83 M voxels) stays at full resolution all the time (no blur, no binning memory).
- **From a binned level in memory, not per plane on the fly**: binning a plane on the fly reads two full planes, the
  same CPU as copying them; the binned volume (1/8 of the map, 190 MB for a 1.5 GB map, kept with the volume) makes
  binned planes cheap gathers (z: views).
- **Binning starts when a slice is shown**, not at load: the hidden x/y slices of a load bin nothing.
- **Accepted:** while a big slice moves, a full and a binned window can both be held (≤ 2 × 128 MB GPU); the binned one
  is freed 5 s after rest. The binned volume stays in CPU memory with the volume. The averaging needs a Float64 sum
  array of 1/8 of the map × 8 B transiently (377 MB for a 1.5 GB map).

### Measurements (synthetic 1024 × 1024 × 360 map, 1.5 GB, headless Chrome; renderer footprint 3.7 GB)

| What                                    | prism-me (1343)                                      | window, no binning                       | window + binned preview                  |
| --------------------------------------- | ---------------------------------------------------- | ---------------------------------------- | ---------------------------------------- |
| Drag Z end to end, 3 s                  | 10 frames > 33 ms, max 167 ms, 10 commits            | 0 > 33 ms, max 16.8                      | 0 > 33 ms, max 16.8, 1 commit            |
| Drag X end to end, 3 s                  | 15 frames > 33 ms, p95 83 ms, max 267 ms, 14 commits | 1 > 33 ms, max 350 ms                    | 0 > 33 ms, max 16.8, 1 commit            |
| Step at the window's edge, median / max | —                                                    | z 1.7 / 5.5; x 3.3 / 243; y 0.9 / 1.1 ms | z 0.1 / 4.8; x 0.5 / 0.7; y 0.2 / 0.6 ms |
| Jump far                                | —                                                    | z 0.2, x 3.4, y 1.1 ms                   | z 0.7–0.9, x 0.7, y 0.3 ms               |

Ludo's map after all of it: drag Z 0 frames > 33 ms, 1 commit (unchanged). (The steps script's x/y numbers after the
hidden-slice fix read 0 ms: those slices are hidden there, so nothing is drawn; the visible numbers are the column
above.)

### Tests (failing first)

- graphics `slice.test.ts`: hidden 5 s frees, shown makes again at the slice; changes and an axis change while hidden
  keep nothing allocated; the binned grid is `binGrid` 2×; a far step shows the binned plane (its values, layer, the
  plane's size for the shader), the full one after rest at the same corners; a big slice made hidden is not binned until
  shown; the binned window freed after rest and made again; under the threshold, no binning.
- model `bin.test.ts`: `binGrid` yields in its averaging pass.
- Dawn `webgpu-slice-window.test.ts`: on a map constant per 2×2×2 block with odd sides, the binned plane renders the CPU
  path's full image pixel for pixel along x, y, z, and so does the full plane after rest (a texel shifted by one fails
  it).

### Review of the follow-up (lane-reviewer, lane-skeptic)

| #      | Finding                                                                               | Verdict                    | Outcome                                                                          |
| ------ | ------------------------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------- |
| 1      | a change while hidden remade the freed window, never freed again                      | confirmed (must)           | fixed 0158dfe94, test first                                                      |
| N1     | an axis change while hidden made a window never freed                                 | confirmed by the same test | fixed 0158dfe94                                                                  |
| 2 / N2 | `binGrid`'s averaging pass had no yield (0.13–0.25 s x-fastest, 0.65–1.5 s z-fastest) | confirmed (timed)          | fixed b1327a101 (memory order, yields), test first                               |
| 3      | the binning promise had no catch                                                      | confirmed                  | fixed 0158dfe94                                                                  |
| 4      | the binned window never freed while visible; not in the budget                        | confirmed                  | freed 5 s after rest (0158dfe94, test first); the two-window cost accepted above |
| 5      | `SliceSettleMs` a stale copy                                                          | confirmed (nit)            | removed 0158dfe94                                                                |
| 6      | a closure per coarse step                                                             | confirmed (nit)            | open (one per step, not per frame)                                               |
| 7      | the switch back to full not rendered                                                  | partly refuted             | Dawn capture after rest added ce90623f1                                          |
| N3     | binning started for a slice made hidden                                               | confirmed (nit)            | binning starts when shown, 0158dfe94                                             |

Commit 0158dfe94 holds several gate causes in one file pair (the visibility, hold and binning start share `drawSlice`);
the others are one cause each.

### Core changes (added)

| What                                                                | Why                                 | Files                                                                                                                               | Commits                         |
| ------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `VolumeVisualBuilder.setVisibility`; a hidden slice's windows freed | memory of hidden slices (Ludo: yes) | `graphics/src/repr/volume/visual.ts`, `slice.ts`, `slice-window.ts`                                                                 | 0f6030763, 0158dfe94            |
| `SliceBinned`, `uSliceBin`, binned preview while a big slice moves  | big maps at frame rate              | `graphics/src/repr/volume/slice-window.ts`, `slice.ts`, `gl/renderable/image.ts`, `geo/geometry/image/image.ts`, both image shaders | 32ff54caa, 85063c790, 0158dfe94 |
| `binGrid` averaging in memory order, yielding                       | a 2 GB map binned in the background | `model/src/model/volume/bin.ts`                                                                                                     | b1327a101                       |

## A tilt series' slider (Ludo, 2026-11-15: a portal tilt series, 41 × 3000², ~2 GB, "does not respond")

**Cause, measured (hypothesis a):** the window's 3d texture limit is 2048 (WebGPU `maxTextureDimension3D`, WebGL2
`MAX_3D_TEXTURE_SIZE` here). A 3000-wide plane can't be allocated, so the slice fell back to the CPU path: 1.43–1.56 s a
step. On a synthetic 3000 × 3000 × 41 float map, the windowed path was off. Hypothesis (b) followed from it: a 36 MB
plane also failed the old minimum of 4 planes in the 128 MB budget. (c) didn't apply: the series loads as an MRC
periodic tile and uses volume-value, as the tomograms do. (d) was right: 369 M voxels passes the binning threshold, and
binning z by 2 would mix two tilt angles.

### Built

- **Tiles:** a plane wider or taller than the 3d texture limit is split into even tiles (3000² → 2 × 2 tiles of 1500²),
  each tile a layer. The shader picks the tile's layer and the texel in it (`uSliceTiles`). The window's planes are
  clamped so that their tiles fit the layer limit, at least 1 plane (a 3000² plane: 3 planes).
- **Per-axis binning:** `binGrid` takes a factor per axis. A volume with fewer than 128 planes along z (a tilt series)
  is binned 2× in x and y only, so a binned plane is the same tilt. The shader's bin is per column and row (`uSliceBin`,
  v2).
- **Idle fill:** off only where a plane is tiled or over 16 MB (one copy outlasts an idle slot); the plane shown is
  still copied at once.
- **`binGrid` holds one binned slab of sums at a time** (a 41 × 3000² series: 18 MB, not 738).
- **WebGL fix:** the items rebind a kind-'texture' cell set to another texture at the next draw, as WebGPU's do. Without
  it the tilt slice at rest drew the binned planes in tiles on WebGL2 (found by the WebGL2 screenshot).

### Measured (synthetic 3000 × 3000 × 41 float, 1.5 GB, headless Chrome M1, one browser at a time)

| What                                | prism-me (1343)                                               | after (1380)                                                                           |
| ----------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| A Z step through the representation | 1430–1560 ms (CPU path)                                       | 3–9 ms (binned 1500², xy)                                                              |
| Drag Z end to end (3 s of pointer)  | the drag took 60 s, 46 frames > 33 ms, max 1.58 s, 41 commits | 272 frames, 0 > 33 ms, max 16.8 ms, 1 commit                                           |
| WebGL2 step                         | 1449 ms median                                                | 5.8 ms median                                                                          |
| At rest                             |                                                               | full resolution in 2 × 2 tiles; WebGL2 screenshot vs the CPU path: 1 pixel > 3 (max 6) |
| Ludo's tomogram (regression)        |                                                               | drag 0 > 33 ms, 1 commit                                                               |

The headless renderer stayed under 4 GB. Ludo's own Chrome (not ours) had a 7.2 GB renderer and a 5 GB GPU process open
at the time.

### Tests (failing first)

- graphics `slice-window.test.ts`: tiles and the planes they hold; the budget's depth (3 for 3000²); idle off for tiled
  windows.
- graphics `slice.test.ts`: a tilt-like volume binned [2,2,1]; binned and at rest, a step within the window is a full
  plane.
- model `bin.test.ts`: per-axis factors; one pass yielding per slab.
- graphics `gl/_test/webgl-texture-rebind.test.ts` (native GL, medium lane): a replaced kind-'texture' cell is bound at
  the next draw.
- Dawn `webgpu-slice-window.test.ts`: a tiled window (tiles of 16) and a binned-xy window draw the CPU path's pixels
  along z and x. The z-binned case now uses 131 planes.

### Review (lane-reviewer, lane-skeptic)

| #    | Finding                                                                          | Verdict            | Outcome                                                                                  |
| ---- | -------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------- |
| 1    | idle fill off for every binned volume: a step after rest showed the binned plane | confirmed (must)   | fixed (idle off by tile/size), test first                                                |
| 2    | `idle()` re-armed after the flag went off                                        | confirmed (nit)    | fixed, same commit                                                                       |
| 3    | `binGrid` sums 738 MB for a tilt series                                          | confirmed (should) | fixed: one slab of sums                                                                  |
| 4    | WebGL2 path untested                                                             | confirmed (should) | checked in Chrome: it found a real WebGL bug (texture swap); fixed with a native-GL test |
| nits | stacked JSDoc, "even sizes", "Binning 2×" text, the tilt test's x step           | confirmed          | fixed except the x-step assertion (rendered in Dawn)                                     |

### Core changes (added)

| What                                                          | Files                                                                                                                               | Commits                                   |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `binGrid` per-axis factors, one slab of sums                  | `model/src/model/volume/bin.ts`                                                                                                     | 9138693dc, and the slab commit            |
| Slice window tiles, per-axis bins, idle policy                | `graphics/src/repr/volume/slice-window.ts`, `slice.ts`, `gl/renderable/image.ts`, `geo/geometry/image/image.ts`, both image shaders | c5dc72a79, 819b3a586, d894ba9be |
| WebGL render items rebind replaced external textures per draw | `graphics/src/gl/webgl/render-item.ts`                                                                                              | the rebind commit                         |
