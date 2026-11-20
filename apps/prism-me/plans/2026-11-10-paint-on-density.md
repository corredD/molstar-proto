# Paint on density (plan, 2026-11-10)

Ludo: "next round will be paint on density. when we place an object on a slice, it should have a slight bias /
minimisation using the surrounding density, a mini envelope matching. From that seed we could grow a tiling either on a
surface (mesh constraint), as a crystal, as a fiber (curve constraint)."

This builds on paint (PR #64, the paint layer merged into it): a copy is a particle of its list, and a structure of the
scene can be the brush.

## Revised order (Ludo, 2026-11-11)

"lets start by the growing. If I paint an instance, or I click an instance, I should have a growing options (randomwalk
for fiber, crystal growth, symetry growth, tiling growth, random growth in a sphere). Then placement and growing can be
constraint on mesh surface first then weighted by density if one selected."

- Symmetry growth is both point/helical operators and the structure's own space group; copies go exactly where the rule
  says, overlaps allowed (Ludo, 2026-11-11).

| #   | Lane             | Gives                                                                                                            | Depends |
| --- | ---------------- | ---------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | `grow`           | Grow from an instance (right-click, or the last painted): Random walk, Crystal, Tiling, Sphere; round 2 Symmetry | PR #64  |
| 2   | `grow-mesh`      | paint and grow constrained to a mesh surface (OBJ, PLY, VTP first)                                               | 1       |
| 3   | `density-weight` | D1's fit on a slice, then growth weighted by a chosen density (each copy fitted, kept above a threshold)         | 1, 2    |

The D1 and D2 sections below stay the design for lanes 3 and 2.

## What exists (survey, 2026-11-10)

- **Slices.**
  - A click on a slice picks it: `getSliceLoci` (graphics/src/repr/volume/slice.ts:714) gives `Volume.Cell.Loci`, and
    the pick gives a 3D position.
  - The plane is known: `statePlane` (cryoet/src/oblique-handle.ts:41), `obliquePlane` (oblique.ts:66), the grid axis.
  - Paint's `surfaceAt` (mesoscale/src/pick-surface.ts:66) would get the plane's normal from neighbouring picks.
    `PaintHost.refine` handles only particle loci, and Place `auto` paints a protein at a depth, not on the slice.
- **Density.**
  - `Grid` has stats (mean, σ) and `makeGetTrilinearlyInterpolated(grid, 'relative')` (model/volume/grid.ts:204), which
    gives (v − mean)/σ at a point in Å.
  - `makeGetInterpolatedGradient` (:454) works in grid coordinates.
  - The grid to sample is the one the slice draws (`drawnGrid`, cryoet/operations.ts:906: a moved volume's last
    decorator).
  - A tomogram has no contrast sign: protein is often dark.
- **Fitting: none in the TS monorepo.** No correlation, no optimiser. What can be reused:
  - `computeGaussianDensity` (core/math/geometry/gaussian-density.ts:23): an object's map.
  - `PrincipalAxes`.
  - The copy's own points: a structure's atoms, a `sites` target's sites, a `volume` target's voxels (an EMDB average
    _is_ an envelope).
- **Tiling: none on this branch.** Prior art:
  - TomoNet (`~/Dev/TomoNet`, objects/expand.py:49-117, bin/sta_expand.py): from a seed, neighbour = X + R·tₖ for each
    repeat-unit translation, aligned and kept above a CCC threshold, duplicates removed at 0.8 × the repeat. This is the
    lattice growth wanted here.
  - cellpackgpu: `SurfaceQuadTiler.cs` and `SurfaceHexTiler.cs` (frontier growth on a mesh), and `InsulineCrystal.cs`
    (grid and space group).
  - Other branches: `me/mesoviewspec` (`meso.lattice` on spheres and ellipsoids; `meshSampler`,
    `pointTriangleDistance2`, `sdfGrid` in geometry.ts) and `me/lipid-tiles` (mesh remeshing, `offsetSurface`).
  - The membrane-tile-packing skill (Python: planar and sphere seeded growth; it saturates at about 0.80 of the area).
