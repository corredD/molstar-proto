# Lane `volume-lighting` (library): volumetric lighting in direct volumes, and volumes in illumination (2026-11-02)

Branch `me/volume-lighting` from c1b8ecb82. Library lane: packages/ (graphics) only, upstreamable. This file is
untracked; the coordinator copies it into prism-me's progress folder at close. Keep its sections up to date.

## Scope of this lane (coordinator, 2026-11-02)

Ludo, 2026-11-02: "do now the parked plan with many lanes... volume on top of cryoET so I will be able to test both at
the same time. Expert coding, efficient and optimized. No repetition with existing code. Go independent."

- This lane: **Part A** (A1 pyramid, A2 descriptors, A3 `lighting: 'volumetric'`, A4 measure on the M1) and **Part D
  D1–D2** (volumes shadow the molecules in illumination; one light), **D4** measured on the M1. D3 only as a measurement
  note (not built). The Quadro measurements: listed as open in the PR, never blocking.
- Parts B and C are lane `volume-neural` (`~/prism-me-lanes/volume-neural`, branch `me/volume-neural`): it needs your
  **A2 descriptor layout frozen early**: as soon as A2 is settled, write the layout (inputs, order, units, the pyramid
  levels, normalization) under "Decided" below AND in the spec `.v6/plans/gl/volume-lighting.md`, commit and push, so it
  can merge your branch. Keep a `lighting` param with room for `'neural'` (the neural lane adds it).
- **Gate A:** if `volumetric` costs more than ~+50 % a frame on the M1 (256³ map and a 512³-ish tomogram at 1080p), stop
  and report the numbers before D.
- **Test on a tomogram too**, not only EMDB maps: tomograms store dense matter dark; check the transfer function default
  does not make the whole box opaque (the volume from `~/molstar-prism-me/.me-data/maps/emd_1181.map` for a map; for a
  tomogram, the MRC binned from portal 10003 TS_08 if lane `cryoet-portal` has put one in
  `~/molstar-prism-me/.me-data/cryoet-10003/`, else make one: any 300-500³ MRC of a tomogram from the portal, e.g. the
  4x level is in its zarr; ask nobody, pick).
- **Reuse:** grep master's compute scaffolding first (`packages/graphics/src/gl/webgpu/compute.ts`, `mipmap.ts`, the
  cull and Hi-Z kernels `shader/cell-cull.wgsl.ts` and the Hi-Z pyramid of #2060/#2061) for dispatch, pipeline and
  mip-chain code before writing new ones. The existing direct-volume transfer-function texture and step logic stay the
  inputs; no second copy of the TF evaluation.
- WebGPU first. WebGL2: `lighting` falls back to `local` with no change to today's image (a test says so); a WebGL2
  version is a later step, noted open.

## The plan (Ludo's, written 2026-11-02; Parts A and D are yours)

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

## Part D: integration with illumination

Today (`canvas3d/passes/illumination.ts:225-229`) volumes are drawn under the transparent primitives into the
illumination pass's transparent target, against the opaque depth, then composed with the traced result; they discard in
the tracing variant (`direct-volume.frag.ts:400`): they neither shadow the traced molecules nor receive their light.

D1. **Volumes shadow the molecules:** the trace shader (`illumination.wgsl.ts`, its shadow rays at :226) multiplies each
shadow ray's light by the volume's transmittance, read from A1's pyramid by cone marching (a few reads per ray, in the
volume's model space by its inverse transform). A transfer function change rebuilds the pyramid and restarts the
accumulation. Tests (Dawn): a sphere behind a dense slab along the light is darker with the volume than without, and
unchanged with the volume's `lighting: 'local'` (opt-in: today's image by default). D2. **One light:** the volume's key
light and ambient take illumination's light direction and ambient color (the `TracingParams` and renderer light props),
so both look lit by the same light. Test: the volume's uniforms follow a light change in the props. D3. **Molecules
shadow the volume (optional, mesoscale):** opaque geometry voxelized into the same pyramid as extra extinction
(particles: each sphere splatted into the grid by a compute pass), so the volume darkens next to them; the same
world-space field can give the particles a large-scale occlusion beyond what SSAO and the screen-space tracer see.
**Gate:** measured first on CellPack HIV; built only if it shows. D4. **Measure** illumination with and without D1
(iterations to converge, frame time), M1 and Quadro.

## Done

Checks: `npx tsc -b`, `pnpm lint`, `pnpm format:check`, `pnpm check:workspace`, `pnpm test:unit packages/graphics`
(Dawn: `NODE_PATH=.cache/native/node_modules`, installed in this worktree). Gate (lane-reviewer + lane-skeptic). PR
`gh pr create -R corredD/molstar-proto --base prism-me` with frame times (M1) and before/after images.

## Built

