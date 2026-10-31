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

## Built

## Decided

## Learned

## Size

## Review
