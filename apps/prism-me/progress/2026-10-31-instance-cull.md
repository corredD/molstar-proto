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

## Built

## Decided

## Learned

## Size

## Review
