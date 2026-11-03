# Volume lighting: shadows and scattering in direct volumes, plain then neural, with illumination (2026-11-02, lane `volume-lighting`)

Parked (Ludo, 2026-11-02: "write the plan in prism-me, we will not do it right now"). Started on Ludo's word: the lane
copies this brief to its `progress/<date>-volume-lighting.md` and builds from there.

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

## Not in scope

The network for surfaces or particles (only volumes); WebGL1; a learned density or a learned denoiser; the volume inside
the screen-space tracer as a medium (D1 reads transmittance only).

## Built

- Clip objects (2026-11-03, Ludo: "try it first and see whether it shows or slow down anything"; it showed): the pyramid
  counts the cells a clip removes as 0 and the level-0 read toward the light is clipped, so the cut face is lit and the
  part cut away shadows nothing, volumetric and neural, traced molecules included (lane `volume-lighting` 9091c7a5e,
  `volume-neural` 80dad7178; spec `.v6/plans/gl/volume-lighting.md` §A1, §A4).

## Decided

## Learned

## Size

<measured> against ~900; what took the room.

## Review

| Finding | Severity | Verdict | Commit / open |
| ------- | -------- | ------- | ------------- |
