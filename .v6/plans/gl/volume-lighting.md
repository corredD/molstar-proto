# Plan: volumetric lighting in direct volumes, and volumes in illumination

## Status

- **Current**: A1–A2 frozen (this section and "Descriptors"); A3, A4, D1–D2 in lane `volume-lighting`; B and C
  (reference tracer, network) in lane `volume-neural`, built on the descriptors below (§B, §C).
- Follows [direct-volume-quality.md](direct-volume-quality.md): its options 2 (occlusion volume) and 3–4 (shadows)
  are replaced by one extinction pyramid, built once per transfer function, read per sample by cone marching. The
  lights stay camera relative: only the pyramid is precomputed, the light-side reads are per frame.

## A1. The extinction pyramid

- **Extinction per cell**: `alpha = clamp(TF(v) * uAlpha, 0, 1)`, the transfer function's opacity per cell as the ray
  marcher takes it (`uTransferScale` scales it to a step), `TF(v)` the 256-entry table linearly filtered at
  `v * 256 - 0.5` (clamped to the table, as the sampler), `uAlpha` the material's alpha (folded in: a change rebuilds).
  `sigma = -ln(1 - min(alpha, 0.999))`, per cell length (0.999 is `MaxPreIntegratedAlpha`). Units of cells make the
  descriptors independent of the voxel size in Å.
- **Levels**: level 0 is `sigma` itself, not stored: read from the grid and the transfer function where needed. Stored
  are levels 1 to 5 (`VolumeLightingLevels`), one `r16float` 3d texture with 5 mip levels (mip `k - 1` is level `k`):
  1/8 of the memory a full chain from level 0 takes (512³: 38 MB, not 300 MB).
- **Padding**: level 1 is `ceil(dim / 32) * 16` texels per axis, so every level halves exactly and one uv addresses
  all of them; the cells beyond the grid count as 0 (empty).
- **Means**: a level-1 texel `j` is the sum of `sigma` over its 8 cells `2j + {0,1}³` divided by 8 (cells outside the
  grid add 0); a level-`k` texel the mean of its 8 children of level `k - 1`. A kernel per level
  (`vl-extinction` from the grid, `vl-downsample` per level after), rebuilt when the grid, the transfer function or
  `uAlpha` change, never per frame.
- **Format**: written by compute as `r16float` storage, which needs `texture-formats-tier1` (Dawn, Chrome 139+ on
  Metal, D3D12 and Vulkan). Without it `volumetric` falls back to `local`: `rgba16float` would take 4x the memory and
  `r32float` filtering needs `float32-filterable` as well.
- **Not reused**: `mipmap.ts` is a 2d render-pass filter (a linear sample per texel, not the 8-child mean), the Hi-Z
  pyramid a texture per level; the kernels use the compute scaffolding (`ComputeContext`, `KernelCode`, a texture
  level per binding, `TextureLevel`).

## A2. Descriptors (frozen for `volume-neural`)

