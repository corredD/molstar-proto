# lod-impostor (brief, 2026-11-15)

Ludo: "explore the LOD, I would like the LOD rendering to look like David's painting when looking from afar. Right now
it's LOD of ordered spheres of increasing radius, we lose the globular shape. Could the switch go to an impostor made of
a couple of planes that would fake camera rotation, since the camera is far, it should work. What the quad shows is the
contour of the protein and its color inside." Then: "mycoplasma which is big, and we can put two in the scene so we can
zoom back and really test. … run all the lanes at night, I will check tomorrow, be independent, … give the best looking
transition of this new LOD."

Reference (Goodsell, HIV-infected cell): `~/prism-me-lanes/lod-impostor-ref/goodsell-hiv.png` and the close-up
`goodsell-crop.png`. Look at them first: each protein a flat-colored silhouette with its recognizable outline, a thin
darker edge between molecules, little or no lighting, crisp shapes at a few pixels each.

Slug `lod-impostor`, branch `me/lod-impostor` from prism-me bdb9ef209, port 1381. Lane model: **Opus** (core visual,
shaders, the look). Ludo is away until morning: decide yourself, record each decision and why; do not stop to ask.

## Now

- Particle targets (structures as spheres) have levels by size on screen: `lodLevels` (each a `stride` of the atoms
  drawn with `scaleBias` bigger spheres) and `lodPixelSize` (`packages/graphics/src/geo/geometry/lod-levels.ts`,
  `geo/geometry/spheres/spheres.ts` `LodLevelsPresets` / `LodPixelPresets`,
  `repr/particles/representation/target/ common.ts` and `representation.ts`; the shader's `assign-lod-factor`;
  `.v6/plans` `screen-space-lod.md`). Far away a protein is a handful of big spheres: a lumpy round blob, its shape
  lost.

## Wanted

A last level, far away, where each copy is drawn as an **impostor**: a camera-facing quad showing the protein's
silhouette as seen from that direction, filled with the copy's color, with depth, so it looks like Goodsell's painting.

1. **Per ingredient (a particle target's structure), an atlas of views** made once at load: the full-detail protein seen
   from many directions over the sphere (octahedral impostor, e.g. 8 × 8 = 64 views; choose the count), each a small
   tile (32–64 px; choose) holding coverage/mask and depth (and anything the look needs: e.g. a normal or an ambient
   term). Rendered on the GPU from the existing geometry or splatted on the CPU: choose by quality and load time
   (measure on mycoplasma's ingredients).
2. **Draw**: per copy, the view direction in the copy's frame picks the tile(s); blend the nearest 3 (octahedral
   interpolation) so orbiting does not pop; write depth from the tile (copies overlap correctly; Mol*'s outline and SSAO
   passes see real shapes); color the copy's (its theme: entity, compartment, chain…, and `ColorLevels` "By zoom" where
   on); picking gives the copy.
3. **The look**: as close to the reference as you can get at a distance: flat color, a crisp silhouette, the thin dark
   edge between molecules (from the outline pass or in the tile). Compare your screenshots against the reference and
   iterate; record what you tried.
4. **The transition** (Ludo: "the best looking transition"): no visible pop between the sphere levels and the impostor
   while zooming or orbiting — e.g. a screen-door/dithered cross-fade over a band of pixel sizes, matched size and color
   between the last sphere level and the impostor, temporally stable. Measure it (frame sequences while zooming) and
   choose the band.
