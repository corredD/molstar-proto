# Lane `volume-neural` (library + offline tools): the neural volume shader, parts B and C (2026-11-02)

Branch `me/volume-neural` from c1b8ecb82. This file is untracked; the coordinator copies it into prism-me's progress
folder at close. Keep its sections up to date.

## Scope of this lane (coordinator, 2026-11-02)

Ludo, 2026-11-02: "do now the parked plan with many lanes... Expert coding, efficient and optimized. No repetition with
existing code. Go independent."

- **Part B now** (independent): `tools/volume-lighting/` only (Python, not shipped): B1 the PyTorch reference tracer
  (`~/miniforge3/bin/python`, torch 2.5.1, MPS), checked against the closed form; Mitsuba 3 in its own conda env
  `volume-lighting` as a second reference
  (`~/miniforge3/bin/conda create -y -n volume-lighting python=3.11 mitsuba numpy mrcfile` plus torch if needed; Ludo
  allowed it, 2026-11-02). B2 the data: EMDB maps downloaded into `~/molstar-prism-me/.me-data/volume-lighting/`
  (gitignored, never committed; keep the total under ~2 GB), and portal 10003 TS_08 tomogram subvolumes (from its zarr
  level 1 or 2; plain GET, no Range header).
- **Part C after lane `volume-lighting` freezes A2** (the descriptor layout: its LANE.md "Decided" section in
  `~/prism-me-lanes/volume-lighting/LANE.md` and `.v6/plans/gl/volume-lighting.md` on `origin/me/volume-lighting`). Then
  `git merge origin/me/volume-lighting` (merge, never rebase; again whenever it moves) and build C1–C5 on top: the
  descriptors your Python computes must be bit-for-bit the shader's (same levels, same sampling, same units); write a
  test that checks a few against a Dawn readback of the shader's. While waiting, build B against the plan's A2 layout
  and make the descriptor code one function you swap.
