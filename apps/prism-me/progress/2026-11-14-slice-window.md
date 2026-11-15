# slice-window (brief, 2026-11-14)

Ludo: "what can we do to make the slice slider be interactive at any resolution. there is always a delay" → "could we
do a buffer approach, we have 20 slices in memory and we move the window?" → "yes lets try".

Slug `slice-window`, branch `me/slice-window` from prism-me fca6a3980, port 1380. Lane model: **Opus** (a Mol\* core
visual, a shader, a hot path).

## Measured (coordinator, 2026-11-14, prism-me ebe21bd07, headless Chrome WebGPU)

Ludo's `~/Downloads/7-2_cryolithe_bin2.mrc` (512 × 720 × 225, 13.36 Å), its Z slice, one index step through
`plugin.build().to(slice).update(...).commit()`: **~65 ms** with the default `volume-value` theme, **~35 ms** with
`uniform`; a canvas frame 14 ms. Script `~/prism-me-lanes/slice-speed.cjs` (port 1343 = prism-me's dev server).
Where: `packages/graphics/src/repr/volume/slice.ts` `createGridImage` rebuilds the image on the CPU at every step
(a color callback per pixel, group/value arrays, upload), through the state tree; a drag's steps queue (lag grows).

## Wanted

The grid slice (x, y, z; `mode: 'grid'`) moves at frame rate while its slider is dragged, whatever the volume's size.

1. **A GPU window of slices (ring buffer).** For a grid slice: a 3D texture (or 2D array) of **N = 32** consecutive
   slices along its axis around the current index, raw values (normalized: 8 bit, or 16 bit if the device and the
   data need it — decide and say why), not colors. The slice is drawn by sampling the window at the current layer
   (a uniform). Colors in the shader: the theme's value → color as a 1D LUT (the `volume-value` palette, its domain;
   other themes: build their LUT from values when the theme depends on the value only, else the CPU path).
2. **The window follows.** Moving within the window changes the uniform only. Near an edge, the window recenters by
   replacing only the slices that left with the ones that entered (`texSubImage3D` on layer `index mod N` — a ring),
   one plane copy each; a jump far away refills it. Never reallocates while the axis and grid stay.
3. **A drag path off the state tree.** While dragging, the slider sets the visual's index directly (latest value wins,
   one per frame); the state (and the one history step) is updated on release. Picking: the voxel under the pointer
   from the drawn layer (group = voxel index, as now). Labels/hover report the drawn slice.
4. **Fallbacks**: oblique/plane-mode slices, themes that are not value-only, a device without the texture format →
   the current CPU path, unchanged. Isosurface and direct volume untouched.
5. Memory: N × plane at the chosen precision per shown axis (Ludo's: 32 × 512 × 720 × 1 B ≈ 12 MB for Z); freed when
   the slice is removed or hidden long.

Where it lives: a Mol\* core change (graphics: a slice visual or a mode of `slice.ts`, its shader on WebGL2 and WebGPU)
on prism-me, as commits of their own (no app/extension hunks), recorded in a "Core changes" section of this file (the
coordinator moves them to `_spec/core-changes.md`). The app wiring (the slider's drag path in cryoet / Prism's volume
view) separate. First find where the slice slider lives and how it commits today (debounce? history step per tick?).

## Tests (fail first)

- The window: index i → layer i mod N; recentering replaces exactly the slices that left (count of plane copies);
  a jump refills; the axis/grid change reallocates.
- The drawn values: for indices inside the window, the shader-path pixel values equal the CPU path's `createGridImage`
  values (render both, compare, tolerance of the precision chosen), WebGL2 and WebGPU where the test harness allows.
- Picking at a pixel gives the same voxel as the CPU path.
- A drag of 100 steps commits the state once (one history step), the final index right.
- Perf guard (the repo's perf rule): one step within the window < 2 ms CPU; a recentering step < 5 ms on Ludo's size.

## Check (port 1380)

Ludo's MRC (and a larger one if at hand, or a synthetic 1k × 1k × 500): drag the Z slider fast end to end; per-step
time and frames dropped, before (prism-me) vs after; a screen recording or frame-time log; screenshots of the slice
identical (CPU vs GPU path) at one index.

## Size

~350–500 production lines (core visual + shader + ring; app drag path).

## Out of scope

Oblique slices on the GPU (need the whole volume or bricks: a later lane); direct volume / isosurface speed.

## Rules

Tests fail first; checks pass; gate (lane-reviewer, lane-skeptic); no PR, no merge, no push to prism-me; push
`me/slice-window`. No `git stash pop`. `@author Ludovic Autin <autin@scripps.edu>` on new files.
