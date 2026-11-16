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

## The toggle (Ludo: "where is the button to turn off the lodImpostor?")

- A model's properties › **Graphics & Motion › Far proteins: Silhouettes | Spheres** (shown where the model is drawn by
  its structures), `mesoscale.impostors` (`on`, `particles`): every structure target of the model in one step; ⌘K ("far
  proteins", "silhouettes", "impostors") and the assistant (`draw_mesoscale_far_proteins`); sessions keep it (a
  representation param). Commits `cefeb56fe` (extension), `6b87c8345` (ui.md, features.md). Screens:
  `out/toggle-far-proteins.png`, `out/toggle-silhouettes-left-spheres-right.png`.
- Short gate: 0 must, 0 should; 2 nits left open: the toggle is offered (and steps) for blob-surface or approximate
  targets, where impostors never draw; no session round-trip test (holds by construction).

## Switch by size on screen or distance; the impostors' own programs (Ludo, 2026-11-15, later)

### Built

- **Switch by** (Graphics & Motion › Far proteins, while Silhouettes): Size on screen (each copy below N px across, its
  own bounding sphere; 12 px, 4–64, log) or Distance (each copy beyond D Å from the eye; default 2.6 × the model's
  radius, where the whole model fits a 45° view; R/10 to 20 R, log); live while dragged (gesture steps), one step on
  release; `mesoscale.impostors { on, by, pixels, distance, particles }` for ⌘K and the assistant; sessions keep it
  (structure params `lodImpostorBy`, `lodImpostorPixels`, `lodImpostorDistance`).
- **Core**: the switch in the level value (`LodImpostorSwitch`) and a uniform (`uLodImpostorSwitch`): each copy's share
  from its radius or eye distance in the vertex stage (TS rule `ImpostorAtlas.switchShare`), the band half an octave
  each way; `LodView.getRange` gives the two levels ranges covering every copy that can switch; **per member** the CPU
  culling (`setSegmentRanges`) and the GPU culling (`switchLevels`, per instance by its segment's radius) end a member's
  last spheres where its copies switch. By size, radii above the 90th percentile of the copies count as it (the few
  largest switch larger on screen; their last spheres not drawn out to where they would switch).
- **The impostors' levels draw by programs of their own** (`MultiDrawBaseData.define`: `dLodImpostorLevel` for the last
  level, `dLodImpostorBand` for the one before; WebGPU by `getWebGPUProgram(variant, define)`, WebGL by programs made on
  first use, linked in the background, bound in turn); the object's `dLodImpostor` changes no shader text; the renderer
  prepares both define programs with an object's own.

### Measured (M1 Pro, 1280 × 800, cellpack-mg, quality; off/on alternated in the same page, ms)

| view (× distance)       | WebGPU off         | before (one program) | after: 12 px       | after: 24 px | after: distance 6000 Å |
| ----------------------- | ------------------ | -------------------- | ------------------ | ------------ | ---------------------- |
| 0.35 (close)            | 25.8               | 32–34                | **25.8**           | –            | –                      |
| 0.7                     | 25.4               | 30                   | **25.6**           | –            | –                      |
| 1.6 (band)              | 10.1               | 17                   | 12.9               | 13.4         | 18.4                   |
| 2.2                     | 8.4                | 9 (Å/px rule)        | 12.6               | 8.8          | 8.8                    |
| 3.5                     | 8.5                | 9                    | 11.0               | 8.9          | 9.1                    |
| two cells × 2.6 / 4 / 6 | 13.1 / 15.4 / 15.4 | –                    | 13.4 / 15.6 / 15.7 | –            | –                      |

| view       | WebGL2 off | before | after (12 px) |
| ---------- | ---------- | ------ | ------------- |
| 0.35       | 116        | 168    | 123           |
| 0.7        | 78         | 95     | 100           |
| 1.6 (band) | 36         | 66     | 53            |
| 2.2        | 31         | 35     | 47            |
| 3.5        | 27         | 33     | 34            |

- **Close up**: WebGPU back to the old cost exactly; WebGL2 +6% (from +45%).
- **Far is not faster, and cannot be on this model by impostors**: with every target hidden a far frame is 3.2–3.9 ms of
  8.4; the rest is about 2 M copies that are already one sphere each at the last level (MG's 1.1 M lipids at 9–10 Å and
  the small targets), against about 0.1 M protein copies that impostors replace. A quad per copy costs what a sphere per
  copy costs, more in the fragment stage. Faster far views need fewer draws per copy: sub-pixel copies culled, or the
  far cell drawn as one (aggregation): not this lane's.
