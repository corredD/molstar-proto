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
