# Close up, only the particles in view (2026-10-31, lane `instance-cull`)

## Brief

- **Asked** (Ludo, 2026-10-31): "even without byzoom for the color, when the camera is close to the atom, framerate drop
  a lot. Loading any mesoscale models cellpack or petworld, zooming in and we can feel the slow down"; "I dont have this
  problem" in cellVIEW. Then "yes" to: per-particle frustum culling first, measured; k-means proxy levels as a design
  note. **Check:** CellPack HIV and PetWorld HIV zoomed close to one capsid protein: the frame time with your change
  against prism-me, on WebGPU (Chrome, Firefox) and WebGL2; no particle missing at the view's edges while turning.
- **What we know** (coordinator, 2026-10-31):
  - Ludo's run of `scripts/zoom-test.js` (Firefox, WebGPU, dpr 2, zoomed): pixel scale 1 / 0.5 / 0.25 the same, LOD
    quality / balanced / performance 300 / 200 / 100 ms (Firefox's WebGPU reports the GPU done every 100 ms: rounded;
    the script now times batches of 20). Headless Chrome, CellPack HIV at 0.05: pixels 40 / 42 / 40 ms, LOD 40 / 27
    / 16. So the cost is the spheres drawn, not the fragments.
  - Mol* culls by 200 Å cells (`gl/compute/cell-cull.ts`, `webgpu/shader/cell-cull.wgsl.ts`; WebGL2 `cullSegment` on the
    CPU): every particle of a cell that touches the view is drawn. `instance-copy` already runs a thread per particle of
    a drawn cell.
  - cellVIEW (`~/Dev/cellpackgpu`, read 2026-10-31): per-instance frustum culling (`ComputeSphereBatches.compute:71`),
    LOD per instance by distance, coarse levels as k-means proxies (15 %, 10 %, 5 % of the atoms, then 12, then a grid;
    `KMeansClustering.compute`, `CellPackLoader.cs:695, 942`), no occlusion culling (commented out), one triangle an
    atom, 100 atoms a batch, one indirect draw.