- **Gate C:** `neural` ships only if it beats `volumetric` visibly on held-out maps (the post's two numbers). If it does
  not, the PR still lands B (tools) and C's code behind the `'neural'` option marked experimental, with the numbers, and
  says so plainly. Never tune on held-out maps.
- Your PR is stacked: base `me/volume-lighting` until that merges, then `prism-me`.

## The plan (Ludo's, written 2026-11-02; Parts B and C are yours)

## Brief

- **Asked** (Ludo, 2026-11-02): "could we do something like https://charlesgrassi.dev/blog/neural-volumetric-clouds/ in
  WebGPU, and use it for volume rendering interactively or other interesting effect?"; "show me the brief first, and all
  the steps, the neural shader and then the integration with illumination." **Check:** load an EMDB map and a tomogram
  in prism-me on WebGPU, direct volume; switch `lighting` from `local` (today) to `volumetric` then `neural`: dense
  regions shadow themselves and light passes through thin ones, the camera turns interactively (frame times in the PR).
  Turn illumination on: the molecules inside or behind the volume are darkened by it, and the volume's light matches the
  scene's.
- **Spec:** new `.v6/plans/gl/volume-lighting.md` (the pyramid, the descriptors, the network, its training, the
  illumination coupling); `direct-volume-quality.md` gains the `lighting` param; changelog
  `.v6/changelogs/volume-lighting.md`.
- **Tests:** below per step; images on Dawn (`pnpm native:install -- --webgpu`, then
  `NODE_PATH=.cache/native/node_modules`), numbers against a reference, and `lighting: 'local'` gives the image of today
  (0 pixels differ).
- **Touches:** `packages/graphics`: `geo/geometry/direct-volume/direct-volume.ts` (params, 601 lines),
  `gl/webgpu/shader/direct-volume.wgsl.ts` (572), a new compute kernel for the pyramid, `canvas3d/passes/tracing.ts`
  (541) and `gl/webgpu/shader/illumination.wgsl.ts` (567, its shadow rays at :226); a new `tools/volume-lighting/`
  (Python: reference tracer, sampling, training; not shipped). **Stays off:** the culling files (`merged-culler.ts`,
  `cell-cull*`) and whatever the turning-cost lane takes, if started.
- **Base and delivery** (Ludo, 2026-11-02: "base branch is master, but I want to have it in prism-me"): a library lane,
  `me/volume-lighting`, from the master commit prism-me last merged (`git merge-base origin/prism-me upstream/master`;
  c1b8ecb82 at #36), so the branch holds master plus the lane's commits only. Each part's PR goes to the fork's
  `prism-me` (`gh pr create -R corredD/molstar-proto --base prism-me`): prism-me already contains that master, so the PR
  brings only the lane's commits. The same branch goes upstream (a PR to molstar/molstar `master`) only on Ludo's word.
  Where master moves on, the lane merges `upstream/master` (never a rebase) after prism-me's own master merge, so a PR
  into prism-me never carries master commits prism-me lacks. The lane changes `packages/` only; prism-me's own wiring (a
  `lighting` choice in its volume controls and looks) is a small prism-me lane after part A lands.
- **Size:** ~900 production lines over the 4 parts (A ~350, C ~150, D1–D2 ~150, D3 ~250), plus ~600 lines of Python
  tooling. WebGPU first; WebGL2 in a later step (the weights in a data texture).
- **Steps and models:** design, shaders and every review Opus; data generation runs, benches and checks Sonnet. A gate
  (reviewer, skeptic) at the end of each part, one PR per part (A, B+C, D) so each can stop there.

## Part A: plain volumetric lighting (no network)

A1. **Opacity pyramid** (compute kernel, WGSL): after the transfer function, the extinction per voxel σ = −ln(1 − α) /
step, then a mip chain of means (each level the mean of its 8 children), one `r16float` 3D texture with mip levels.
Rebuilt when the volume or the transfer function changes, not per frame. Test: the kernel's levels against a TypeScript
reference on a random 32³ grid (mean of children, exact to f16). A2. **Descriptors per ray-march step:** 6 mean
extinctions around the point at radii r_i = voxel · 2^i (pyramid level i), 6 along the light at p + l · r_i, the cosine
of view and light: 12 texture reads, independent of each other. Test: the descriptors of a uniform grid equal its σ at
every level; of a half-filled grid, the expected ramp. A3. **Plain shading** (`lighting: 'volumetric'`): transmittance
to the light from the 6 light-side reads (cone marching: exp(−Σ σ_i · r_i)), ambient occlusion from the 6 around, times
the transfer function's color; the gradient Phong stays for `local`. Tests: `local` = today's image (0 pixels, Dawn); a
dense cube in front of a thin slab along the light darkens the slab's side behind it and not the other. A4. **Measure**
on the M1 and on Ludo's workstation (Quadro RTX 8000, over VPN and Remote Desktop: a prompt for its Claude, as for the
#2061 raster), a 256³ map and a 512³ tomogram at 1080p: frame time of `local` / `volumetric`, the pyramid build time.
**Gate:** if `volumetric` costs more than about +50 % a frame, stop and report before B.

## Part B: reference and training data (offline, Python)

B1. **Reference tracer** in PyTorch (Metal on the M1, CUDA on the workstation): delta tracking through the same
extinction grid, single and multiple scattering, a Henyey-Greenstein phase with g as a parameter, one key light and an
ambient term. ~300 lines, no renderer dependency. PyTorch is installed: `~/miniforge3/bin/python` (torch 2.5.1, MPS
available). Mitsuba 3 may be installed (Ludo, 2026-11-02), in its own conda env (`volume-lighting`), as a second
reference to check ours against (`volpath` integrator, heterogeneous `gridvolume`). B2. **Data:** 6–10 EMDB maps of
different kinds (ribosome, virus capsid, filaments, membrane), 2 tomogram subvolumes, each under ~20 random transfer
functions and light directions, albedo in [0.3, 0.95]. Points sampled where camera rays first meet density (the post's
lesson: 0.34 → 0.70 accuracy in bright regions). A few hundred thousand (descriptors, reference in-scatter) pairs; 2–3
maps held out, never trained on. Test: the tracer's single scattering on a homogeneous slab against the closed form
(within 1 %).

## Part C: the neural shader

C1. **Network:** inputs the 13 descriptors of A2 plus albedo (14); 14 → 16 → 16 → 2, squared ReLU (max(x, 0)²) as in the
post; outputs the key-light and the ambient in-scatter, squared then clamped, multiplied by the transfer function's
color in the shader. About 560 weights: 2.3 KB in one uniform buffer, inputs normalized by a mean and scale stored with
them. C2. **Training** in PyTorch on B2's pairs, a relative loss (no cube root: in the post it "cost half the light");
export the weights to a JSON next to the shader source, versioned with it. C3. **WGSL inference** (`lighting: 'neural'`)
at each ray-march step, replacing A3's two terms; f32, and f16 where the device has `shader-f16`. Tests: the WGSL
network against the TypeScript one on 1,000 random inputs (Dawn compute: within 1e-4 in f32, 1e-2 in f16); `local`
unchanged (0 pixels). C4. **Quality** on the held-out maps against the reference renders: the post's two numbers (mean
brightness ratio, 1.0 = exact, over a light sweep of 0 to 180°; RMSE), for `volumetric` and `neural`. **Gate:** `neural`
ships only if it beats `volumetric` visibly on held-out maps (the post's network was scored on the cloud it was trained
on; we do not). C5. **Measure** as A4, with `neural`.