- **12 px costs more than the old rule at mid distances** because the larger proteins keep their spheres to 12 px
  instead of switching at the Å-per-pixel boundary (about 42 px for a ribosome): the look Ludo asked for, paid; 24 px
  costs as off. Default kept at 12 px (the look asked); a decision for Ludo.
- **Small items as impostors** (`ImpostorMinRadius` 0, tried): atlas 4096 × 3456, 54 MB (+6 MB), build the same (2.2 s),
  far frames 16 ms against 8.5 (2 M quads with the impostor fragment stage), and small items look blobbier
  (`out/small-items-spheres-left-impostors-right.png`); lipids look the same as a carpet. **Kept at 22 Å** (slower, no
  better look).

### Corrections

- The first Dawn render tests drew spheres, not impostors (a GPU culler made without levels keeps none: levels added
  after the object's creation were not drawn). Fixed in the tests (levels from creation); the XR test fails without its
  fix (checked by reverting it). Core TODO: a culler's level count follows a later change of the levels.
- The earlier "two cells, far: 21 → 16 ms" did not reproduce in alternated runs (13.1 → 13.4, 15.4 → 15.6).
- The depth test cannot fail as built (the copies' centers are in depth order); a case where center and surface order
  differ is still to write.

### Screens (`~/prism-me-lanes/lod-impostor-ref/out/`)

`switch-panel.png` (the controls), `switch-size6-size24-top-distance6000-12000-bottom.png`,
`small-items-spheres-left-impostors-right.png`.

### Core changes (added)

`23b82493d` the switch per copy; `26ed1500b` small items keep their spheres beyond it; `b96769fa4` particle targets'
switch params; `2cd49b025` the impostors' levels' own programs; `b1d07561b` each member's switch in the culling;
`9a6997161` WebGL draws a level's program once linked. App/extension: `5132c6f47`, `ee89a0852`, `a1cf45b9d`.

### Short gate (these commits)

One reviewer acting as its own skeptic, over `a6b6c3480..HEAD`: 2 must, 2 should, 5 nits.

| finding                                                                                              | fixed by                                                                                 |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| the shaders' pixel not the culling's (lod scale while moving): copies in neither level (must)        | `752fbf37b` (global `uLodScale`, `uCssHeight`)                                           |
| orthographic with levels by distance: impostors never drawn (must)                                   | `01112dacb`                                                                              |
| WebGL never prepared the level programs: the first far frame without them (should)                   | `1307aaea0` (not testable on this Mac)                                                   |
| no test tying the culling's ranges to the shaders' share (should)                                    | partly (the chunks read the culling's view; orthographic case); a sweep left open (TODO) |
| r0 = 1, the 0.5 eye-distance margin, the slider's default radius, the draw key without define (nits) | left open                                                                                |
| misplaced JSDoc (nit)                                                                                | `1307aaea0`                                                                              |

## The yeast slab, every target, thinning (Ludo, 2026-11-15, evening)

### Yeast slab diagnosis (yeast_slab_z600nm.bcif, 6,887,013 copies, 5,457 targets; Distance 2430 Å)

- **(d) the atlas was full: the cause.** At most 4096 a side it held 3,136 entries; **2,311 targets ≥ 22 Å (2,251,361
  copies) had none** and drew as spheres at every distance: the lumpy clusters. Fixed `e7aebd5df`: places in 10 bits a
  side, atlases to 8192 where the device allows; now all 5,457 have an entry (atlas 8192 × 4680, 153 MB: a cost of this
  size of model, recorded).
- **(b) under 22 Å**: 10 targets, 2,310,483 copies (lipids): spheres by design then; now silhouettes too (Ludo).
- **(a) nearer than 2430 Å**: none in that view (camera 3,292 Å above the slab's top; copies in view at 3,408–9,569 Å
  from the eye): not a cause there.
- **(c) canDrawImpostors**: true (one merged object, not approximate, 4 levels). **(e)** the distance is the eye's to
  the copy's center, in world Å: no unit or frame error found.
- **Slider**: its left end was the model's radius / 10 (2,430 Å: Ludo's value was the minimum), and the default 2.6 ×
  the radius (63,000 Å): both of the model's extent, meaningless for a slab. Now the default is where a copy of the
  median radius is 12 px across in a 720-px view (`ImpostorAtlas.autoDistance`), the slider from 100 Å, showing the
  distance applied (`2a62e12e5`, `593d3c872`).
- Frame at Ludo's view, WebGPU: spheres 35.7 ms, silhouettes 23.9. Screens:
  `out/yeast-before-left-after-right-distance-2430.png`.

### Every target, thinning

- `ImpostorMinRadius` 0 (Ludo's choice), tiny copies read one view (`8058ab24e`). Alone it made far frames slower (MG
  ×3.5: 18 ms against 9.4): two million quads.
- **Stochastic simplification** (`5e4f37651`): below `lodImpostorThin` px (default 8, 0 off) a share (size / s0)² of the
  copies kept by a stable hash, the kept ones larger by 1/√p (area kept), those leaving shrinking out over a quarter;
  the GPU culling drops the others per instance. Zoom-out sequence: frame differences decay smoothly (no flicker).

| cellpack-mg, WebGPU (ms) | spheres (off)      | silhouettes, no thinning | silhouettes + thinning (8 px) |
| ------------------------ | ------------------ | ------------------------ | ----------------------------- |
| one cell × 2.2           | 10.3               | 18.7                     | 12.9                          |
| one cell × 3.5           | 9.8                | 18.9                     | **8.7**                       |
| two cells × 2.6 / 4 / 6  | 15.8 / 18.1 / 18.3 | –                        | **8.3 / 8.0 / 7.8**           |
| close (× 0.35)           | 32.8               | 32.8                     | 32.8                          |

Screens: `out/today-silhouettes-thinned-d2.2.png`, `-d3.5.png` (today, silhouettes, thinned). Mid distances (× 1.6–2.2,
the band) still cost more than spheres; open.

### Yeast slab: spheres, silhouettes, thinned (one page, two passes each)

At Ludo's view (Distance 2430 Å, from above, 31,340 copies in view at 3,408–9,569 Å), WebGPU: spheres 29.5 / 29.0 ms,
silhouettes 19.3 / 19.4, silhouettes + thinning 19.4 / 19.2. Thinning gains nothing there: the copies in view are mostly
above 8 px. (An earlier session, same view: 35.7 against 23.9.) Screens: `out/yeast-spheres-silhouettes-thinned.png`.
Zoom-out sequence, thinned (24 frames, × 0.12 → 2.4): mean frame differences fall smoothly 27 → 0.8, no spike:
`out/zoom-sequence-thinned-8px.png`.

### Short gate (thinning, 8192, every target)

One reviewer acting as its own skeptic, over `386790c26..21a29cff2`: 3 must, 4 should, 3 nits.

| finding                                                                                                 | fixed by                                       |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| the distance slider's max follows the dragged value: it runs away (must)                                | `6ac788306` (the max held during the drag)     |
| the culling thins a member's last spheres where it has no atlas entry: copies vanish (must)             | `8a50557cc` (only negative last scales)        |
| the plan stale (4096, 22 Å, no thinning) (must); the changelog not updated (should)                     | `022b07909`                                    |
| the area 9% over: the fade's left out (should)                                                          | `5f5af257f` (`ThinArea`, at most 1)            |
| the clip ghost's culling thins at 4× the scale of its vertex stage (should)                             | `53cfea835` (`LodView.coarser`; no unit test)  |
| inside the band (distance mode, or a switch below 8 px) kept copies grow during the cross-fade (should) | left open: the culling would need the band too |
| a test of the shader/culling parity (nit)                                                               | `8a50557cc` (constants, hash, the sign check)  |
| the one-view test reads a name only; the cull tests the unenlarged sphere (nits)                        | left open                                      |

Checks: `npx tsc -b`, the app's, vitest (graphics, mesoscale; `backend-neutral` as before). The Dawn tests did not run
this round: the `webgpu` package would not install (npm hung); the WGSL change is one guard and one constant, held by
the source test.

### Core changes (added)

`e7aebd5df` atlases to 8192; `8058ab24e` every target, one view; `5e4f37651` thinning; `593d3c872` auto distance, thin
8; `5f5af257f` the area with the fade; `8a50557cc` the culling thins impostors only; `53cfea835` the ghost's scale.
App/extension: `2a62e12e5`, `6ac788306`, `d4a336c3c`, `a1079d73d`.

## Big copies jump as the camera turns; thinning controls (Ludo, 2026-11-15, night)

Ludo: "with big object, for instance in mycoplasma the big MG_271_272_273_274_192MER, MG_312_MONOMER, DNA_GYRASE,
RIBOSOME_70S, MG_224_8MER_GTP and MG_213_214_298_6MER_ADP looks wrong when camera rotate, their representation kind of
jump and is not stable. It would be nice to control the dropping threshold, and the scaling for the left visible."

### Measured first (`~/prism-me-lanes/lod-impostor-orbit.mjs`, `lod-impostor-frames-metric.mjs`)

One copy of each named ingredient alone (the other entities hidden, an instance clip around the copy), the camera
orbiting it in 1.5° steps over 45°, at 24, 40 and 64 px across, silhouettes on and off (spheres). Per step the share of
the copy's silhouette that changed; a jump is the largest step over the median (spheres: 1.2–2.8).

| copy (r)              | before, on: jump (largest step) 24 / 40 px | spheres (off) 24 / 40 px |
| --------------------- | ------------------------------------------ | ------------------------ |
| DNA_GYRASE (113 Å)    | 7.1 (0.10) / 5.0 (0.10)                    | 1.8 / 1.4                |
| MG_224_8MER (190 Å)   | 5.0 (0.30) / 5.2 (0.34)                    | 2.3 / 1.6                |
| MG_312_MONOMER (180)  | 5.6 (0.21) / 6.4 (0.26)                    | 2.2 / 1.5                |
| 6MER, 192MER, RIBOSOME | 1.7–2.4                                   | 1.5–2.8                  |

The compact ones (192-mer, ribosome, 6-mer) do not jump but are blurry silhouettes at 40–64 px; the elongated ones
(a rod, a ring edge-on, a two-lobed gyrase) lose or grow whole parts in one step.

### Cause (two)

1. **The radius cap had become 17.6 Å (a regression of `8058ab24e`, every target).** By size on screen a copy's radius
   counted at most the cap, the 90th percentile of the copies' radii, meant to let a few ribosomes switch a little
   larger. With MG's 1.1 M lipids given impostors it fell from 64 Å (targets ≥ 22 Å) to 15–17.6 Å (live
   `uLodImpostorSwitch` `[1, 12, 0.25, 17.59]`): every protein switched at 12 × r / 17.6 px, a ribosome (183 Å) a
   silhouette below 125 px (the band to 177), the 6-mer (312 Å) below 210 px, with tiles of 64 texels and nine-by-nine
   views. Ludo saw big copies as silhouettes at sizes where no blend of views holds.
2. **The views disagree off their planes.** Each of the three views was read where the ray meets its plane through the
   copy's center; what lies off that plane lands elsewhere in each view (about its height × the angle between views,
   up to 22°). For an elongated copy the blend ghosts, and a part covered by only one or two views has a coverage equal
   to their weights' sum, the same over the whole part: as the weights move the whole part crosses the 0.35 cut in one
   step (the jump). A CPU model of the fragment stage (`ImpostorAtlas.hit`) over a 60° orbit: a rod and a ring, IoU
   with the spheres 0.55 and 0.65, jumps 7.3 and 6.0 (the spheres' 1.9).

Not the cause: blend weights (continuous across triangles and the octahedral fold, checked), the one-view rule
(< 4 px), the band, thinning (big copies are above 8 px), the center (the atlas and the quad use the same invariant
sphere). Tried in the CPU model and not taken: 17 × 17 views (jumps 3.5–4.6 alone; with the parallax 2.1–3.0, the best,
but 3.6× the atlas for the large items: a decision for Ludo); a dithered cut (fewer jumps, IoU worse).

### Fixed

- `888485fcf` **the cap is the largest item's**: every copy switches at its own size on screen (12 px for a ribosome
  too). Test fails first (cap 17 for a lipid-heavy population).
