# slice-constraint (brief, 2026-11-14)

Ludo: "I am missing constraint on slice (the plane made from the volume)." Asked and answered (2026-11-14): **Fit and
Grow** stay on the slice; a copy on a slice is oriented **like on a surface** (its axis along the plane's normal; the
fit may spin it about the normal and tilt it up to 5°, as on a mesh).

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
- Tiling (Hex, Count 19), Random walk, Helix, Spiral from a copy on a slice: every copy on the plane (|d| < 0.01 Å), up
  along the normal; Tiling at a slice's edge stops at the box.
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

## Built (2026-11-14)

- **A slice is a surface** (`slice-surface.ts`): `planeSurface(plane, grid)`, a `GrowSurface` for a slice's plane
  bounded by its volume's box (its voxels' centers, indices 0 to n − 1 of the drawn grid): a point projected along a
  line within the reach, else its foot; none outside the box; its triangles the plane's section of the box (Sphere).
  `GrowSlice` {volume, point, normal}; `sceneSliceAt` (the shown slice through a point).
- **Paint** (`mesoscale.paint { slice, slicePoint, sliceNormal }`): a copy on the slice's plane is turned along its
  normal (Turn Auto) and fitted on it (`FitOptions.normal`: tangent shift, spin, tilt ≤ 5°); the stroke's copies off it
  as before (free at a depth, on the mesh's normal on a mesh). Paint mode records a stroke's first slice and sends it;
  the copy under the pointer on a slice is turned and fitted the same way.
- **Grow** (`mesoscale.grow { slice, … }`): Tiling, Sphere, Random walk, Spiral, Symmetry's Snap on the plane as on a
  mesh, their up along the normal, ending at the box; with Fit to, each copy fitted on it (the source's fitted score for
  the threshold: as `97015c359`). Crystal and Helix: refused by the operation on a slice; Grow's settings send no slice
  for them (they grow in space). The grow records `grow.slice` (volume, plane, name): a session keeps it.
- **Grow knows**: the paint's slice reaches `growSettings.slice` with its last copy; a right-clicked source takes the
  slice shown through it; Grow › On lists "Slice of <volume>" (kept while a mesh or None is picked: `inSpace`); the live
  grow keeps it; Snap shows on a slice. The slice is three plain params (volume text, two vectors) so the assistant and
  ⌘K carry it; an empty volume (the default) is none, as `mesh`.

## Checked in the app (1378)

`~/prism-me-lanes/slice-constraint-check.cjs`: Ludo's `7-2_cryolithe_bin2.mrc`, 8CKV, the middle Z slice (z 1496.3 Å). A
real paint-mode click (Fit to Auto, Dark): the hint "fit 2.0σ, 5.9 Å, 5°", the copy at |z − z0| = 5e-5 Å (float32); Grow
got the stroke's slice; Tiling Hex 108.5 Å, Count 37, Fit to, Threshold 0.6: 7–15 copies kept (the click's random spin),
all at |z − z0| ≤ 5e-5 Å, on the capsid walls; Grow › On shows "Slice of 7-2_cryolithe_bin2.mrc". Screenshots in the
session scratchpad `slice-constraint/` (c2-top.png from above, c3-edge.png edge-on: one plane; c4-grow-on.png). The
synthetic tomogram: by the headless tests (`slice-fit.test.ts`), not in the app.

## Tests

`slice-surface.test.ts` (4), `slice-fit.test.ts` (11: paint on a slice pinned against the free fit, a stroke onto a
mesh, the turn per copy, Tiling/Sphere/Walk/Spiral on the plane, the box, refusals, the session round-trip, a fitted
Tiling over a tomogram, Grow knowing the slice, the assistant's params), `paint-slice.test.ts` (+1), the app's
`grow.test.tsx` (+1, On a slice). Lane suites: 861 tests (860 passed, 1 skipped); `tsc -b`, `tsc -p apps/prism-me`,
`pnpm lint`, biome format clean. `check:workspace` fails on `@molstar/plugin-ui ./*.css` (not built here; not this
lane's); `format:check` flags other progress files only.

## Review

Reviewer 2 must, 4 should, 6 nits; skeptic: 12 confirmed, 0 refuted (#2 lowered to should), 2 new (N1 should, N2 nit).

| #   | Finding                                                                  | Outcome                                    |
| --- | ------------------------------------------------------------------------ | ------------------------------------------ |
| 1   | a stroke from a slice onto a mesh fits its mesh copies free              | fixed 243ff76f3                            |
| 2   | the assistant and ⌘K drop the `slice` object param                       | fixed d77eb0831 (three plain params)       |
| 3   | Helix refused on a slice; growParams kept the slice for it               | fixed 0243a6831 (in space); for Ludo below |
| 4   | Grow › On cannot go back to the slice; no UI test                        | fixed 0243a6831, test 3e0fe152f            |
| 5   | a slice stroke's depth copies face the camera                            | fixed f306d7b32                            |
| 6   | tests: Symmetry Snap on a slice, a moved volume's box, an old record     | open (Snap: below; the others by reading)  |
| 7   | project gives no foot when its line meets the plane outside the box      | fixed 5f379bc8b                            |
| 8   | a point of fewer than 3 numbers accepted                                 | fixed d77eb0831                            |
| 9   | settingsOfGrow made a new slice each call                                | fixed 0243a6831                            |
| 10  | meshUnder's doc above sliceOf                                            | fixed 507715452                            |
| 11  | a slice without normals turned at random                                 | fixed f306d7b32 (the plane's normal)       |
| 12  | a stroke crossing a second slice: the cursor fits on it, the commit free | open (nit: a stroke keeps its first slice) |
| N1  | the agent's default slice would count as one                             | fixed d77eb0831 (empty volume: none)       |
| N2  | `sceneSliceAt` uses the foot only                                        | open (nit)                                 |

## Learned

- The fit's surface path already did the work (`FitOptions.normal` zeroes the normal shift): the slice was only
  plumbing; the copies stay on the plane exactly (float32 in the list).
- A GrowSurface for a plane is a few lines; the box's clip (Sutherland–Hodgman in grid space) covers slices on a face.
- A helix on a plane is degenerate with the mesh's rule (radial lines from an axis in the plane meet it only at the
  axis).
- Symmetry's Snap on a slice behaves as on a mesh: copies whose radial line misses the plane within its reach stay where
  the group puts them (off the plane) — the test of "every copy on the plane" does not hold for it.
- `git stash` in a lane worktree with nothing to stash pops another branch's stash (the list is shared): never use it in
  lanes (caught and undone here; the stash entry kept).

## Size

~395 production lines (brief ~200–300): slice-surface.ts 161, operations.ts +142, controls.tsx +59, paint-mode +22. What
took the room: the review's fixes (per-copy turn and fit, the params for the assistant, On's `inSpace`) and the Grow ›
On select.

## Decisions for Ludo

1. **Helix on a slice**: grows in space (as Crystal) from the Grow section; `mesoscale.grow` refuses one with a slice. A
   plane has no axis for the mesh's helix. Wanted instead: a helix lying in the plane (flattened: a zigzag), or about an
   in-plane axis?
2. **Symmetry's Snap on a slice**: as on a mesh (a copy beyond its reach stays off the plane). Snap every copy straight
   onto the plane instead?
3. **The box**: the voxels' centers (0 to n − 1), half a voxel inside the drawn slice's edge. OK?
4. **On None** with a slice keeps it listed to pick again (`inSpace`); a mesh picked wins while picked.

## Core changes

None.