- **Ludo, 2026-10-31: "dont stop until performance is smooth".** The goal: zoomed in (0.1 and 0.02 of the distance,
  CellPack HIV and PetWorld HIV) at the default `quality`, a frame within 16.7 ms on Chrome WebGPU and within 33 ms on
  WebGL2 on this M1 (the batched `scripts/zoom-test.js` method), with no visible loss against prism-me at rest. Do not
  stop at a step: go through the options in order until the goal holds, each measured before and after, written here:
  (1) per-particle frustum culling; (2) whatever the measurements show next, e.g. coarser while the camera moves and
  full when still, a lower pixel ratio only while moving, the k-means proxy levels (cellVIEW's) built rather than only
  noted, or the LOD defaults; ask only if a step needs Ludo's call on the look (say what changes, with images).
- **Step 1, a measurement before code:** zoomed (1, 0.1, 0.02 of the distance), particles drawn against particles whose
  sphere touches the view, per level, and the frame time (`scripts/zoom-test.js`'s batched method); written here; if the
  gap is small, go to the next option.
- **Step 2, build:** each particle's sphere against the six planes in `instance-copy` (WebGPU), its LOD level kept;
  library commits naming no extension (upstreamable later, with Alexander, when Ludo says so). WebGL2: measured options
  (finer cells near the camera, a CPU test) in this file, built only if small.
- **Step 3, a design note first, then built if the goal still needs it:** k-means proxy spheres per target as the coarse
  levels (cellVIEW's), how they would fit `lodLevels` and the merged objects, their cost at load, for Ludo and
  Alexander.
- **Spec:** `.v6/plans/gl/merged-render-objects.md` (GPU culling), `screen-space-lod.md`; `features.md`.
- **Tests:** a particle outside the frustum in a drawn cell is not drawn, one inside is, at its level; the images
  identical to prism-me's (no particle lost at the edges); a scaling guard on the cull pass.
- **Touches:** `graphics` (cell-cull, instance-copy, merged-culler), the bench script; **stays off:** color levels (PR
  #27, this branch's base: it carries the WebGPU draw-list fix PetWorld needs; merge #27 before this PR).
- **Size:** per step written here before building; no stop on size (Ludo's goal), but say each step's size.
- **Steps and models:** 1. measure (Sonnet) 2. design (Opus) 3. build (Opus) 4. checks (Sonnet) 5. browser on WebGPU and
  WebGL2 (Sonnet) 6. gate (Opus) 7. the proxy note (Opus).

## Step 1: measured before code

`apps/prism-me/scripts/zoom-bench.mjs` (new): headless Chrome (Playwright, Metal), 1280x800 window (canvas 896x800), the
camera moved to 1, 0.1 and 0.02 of its distance to the target (the virion's center: at 0.1 inside the envelope, at 0.02
inside the capsid, the view filled by a few near particles), default `quality`; the frame time by `zoom-test.js`'s
batched method (`T()`, 7 batches of 20), the instances (particles) and spheres per level counted on the CPU from the
members: in a cell drawn at a level (what the cell culling draws; before the per-cell occlusion test) against those
whose own sphere touches the view and the level's distance range. Load average 4 to 6 (other lanes running).

| model, backend       | fraction | frame (ms) | level-0 instances, cell / own | level-0 spheres (M), cell / own |
| -------------------- | -------- | ---------- | ----------------------------- | ------------------------------- |
| CellPack HIV, WebGPU | 1        | 8.9        | 0 / 0 (all at level 2)        | 0 / 0 (0.45 M at level 2)       |
| CellPack HIV, WebGPU | 0.1      | 83.1       | 64,993 / 36,111               | 10.74 / 7.08                    |
| CellPack HIV, WebGPU | 0.02     | 70.5       | 31,561 / 15,725               | 4.81 / 3.25                     |
| CellPack HIV, WebGL2 | 1        | 9.6        | same counts                   |                                 |
| CellPack HIV, WebGL2 | 0.1      | 88.0       |                               |                                 |
| CellPack HIV, WebGL2 | 0.02     | 70.3       |                               |                                 |
| PetWorld HIV, WebGPU | 1        | 26.0       | 0 / 0 (levels 1, 2)           | 0 / 0 (2.74 M / 2.54 at lvl 1)  |
| PetWorld HIV, WebGPU | 0.1      | 119.2      | 7,065 / 3,216                 | 13.10 / 8.40                    |
| PetWorld HIV, WebGPU | 0.02     | 93.6       | 5,013 / 1,804                 | 9.11 / 5.59                     |
| PetWorld HIV, WebGL2 | 1        | 30.4       | same counts                   |                                 |
| PetWorld HIV, WebGL2 | 0.1      | 129.6      |                               |                                 |
| PetWorld HIV, WebGL2 | 0.02     | 101.3      |                               |                                 |

- **Per-particle frustum culling alone saves a third** of the level-0 spheres (CellPack 34 % and 32 %, PetWorld 36 % and
  39 %): linear in spheres, 83 to about 55 ms, short of 16.7 by 3x. The rest of what is drawn is in view but hidden: at
  0.1 and 0.02 a few near particles fill the screen, millions of spheres behind them.
- **The fragments count as much as the spheres close up.** `zoom-test.js` set the pixel scale on Canvas3D, which has
  none (`c.props.pixelScale` undefined): the sweep changed nothing, so "pixel scale 1 / 0.5 / 0.25 the same" (Ludo's
  run, and the brief) measured one resolution three times. Fixed (the context's `setProps({ pixelScale })`, then
  `handleResize`). With it (CellPack HIV, WebGPU, dpr 1), pixel scale 1 / 0.5 / 0.25: 0.1 at 73 / 46 / 37 ms, 0.02 at 62
  / 29 / 22 ms. At dpr 2 (Ludo's display, `--dpr 2`, canvas 1792x1600): 1 at 11.9 ms, 0.1 at 168 ms, 0.02 at 184 ms.
  Close up the impostors overdraw: large quads, a ray per fragment, depth written by the shader (no early depth test).
- **So the step that can reach the goal tests occlusion per particle**, not only the frustum: hidden particles cost
  neither vertices nor fragments. Step 2 builds both in `instance-copy` (below).

## Step 2: per-particle culling on the GPU, measured

Built (WebGPU): `instance-copy` tests each instance of a drawn cell by its own sphere (frustum, distance ranges, each of
the cell's levels, the depth pyramid); the GPU occlusion test clamps a rectangle to the view (one reaching past it was
never occluded) and reads a level finer (up to 4 x 4 texels); `gpuCulling: 'auto'` also from 10 M vertices at full
detail and 30 instances (PetWorld's 19 objects of few large proteins stayed on the CPU's cells). Frame (ms), headless
Chrome, `zoom-bench.mjs`, before / after:

| model, backend, dpr     | 1           | 0.1           | 0.02         |
| ----------------------- | ----------- | ------------- | ------------ |
| CellPack HIV, WebGPU, 1 | 8.9 / 6.0   | 83.1 / 65.2   | 70.5 / 31.4  |
| CellPack HIV, WebGPU, 2 | 11.9 / 10.5 | 167.5 / 146.1 | 183.9 / 76.9 |
| PetWorld HIV, WebGPU, 1 | 26.0 / 23.3 | 119.2 / 75.1  | 93.6 / 65.5  |
| PetWorld HIV, WebGPU, 2 | 45.6 / –    | 324.1 / –     | 271.1 / –    |
| CellPack HIV, WebGL2, 2 | 15.1        | 191           | 199.6        |
| PetWorld HIV, WebGL2, 2 | 49.6        | 341.9         | 284.8        |

(PetWorld at dpr 2 "before" was measured with the step-2 code on, before the auto rule: its objects were still on the
CPU then, so it is the baseline.) Instances drawn (read back from the counters, CellPack HIV): 1 176k to 155k of 229k,
0.1 47k to 48k, 0.02 13.5k to 10k (the frustum-only counts at 0.1: 46k).

- **The depth pyramid barely occludes zoomed in**: a texel keeps the farthest depth it covers, and between the atoms of
  the front particles some pixel of almost every texel shows deep into the model: mesoscale packing is porous at the
  pyramid's resolution. What is seen through a gap must be drawn anyway; the culling draws what is in view.
- **Postprocessing is cheap** (all off: 0.1 from 65 to 62.5 ms); the cost is the spheres: their vertices (pixel scale
  0.25: 0.1 at 34 ms, 0.02 at 15) and their fragments (the rest; at dpr 2 most of the frame).
- **The bound of a coarser look**: `performance` (D 6, pixel scale 0.5) at dpr 2, i.e. native 1x: CellPack 36 / 23 ms,
  PetWorld 50 / 54 ms at 0.1 / 0.02. So at rest, at `quality`, 16.7 ms is out of reach without changing the look; the
  goal's frames are reached while the camera moves (step 3), the rest frame keeps today's look.

## Step 2b: the pyramid of a still view, measured

Found while measuring the switch of the pixel scale: a still view's frames cost 14 ms where the batched method said 65
(CellPack HIV at 0.1). The culler skipped a dispatch while the pyramid's camera was the one it tested last: after a
camera jump the first dispatch tested the pyramid of the old view, the next one the pyramid of a frame drawn from that
(with holes where it culled wrongly), and then never again. Fixed (`OcclusionPyramid.version`: a dispatch per drawn
frame against the newest build; a still canvas draws nothing); what a change at a still view reveals is drawn again (an
object hidden, a level refined). With it the occlusion converges in 3 to 4 frames.

The edges, while turning: a rectangle reaching past the pyramid's view was clamped (my step 2): a particle entering the
view behind another showed a frame late (PetWorld HIV at 0.1, 2° a frame: 15,308 of 716,800 pixels in a frame). Now
clamped only where no part of the sphere beyond the pyramid's frustum is in view (the cap beyond each plane). Not
occluded wherever it reached past, a turning frame cost twice (CellPack 0.1: 22 to 45 ms); with the cap test 37 ms.
`cull-check.mjs` (new): settled images with occlusion against without, and GPU culling against the CPU's cells, at 1,
0.1 and 0.02, both models: no pixel differs. Turning 2° a frame (the frame with occlusion against the same camera
without), the worst frame: at 0.1 13 (CellPack) and 206 (PetWorld) pixels of 716,800; at 0.02 1,397 and 953 (what
parallax uncovers behind a near particle shows a frame late: the one-phase test's limit).

Frame (ms), WebGPU, still / turning 1° a frame (`zoom-test.js` `M()`):

| model, dpr      | 1           | 0.1         | 0.02        |
| --------------- | ----------- | ----------- | ----------- |
| CellPack HIV, 1 | 6.4 / 6.6   | 12.1 / 36.8 | 14.1 / 24.7 |
| CellPack HIV, 2 | 10.8 / 10.8 | 35.4 / –    | 39.1 / –    |
| PetWorld HIV, 1 | 23.3 / 23.4 | 22.0 / 51.1 | 50.3 / 53.5 |
| PetWorld HIV, 2 | 41.2 / 41.0 | 66.4 / –    | 147.9 / –   |

WebGL2 unchanged (CPU culling): CellPack dpr 1 88 / 70 ms, dpr 2 191 / 200 ms; PetWorld dpr 1 129 / 102, dpr 2 342
/ 285.

## Step 3: coarser while the camera moves (built, the first part)

`Canvas3D` `motion` (`lodScale`, `holdMs` 250): while the camera changed within the hold, levels by size on screen drawn
`lodScale` times coarser (`Renderer.setLodScale`, `LodView`'s scale: as at a resolution that many times lower), then one
frame at full detail without a request. Found on the way: a draw list's recording held the view's planes alone, so a
scale (or a resolution) at the same camera replayed the old levels (fixed: the view's Å per pixel with the planes).
Turning frames (ms, WebGPU, before the cap test; still frames unchanged):

| model, dpr      | 0.1, m 2 / m 4 | 0.02, m 2 / m 4 |
| --------------- | -------------- | --------------- |
| CellPack HIV, 1 | 31.5 / 21.0    | 23.2 / 16.6     |
| CellPack HIV, 2 | 83.3 / 61.7    | 63.3 / 47.9     |
| PetWorld HIV, 1 | 48.6 / 31.9    | 52.2 / 40.0     |
| PetWorld HIV, 2 | 130.2 / 97.4   | 153.3 / 131.3   |

At dpr 2 the fragments bound the frame: the levels alone don't reach 16.7 ms; next, the pixel scale while moving.

## Built

## Decided

## Learned

## Size

## Review
