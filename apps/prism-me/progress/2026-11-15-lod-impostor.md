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
  `geo/geometry/spheres/spheres.ts` `LodLevelsPresets` / `LodPixelPresets`, `repr/particles/representation/target/
  common.ts` and `representation.ts`; the shader's `assign-lod-factor`; `.v6/plans` `screen-space-lod.md`). Far away a
  protein is a handful of big spheres: a lumpy round blob, its shape lost.

## Wanted

A last level, far away, where each copy is drawn as an **impostor**: a camera-facing quad showing the protein's
silhouette as seen from that direction, filled with the copy's color, with depth, so it looks like Goodsell's painting.

1. **Per ingredient (a particle target's structure), an atlas of views** made once at load: the full-detail protein seen
   from many directions over the sphere (octahedral impostor, e.g. 8 × 8 = 64 views; choose the count), each a small
   tile (32–64 px; choose) holding coverage/mask and depth (and anything the look needs: e.g. a normal or an ambient
   term). Rendered on the GPU from the existing geometry or splatted on the CPU: choose by quality and load time
   (measure on mycoplasma's ingredients).
2. **Draw**: per copy, the view direction in the copy's frame picks the tile(s); blend the nearest 3 (octahedral
   interpolation) so orbiting does not pop; write depth from the tile (copies overlap correctly; Mol*'s outline and
   SSAO passes see real shapes); color the copy's (its theme: entity, compartment, chain…, and `ColorLevels` "By zoom"
   where on); picking gives the copy.
3. **The look**: as close to the reference as you can get at a distance: flat color, a crisp silhouette, the thin dark
   edge between molecules (from the outline pass or in the tile). Compare your screenshots against the reference and
   iterate; record what you tried.
4. **The transition** (Ludo: "the best looking transition"): no visible pop between the sphere levels and the impostor
   while zooming or orbiting — e.g. a screen-door/dithered cross-fade over a band of pixel sizes, matched size and
   color between the last sphere level and the impostor, temporally stable. Measure it (frame sequences while zooming)
   and choose the band.
5. **Both backends**: WebGL2 and WebGPU (prism-me's default is WebGPU; check what the app uses). A device that cannot →
   the current levels.
6. Default on for structure particle targets in the explorer's graphics modes, with a param to turn it off; fibers,
   lipids/membranes and other targets keep their current levels (say what you saw).

Where it lives: Mol\* core (graphics: the atlas builder, the impostor visual/level, shaders), on prism-me, as commits of
their own with no app/extension hunks, listed in a "Core changes" section of this file (the coordinator moves them to
`_spec/core-changes.md`); app/extension wiring separate.

## Tests (fail first)

- The atlas: a known shape (e.g. an ellipsoid of spheres) gives the right silhouette area per view direction; the
  view for a direction is the octahedral mapping's.
- The draw: for a copy turned by R, the tile chosen for camera direction d is the one for R⁻¹d.
- Depth written: two overlapping impostors occlude as the full-detail spheres do (render test, small scene).
- Picking returns the copy.
- The level switch by pixel size: above the band full levels, below it impostors, inside the band both (the fade).
- Perf guard: far view of 2 × mycoplasma, frame time no worse than the current far levels (record both).

## Check (port 1381)

`mesoscale.example` `cellpack-mg` (Mycoplasma genitalium) loaded **twice**, the second moved beside the first
(`stage.move`), so the camera can back off far. Screens at 4–5 distances, current vs impostor, side by side with the
reference; a zoom-out frame sequence (and an orbit) showing the transition; frame times (current vs new) at each
distance. Screens to `/private/tmp/claude-501/-Users-ludovicautin-molstar-proto-git/bc8a7dcf-b4ed-4027-911e-5f56df74a469/scratchpad/lod-impostor/`
and copies of the best to `~/prism-me-lanes/lod-impostor-ref/out/` (durable).

## Size

~600–1,000 production lines (atlas builder, visual, shaders ×2, the fade, wiring). Over: record what took the room.

## Rules

Tests fail first; checks pass; the gate (lane-reviewer, lane-skeptic); no PR, no merge, no push to prism-me; push
`me/lod-impostor`. Never `git stash pop`. `@author Ludovic Autin <autin@scripps.edu>` on new files. Progress file
finished: built, decided (each with why), measurements, review table, learned, size, decisions for Ludo, Core changes.