## Done

Checks: `npx tsc -b`, `pnpm lint`, `pnpm format:check`, `pnpm check:workspace`, `pnpm test:unit packages/graphics`
(Dawn: `NODE_PATH=.cache/native/node_modules`); the Python tools' own tests (`pytest` in the env). Gate (lane-reviewer +
lane-skeptic). PR `gh pr create -R corredD/molstar-proto --base me/volume-lighting` (or `prism-me` once that merged)
with the quality numbers and images.

## Built

**PR:** https://github.com/corredD/molstar-proto/pull/42 (stacked on `me/volume-lighting`; retarget to `prism-me` once
that merges). Status (2026-11-03): review gate done; `neural` stays "(experimental)" until Ludo signs off (Gate C run 2
passes, after a post-hoc harness fix). Open: f16 network, WebGL2, prism-me's `lighting` control.

- **B1** `tools/volume-lighting/vl/` (70ae7934b, 0882ff338, 3fb2fcbce, 0902f0072): the tracer (`tracer.py`), the grid,
  transfer function and pyramid as §A1 (`grid.py`), §A2's descriptors (`descriptors.py`), the shader's march and the
  path-traced image (`render.py`); `pytest` (`~/miniforge3/bin/python -m pytest tools/volume-lighting/tests`, 19 tests):
  the slab's closed forms within 1 %, loose majorants on a gradient, Mitsuba 3 volpath (conda env `volume-lighting`,
  `metal_ad_mono`): mean ratio 0.997, 4×4 blocks median 0.5 %.
- **B2** `make_data.py`, `vl/data.py` (6d524ef40): 8 EMDB maps (2660, 8107, 6000, 11638, 0013, 50941, 5778, 3534) and 2
  TS_08 subvolumes in `~/molstar-prism-me/.me-data/volume-lighting/` (1.5 GB maps, 27 MB pairs, `manifest.json`); 387k
  pairs, 1024 paths each (median relative noise: key 2–3 %, ambient 1–2 %), ~40 min on the M1's CPU.
- **C1–C2** `vl/net.py`, `train.py` (0712c7e42; retrained in 794c0910b on the data made again with peaks of α up to
  0.99, 387k → 380k pairs): validation (every 10th configuration of the 7 training maps): key median relative error 14.9
  % (volumetric 43.0 %), ambient 6.2 % (16.0 %); brightness ratios key 0.901 (0.756), ambient 0.979 (1.120). 6 s to
  train on the CPU; lr, batch and epoch sweeps land at val 0.097–0.103 (capacity).