- **Surfaces in a tomogram scene.**
  - Segmentation masks (membrain-seg and others) are **volumes** drawn as an isosurface at 0.5
    (cryoet/load-scene.ts:95), not meshes. Their normal is the mask's gradient; a point goes onto the surface by Newton
    steps to 0.5.
  - OBJ, PLY and VTP meshes are shapes with triangle picking. `getMeshTriangleLookup(mesh).pick` gives the closest
    triangle (geo/geometry/mesh/triangle-pick.ts:37). Portal glb meshes have no triangle picking.
- **Curves.** `resamplePath`, `makeFiber`, `fiberRotations` (mesoscale/src/paint.ts).
- **Where a refined pose goes.**
  - Into the stroke, as explicit positions and rotations: refine in the scene frame before `toListFrame`
    (mesoscale/src/operations.ts:772).
  - The decorator does not depend on the volume, so it cannot fit again when applied. A fitted fiber is stored as its
    points, not remade by `makeFibers`.
- **Handedness.** TODO.md:151: some tomograms are of the other hand than their EMDB average, and no rotation fixes a
  mirror. A fit fails silently on such a pair; `flipVolumeX` exists.

## D1. A seed fitted to the density (`density-fit`)

**What Ludo sees.**

1. With a tomogram slice shown, a click on the slice paints a copy **in** the density at the picked point. The copy's
   center is on the slice, not its surface. Its axis is upright to the slice when the brush is a membrane protein, else
   as Turn says.
2. **Fit** in Paint (On by default when a density is under the pointer). The copy shifts and turns a little toward the
   density around it, at most a set **reach**: by default a third of its radius and 15°.
3. The copy under the pointer shows the fitted pose before the click (the fit is a few ms). The hint gives the score:
   "fit 2.4σ, 3.1 Å, 8°".
4. **Contrast**: Dark (default for a tomogram) or Bright.
5. One undo step, as a stroke.

**How: a mini envelope match.**

- The copy's envelope is a cloud of about 200 points from its own object:
  - a structure: atoms, k-means'd;
  - `sites`: its sites;
  - a `volume` target: its voxels above its level;
  - a sphere: points in its ball.
- A shell of about 100 points around it: the envelope pushed out by about 1.5 voxels along its outward direction.
- **Score**:
  - the mean density inside minus the mean in the shell, in σ of the slice's grid, signed by Contrast;
  - minus a soft restraint to the picked pose (`k·(d²/reach² + θ²/θmax²)`): the "slight bias", so a flat density leaves
    the copy where it was painted.
- **Search**: Nelder-Mead over 6 parameters (shift; rotation vector), bounded by the reach, from the picked pose. Then
  one refinement on a finer step.
  - Cost: about 300 evaluations × 300 trilinear samples, about 2–5 ms in TypeScript. That is fast enough for the cursor;
    a worker is not needed.
- Optional: the volume low-passed to the envelope's scale (a Gaussian of 1–2 voxels, cached per grid), so a noisy
  tomogram gives a smooth score.
- Stored in the stroke as its pose. The stroke also keeps `fit: { score, shift, angle }` for the report.

**Tests.**

- A synthetic map: the Gaussian density of 1CRN at a known pose, plus noise. A seed 4 Å and 10° off is fitted back
  within 1 Å and 3°.
- A flat map leaves the pose as painted.
- A fit never goes past its reach.
- Contrast: the same map inverted, with Contrast Dark, gives the same fit.
- A click on a slice gives the slice's point and its plane's normal exactly.
- One undo step. A session keeps the fitted pose without the volume.