- `2ac69cc8f` **each view read at the ray's front** (parallax): from the height of the ray's point nearest the center
  (always in the tile), then once more at the height read there (`ImpostorAtlas.hit`, `ParallaxSteps` 1; GLSL, WGSL);
  a copy under 4 px still reads one view once. CPU model: IoU 0.55 → 0.75 (rod), 0.65 → 0.80 (ring); jumps 7.3 → 4.3,
  6.0 → 3.5 (test fails first).

### After (same orbits)

| copy             | before 24 / 40 px | after the cap (spheres there) | at 64 px switch, no parallax | at 64 px, parallax |
| ---------------- | ----------------- | ----------------------------- | ---------------------------- | ------------------ |
| DNA_GYRASE       | 7.1 / 5.0         | 2.3 / 1.4                     | 6.8 / 4.5                    | **1.9 / 1.9**      |
| MG_224_8MER      | 5.0 / 5.2         | 3.4 / 1.8                     | 5.0 / 5.1                    | **3.1 / 2.2**      |
| MG_312_MONOMER   | 5.6 / 6.4         | 2.2 / 2.3                     | 5.6 / 6.4                    | **2.4 / 1.7**      |
| largest step 8MER | 0.30 / 0.34      | 0.16 / 0.12                   | 0.30 / 0.33                  | **0.15 / 0.14**    |