- **C3** (fe91569e5, 21daf6301, 495c7ba25): `lighting: 'neural'` (param "Neural (experimental)"), the WGSL generated
  from `shader/_generated/volume-neural-weights.ts`, inputs clamped to the training range; Dawn tests: descriptors vs
  Python (24 samples within the filter bound), WGSL vs TypeScript network (1,000 inputs of the training range, 1e-4),
  the slab-and-cube shadow (softer than volumetric's), traced molecules shadowed by a neural volume.
- **C5** `neural` +60–70 % a frame over `volumetric` at 1080p on the M1 (map-256 3.56 → 5.74 ms; deep tomogram 8.40 →
  14.2 ms), `volume-lighting.md` §C5.
- **C4** `gate_c.py` (Gate C, `volume-lighting.md` §C): run 2 passes the criterion on the 3 held-out maps (relative RMSE
  neural / volumetric 0.311 / 0.675, 0.659 / 1.439, 0.692 / 1.053; mean |ratio − 1| 0.060 / 0.265, 0.130 / 0.292, 0.037
  / 0.308). Run 1 (first network, box-filtered reference) failed the tomogram's RMSE margin. Images: branch
  `me/volume-neural-images` of the fork.

## Decided

A1/A2 frozen by lane `volume-lighting` (2026-11-02, `.v6/plans/gl/volume-lighting.md` §A1–A3, merged f886941d5); the
tools follow them (3fb2fcbce).

- **Units** (frozen §A1): lengths in cells, cell j spans [j, j + 1) with its value at j + 0.5; grid values on bytes
  (`rgba8unorm`), the transfer function its 256 bytes filtered at v · 256 − 0.5, then σ = −ln(1 − min(α, 0.999)) per
  cell (`grid.tf_alpha`, `grid.sigma_from_alpha`), classified after filtering.
- **Descriptors** (frozen §A2): `S_0` σ of the trilinear value (the tracer's field, `Medium.sigma`), `S_1..5` the f16
  pyramid levels (level 1 the f32 mean of 2³ cells' σ, padded with zeros to ceil(dim / 32) · 16), trilinear, every read
  0 outside [0, dim]; `[around 0..5, light 0..5, cosine]`, `cosine = dot(d, L)`. Grids in Mol*'s x, y, z (mrcfile's z,
  y, x transposed once in `grid.load_map`).
- **Not bit-for-bit** (Opus, 2026-11-02): §A2 reads levels 1–5 with `textureSampleLevel` (hardware filtering, its
  weights' fixed-point precision is the implementation's); the Python reads them in f32 weights. C's Dawn readback test
  bounds the difference by the filter's precision and says so; it cannot be 0.
- **Phase** (Opus): one Henyey-Greenstein g for everything, `G = 0.3` (`vl/config.py`): the network has no g input, so a
  varied g would give the same inputs different targets. The key channel's phase is normalized to 1 on average over the
  sphere (4π·p), so isotropic single scattering is the plain transmittance, as A3's shading.
- **Targets** (Opus): S_key, S_amb = in-scatter at p towards the camera (all orders; p's own albedo excluded, the shader
  multiplies by the TF color), key light irradiance 1 (directional), sky radiance 1. Points at the first collision of
  delta-tracked camera rays.
- **Tracker** (Opus): brick majorants (8³ voxels, bound on σ over the brick's trilinear value range), DDA between
  bricks; delta tracking for scattering, ratio tracking for next-event transmittance; Russian roulette after 4 bounces.
- **Loss** (Opus): relative L2 with denominator (stopgrad(pred) + y) / 2 + ε, never the noisy target alone.
- **Gate C criterion** (Opus, 2026-11-02, written before any result): on each held-out map, 2 transfer functions drawn
  with a seed no training run uses, the camera fixed, the light swept 0–180° from the camera's side to behind (7
  angles), 96² images at Mol*'s defaults (key 0.6, ambient 0.4, 2 steps per cell, samples under α 0.01 per cell unlit as
  in the shader). Numbers per method against the path-traced reference: the mean brightness ratio (1 = exact) and the
  relative RMSE (RMSE over the reference's mean), each over the sweep, and the reference's own noise floor. `neural`
  ships (not experimental) only if, on every held-out map, its relative RMSE is at least 20 % below `volumetric`'s and
  its mean |ratio − 1| is lower.
- **Gate C run 1 and the harness fix** (Opus, 2026-11-02, after run 1): run 1's reference jittered its camera rays over
  each pixel (a box filter) while the march cast one ray per pixel center, as the shader: the per-pixel RMSE measured
  aliasing for both methods (the skeptic's volumetric-only probe: relative RMSE centers vs box-filtered 0.12–0.41 on the
  maps, 1.1–1.8 on the tomogram, means unaffected). Fixed: the reference casts the pixel centers (`jitter` off;
  Mitsuba's check keeps the box filter); the march stops at T < 0.05 as the shader. The criterion is unchanged; run 1 is
  kept and reported (`neural` passed on the two maps, failed the RMSE margin on the tomogram).
- **Dense transfer functions** (review finding 1, 2026-11-02): run 1's network extrapolated past its training range
  (peak α 0.6) to its output clamp (4) on dense regions. Fixed by widening the training peaks to 0.99, clamping the
  inputs to the training range and the outputs per channel (key 3, ambient 1), with a test; the data, the network and
  Gate C are made again (run 2), so run 1's numbers describe the first network only.
- **Pre-integration** (Opus): Gate C's march classifies each sample by the transfer function at its value, as the shader
  with `preIntegration: false`; the default is on (`transferSegment`). Both methods share the march, so the comparison
  holds; the absolute numbers are those of `preIntegration: false`.
- **No f16 network** (Opus, 2026-11-03): the brief's C3 asks for f16 where the device has `shader-f16`. The render
  programs take no `enable` directive (only compute strips them, `compute.ts`), so f16 needs a source variant per device
  feature with its program-cache key: shared WebGPU work beyond this lane's size. Left open (TODO), with the cost it
  would cut: `neural` +60–70 % a frame over `volumetric` on the M1.
- **Held-out** (Opus, written before any data is made): the second capsid (`capsid_large`), the membrane map and
  tomogram subvolume `b`. Hyperparameters are chosen on a validation split of the training maps only.

## Learned

- The wavefront tracer is ~450x faster on the M1's CPU than on MPS (each small op waits on the GPU there).
- Block-mean downsampling lowers a map's peaks: the EMDB contour does not survive it; thresholds by occupied fraction.
- A NaN in 6 of 40,000 pairs: u = 0 gives a free flight of 0, a collision in an empty brick (0 / 0).
- Python's `hash(str)` is randomized per process: the data's seeds use crc32.
- The GPU's pyramid differs from numpy's by up to an f16 ulp per level (2 ulps at level 5 of the fixture): §A2's
  descriptors match the Python's within a bound (filter weights of 8 bits, an ulp per level), not bit for bit.
- Biome reformats a generated JSON literal into JS: generated files go in `_generated/` (ignored by Biome).
- At albedo 0.95 (a white color) a dense cube shadows less in `neural` than in `volumetric` (multiple scattering).

## Size

- Production (`packages/`, without tests and the generated weights): ~184 lines against C's ~150: the WGSL generator and
  its TypeScript reference (131), the shader's neural chunk and wiring (~50), the trace's neural check.
- `tools/volume-lighting/`: ~1,500 lines with tests against ~600: the tests (closed forms, Mitsuba, ~350), Gate C's
  harness and the Dawn fixture (~300) took the room.
- Generated: the weights module (~170 lines), the descriptor fixture (one line of JSON).

## Review

| Finding                                                 | Severity   | Verdict              | Commit / open                                                     |
| ------------------------------------------------------- | ---------- | -------------------- | ----------------------------------------------------------------- |
| 1 dense TFs glow (network past its training range)      | must-fix   | confirmed            | 794c0910b (test: dense block, 4 → < 0.1)                          |
| 2 specs uncommitted                                     | must-fix   | confirmed            | 8211eae0a (§B, §C), 62a8156e2                                     |
| 3 no own changelog                                      | must-fix   | confirmed            | 62a8156e2 (`.v6/changelogs/volume-neural.md`)                     |
| 4 network tests' inputs saturate                        | should-fix | partly confirmed     | 794c0910b (check from validation), 21daf6301                      |
| 5 drawn test can't tell neural from volumetric          | should-fix | confirmed            | 21daf6301, 495c7ba25 (neural > volumetric + 0.05)                 |
| 6 Gate C marches past the shader's stop                 | should-fix | confirmed            | f8a3d4126 (cutoff 0.05), test 28e61e011                           |
| 7 Gate C ignores pre-integration                        | should-fix | plausible            | recorded (Decided, §C4: `preIntegration: false`'s classification) |
| 8 f16 neither built nor dropped                         | should-fix | confirmed            | recorded as open (Decided, §C5), 62a8156e2                        |
| 9 weights test checks 20                                | nit        | confirmed            | 21daf6301                                                         |
| 10 make_data defaults                                   | nit        | confirmed            | 917df6fec                                                         |
| 11 stale pyramid comment                                | nit        | confirmed            | 917df6fec                                                         |
| 12 no neural preprocess case                            | nit        | confirmed            | 21daf6301                                                         |
| 13 gate_c writes a .tmp in the repo                     | nit        | confirmed            | f8a3d4126                                                         |
| 14 test count 18 vs 17                                  | nit        | confirmed            | LANE.md                                                           |
| J Gate C reference box-filtered, march at pixel centers | (author)   | skeptic: holds       | f8a3d4126; run 2, test 28e61e011                                  |
| N1 weights format vs TS/WGSL                            | must-fix   | confirmed (worktree) | 794c0910b                                                         |
| N2 gate_c can't load old weights                        | should-fix | confirmed            | 794c0910b (retrained)                                             |
| N3 data and numbers stale after TF widening             | should-fix | confirmed            | data made again, run 2                                            |
| N4 §C "clamped to 4", placeholders                      | nit        | confirmed            | 62a8156e2                                                         |
| (author) neural volumes did not shadow traced molecules | should-fix | test failed first    | 495c7ba25                                                         |
