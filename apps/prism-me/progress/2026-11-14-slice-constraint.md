# slice-constraint (brief, 2026-11-14)

Ludo: "I am missing constraint on slice (the plane made from the volume)." Asked and answered (2026-11-14): **Fit and
Grow** stay on the slice; a copy on a slice is oriented **like on a surface** (its axis along the plane's normal; the fit
may spin it about the normal and tilt it up to 5°, as on a mesh).

Slug `slice-constraint`, branch `me/slice-constraint` from prism-me 93a1158bd, port 1378. Lane model: **Opus** (the
fit's and grow's surface paths; small but subtle).

## Now

- Paint on a slice (density-fit, `paint-mode.ts` ~378 and ~510, `PaintHost.sliceAt`, `fit.ts` `slicePlane`,
  `rayOnPlane`): the copy's center is put on the slice's plane, its normal the plane's. Then the fit runs **free in 3D**
  within its reach (no `normal` passed: `paint-mode.ts` ~561-563 passes the surface only for a mesh), so a copy leaves
  the slice (Ludo's lattice walls: it runs to its reach; morning note "After the crash", open).
- Grow from a copy painted on a slice: no surface (`GrowSurface` is built only for a mesh, `grow.ts` ~727-780,
  `mesoscale.grow`'s `mesh`), so every mode spreads in 3D.

## Wanted

The slice's plane is a surface like a mesh's, wherever a mesh surface is used:

1. **Fit on paint and on the cursor**, on a slice: the surface fit (`FitOptions.normal` = the plane's normal: tangent
   shift, spin, tilt ≤ `SurfaceTilt`, shell along the normal) so the copy stays on the plane.
2. **Grow** from a copy on a slice, every mode that takes a surface (Tiling, Sphere, Random walk, Helix, Spiral,
   Symmetry's Snap) lays its copies on the plane, their up the plane's normal, as on a mesh. A `GrowSurface` for a plane
   (`project`: the point projected along `along` or the normal onto the plane; the normal constant), bounded by the
   slice's extent in the volume (a plane ends where the volume's box does: `project` fails outside it).
3. **How Grow knows**: the source copy's slice recorded where its stroke is (as a mesh's ref is: the volume's ref and
   the plane, so a moved slice later does not move the grown copies), and/or Grow › On: the slice under it. Read how
   `mesh` reaches `mesoscale.grow` and do the same for a slice (`slice: {volume ref, point, normal}` or the volume ref
   and the slice's params at the time). Sessions keep it; old sessions read none.
4. **Grow with Fit to** on a slice: each grown copy's fit on the plane too (as `97015c359` did for meshes: the source's
   fitted score for the threshold, the copies fitted on the surface).
5. Live settings, Count, Clear, Undo, ⌘K/assistant (`mesoscale.grow` / `mesoscale.paint` take the slice as they take
   `mesh`), the cap: as for a mesh.

## Tests (fail first)

- A copy painted on a z slice with Fit to, on a synthetic map whose nearest density is 6 Å off the plane: the fitted
  copy's center stays on the plane (|z − z0| < 0.01 Å) and its axis within 5° of the normal; without the slice, it moves
  off (the current behaviour, pinned).
- A plane `GrowSurface`: project inside/outside the volume's box; the normal; an oblique (plane-mode) slice.
- Tiling (Hex, Count 19), Random walk, Helix, Spiral from a copy on a slice: every copy on the plane (|d| < 0.01 Å),
  up along the normal; Tiling at a slice's edge stops at the box.
- A fitted Tiling on a slice over the synthetic tomogram (density-fit's `tomo-1crn-tiling.mrc` or one like it): copies
  only on filled sites, all on the plane.
- The slice stored with the stroke/grow; a session round-trip; an old session reads no slice.

## Check (in the app, port 1378)

Ludo's `~/Downloads/7-2_cryolithe_bin2.mrc` with a z slice through the capsids and PDB 8CKV (as in the fit-real runs,
`~/prism-me-lanes/fit-real*`): paint on the slice with Fit to (Dark): copies stay on the slice; Grow › Tiling (Hex,
108.5 Å) with Fit to and Threshold 0.6: copies on the plane on the lattice. Also the synthetic tomogram. Screenshots
from above and edge-on (the copies in one plane).

## Size

~200–300 production lines (a plane surface, the slice carried to grow, the fit's normal on slices).

## Rules

Core changes (outside the three extensions) as their own commits, recorded in a "Core changes" section here (the
coordinator moves them to `_spec/core-changes.md`); probably none. ui.md and features.md updated.