- A1 (e805da7a9, 2d7d5b74b): `Texture.define(..., levels)` + `TextureLevel` kernel bindings + `r16float` storage under
  `texture-formats-tier1` (requested as optional feature); `gl/compute/volume-lighting.ts` + kernels `vl-extinction`,
  `vl-downsample`; Dawn test vs f64 reference (32³ and 33x20x17), half an f16 step.
- A2/A3 (b93709784): `lighting` param (`local` | `volumetric`), `dLighting` define, `tExtinction` (renderable-owned),
  `volumeDescriptors` + `volumetricLight` in `direct-volume.wgsl.ts`; tests: local == source before (WGSL), WebGL draws
  local, Dawn slab/cube shadow 0.49/0.57 vs local 0.97.
- A4 (d27ef3b20): benchmark cases at 1080p. M1 Chrome: map-256 3.74 → 3.76 ms, tomogram-512x512x96 3.76 → 4.07 ms
  (`volume` pass 2.15 → 2.27, 2.32 → 2.48). **Gate A passed** (+1 %, +8 %). Pyramid build 1–5 ms.
- D1/D2 (4a1eb2b17): `dVolumeShadow` in the trace (`volumeTransmittance`, 8 reads, `sLinearMipmap` at the step's level),
  `findVolumeShadow` + `updateVolumeShadow` in `tracing.ts`. Dawn: atoms beside a dense slab 247 none / 248 local / 82
  volumetric; the light moved: unshadowed.
- D4 (404a1987a): 7qpd + map-256 with illumination, rotating, 1080p, M1: 7.63 ms local / 7.46 ms volumetric (trace 0.80
  / 0.79 ms).
- Review fixes: 6f4d2a613 (trace takes up a replaced pyramid; test pins the trace quality, failed 73 -> 248 first), a
  descriptor test on Dawn (`volumeDescriptors` read directly), gate A on a 464x464x225 box (c39c3927e: 8.28 -> 8.76 ms,
  +6 %).

- Clip objects in the pyramid (2026-11-03, Ludo: "try it first and see whether it shows or slow down anything"; it
  showed: the cut face black under volumetric). 88e78421d benchmark cases under a plane clip; 9091c7a5e fix
  (`vl-extinction` zeroes clipped cells via `clip_storage_wgsl`, level-0 light read clipped by `volumeClipped`, rebuild
  on clip / first-instance transform change by value); 9d6bebcfa tests from the gate; docs ba115d77f, 8f886214d. Cost
  (M1 Chrome 1080p): no clip unchanged; with a clip, map-256 3.87 -> ~3.98 ms, 464x464x225 8.51 -> ~9.0 ms (the level-0
  clip test per lit sample). Rebuild (Dawn) with a clip: 128³ 1.0 ms, 232x232x113 2.0 ms, 464x464x225 4.1 ms.

## Decided

- **D1** (this lane): the volume shadows the traced molecules with or without `shadowEnable` (illumination's default is
  shadows off); primary hits only, the first visible volumetric volume, its first instance; 8 reads clipped to the box.
- **D2**: one light by construction (volume and trace both read `renderer.light` and the renderer's ambient).
- **Tomogram default TF** (fills the box): reported, not changed here (pre-existing `computeRampControlPoints`).

- **A2 descriptor layout frozen** (2026-11-02, this lane; full text in `.v6/plans/gl/volume-lighting.md` §A2): 13 floats
  per sample, `[around 0..5, light 0..5, cosine]`; `around[k] = S_k(x)`, `light[k] = S_k(x + l * 2^k)`,
  `cosine = dot(viewRayDir, toLight)` in view space. `S_0` = sigma of the trilinear grid value (classified after
  filtering, not stored); `S_k` (k = 1..5) the trilinear read of pyramid level k (mean of 8 children, level 1 the mean
  of 2³ cells' sigma). sigma = -ln(1 - min(clamp(TF(v) * uAlpha, 0, 1), 0.999)) per cell; radii and `l` in cells (toward
  the light: `-uLightDirection[0]`, which is the direction the light travels; corrected 2026-11-02 before any use; taken
  to cell space through `modelView * transform * uTransform`, normalized there); 0 outside the box `[0, dim]`. Grid
  padded to a multiple of 32 cells (zeros). No normalization in the descriptors.
- **Pyramid storage**: one `r16float` 3d texture, 5 mips = levels 1..5 (level 0 on the fly: 1/8 the memory), written by
  compute, needs `texture-formats-tier1` (Dawn has it on the M1); without it `volumetric` falls back to `local`.
- **A3 cone weights** `D = (1, 1, 2, 4, 8, 16)` (segments ending at the reads): the brief's `sum sigma_i * r_i` counts
  63 cells of path for 32 covered.

- **Clip** (2026-11-03): pixel clipping only (as the march); the first instance's `aTransform * uTransform`, `uModel` as
  the identity (documented limit, as GPU culling); the level-0 clip kept despite ~+5 % under a clip (the face toward the
  light reads one cell into the removed part). `volume_lighting_wgsl` includers define `volumeClipped` (§A2).

## Learned

- `uLightDirection` is the direction the light travels (Mol* shading normals point into the surface).
- The transfer function table ends at 0 at x = 1 (`build1DAlphaArray` appends `{x: 1, alpha: 0}`): a value of exactly
  the max is transparent.
- Mean-extinction cone AO with the cone's own segment lengths (`D_k`) blackens every surface of a map-like TF (a
  half-filled ball counts 16 cells); the 1/r obscurance weights (`D_k / r_k`) keep a surface near 0.5.
- The tomogram (TS_08 bin2, 464x464x225) under the default ramp (signed: mirrored ramps from ±1 sigma) fills the whole
  box: noise beyond 1 sigma is ~30 % of the voxels. Pre-existing (`computeRampControlPoints`), not this lane's; open.
- M1 Chrome GPU timer per pass is odd (passes sum to ~30 ms in a 3.7 ms frame): compare like with like only.

## Size

- Production: ~720 lines in `packages/graphics` (14 files; the brief's A ~350 + D1–D2 ~150 = 500). Over by the WebGPU
  scaffolding (texture mip levels, `TextureLevel`, tier-1 storage formats, ~120) and the doc comments of the WGSL.
- Tests and benchmark: ~730 lines (5 files). 12 commits.

## Review

| Finding                                                     | Severity              | Verdict                                                          | Commit / open                                     |
| ----------------------------------------------------------- | --------------------- | ---------------------------------------------------------------- | ------------------------------------------------- |
| 1 trace keeps a replaced/destroyed pyramid (no `update`)    | must-fix              | confirmed (reproduced pinned 73 -> 248)                          | 6f4d2a613                                         |
| N1 the recreate test passed for the wrong reason            | should-fix            | confirmed                                                        | 6f4d2a613 (quality pinned)                        |
| N2 hiding one of two volumetric volumes                     | should-fix            | plausible, same cause                                            | 6f4d2a613                                         |
| 3 no test reads `volumeDescriptors`                         | should-fix            | confirmed                                                        | descriptor test (Dawn)                            |
| 4 gate A not on a 512³-ish tomogram                         | should-fix            | confirmed                                                        | c39c3927e (464x464x225: +6 %)                     |
| D4 convergence argued, not measured; Quadro                 | should-fix            | confirmed                                                        | open (Quadro numbers open per brief)              |
| 2 `local` test compares new with new                        | nit (from should-fix) | gap confirmed, risk refuted (old vs new preprocessed: identical) | open                                              |
| `textureDimensions` per lit sample                          | nit                   | confirmed                                                        | open                                              |
| trace mip capped at level 5 for long chords                 | nit                   | confirmed                                                        | open (noted)                                      |
| `volumetric` + `ignoreLight` builds the pyramid and shadows | nit                   | confirmed                                                        | open (design call)                                |
| D2 test checks the trace, not the volume                    | nit                   | confirmed                                                        | open (A3 test shows the volume follows the light) |

Clip gate (2026-11-03):

| Finding                                              | Severity              | Verdict                        | Commit / open                    |
| ---------------------------------------------------- | --------------------- | ------------------------------ | -------------------------------- |
| M1a raw harnesses lack `volumeClipped` (neural lane) | must-fix              | confirmed (run)                | neural merge                     |
| M1b neural program lacks the def                     | must-fix              | refuted (auto-merge widens it) | -                                |
| M1c `volumeCellToModel` unassigned under neural      | must-fix              | confirmed                      | neural merge                     |
| M1 §A2 lacks the contract / New-2 frozen semantics   | nit                   | confirmed                      | 8f886214d                        |
| S1 level-0 hook untested                             | should-fix            | confirmed (run)                | 9d6bebcfa (failed first: 4 > 1)  |
| S2 no preprocess of volumetric + clip                | nit (from should-fix) | gap confirmed, no defect       | 9d6bebcfa                        |
| N1 `uModel` dropped by the pyramid                   | nit                   | confirmed                      | open (documented limit)          |
| N2 LANE.md stale                                     | nit                   | confirmed                      | this entry                       |
| N3 transform-under-clip rebuild untested             | nit                   | confirmed                      | 9d6bebcfa (failed first: 2 vs 3) |
| N4 ignoreLight + clip change rebuilds                | nit                   | confirmed                      | open (existing design call)      |
| New-1 merge conflict could drop the stub             | should-fix            | confirmed (run)                | neural merge                     |

## PR

https://github.com/corredD/molstar-proto/pull/40 (base prism-me). Gate run: 1 must-fix, 4 should-fix (+1 raised), 5
nits; must-fix and 3 should-fix fixed with failing-first or new tests.
