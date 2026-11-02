# gpuCulling auto without the sphere raster (2026-11-01, lane `no-raster-auto`)

Branch `me/no-raster-auto` from `origin/me/merge-master` (b20714a90); PR to `me/merge-master`.

## Brief

- **Problem**: after the merge of master (#2061) only master's `gpuCulling: 'auto'` rule remains (from 20k instances
  with 30 per draw, or from 100k spheres where the device has the sphere raster, d65fc4bfd). prism-me's rule (3636fff0f:
  from 10 M vertices at full detail and 30 instances) is gone; its test is skipped in
  `packages/graphics/src/repr/_test/merged.test.ts` (`// rework:`). So on Apple M1/M2 (no `atomic-vec2u-min-max`, no
  raster) PetWorld HIV (19 objects, ~13 M spheres) is CPU-culled on WebGPU again. Coordinator's bench (M1 Pro, Chrome
  156, ms a frame at camera 1 / 0.1 / 0.02 of its distance): PetWorld WebGPU before the merge 24.8 / 21.6 / 41.9, after
  25.4 / 71.1 / 47.5.
- **Goal** (Ludo: "favor master first, rework on top if relevant, no duplication"): ONE auto rule, master's, extended
  for devices without the raster, not a second rule next to it. Measure first on the M1 (the zoom bench, PetWorld and
  CellPack, gpuCulling forced on vs off at 1 / 0.1 / 0.02), then extend master's rule by the measured condition; the
  skipped test re-enabled, adapted to the merged rule (not weakened); a test for the no-raster case failing first.
- **Item 2 of the rework list** (CPU culling by instance on WebGL2) only if the measurement shows WebGL2 needs it; the
  coordinator's bench shows WebGL2 equal or better after the merge (PetWorld 33.1 / 83.7 / 73.1 -> 29.2 / 74.1 / 50.4;
  CellPack 9.7 / 73.7 / 40.9 -> 9.0 / 68.3 / 36.2). If not needed: the numbers recorded, dropping recommended, its tests
  left skipped with a note.
- **Stays off**: the merged-culler / cell-cull kernels (lane `webgpu-zoom-regression`).
- **Done when**: PetWorld on WebGPU without the raster GPU-culled by auto where faster (numbers before/after in the PR),
  CellPack unchanged, one rule in one place, documented in `.v6/plans/gl/merged-render-objects.md` and
  `.v6/changelogs/no-raster-auto.md`; `npx tsc -b`, `npx tsc --noEmit -p apps/prism-me`, `pnpm lint`,
  `pnpm format:check`, `pnpm check:workspace`, vitest for the packages touched. Size < 60 production lines.
- **Models**: benches and checks to Sonnet subagents; design to Opus. Then the review gate (lane-reviewer,
  lane-skeptic), push, PR.

## Measured (step 1, before code)

The zoom bench (`zoomcmp/bench.mjs`, copied to the lane's scratch dir; headless Chrome 156, Metal, canvas 448x400 at
pixel scale 0.5, PetWorld and CellPack at the coordinator's cameras, the others at their own), every run in the shared
bench lock, one case each; `gpuCulling` forced by a bench-only hook (`globalThis.__forceGpuCulling` read in
`resolveGpuCulling`, never committed). Device: Apple M1 Pro, `atomic-vec2u-min-max` absent (no raster). Load average 3
to 11 (the other lane benching; each run's in its file). WebGPU, ms a frame at 1 / 0.1 / 0.02 of the camera's distance:

| model (objects, instances, spheres) | per draw | CPU culled (off)   | GPU culled (on)    |
| ----------------------------------- | -------- | ------------------ | ------------------ |
| PetWorld HIV (19, 16,035, 37.7M)    | 211      | 25.2 / 71.1 / 47.4 | 17.1 / 34.8 / 30.9 |
| T7 phage (23, 5,810, 18.5M)         | 63       | 6.3 / 42.2 / 31.6  | 6.2 / 36.5 / 26.3  |
| SARS-CoV-2 (8, 696, 13.5M)          | 22       | 13.8 / 28.5 / 22.9 | 13.5 / 24.8 / 19.4 |
| Flagellar motor (17, 258, 0.74M)    | 4        | 7.0 / 8.7 / 5.7    | 6.9 / 8.6 / 5.4    |
| CellPack HIV (68, 229k, 33.7M)      | -        | 6.9 / 63.9 / 32.9  | 4.8 / 25.0 / 16.2  |

(spheres: instances times `uVertexCount`, what master's rule counts; per draw: instances / objects x 4 levels.) GPU
culling never lost without the raster. Synaptic vesicle failed to download (dropped).

## Decided

- **The rule** (Opus, advisor consulted): master's expression kept, its 20k-instance floor waived from 1M spheres
  (`AutoGpuCullingMinSpheres`) with `AutoGpuCullingThreshold` (30) per draw still asked; master's raster rule untouched
  (100k spheres, raster only). One function, one expression:
  `raster && spheres >= 100k || perDraw && (instances >= 20k || spheres >= 1M)`. Why per draw and not prism-me's 30
  instances in all: a PDB entry's units are one instance an object (3J3Q, 1356 units), where master measured GPU culling
  without the raster a little slower; per draw keeps them on the CPU. Cost: SARS-CoV-2 (22 a draw) stays on the CPU
  though GPU culling is 13 % faster there at 0.1 (left open: a lower ratio would be a new constant, not measured on PDB
  entries). Why 1M: above the 60-copy 7qpd assembly (0.69M as spacefill, kept on the CPU by the spec), below every
  mesoscale model that gained (13.5M and up).
- **The skipped test** re-enabled, adapted: its three boundaries kept (at the threshold, one below, a lone large
  object); "30 instances" became 30 per draw (30 x 76 for PetWorld's 19 objects x 4 levels). Master's raster test calls
  the raster now, plus a case that 100k spheres without it is not enough.
- **Particle targets' signatures** count the spheres of structure targets: without them the programs prepared ahead for
  PetWorld were the CPU-culled ones (the raster rule had the same gap).
- **Item 2 (CPU culling by instance, WebGL2) not built**: WebGL2 after the merge 28.4 / 73.7 / 49.6 (PetWorld), 9.1 /
  67.1 / 35.3 (CellPack), against 33.1 / 83.7 / 73.1 and 9.7 / 73.7 / 40.9 before it. Recommend dropping it; its tests
  stay skipped with the numbers (`cull-segment.test.ts`).

## After (auto, WebGPU unless said)

| model            | before (auto)                     | after (auto)       |
| ---------------- | --------------------------------- | ------------------ |
| PetWorld HIV     | 25.2 / 71.0 / 47.4                | 17.2 / 34.9 / 30.9 |
| T7 phage         | 6.3 / 42.2 / 31.6                 | 6.3 / 36.6 / 25.4  |
| SARS-CoV-2       | 13.8 / 28.5 / 22.9                | 13.9 / 28.6 / 22.9 |
| CellPack HIV     | 4.7 / 25.1 / 16.2                 | 4.8 / 25.2 / 16.2  |
| PetWorld, WebGL2 | (29.2 / 74.1 / 50.4, coordinator) | 28.4 / 73.7 / 49.6 |
| CellPack, WebGL2 | (9.0 / 68.3 / 36.2, coordinator)  | 9.1 / 67.1 / 35.3  |

(before for T7 and SARS: the forced-off runs, which is what auto did.) PetWorld at 0.1 is still slower than before the
merge (21.6, coordinator): that is the GPU culler's own zoom cost, lane `webgpu-zoom-regression`.
