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
2. Free a hidden slice's window after a while? (not built; the x and y slices of an MRC are made hidden at load and take
   their windows only once shown and moved — they do allocate their texture at load.)
3. Upstream the core commits (they are self-contained, no app hunks)?

## How Ludo checks it (port 1380)

`http://localhost:1380/apps/prism-me/build/`, drop `7-2_cryolithe_bin2.mrc`, pick Slice Z, drag the Slice slider end to
end fast: the slice follows the pointer, one undo step (Undo returns to the start). Click far along the track: it jumps
at once. Change the contrast: immediate. Hover the slice after a drag: the cell label is on the drawn slice.