5. **Both backends**: WebGL2 and WebGPU (prism-me's default is WebGPU; check what the app uses). A device that cannot →
   the current levels.
6. Default on for structure particle targets in the explorer's graphics modes, with a param to turn it off; fibers,
   lipids/membranes and other targets keep their current levels (say what you saw).

Where it lives: Mol\* core (graphics: the atlas builder, the impostor visual/level, shaders), on prism-me, as commits of
their own with no app/extension hunks, listed in a "Core changes" section of this file (the coordinator moves them to
`_spec/core-changes.md`); app/extension wiring separate.

## Tests (fail first)

- The atlas: a known shape (e.g. an ellipsoid of spheres) gives the right silhouette area per view direction; the view
  for a direction is the octahedral mapping's.
- The draw: for a copy turned by R, the tile chosen for camera direction d is the one for R⁻¹d.
- Depth written: two overlapping impostors occlude as the full-detail spheres do (render test, small scene).
- Picking returns the copy.
- The level switch by pixel size: above the band full levels, below it impostors, inside the band both (the fade).
- Perf guard: far view of 2 × mycoplasma, frame time no worse than the current far levels (record both).

## Check (port 1381)

`mesoscale.example` `cellpack-mg` (Mycoplasma genitalium) loaded **twice**, the second moved beside the first
(`stage.move`), so the camera can back off far. Screens at 4–5 distances, current vs impostor, side by side with the
reference; a zoom-out frame sequence (and an orbit) showing the transition; frame times (current vs new) at each
distance. Screens to
`/private/tmp/claude-501/-Users-ludovicautin-molstar-proto-git/bc8a7dcf-b4ed-4027-911e-5f56df74a469/scratchpad/lod-impostor/`
and copies of the best to `~/prism-me-lanes/lod-impostor-ref/out/` (durable).

## Size

~600–1,000 production lines (atlas builder, visual, shaders ×2, the fade, wiring). Over: record what took the room.

## Rules

Tests fail first; checks pass; the gate (lane-reviewer, lane-skeptic); no PR, no merge, no push to prism-me; push
`me/lod-impostor`. Never `git stash pop`. `@author Ludovic Autin <autin@scripps.edu>` on new files. Progress file
finished: built, decided (each with why), measurements, review table, learned, size, decisions for Ludo, Core changes.

---

# Progress (lane, 2026-11-15)

## Built

- **Atlas** (`ImpostorAtlas`, graphics `geo/geometry/impostor-atlas.ts`): per target (structure or sites, from 22 Å
  radius) its spheres splatted on the CPU from 9 × 9 octahedral views, a tile each of coverage (2 × 2 subsamples), front
  height and front normal (RGBA8); tiles 8–64 px by the pixels a copy covers where impostors start; one shelf-packed
  atlas per representation, one shared GPU texture. Blocks cached per target key: a change re-splats that target alone;
  where a texel is ≥ 3 Å level 1's spheres (a tenth, scaled) are splatted. cellpack-mg: 4096 × 3096, 48 MB, **2.2 s** at
  load (was 9.5 s splatting every atom), 0.04 s for an update that changes no target.
- **Draw**: the last LOD level (replacing stride 1000) draws one quad a copy at its bounding sphere; the fragment blends
  the 3 views nearest the camera's direction in the copy's frame, cuts coverage at 0.35, writes depth from the blended
  height (outline and SSAO see real shapes), shades with the blended normal, the copy's color (themes, color levels),
  picking gives the copy. GLSL and WGSL, same rule as the TS (tested).
- **Transition**: the boundary before the impostors widened into a 0.5-octave band; in it both levels draw and a 4 × 4
  Bayer dither gives each pixel of a copy to exactly one (the level fading in vs fading out; overlap sign); at the band
  copies choose their level whole. Beyond the band, over an octave, the impostors flatten (normal to the camera):
  Goodsell's flat colors, the outline pass draws the edges.
- **Param**: `structure.lodImpostor` (on) on particle target representations; gated by `canDrawImpostors` (spheres, not
  approximate, 2–4 levels, flat varyings). Not the sphere raster's.

## Decided (why)

- **CPU splat** (not GPU render): one texture for both backends, testable, no offscreen passes per target × view; cost
  kept down by the block cache and level-1 spheres (look unchanged: `scratchpad/lod-impostor/coarse-sbs.png`).
- **Impostor = the last of the 4 levels**, its per-target entry in the member's own level scale (negated): no change to
  `MaxCullLevels`, `aSegmentLod`, the cullers, the merge key; merged and unmerged alike.
- **9 × 9 views, frames on the grid** (odd: axes are frames; edges are frames: no lookup wraps).
- **RGBA8 with the normal**: Mol*'s WebGL layer has no RG8 (WebGL2 failed with RG); the normal is exact from the splat.
- **Cut at 0.35, not 0.5**: measured protein-pixel share (full detail 0.23–0.26): 0.5 gave 0.18 far, 0.35 gives
  0.20–0.24; the old far levels gave 0.50 (balloons twice the proteins' size).
- **Dithered cross-fade over 0.5 octave** (the transition): complementary per pixel, screen-fixed so stable while
  zooming and orbiting; zoom-sequence frame differences decay smoothly where the current levels show a bump at the
  switch; orbit frame-to-frame change 6.6 (impostors) vs 8.9 (current). Whole copies switch only at the band, so the
  band never shows a half copy.
- **Lipids and targets < 22 Å keep their spheres** (MG's 1.1 M lipids are 9–10 Å: a handful of atoms, already right);
  fibers are another representation, untouched.
- **No sphere raster with impostors**: its levels are per sphere, no dither. Only GPUs with `atomic-vec2u-min-max` (not
  the M1).

## Measured (M1 Pro, 1280 × 800, cellpack-mg, quality; impostors on vs off in the same page)

| view (× the cell's distance) | WebGPU off | WebGPU on | WebGL2 off | WebGL2 on |
| ---------------------------- | ---------- | --------- | ---------- | --------- |
| 0.35 (close)                 | 26 ms      | 32 ms     | 116 ms     | 168 ms    |
| 0.7                          | 25 ms      | 30 ms     | 78 ms      | 95 ms     |
| 1.6 (the band)               | 10 ms      | 17 ms     | 37 ms      | 66 ms     |
| 2.2                          | 9 ms       | 9 ms      | 31 ms      | 35 ms     |
| 3.5                          | 9 ms       | 9 ms      | 29 ms      | 33 ms     |
| two cells, × 4 (far)         | 21 ms      | 16 ms     | -          | -         |

Headless Chrome footprint ≤ 6.3 GB (two cells at load), 1.5–2.4 GB otherwise.

Screens: `~/prism-me-lanes/lod-impostor-ref/out/` (`zoom-sequence-current-top-impostor-bottom.png` first,
`near-band-current-vs-impostor.png`, `far-current-vs-impostor.png`, `two-mg-current-top-impostor-bottom.png`,
`webgl2-current-webgl2-webgpu.png`, `band-frames.png`). Scripts: `~/prism-me-lanes/lod-impostor-check.mjs`,
`lod-impostor-atlas-time.mjs`.

## Review

Reviewers: shaders/plumbing (3 must, 4 should, 5 nits), TS side (1 must, 5 should, 6 nits); skeptics: 0 refuted.

| finding                                                                                                                                                                   | verdict               | fixed by                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------ |
| atlas 9.5 s synchronous, all re-splatted on a change, radii on every update (must, should)                                                                                | confirmed             | `732e4dd3c`                    |
| XR model scale: far copies vanish (must)                                                                                                                                  | confirmed             | `cb586c76d` (test fails first) |
| ortho band drawn twice then popping (must → should)                                                                                                                       | confirmed             | `0c9e80395`                    |
| approximate, > 4 levels, WebGL1 non-flat entry (must/should/nit)                                                                                                          | confirmed / plausible | `958a700ce`                    |
| resolveSphere vImpostorY unset (nit, latent)                                                                                                                              | confirmed             | `f969e3134`                    |
| no band render test, overlapProp round trip untested (should, nit)                                                                                                        | confirmed             | `195fdbd0c`                    |
| no test of the representation wiring (should)                                                                                                                             | confirmed             | left open (TODO)               |
| writeTile 4 arrays per view; one shrink for all tiles; tile boundary at the nominal radius; gridless members; float32 edges; back-depth front; WGSL `% 4` negative (nits) | confirmed / plausible | left open                      |

## Learned

- A level's overlap was read back as a prop (`getLodLevels`): changing the drawn overlaps needs the props' kept
  (`overlapProp`), else turning a feature off leaves negative overlaps that shrink spheres to nothing.
- Members with different level ranges do not merge: 848 render objects instead of one. Any per-member change to the
  levels must keep min/max/overlap equal across members.
- Headless WebGPU picking reads the canvas: draw the canvas (tick) before `asyncIdentify`; the image pass has no camera
  scale.
- Frame times in headless Chrome swing ±30% between runs: compare on/off alternated in the same page.

## Size

~1,100 production lines (atlas 500, shaders 2 × 250, wiring 150) plus ~550 test lines: over the brief's 600–1,000 by the
shader pair (the impostor fragment and the band, twice) and the atlas cache.

## Decisions for Ludo

1. **Close-up cost**: with impostors on, the spheres' program is heavier even where no impostor is drawn: +25% close up
   on WebGPU, +45% on WebGL2; the band +70%. Far it is equal or faster (two cells: 21 → 16 ms). Default on as briefed;
   turn it off per representation (`structure.lodImpostor`) or say if it should be WebGPU only. A separate program for
   the impostor level would remove the close-up cost (renderable per-level variants: a core change).
2. **Atlas load**: 2.2 s on cellpack-mg, synchronous in the representation's update; two lists, two atlases. Async
   (yields) or shared atlases across lists next if it matters.
3. **The look**: flat far away by default (normal to the camera over an octave after the band). Lighting the impostors
   instead is a constant (`ImpostorFlatOctaves`).

## Core changes

All under `packages/graphics` (and one test in `packages/plugin/headless`), no app hunks; for `_spec/core-changes.md`:

- `ed9e98f51` ImpostorAtlas (octahedral views splatted on the CPU)
- `89f8c2996` the last level of spheres as octahedral impostors (GLSL, WGSL, schema, raster exclusion)
- `2c0806e6e` particle targets' impostors, one atlas per representation (`lodImpostor`)
- `943088bf5` the band on every member, the props' overlap kept
- `eefcb2145` cut at 0.35, flat far away
- `6665f7842` RGBA with the front's normal; WebGL2; less work for spheres
- `0ee2dcbe1` prepared ahead, on without entries; WebGPU render test
- `732e4dd3c` atlas from cached blocks and level 1's spheres
- `cb586c76d` impostors at a model scale (XR)
- `0c9e80395` orthographic: one level across the band
- `958a700ce` impostors only where they can draw
- `f969e3134` resolved spheres outside the band
- `195fdbd0c` band and levels-kept tests
- `b4c08bf32` docs: `.v6/plans/gl/lod-impostor.md`, `.v6/changelogs/lod-impostor.md`

App: `0e8da5454` `prism-me: features, far proteins as impostors` (features.md only: the explorer's graphics modes take
the representation's default, nothing to wire).