At a ray-march sample, `x` in texel coordinates of the grid (cell `j` spans `[j, j + 1)`, its center at `j + 0.5`;
the ray marcher's `unitPos * gridDim + 0.5`):

- `S_0(y) = sigma(v(y))`, `v` the grid's value trilinearly filtered at `y` (classified after filtering, as the ray
  marcher's samples);
- `S_k(y)`, `k = 1..5`: level `k` trilinearly filtered at `y / 2^k` level texels (uv `y / (32 * ceil(dim / 32))`),
  clamp to edge;
- every `S_k(y)` is 0 where `y` is outside the grid's box `[0, dim]` on any axis.

The 13 descriptors, in this order:

| Index | Name | Value |
| ----- | ---- | ----- |
| 0–5 | `around[k]` | `S_k(x)`, `k = 0..5` (mean extinction within about `2^k` cells) |
| 6–11 | `light[k]` | `S_k(x + l * 2^k)`, `k = 0..5`: along `l`, the unit direction to the key light in cell space |
| 12 | `cosine` | `dot(d, L)`: `d` the view ray's direction (camera to sample), `L` the direction to the key light, both unit vectors in view space (1: light from behind the sample, forward scattering) |

- `l` is `-uLightDirection[0]` (view space; `uLightDirection` is the direction the light travels, as `applyLight`
  takes normals pointing into the surface) taken to cell space by the inverse of
  `modelView * transform * uTransform` and normalized there: anisotropic cells and any transform are handled, the
  distances are in cells.
- Units: extinction per cell, no normalization; the network stores its own input mean and scale with its weights (C1).
  `cosine` in [-1, 1].
- WGSL: `volumeDescriptors(...)` in `direct-volume.wgsl.ts` returns them as `around0` (levels 0–2), `around1` (3–5),
  `light0`, `light1`, `cosine`.

## A3. `lighting: 'volumetric'`

- The param `lighting` of direct volumes (`local` default, `volumetric`; `neural` to come, lane `volume-neural`), the
  define `dLighting`. The renderable draws `local` where it can't build the pyramid (WebGL, no
  `texture-formats-tier1`, 2d grids) and builds it where `volumetric` is drawn, rebuilt when the grid, the transfer
  function's bytes or `uAlpha` change (`createVolumeLighting` in `gl/renderable/direct-volume.ts`).
- Transmittance to the key light by cone marching along `light`: segments `[0, 1], [1, 2], [2, 4], ..., [16, 32]`
  cells, of lengths `D = (1, 1, 2, 4, 8, 16)`, the read of level `k` at the far end of segment `k`:
  `T = exp(-sum_k D_k * light[k])`.
- Ambient obscurance from the reads around, with a `1 / r` falloff: `A = exp(-sum_k (D_k / r_k) * around[k])`, weights
  `(1, 0.5, 0.5, 0.5, 0.5, 0.5)`, every scale alike. Not the same cone sum as `T`: with `D_k` the means of a half-filled
  ball (a surface) count 16 cells of extinction, black at the opacities of maps (0.3 a cell), where half the directions
  are open; with `D_k / r_k` such a surface is about 0.5.
- Color: `rgb * (uLightColor[0] * T + uAmbientColor * A) * uExposure`, isotropic (no phase); the other lights are not
  used, nor the material's metalness and roughness. The gradient and `applyLight` stay for `local` only, and pick,
  marking and depth variants ignore `dLighting` (`shader-code.ts`).
- `local` preprocesses to the source of before the param (`wgsl-declarations.test.ts`): its image is today's.
- Tests: the pyramid against an f64 reference on Dawn; a dense cube beside a thin slab, the key light from the front
  at 45° to one side then the other: the slab behind the cube at 0.49 and 0.57 of the other side, 0.97 with `local`
  (`webgpu-volume-lighting.test.ts`); WebGL draws `local` (`direct-volume.test.ts`).

## A4. Cost

M1 (Apple M1, Chrome, WebGPU), `node scripts/benchmark.mjs --backends webgpu --filter 'render/direct-volume/*-1080'
--gpu-timing --runs 5`, 1920x1080, medians:

| Case | Frame, local / volumetric | `volume` pass, local / volumetric |
| ---- | ------------------------- | --------------------------------- |
| `map-256` (256³, 40 globules) | 3.74 / 3.76 ms | 2.15 / 2.27 ms |
| `tomogram-512x512x96` (tilted slab) | 3.76 / 4.07 ms | 2.32 / 2.48 ms |