(The last two columns with the switch at 64 px, so that the big copies are silhouettes at 24 and 40 px: the parallax
alone.) Big copies through the band (9–18 px) are never empty: `out/band-ribosome-9-12-15-18px-never-empty.png`.
Frames: `out/orbit-before-top-after-bottom-*.png` and `-left-after-right-*.gif` (the cap),
`out/orbit-64px-noparallax-top-parallax-bottom-*.png/.gif` (the parallax); all frames under `out/orbit/`.

### Frame times (M1 Pro, 1280 × 800, WebGPU, off/on alternated in one page, ms)

| view                | spheres (off) | before (cap 17.6, put back for the run) | after, 12 px | after, 24 px | parallax off (12 px) |
| ------------------- | ------------- | --------------------------------------- | ------------ | ------------ | -------------------- |
| one cell × 1.6      | 10.6          | 15.2                                    | 17.9         | 17.8         | 17.9                 |
| one cell × 2.2      | 8.8           | 10.2                                    | **14.6**     | 12.1         | 14.6                 |
| one cell × 3.5      | 8.7           | 7.4                                     | **10.1**     | 8.5          | 10.1                 |
| two cells × 2.6/4/6 | 13.7/16.1/16.3 | (8.3/8.0/7.8 last round)               | 8.7/8.3–9.2/8.2–8.6 | –     | –                    |
| yeast, Ludo's view  | 30.1–31.8     | (19.3–19.4 last round)                  | 21.7–25.4    | –            | –                    |

