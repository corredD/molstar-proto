# Lane density-fit (2026-11-13, night)

## Brief

From [plans/2026-11-13-night-lanes.md](../plans/2026-11-13-night-lanes.md) (Ludo, 2026-11-13). Branch `me/density-fit`
from prism-me at eaf253942 (grow-helix merged).

D1 of [2026-11-10-paint-on-density.md](2026-11-10-paint-on-density.md), then growth weighted by density.

- **Fit on paint**: with a density (a tomogram, an MRC) chosen under Paint › **Fit to** (a volume of the scene; None
  default unless a slice is under the pointer), each painted copy is fitted: a shift and turn within a reach (a third of
  its radius, 15°), pulled back toward the click (the plan's score: inside − shell, in σ, signed by **Contrast**
  Dark/Bright, minus the restraint; Nelder-Mead over 6 parameters). Painting on a slice puts the copy's center on the
  slice. The copy under the pointer shows the fitted pose; the hint gives "fit 2.4σ, 3.1 Å, 8°".
- **Density-weighted grow**: Grow › **Fit to** the same density: every grown copy is fitted within a smaller reach and
  kept only above a **Threshold** (0.6 × the source's score by default); Count counts kept copies. Works with every mode
  (walk, tiling, sphere, helix, spiral, symmetry once merged); prefix stability holds per kept copy.
- Envelope: ~200 points from the copy's object (atoms k-means'd; sites; volume voxels; a sphere's ball), a shell of ~100
  pushed out 1.5 voxels; optional low-pass (Gaussian 1–2 voxels, cached per grid).
- Stored as explicit poses in the stroke, with `fit: {score, shift, angle}`; a session keeps them without the volume.
- Tests (from the plan): a synthetic 1CRN map + noise, a seed 4 Å / 10° off fits back within 1 Å / 3°; a flat map leaves
  the pose; never past the reach; Contrast inverted gives the same fit; a slice click gives the slice's point; a
  weighted tiling keeps only copies above the threshold on a map with half the sites empty; one undo step.
- Check: a synthetic tomogram (a lattice of 1CRN densities with noise, written as an MRC) in the app: paint near a site,
  the copy snaps; grow Tiling with Fit to: copies only on the sites; screenshots.
- Handedness flip stays a TODO (plan, Decided 4).

**Shared rules for the night.** New code in new files where it can be; edits to operations.ts, controls.tsx, paint.ts
kept to the wiring (four lanes touch the mesoscale package). Nothing pushed, no PR. Tests fail first; the gate
(lane-reviewer, then lane-skeptic); progress file, `.v6/changelogs/density-fit.md`, ui.md and features.md.

**Size.** ~550 production lines. **Model.** Opus. **Port.** 1372
(`node scripts/esbuild/app.mjs apps/prism-me --dev --port 1372`, log `~/prism-me-lanes/dev-1372.log`), left running for
Ludo's morning try.

## Built (2026-11-14, night)

- **`fit.ts`** (new): a copy's envelope (its object's points about its center, `ParticleTarget.getCenter`: a structure's
  atoms, a `sites` target's sites, a `volume` target's voxels above 1σ; subsampled to 4000, k-means'd to 200; a shape or
  no object: a ball), a shell (100 Fibonacci directions: the envelope's farthest point along each pushed out 1.5
  voxels + 2 Å), the map (σ about its mean, 0 outside; a strided trilinear read, about 20 ns), the score (inside −
  shell, signed by Contrast), Nelder-Mead over 6 parameters (shift / reach, rotation vector / θmax, projected into their
  balls before each evaluation: never past the reach), then once more on a finer simplex; about 2.8 ms a fit (360
  evaluations × 300 points). `fitGrown` (grown copies fitted in order, kept above a threshold and apart from the copies
  kept, up to Count), `fitCopies` (a stroke's copies in the list's frame, fitted in the scene), `slicePlane` and
  `rayOnPlane`, `sceneVolumes` (a volume's last decorator's grid, as cryoet's `drawnGrid`, without importing cryoet).
- **`mesoscale.paint { fit, contrast }`**: each copy of a stroke fitted (a third of its radius, 15°); the stroke keeps
  `fit: { volume, score[], shift[], angle[] }` and the fitted poses. A fiber stroke (a path) is not fitted.
- **`mesoscale.grow { fit, contrast, threshold }`**: the source scored at its pose (≤ 0: refused), every grown copy
  fitted (a sixth of its radius, 7.5°) and kept at Threshold × that score; Count (Sphere, Spiral, Tiling on a mesh)
  counts kept copies, the rule drawn 4 × Count; a fitted fiber (Random walk, Helix, Spiral) is stored as its units'
  poses (a plain stroke: the decorator would remake them unfitted). No copy kept: refused. The record's params carry
  `fit`, `contrast`, `threshold` (the section follows the live grow back).
- **Paint on a slice** (`PaintHost.sliceAt`): the pick's representation's props give the plane (a grid slice, x/y/z
  absolute or relative, or an oblique plane); the copy's center where the pointer's ray meets it, its normal the plane's
  toward the viewer, at a depth or on a surface; a pending pick is read again next frame (at the release: the depth).
  `SurfacePoint.volume`: the volume of the scene the slice is of.
- **The copy under the pointer** (`pluginCursorFit`, `CursorFit` in `copyCursor`): shown at the pose the click paints
  (the same fit); the hint gains "fit 2.4σ, 3.1 Å, 8°".
- **UI** (`fit-controls.tsx`, new): Paint › Fit to (Auto, None, the scene's volumes) and Contrast; Grow › Fit to (None,
  volumes), Contrast, Threshold, live on the last grow as its other settings (a fitted fiber's Rise, Twist, Jitter make
  the grow again: `mesoscale.grown-fiber` refuses a non-fiber stroke).
- Shared files kept to the wiring: operations.ts (params, the fit block of each op, `FitParams`, `fitVolumesState`,
  `GrowSettings`), paint.ts (`PaintStroke.fit`), paint-mode.ts (settings, `sliceAt`, the hint, `fitOf`), paint-host.ts,
  paint-cursor.ts, pick-surface.ts, controls.tsx (two components, `settingsOfGrow`, the fiber key).

## Decided (lane, simplest sound rule; Ludo to confirm)

1. **Fit to Auto** (Paint's default): the volume whose slice is under the pointer, none elsewhere; None; or a volume.
   Grow's default None.
2. **Pull** k = 0.1 σ at the reach's edge per term (`k·(d²/reach² + θ²/θmax²)`). At 0.2 the turn came back 3–4° off on
   the noisy map; at 0.05 a noise-only map lets the copy wander to the reach.
3. **Reach from the envelope's own radius** (its farthest point), not the list's radius (10 Å when a list has none):
   1CRN's is 17 Å, a reach of 5.7 Å.
4. **Grow's reach half paint's** (a sixth of the radius, 7.5°): the rule already says where.
5. **Count counts kept copies** where a mode has a Count (Sphere, Spiral, Tiling on a mesh): the rule drawn 4 × Count
   (at most a grow's 20000), fitted in order, stopped at Count; each fit from its rule pose alone, so prefix-stable.
   Rings, cells, Steps and Turns bound the copies tried (the kept ones of them).
6. **Two copies in one site are one**: a copy whose center is within the copy's radius of a copy kept (or the source) is
   dropped (TomoNet's duplicate rule, at the radius).
7. **A fitted fiber is its units' poses** (the plan's "stored as its points"); a fiber of a bank's units (DNA, RNA) is
   refused with a fit (its units differ a point).
8. **The source is scored, not fitted** (it stays where it is); off the density (score ≤ 0) the grow is refused.
9. **No low-pass** (optional in the plan): a copy of a whole tomogram's grid is too large; on the test map it helped the
   shift, not the turn. The score is the 300-point mean.
10. **A slice's volume instance transform is not read** (cryoet moves a volume by its decorators' grid, its instance is
    identity). A frame slice gives no plane (the pick's point as before).
11. **Turn on a slice** stays as Turn says (Auto at a depth: at random; a membrane protein upright to the slice).
12. Handedness flip stays a TODO (plan, Decided 4).

## Learned

- On a noisy map the turn is the weak part: 1CRN (10 kDa, compact) 4 Å / 10° off comes back within 0.3 Å but 3–7° at 2 Å
  blur and noise 0.1–0.15 of the peak, the noisy map's own optimum (its score above the true pose's). The test map is
  1.5 Å voxels and 1.5 Å blur, noise 0.1: within 2.4°. A real tomogram (8–14 Å voxels) will fit the shift, not the turn
  of a small protein.
- A first click in the app was not fitted: the copy under the pointer moving makes the canvas's pick pending at the
  press; depth mode never waited for it. Fixed (4a9444b55), with a test.
- The mesoscale package's `test:scaling` config does not start since the master merge (`heapTests` moved to
  `@molstar/test-harness`); `fit.scaling.ts` imports the harness by path and passed with a temporary config.
- `pnpm format:check` (prettier on plans, progress/current.md, decisions-ludo.md, TODO.md: not this lane's files) and
  `pnpm check:workspace` (`@molstar/plugin-ui: Export pattern ./*.css`) fail on the branch as it came.

## Tests

- `fit.test.ts` (11): envelope, the score at a site, 6 seeds 4 Å / 10° off back within 1 Å / 3°, flat map, noise alone,
  never past the reach (15 Å / 40° off), Contrast inverted, `fitGrown` keeps only filled sites, Count prefix-stable and
  the source's site taken, slice planes (grid absolute and relative, oblique, frame) and the ray.
- `fit-operation.test.ts` (6, headless viewer, an MRC in memory): paint fitted onto a site (≤ 1 Å, < 3°), one step, a
  session keeps it with the volume deleted; a volume not there refused; the cursor's fitted pose is the painted one; a
  weighted tiling keeps only the copies on the filled sites (half empty) and a threshold too high is refused; Count
  prefix-stable (Sphere); `growParams` and a live replace keep the fit.
- `paint-slice.test.ts` (5, jsdom): a click on a slice paints at its point and normal (depth and surface), Fit to Auto,
  None, a volume; the cursor's fit in the hint; a pending pick at the press waited for; still pending at the release:
  the depth.
- `fit.scaling.ts`: N fitted copies, n and 4n, the quadratic control.
- Checks: `npx tsc -b`, `npx tsc --noEmit -p apps/prism-me`, `pnpm lint`,
  `npx vitest run packages/extensions/mesoscale apps/prism-me` (60 files, 522 tests after the review).

## In the app (port 1372)

`~/prism-me-lanes/density-fit-check.cjs` (headless Chrome): 1CRN painted at (100, 100, 40) with Turn Axis, Spin 0 and
its square tiling (40 Å, 2 rings) give the sites; `density-fit-data/tomo-1crn-tiling.mrc` (100 × 100 × 40, 2 Å, a
checkerboard of 13 filled sites of 25, Dark, noise 0.15) loaded; Paint (Fit to Auto) hovered 3.9 Å off the middle site:
hint "fit 3.7σ, 3.8 Å, 3°"; the click paints it 0.6 Å from the site; Grow › Tiling (Square, 40 Å, 2 rings) Fit to the
tomogram: 12 copies, all within 2.2 Å of a filled site, none nearer than 39.6 Å to an empty one.
`density-fit-data/tomo-1crn-lattice.mrc` is the axis-aligned lattice (identity turn) for a try by hand.

For Ludo's try: open `tomo-1crn-tiling.mrc` and 1crn.cif, Paint with 1CRN, Turn Axis and Spin 0 (the sites' turn), hover
near a dark site: the copy snaps; click; Grow › Tiling, Square, Spacing 40, Rings 2, Fit to the tomogram.

## Review (lane-reviewer, then lane-skeptic)

The skeptic confirmed 15 of the reviewer's 17 findings (S7 plausible, N4 refuted) and added 4. Each must and should fix
has a failing test first, a commit each.

| Finding                                                                                                                                                        | Verdict   | Sev.  | Fixed                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----- | ------------------------------------------------------------------------------------------- |
| M1 paint fitted a 10 Å ball, the cursor one of the copy's radius (no object, a shape)                                                                          | confirmed | M     | a1e22979a                                                                                   |
| M2 a deleted volume kept in Fit to: every stroke and Grow refused                                                                                              | confirmed | M     | 602a5ce79                                                                                   |
| M3 allocations a frame (the search's sort and closures, poses, slice plane, volume scan)                                                                       | confirmed | M     | 615b3d74b                                                                                   |
| S1 fitted Tiling on a mesh kept Count + the source                                                                                                             | confirmed | S     | 3b3e026f1                                                                                   |
| S2 fitted spiral reported the overdrawn path's turns, copies                                                                                                   | confirmed | S     | 0425fc69d                                                                                   |
| S3 no bound on a fitted grow's work; Threshold refit on preview                                                                                                | confirmed | S (M) | 934f1e3a9                                                                                   |
| S11 (skeptic) no bound on a fitted stroke                                                                                                                      | plausible | S     | 934f1e3a9                                                                                   |
| S4 depth drags read a pick a sample, no volume needed                                                                                                          | confirmed | S     | 9bef2ad9c                                                                                   |
| S10 (skeptic) a fiber stroke not fitted, the cursor showed a fit                                                                                               | confirmed | S     | 861189129                                                                                   |
| S7 envelope cache ignored the target's own center                                                                                                              | plausible | N     | 0a752b584                                                                                   |
| S8 tests missing                                                                                                                                               | confirmed | S     | in the fixes: fitted walk and spiral, a list of picks (no object), Tiling's Count on a mesh |
| S9 TODO item not removed                                                                                                                                       | confirmed | S     | c2f0bdb0f (reworded: what is left)                                                          |
| N1, N2, N3/N5, N6 comments, flat map, a stroke's first slice, the hint's depth                                                                                 | confirmed | N     | 32c895e89                                                                                   |
| N4 Threshold slider max 1.5                                                                                                                                    | refuted   | —     | —                                                                                           |
| S5 the copy under the pointer on a moved or turned list starts from another pose than the click (older than this lane: the cursor never reads the list's move) | confirmed | S     | open (TODO)                                                                                 |
| S6 a target's kind offsets (`ParticleListOffsets`) are not in the fit: an offset kind is drawn off its fitted site                                             | confirmed | S     | open (TODO)                                                                                 |

Left untested: the bank refusal of a fitted fiber, a moved list (S5).

M3's guard: a fit into an out pose allocates no object (it was 1.9 MB a fit: TimSort's buffers a step, Math.hypot's
arguments, closures, poses); V8's boxed numbers between calls are left, about 200 bytes an evaluation (under 100 KB a
fit, short-lived).

## Size

About 1470 production lines against ~550 after the review (1300 before it): fit.ts 742 (the score and search ~250 as
planned, plus the envelope's k-means and kinds ~150, the fast map read ~50, `fitGrown` with its spacing grid ~90, slices
~70, scene volumes and `fitCopies` ~100, doc comments), fit-controls.tsx 133, operations.ts +166 (the grow's candidates,
fiber units and fit block), paint-host +149 (slice, `pluginCursorFit`, a block moved: `radiusOf`), paint-mode +99, the
rest wiring.

## Real data (2026-11-14, Ludo: HIV capsids, 8CKV, `7-2_cryolithe_bin2.mrc` + `7-2_capsids_curvature.vtp`)

- Frames checked: the MRC (512 × 720 × 225, 13.36 Å, origin 0) is drawn and sampled in one frame; the VTP is in nm
  (Scale 10 in the Segmentations tab lines it up); 8CKV loads as its hexamer (assembly 1, 9900 atoms, radius 54 Å), its
  envelope about its centroid, as the copies are drawn. The fit reads the 3D grid, not the slice's image.
- "Goes to the brightest" not reproduced: every path measured (a click on a slice, Fit to Auto: −2.15 → −3.39σ at the
  atoms; paint on the mesh with Fit to the MRC: −0.97 → −1.37σ) went darker. What was wrong: on a capsid's wall the
  shell's points along the wall lie on the neighbouring hexamers (−0.8 to −2.0σ), as dark as the copy, so a copy put on
  the mesh scored −0.9 to +1.1σ; a grow from one was refused at ≤ 0 (3 of 7) and a fit free in space left the surface.
- Decided: **on a mesh a fit stays on it** (its shift in the tangent plane, a spin about the normal, a tilt of 5° at
  most) and **its score's shell is the points within 45° of the normal** (the wall against either side); **a grow keeps
  copies by the source's fitted score** (within paint's reach, on the mesh on it; the source not moved), refused only
  when that is ≤ 0. Paint on a mesh (`mesoscale.paint { mesh }`) and the copy under the pointer over a mesh fit on it;
  on a slice the fit stays free.
- Ludo's grow (Tiling Hex 108.5 Å, Count 376, Fit to the MRC, Dark, 0.6) headless (`~/prism-me-lanes/fit-real-*.cjs`,
  `fit-real/dens.py`): from each of 7 copies put on the capsids, all grow (81–237 kept); from #6 97 kept, −2.47σ at
  their atoms (−3.47σ at their centers; the surface cells −2.23σ), 0.1 Å off the surface (median, 0.5 at most).