- Gate A (+50 % a frame) passed: +1 % and +8 %. The 12 reads replace the gradient's 6 and only lit samples read them.
- The pyramid (5 dispatches, at a transfer function change, Dawn on the M1, after the first build's compile): 256³
  1.1–1.5 ms (4.8 MB), 464x464x225 1.5–2 ms (17 MB), 512³ 3–5 ms (38 MB).

## B. Reference and training data (`tools/volume-lighting/`, Python, not shipped)

- **Tracer** (`vl/tracer.py`): delta tracking through `S_0`'s field (σ of the filtered value, 0 outside the box),
  majorants per 8³ brick (the largest α the table takes over the brick's value range), ratio tracking for next-event
  transmittance, Henyey-Greenstein `g = 0.3` (one value: the network has no g input), a directional key light
  (irradiance 1) and a uniform sky (radiance 1), all orders, Russian roulette after 4 bounces. Targets per sample:
  `S_key`, `S_amb`, the in-scatter toward the camera without the sample's own albedo (the shader multiplies by the
  color); the key's phase normalized to 1 over the sphere (isotropic single scattering is the transmittance, as §A3).
  On the CPU: on MPS each of the wavefront's small ops waits on the GPU.
- **Checks** (`pytest`): a slab's single scattering (key, ambient `(E2(σz) + E2(σ(D − z))) / 2`, and the image seen
  from above) within 1 %; loose majorants on a gradient (closed-form optical depth); Mitsuba 3's `volpath` on a
  heterogeneous grid with multiple scattering (conda env `volume-lighting`): mean ratio 0.997, 4×4 blocks within 0.5 %
  (median).
- **Descriptors** (`vl/descriptors.py`): §A2 in f32 weights; the shader reads levels 1–5 and the value with hardware
  filtering (sub-texel weights of 8 bits at least) and stores f16 levels it rounds itself, so the two agree within a
  bound, not bit for bit: `webgpu-volume-neural.test.ts` checks 24 samples of a grid against the Python's
  (`fixtures.py`), each within 3 · 2⁻⁸ of its 8 texels' range plus an f16 ulp per level.
- **Data** (`make_data.py`): 8 EMDB maps (ribosomes 80S and 70S, two capsids or shells, a helical filament, a
  microtubule, a membrane protein in its micelle, the 26S proteasome) and 2 subvolumes of CryoET portal 10003 TS_08
  (inverted), block-mean downsampled to at most 144 cells; per map 20 configurations (a transfer function whose
  threshold leaves 2–30 % of the cells above it, peak α per cell 0.03–0.99; a light; albedo 0.3–0.95), 2000 points at
  the first collision of camera rays (where they meet density), 1024 paths each. Held out (`vl/data.py`, fixed
  before any data): apoferritin EMD-11638, TRPV1 EMD-5778, tomogram subvolume `b`; validation: every 10th
  configuration of the training maps. Data in `~/molstar-prism-me/.me-data/volume-lighting/`, never committed.

## C. `lighting: 'neural'`

- **Network** (C1, `vl/net.py`): the 13 descriptors and the albedo, clamped to the training range (a network
  extrapolates badly: unclamped, dense regions glowed at the output clamp) and normalized by a stored mean and scale,
  14 → 16 → 16 → 2, squared ReLU, the outputs squared and clamped per channel (key 3: the phase's peak 2.65 and a
  little multiple scattering; ambient 1, the sky's radiance): `S_key`, `S_amb`, in place of §A3's transmittance and
  occlusion (`volumeLight`). In the shader the albedo is the color's luminance clamped to the training range.
- **Training** (C2, `train.py`): Adam, one-cycle, relative L2 with the denominator `(stopgrad(pred) + y) / 2 + 0.01`
  (the targets' noise does not bias it). The weights go to `volume-neural-weights.ts` next to the shader (a JSON
  literal: the package compiles without JSON modules), with check inputs and PyTorch's outputs for them.
- **WGSL** (C3, `volume-neural.wgsl.ts`): generated from the weights, constants only (no binding, no upload): the
  inputs in 4 vec4s, the layers as `mat4x4` blocks (`mat4x2` for the outputs); f32. Tests: the TypeScript network
  gives PyTorch's outputs; the WGSL one the TypeScript one on 1,000 random inputs within 1e-4 (Dawn).
- **Gate C** (C4, `gate_c.py`): pending (run 2, after the review).
- **Cost** (C5): pending.

## D. Illumination

To be written with D1–D2.