**Size**: about 450 production lines (fit.ts about 250, the slice's refine about 60, the cursor and the operation about
80, Paint's controls about 60).

## D2. Growing a tiling from a seed (`grow-lattice`, then `grow-surface`, `grow-fiber`)

**One growth engine, three rules.** From a seed (a fitted copy):

1. The rule proposes neighbours of each copy on the frontier.
2. Each neighbour is fitted (D1, with a reach that the rule restricts).
3. A neighbour is kept when:
   - its score is at least a **threshold** (by default 0.6 × the seed's), and
   - it does not clash: farther than a fraction of the spacing from every copy kept (TomoNet's duplicate rule), and not
     inside the model's copies (a grid lookup).
4. Growth stops at a **count**, at the region's edge (the tomogram's box, or the mask's component), or when nothing more
   is kept.

- It is shown growing, ring by ring: `setParticleFrames` previews without a state change.
- It commits as one stroke (one undo step) holding:
  - the seed;
  - the rule and its parameters;
  - every kept pose, explicit.
- **Grow** in Paint, with Count and Threshold. Esc stops it and keeps what grew.

**D2a. Crystal / lattice (`grow-lattice`).**

- **Rule**: neighbour = X + R·tₖ, for the lattice's vectors tₖ in the seed's own frame (±a, ±b, ±c; a 2D lattice has no
  c).
- **The vectors are typed** (Ludo, 2026-11-10): a, b, c (Å) and α, β, γ in Paint, in the seed's own frame; c empty for a
  2D lattice. Later, if wanted: taught by painting 2–3 copies, or a structure's own unit cell.
- The fit's reach is small, because the lattice already predicts the pose.
- **Size**: about 400 lines. The growth engine is about 250 of them and is shared by the next two.

**D2b. On a surface (`grow-surface`).**

- **Constraint, meshes first** (Ludo, 2026-11-10): a file mesh (OBJ, PLY, VTP: `getMeshTriangleLookup`, the closest
  triangle and its normal, in the shape's instance transform and pixel-size scale). Then a segmentation mask (its 0.5
  level, normal = its gradient; a point projected by Newton steps) and the portal's glb meshes (no triangle picking
  yet).
- **Rule**: six neighbours at the spacing, in the tangent plane at the copy, projected onto the surface and turned to
  its normal. Hexagonal by default, square as a choice: cellpackgpu's tilers. Or the taught lattice's two vectors
  carried in the tangent plane.
- **Fit**: in-plane shift and spin about the normal, with a small tilt.
- **Size**: about 250 lines for meshes (the mesh projector about 120, the rule about 80, controls about 50); the mask
  projector about 120 more, after.

**D2c. Along a curve (`grow-fiber`).**

- **Constraint**: a curve.
  - First: the painted fiber's path. Its units are each fitted with the shift along the path and the twist free (a
    fiber's rise and twist become starting points, not rules).
  - Then **trace**: from the seed, step one rise along its axis, fit, and follow where the density leads, until the
    score drops. This is a filament tracer, seeded.
- Stored as explicit points; `makeFibers` does not remake a fitted fiber.
- **Size**: about 300 lines.

## Plan (lanes, in order)

| #   | Lane           | Gives                                                                                      | Size | Depends            |
| --- | -------------- | ------------------------------------------------------------------------------------------ | ---- | ------------------ |
| 1   | `density-fit`  | paint on a slice; a seed fitted to the density in a reach; Fit, Contrast; the cursor's fit | ~450 | PR #64             |
| 2   | `grow-lattice` | the growth engine; a lattice of typed vectors; Grow, Count, Threshold                      | ~400 | 1                  |
| 3   | `grow-surface` | growth on a mesh (then a mask's level), hexagonal or square, turned to its normal          | ~250 | 2                  |
| 4   | `grow-fiber`   | a fiber's units fitted along its path, then a seeded trace                                 | ~300 | 2 (1 for the path) |

- Lanes 3 and 4 run in parallel after 2.
- Each lane is a design and hot-path lane (the fit, the engine), so Opus.
- Out of the critical path:
  - the stroke speed on cellpack-mg (fast-path lanes): a tomogram scene's lists are small;
  - the handedness flip (a toggle on the volume, `flipVolumeX`): a TODO, unless Ludo wants it in D1.

## Decided (Ludo, 2026-11-10)

1. The fit: a shift and a turn within a reach (a third of the radius, 15°), pulled back toward the click.
2. A crystal's vectors: typed.
3. A surface: file meshes first, masks after.
4. Handedness: later, a TODO.

## Still open (defaults taken unless Ludo says)

1. **Contrast:** Dark by default for a tomogram, with a toggle (recommended), or read from the volume's metadata where
   it says.
2. **Keeping a neighbour:** a score relative to the seed's (0.6 × by default, a slider; recommended), or an absolute σ.
3. **A fiber:** along a painted path first, then a trace (recommended), or the trace from the start.