The parallax costs nothing measurable. The cap's fix costs at mid distances (× 2.2: +43%; × 3.5: +36%): proteins of
30–100 Å now keep their spheres until 12 px (they switched at 20–68 px under the 17.6 Å cap). Far views (two cells)
and the yeast view do not change. WebGL2 × 2.2 / 3.5: 56 / 41 ms (47 / 34 last round).

### Thinning controls (item 2)

- Graphics & Motion › Far proteins, while Silhouettes: **Thin below** (0–16 px, step 0.5, 0 shown "off", default 8;
  `lodImpostorThin`) and, while thinning, **Kept grow** (0–1.5, default 1; the kept copies' area-keeping scale
  `1/√(p·ThinArea)` to this power: 0 not enlarged, 1 the area kept; new `lodImpostorThinScale`, in `uImpostorThin.y`);
  live while dragged, one step on release, the value in the box; `mesoscale.impostors` `thin`, `thinScale` (validated)
  for ⌘K and the assistant; sessions keep both (representation params). Screens: `out/thin-panel.png`,
  `out/thin-grow0-grow1-grow1.5-off.png` (× 3.5: grow 0, 1, 1.5, off).
- Commits: `bdd49a412` (core: param, shaders, `thinScale(p, k)`), `5376f4d0a`, `4277a7213` (extension), `ace6fb3b1`
  (ui.md, features.md).
- Known: above 1 the kept copies grow past the area kept; the GPU culling tests their unenlarged sphere (a copy just
  off screen whose enlarged quad would show is culled: an edge pop at most a few px; as before at 1).

### Core changes (added)

`888485fcf` the radius cap the largest item's; `2ac69cc8f` each view read at the ray's front (parallax);
`bdd49a412` the thinned copies' enlargement a param (`lodImpostorThinScale`). App/extension: `5376f4d0a`,
`4277a7213`, `ace6fb3b1`.

### Decisions for Ludo

1. **Mid-distance cost of the fix**: with every copy at its own 12 px, × 2.2 is 14.6 ms (was 10.2, spheres 8.8).
   Switching at 24 px gives 12.1 (most of it back) with big copies still silhouettes only below 24–34 px (stable now).
   Default kept at 12 px (the number the slider shows is now true for every copy); say if 24 should be the default.
2. **17 × 17 views for the large items** (the CPU model: jumps 2.1–3.0, IoU 0.85–0.94, against 9 × 9 with parallax
   3.2–4.3, 0.75–0.91): 3.6× the atlas for those items (cellpack-mg: 117 targets ≥ 60 Å). Not done; worth it if big
   copies at 30+ px still look soft.
3. **Tiles**: tiles follow the old Å-per-pixel boundary; at 12 px a 64-texel tile is about 4× oversampled for the large
   items, 8-texel tiles slightly under for small ones. Left as is.
