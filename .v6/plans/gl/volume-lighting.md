# Plan: volumetric lighting in direct volumes, and volumes in illumination

## Status

- **Current**: A1–A2 frozen (this section and "Descriptors"); A3, A4, D1–D2 in lane `volume-lighting`; B and C
  (reference tracer, network) in lane `volume-neural`, built on the descriptors below.
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

- Transmittance to the key light by cone marching along `light`: segments `[0, 1], [1, 2], [2, 4], ..., [16, 32]`
  cells, of lengths `D = (1, 1, 2, 4, 8, 16)`, the read of level `k` at the far end of segment `k`:
  `T = exp(-sum_k D_k * light[k])`.
- Ambient occlusion alike from the reads around: `A = exp(-sum_k D_k * around[k])`.
- Color: `rgb * (uLightColor[0] * T + uAmbientColor * A) * uExposure`, isotropic (no phase); the other lights are not
  used. The gradient and `applyLight` stay for `local` only.
- WebGL: `local` (no compute); the shader's `local` variant is the same source as before the param (a test).

## D. Illumination

To be written with D1–D2.
