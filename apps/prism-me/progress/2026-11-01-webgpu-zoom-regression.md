# WebGPU zoomed frames slower after the master merge (2026-11-01, lane `webgpu-zoom-regression`)

## Brief

- **Asked** (coordinator, for Ludo): WebGPU zoomed-in frames are 1.3–3.3× slower after the merge of master (#2061) into
  prism-me, although fewer spheres are drawn. Find why, and recover it on top of master's design (Ludo: "favor master
  first, rework on top if relevant; no duplication"). Branch `me/webgpu-zoom-regression` from `origin/me/merge-master`
  (b20714a90); the PR goes to `me/merge-master`.
- **Measured by the coordinator** (M1 Pro, Chrome 156, no `atomic-vec2u-min-max`: the sphere raster never runs; still
  camera, batches of 20 frames, median of 7, camera at 1 / 0.1 / 0.02 of its distance; 3 reps, ms a frame). E = prism-me
  before the merge (00da9d6c8), F = merged (b20714a90):
  - CellPack HIV, WebGPU: E 8.4 / 11.0 / 12.8, F 4.8 / 25.1 / 16.2.
  - PetWorld HIV, WebGPU: E 24.8 / 21.6 / 41.9, F 25.4 / 71.1 / 47.5. PetWorld (19 objects) is CPU-culled on WebGPU in
    F (master's `gpuCulling` auto rule); that rule is lane `no-raster-auto`'s. Here `gpuCulling: 'on'` is forced to
    separate the causes; the auto rule is not changed.
  - WebGL2 is better or equal after the merge: the regression is WebGPU's.
- **Method**: measure first, by toggles (`hiZ.twoPhase`, `hiZ.gpu`, `gpuCulling`, clip culling, raster) and GPU timing
  where available, before building. Candidates (merge-master's rework list): clusters per instance (item 4), Morton
  order (5), the rectangle clamp with the cap test (6), the coarse level's padding (3); or something else in master's
  two-phase path. Rebuild only what the measurement shows, on master's API, re-enabling the matching skipped tests. A
  defect in master's own code: said so, with a minimal reproduction, one commit of its own (upstreamable).
- **Done when**: CellPack and PetWorld (`gpuCulling: 'on'`) WebGPU zoomed frames at least E's, or what costs what shown
  and why it can't; CellPack's whole-view gain (4.8 ms) kept; WebGL2 unchanged; tests failing first; the checks pass;
  changelog `.v6/changelogs/webgpu-zoom-regression.md`. Size: unknown until measured.
- **Models**: benches and checks to Sonnet subagents; diagnosis, design, hot-path code with Opus.
- **Benches** share the M1 with lane `no-raster-auto`: every timing run inside the shared lock
  (`scratchpad/bench.lock`), one case at a time, with the load (`vm.loadavg`) noted.

## Step 1: measured before code

Bench: the coordinator's `bench.mjs` (copied, with `--props` for `canvas3d.setProps`, `--gpuCulling` set on the
representations, screenshots), still camera, 7 batches of 20 frames, M1 Pro, headless Chrome, dpr 1, 896×800, the
cameras `cam-cellpack.json` / `cam-petworld.json`; each run in the shared lock (load 3–7). ms a frame at 1 / 0.1 / 0.02.

- **GPU timestamps are of no use here**: on the M1 every pass reads about the frame's time (timing mode): toggles only.
- **Toggles on F (merged), CellPack HIV** (at the app's own camera, a valid A/B): `hiZ.twoPhase` off 4.6 / 26.2 / 15.7
  (on 4.5 / 26.4 / 15.7): the two phases cost nothing still. `hiZ.gpu` off (no occlusion) F 7.2 / 55.6 / 29.8, E 8.0 /
  61.5 / 34.2: F draws as much or less without occlusion; **the regression is how much the occlusion test culls**.
- **The cause: master's `occluded()` never occludes a sphere whose rectangle reaches past the pyramid's view** (`x0 < 0
  || ... return false`). Zoomed in, that is a large share of what is behind the front. prism-me's #28 clamped the
  rectangle to the view (with a cap test for a pyramid of another view: rework item 6). Experiment in master's WGSL
  (clamp to the view always, at the brief's cameras):

| model, case                                  | 1    | 0.1  | 0.02 |
| -------------------------------------------- | ---- | ---- | ---- |
| CellPack, E (before the merge, coordinator)  | 8.4  | 11.0 | 12.8 |
| CellPack, F (master's test)                  | 4.8  | 25.1 | 16.2 |
| CellPack, F, rectangle clamped               | 4.8  | 7.6  | 7.7  |
| CellPack, F, no occlusion (`hiZ.gpu` off)    | 7.0  | 56.3 | 28.7 |
| PetWorld (`gpuCulling: true`), F             | 17.1 | 34.8 | 31.1 |
| PetWorld (`gpuCulling: true`), F, clamped    | 17.1 | 12.8 | 20.0 |
| PetWorld (`gpuCulling: true`), F, no occl.   | 24.3 | 60.1 | 39.6 |
| PetWorld, E (coordinator)                    | 24.8 | 21.6 | 41.9 |

- **Images**: at all three distances, both models, no pixel differs (> 24 levels) between master's test, the clamped
  one and no occlusion (still camera).
- **Reading a level finer** (#28's up to 4×4 texels instead of master's 2×2): 26.5 vs 26.4 unclamped, 9.6 vs 9.8 clamped
  (CellPack, the app's camera): too small to rebuild.
- So with the clamp both models are well below E zoomed; clusters (rework 4), Morton (5) and the padding (3) are not
  needed for this regression.
- **Why the clamp is exact where the pyramid is of the culled view**: what lies outside the view is not visible, so
  only the texels inside it matter. That holds for the second phase (its pyramid is of the frame's own camera) and for
  still frames (master stops culling only after two rounds against a pyramid of the same camera). In a first phase
  against another view's pyramid a part beyond that view may show now (the skipped test "also where its rectangle
  reaches past the view").
- Pitfall noted: zsh does not split `$VAR` into words: a bench line `node bench.mjs $ARGS` in zsh gets one argument
  (the model and camera silently default). Batches run as bash scripts.
