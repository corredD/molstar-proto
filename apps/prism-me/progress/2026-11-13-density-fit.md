# Lane density-fit (2026-11-13, night)

## Brief

From [plans/2026-11-13-night-lanes.md](../plans/2026-11-13-night-lanes.md) (Ludo, 2026-11-13). Branch `me/density-fit` from
prism-me at eaf253942 (grow-helix merged).

D1 of [2026-11-10-paint-on-density.md](2026-11-10-paint-on-density.md), then growth weighted by density.

- **Fit on paint**: with a density (a tomogram, an MRC) chosen under Paint › **Fit to** (a volume of the scene; None
  default unless a slice is under the pointer), each painted copy is fitted: a shift and turn within a reach (a third
  of its radius, 15°), pulled back toward the click (the plan's score: inside − shell, in σ, signed by **Contrast**
  Dark/Bright, minus the restraint; Nelder-Mead over 6 parameters). Painting on a slice puts the copy's center on the
  slice. The copy under the pointer shows the fitted pose; the hint gives "fit 2.4σ, 3.1 Å, 8°".
- **Density-weighted grow**: Grow › **Fit to** the same density: every grown copy is fitted within a smaller reach and
  kept only above a **Threshold** (0.6 × the source's score by default); Count counts kept copies. Works with every
  mode (walk, tiling, sphere, helix, spiral, symmetry once merged); prefix stability holds per kept copy.
- Envelope: ~200 points from the copy's object (atoms k-means'd; sites; volume voxels; a sphere's ball), a shell of
  ~100 pushed out 1.5 voxels; optional low-pass (Gaussian 1–2 voxels, cached per grid).
- Stored as explicit poses in the stroke, with `fit: {score, shift, angle}`; a session keeps them without the volume.
- Tests (from the plan): a synthetic 1CRN map + noise, a seed 4 Å / 10° off fits back within 1 Å / 3°; a flat map
  leaves the pose; never past the reach; Contrast inverted gives the same fit; a slice click gives the slice's point;
  a weighted tiling keeps only copies above the threshold on a map with half the sites empty; one undo step.
- Check: a synthetic tomogram (a lattice of 1CRN densities with noise, written as an MRC) in the app: paint near a site,
  the copy snaps; grow Tiling with Fit to: copies only on the sites; screenshots.
- Handedness flip stays a TODO (plan, Decided 4).

**Shared rules for the night.** New code in new files where it can be; edits to operations.ts, controls.tsx, paint.ts
kept to the wiring (four lanes touch the mesoscale package). Nothing pushed, no PR. Tests fail first; the gate
(lane-reviewer, then lane-skeptic); progress file, `.v6/changelogs/density-fit.md`, ui.md and features.md.

**Size.** ~550 production lines. **Model.** Opus. **Port.** 1372
(`node scripts/esbuild/app.mjs apps/prism-me --dev --port 1372`, log `~/prism-me-lanes/dev-1372.log`), left
running for Ludo's morning try.
