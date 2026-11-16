# Plan: The last level of detail as octahedral impostors

## Status

- **Current**: built (lane `lod-impostor`, 2026-11-15), on for particle structure and sites targets
  (`structure.lodImpostor`), checked on cellpack-mg (one and two copies) in WebGPU and WebGL2. Open: the cost of the
  spheres' program close up (below), the sphere raster for objects with impostors, atlases shared across lists.

## Why

- Far away a protein drawn as its last level of spheres (stride 1000, scaled up) is a lumpy ball larger than the
  protein: its shape lost, and the proteins' share of the pixels doubled (cellpack-mg, the green of its proteins: 0.23
  to 0.26 of the cell at full detail, 0.50 at the last levels). Goodsell's paintings show each protein as a flat
  silhouette of its own outline, a thin dark edge between molecules.

## Design

- **Atlas, per item** (`ImpostorAtlas`, `geo/geometry/impostor-atlas.ts`): the item's spheres (drawn radii) splatted on
  the CPU from 9 × 9 directions over the sphere (the octahedral map, z the pole; frames on its grid, `i / 8`: the axes
  and the edges are frames, no lookup wraps), a tile each: coverage (2 × 2 subsamples), the front's height along the
  view, the front's normal (x, y in the view's frame), RGBA8. Tiles sized by the pixels the copy covers where the
  impostors start (a power of 2 in [8, 64]); shelf-packed into one atlas per representation, halved until it fits
  `maxTextureSize` (at most 8192 a side, places in 10 bits: the yeast slab's 5,457 targets need 8192 × 4680). Why the CPU: one texture for both backends, testable, no offscreen pass per item
  and view. Why RGBA: Mol*'s WebGL texture layer has no RG8; the normal is exact from the splat.
- **The last level draws impostors** (`getLodLevelsValue(..., impostor)`): one item a copy (6 vertices), its scale the
  item's atlas entry negated (`-(entry + 1)`, the entry's place packed into 20 bits, `encodeEntry`). Why the scale: it is
  per member already (`aSegmentLod`), outside the merge key; no new segment data. The quad is the copy's invariant
  bounding sphere; the fragment stage takes the camera's direction in the copy's frame (the view's axes in it, two flat
  varyings), the three nearest views and their weights (a triangle of the grid cell), each view read where the ray
  meets its plane, coverage blended and cut at 0.35 (at 0.5 the blend lost the parts where the views disagree), height
  and normal blended by coverage; depth from the ray's point at that height. The copy's color (`vColor`, color levels
  at its center); picking gives the copy (its instance).
- **The band** (`LodImpostorBand`, 0.5 octave): the boundary of the last spheres and the impostors widened both ways;
  in it both draw, and a 4 × 4 Bayer dither (screen space, stable while zooming) gives each pixel of a copy to one of
  them: the level fading in keeps where the threshold is below the share, the one fading out elsewhere (exact
  complement, no hole, no double). The role is the overlap's sign (the last level's negated); the other overlaps 0.
  At the band a copy chooses its level whole (its center's distance); elsewhere by sphere, as without impostors.
  Picking splits at half. Beyond the band, over an octave, the impostors' normal turns to the camera: flat color, the
  outline pass draws the edges (Goodsell's look).
- **Who**: particle structure and sites targets drawn as spheres with `lodImpostor` and at least two levels; an item
  of any radius (`ImpostorMinRadius` 0, Ludo: lipids and ions too); a copy under 4 px reads its nearest view alone
  (`ImpostorOneViewPixels`). All such targets take the define (one merge key), those without an entry (the atlas full)
  draw their last level as spheres with the band, never thinned.
- **The switch** (`uLodImpostorSwitch`): by each copy's size on screen (12 px) or its distance from the eye; the
  distance by default where a copy of the median radius is 12 px across in a 720-px view (`autoDistance`).
- **Thinning** (stochastic simplification, Cook et al. 2007; `lodImpostorThin`, 8 px, 0 off): below that size a share
  `p = (size / s0)²` (at least 1/64) of the copies kept by a stable hash of their member and instance (`copyHash`,
  PCG), larger by `1 / √(p · ThinArea)` (the area kept, the fade's included); one leaving shrinks out over a quarter of
  `p` above it (no pop), then is culled. The vertex stage decides on WebGL; the GPU culling drops the others first by
  the same rule (`thinnedOut`, the frame's scale also in the clip ghost's pass). Open: inside the band (distance mode
  or a switch below 8 px) kept copies grow during the cross-fade.
- **Not the sphere raster's** (`isSphereRasterEligible`): it chooses levels per sphere and has no dither.

## Measured (M1 Pro, 1280 × 800, cellpack-mg, quality)

| view (× the cell's distance) | WebGPU off | WebGPU on | WebGL2 off | WebGL2 on |
| ---------------------------- | ---------- | --------- | ---------- | --------- |
| 0.35 (close)                 | 26 ms      | 33 ms     | 116 ms     | 168 ms    |
| 0.7                          | 25 ms      | 30 ms     | 78 ms      | 95 ms     |
| 1.6 (the band)               | 10 ms      | 17 ms     | 37 ms      | 66 ms     |
| 2.2                          | 9 ms       | 9 ms      | 31 ms      | 35 ms     |
| 3.5                          | 9 ms       | 9 ms      | 29 ms      | 33 ms     |
| two cells, 4 (far)           | 21 ms      | 16 ms     | -          | -         |

On and off in the same page, alternated. Close up the spheres' program costs more with the define (its larger fragment
stage and two more varyings), though no impostor is drawn: the open item. Since then each level has its own program
(close up as off). With every target and thinning (8 px), WebGPU: one cell × 3.5 9.8 → 8.7 ms, two cells × 4
18.1 → 8.0 ms, the yeast slab at Ludo's view 35.7 → 23.9 ms; × 2.2 still 10.3 → 12.9 ms.
