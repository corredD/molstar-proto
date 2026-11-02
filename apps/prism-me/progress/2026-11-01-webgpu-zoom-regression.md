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
  - PetWorld HIV, WebGPU: E 24.8 / 21.6 / 41.9, F 25.4 / 71.1 / 47.5. PetWorld (19 objects) is CPU-culled on WebGPU in F
    (master's `gpuCulling` auto rule); that rule is lane `no-raster-auto`'s. Here `gpuCulling: 'on'` is forced to
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
- **The cause: master's `occluded()` never occludes a sphere whose rectangle reaches past the pyramid's view**
  (`x0 < 0 || ... return false`). Zoomed in, that is a large share of what is behind the front. prism-me's #28 clamped
  the rectangle to the view (with a cap test for a pyramid of another view: rework item 6). Experiment in master's WGSL
  (clamp to the view always, at the brief's cameras):

| model, case                                 | 1    | 0.1  | 0.02 |
| ------------------------------------------- | ---- | ---- | ---- |
| CellPack, E (before the merge, coordinator) | 8.4  | 11.0 | 12.8 |
| CellPack, F (master's test)                 | 4.8  | 25.1 | 16.2 |
| CellPack, F, rectangle clamped              | 4.8  | 7.6  | 7.7  |
| CellPack, F, no occlusion (`hiZ.gpu` off)   | 7.0  | 56.3 | 28.7 |
| PetWorld (`gpuCulling: true`), F            | 17.1 | 34.8 | 31.1 |
| PetWorld (`gpuCulling: true`), F, clamped   | 17.1 | 12.8 | 20.0 |
| PetWorld (`gpuCulling: true`), F, no occl.  | 24.3 | 60.1 | 39.6 |
| PetWorld, E (coordinator)                   | 24.8 | 21.6 | 41.9 |

- **Images**: at all three distances, both models, no pixel differs (> 24 levels) between master's test, the clamped one
  and no occlusion (still camera).
- **Reading a level finer** (#28's up to 4×4 texels instead of master's 2×2): 26.5 vs 26.4 unclamped, 9.6 vs 9.8 clamped
  (CellPack, the app's camera): too small to rebuild.
- So with the clamp both models are well below E zoomed; clusters (rework 4), Morton (5) and the padding (3) are not
  needed for this regression.
- **Why the clamp is exact where the pyramid is of the culled view**: what lies outside the view is not visible, so only
  the texels inside it matter. That holds for the second phase (its pyramid is of the frame's own camera) and for still
  frames (master stops culling only after two rounds against a pyramid of the same camera). In a first phase against
  another view's pyramid a part beyond that view may show now (the skipped test "also where its rectangle reaches past
  the view").
- Pitfall noted: zsh does not split `$VAR` into words: a bench line `node bench.mjs $ARGS` in zsh gets one argument (the
  model and camera silently default). Batches run as bash scripts.

(Step 1's sentence "F draws fewer spheres" of the brief: the bench's sphere counts are its CPU estimate per instance by
the frustum and levels, not what the GPU drew; F drew more, its occlusion culling less. Clip culling and the raster were
not toggled: the clamp alone explains the regression and puts both models below E.)

## Step 2: the clamp, built on master's `occluded()`

- **Test first**: prism-me's skipped "occlusion culls what is hidden also where its rectangle reaches past the view"
  re-enabled: on the merge it fails (20 hidden instances of the grid behind drawn, 0 expected).
- **First built**: #28's cap test (clamped where no part of the sphere beyond the pyramid's frustum is in view; the
  pyramid's planes as uniforms), 6f7305d78. Passes the test. But with one phase (`hiZ.twoPhase` off) it loses pixels a
  turn reveals by parallax among spheres that reach past the view, which zoomed in is nearly all of them (PetWorld at
  0.02, 3 frames of 2°: 13,173 of 716,800 pixels; 94 still missing at rest after; master 0).
- **Kept**: clamped only where the pyramid is of the view culled for (its frustum's planes the culled ones: the second
  phase, a still camera; `uHiZClamp`, set by the culler), 9cfe6151e. Exact with one phase and two (no pixel differs from
  no occlusion, still or after 3 turning frames, both models, at 1, 0.1, 0.02; master's own one-phase lag on CellPack,
  up to 1,290 pixels, unchanged). Turning 1° a frame it costs little against the cap test (CellPack 0.1 / 0.02 20.9 /
  12.6 against 19.0 / 12.2 ms), no cap math and no plane uniforms.
- **The sphere raster** includes the same `occluded()`: its `hiZClampable()` is false (master's rule; one phase for
  unmerged objects, and its kernels never compile on this M1, so left unchanged).
- **Upstreamable**: master's own defect (a performance gap, not a wrong image): master never clamps although at the
  pyramid's own view (every second phase, every still frame) the clamp is exact. The patch:
  `git diff c146545a9 9cfe6151e -- packages/graphics packages/plugin/headless` (two commits, 6f7305d78 then 9cfe6151e
  over the same files; squashed for upstream). The test uses prism-me's `countInView` helper (not on master): it goes
  with the test.

## Results

Interleaved runs (F, G, E in turn, 3 reps; load 1–3), still camera, ms a frame at 1 / 0.1 / 0.02, medians; turning: 1° a
frame (`motion` on, as the app). E = prism-me before the merge (1366), F = `me/merge-master` 6d1833f2d (1365), G = this
lane (1367). PetWorld in F and G with `gpuCulling: true` (E merged it by #28's rule).

| model, WebGPU              | E still            | F still            | G still            | E turning          | F turning          | G turning          |
| -------------------------- | ------------------ | ------------------ | ------------------ | ------------------ | ------------------ | ------------------ |
| CellPack HIV               | 8.4 / 11.0 / 12.8  | 4.8 / 25.1 / 16.2  | 4.8 / 7.5 / 7.6    | 8.4 / 12.5 / 6.9   | 5.8 / 21.1 / 13.1  | 5.8 / 20.6 / 12.5  |
| PetWorld HIV (GPU culling) | 24.8 / 21.6 / 41.8 | 17.1 / 34.8 / 31.1 | 17.2 / 12.5 / 19.3 | 18.5 / 15.3 / 16.7 | 14.0 / 26.5 / 20.0 | 14.0 / 25.6 / 19.4 |

- PetWorld with `gpuCulling: 'auto'` (CPU cells on the M1, lane `no-raster-auto`): F 25.2 / 71.1 / 47.5, G 25.4 / 73.1 /
  49.0 (unchanged: not this code).
- WebGL2, CellPack, interleaved 3 × 2: F and G 8.7 / 67.6–67.8 / 35.4 (unchanged). (A non-interleaved matrix showed F
  10–20 % slower on WebGL2 too: machine state, load up to 40 from other work; discarded.)

## Open

- **Turning frames** stay at F's (CellPack 0.1 / 0.02 20.6 / 12.5 against E's 12.5 / 6.9; PetWorld 25.6 / 19.4 against
  15.3 / 16.7). Not this cause: the clamp barely changes them, the cap test gains 1–2 ms more. E's turning had one phase
  (not exact while moving) and clusters per instance (rework item 4); master's two phases cost while moving
  (`two-phase-culling.md`, "Where the cost goes"). A lane of its own if Ludo wants turning frames back: measure
  `twoPhase` off while moving, then clusters.
- **The CPU test** (`HiZPass.isOccluded`, `hiZ.enabled`, off by default) has the same edge rule; left as is.
- `merge-master.md`'s changelog line "No longer in prism-me: ... the occlusion test's rectangle clamped at the view's
  edges" holds no longer once this merges (the coordinator's file).
- Rework items 3 (padding), 5 (Morton) and 4 (clusters) not built: the still-frame regression needs none of them.

## Learned

- On the M1, WebGPU timestamps per pass read about the frame's time: no use for a breakdown; toggles are.
- zsh does not split `$ARGS`: a bench line in zsh got one argument and defaulted the model and camera silently.
- A non-interleaved bench matrix on a shared machine drifts 10–20 % between servers: interleave and note the load.
- The scratchpad lives in `/private/tmp`: a reboot wiped the bench; the cameras came back from E's own view (the
  CellPack one byte for byte).

## Size

Production: about 50 lines (WGSL 20, culler 35, schema 5), a test re-enabled, no new test file. The brief gave no size.
