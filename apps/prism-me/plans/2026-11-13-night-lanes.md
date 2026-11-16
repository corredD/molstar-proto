# Night lanes (plan, 2026-11-13)

Ludo: "Lets prepare 4 lanes, the decisions we just made, the symmetry, the density weight/small density fit, and one
coming from the cellPAINT principle of grouping. If we paint a protein, we could select a couple of instances, and make
that a new ingredient/structure that could be painted as well. So we can start to build ultrastructure and use them."

## Before the lanes

1. grow-helix round 3b (the spiral skips crowded copies) finishes and passes its gate.
2. Coordinator: verify (tests, `tsc -b`, app tsc), merge `me/grow-helix` into prism-me, push (decision 10), deploy
   prism-me to mesoscope (decision 15).
3. The four lanes branch from that prism-me.

## Running them

- At most 3 at once (lanes rule). `decisions`, `symmetry` and `paint-group` start together; `density-fit` starts when
  the first of them reaches its gate (the coordinator is woken by its report).
- They all touch `packages/extensions/mesoscale` (operations.ts, controls.tsx, paint.ts). To keep the merges small:
  new code in new files (`grow-symmetry.ts`, `fit.ts`, `paint-group.ts`), edits to the shared files kept to the
  wiring; a lane rebases on prism-me only if the coordinator asks.
- Nothing merged or pushed overnight. In the morning: each lane's report, its live build on its port, the merge order
  for Ludo (decisions first, then symmetry, paint-group, density-fit).
- Each lane: tests failing first, a check in the app (screenshots), the gate (lane-reviewer, lane-skeptic), progress
  file, changelog `.v6/changelogs/<slug>.md`, ui.md and features.md.

| Lane | Port | Model | Size (prod lines) |
| --- | --- | --- | --- |
| `decisions` | 1369 | Sonnet; Opus subagent for 1 and 3 | ~250 |
| `symmetry` | 1370 | Opus | ~300 |
| `paint-group` | 1371 | Opus | ~500 |
| `density-fit` | 1372 | Opus | ~550 |

## Lane `decisions`

From the [decisions doc](https://claude.ai/artifact/Jh985ir9vUiRxaUagxuKqV) (Ludo's answers, 2026-11-13):

1. A fiber unit as the Grow source: its offset direction is its "up" (the axis put along the normal), not its
   path-tangent axis. Test: grow Tiling from the last unit of a fiber painted on a mesh: tiles' up = the unit's offset
   direction = the normal.
2. Place Auto switches to Surface whenever the pointer is over a mesh (any brush); at a depth elsewhere as now.
3. A fiber painted on a surface: with helix settings (Twist ≠ 0 or an Offset) it keeps them (units turned about the path
   as set); a plain walk (Twist 0, no Offset) has its units' up along the surface normal, as a grown walk.
8. and 21. Helix and Spiral: Count (copies) and Turns both editable, linked: setting one sets the other (Turns → the
   copies those turns hold; Count → the turns reached); Count prefix-stable as now. The helix's length by copy count.
11. Tiling: Count in space too (Rings gone): in space the hex/square rings filled in order up to Count; sessions with
   Rings read as their count.
13. Color… on a VTP leaves an array color theme alone (it applies to uniform-colored meshes only; an array-themed mesh
   says so in the menu's title).
- The spec (ui.md, features.md) records every answered decision of the doc, the "keep"s included.

## Lane `symmetry`

Grow › Symmetry: copies of the source by a point group about a center.

- Groups: Cn (n 2–60), Dn, T (12), O (24), I (60). Helical is Grow › Helix; a space group is a structure built with
  its symmetry and painted (Ludo, 2026-11-13), so neither is here.
- The center: a Radius from the source along its axis (paint's axis rule: Fiber Axis, else +z; membrane +z), toward
  the inside (Side flips it); the group's principal axis through the center along a chosen direction (Auto: the
  source's axis turned so the source sits on the shell; View; X/Y/Z). I with the source on a 5-fold-free general
  position (60 copies, no overlap of the source with itself).
- The source is copy 0 (not placed again); copies are the source's pose by each operator (exact orientations).
- On a mesh: optional "snap": each copy projected onto the mesh and turned to its normal (off by default, since a
  symmetry is exact).
- As the other modes: live settings on the last grow (Group, n, Radius, axis), Clear, Undo, sessions, ⌘K/assistant
  (`mesoscale.grow` mode `symmetry`), the cap.
- Tests: each group's operator count and that they form a group (closure); copies' pairwise distances match the
  group's; I from a 1CRN gives 60 copies on a sphere of Radius; Cn/Dn axis directions; live n changes.
- Check: an icosahedral shell of 60 1CRN, a C6 ring, a D7 barrel; screenshots.

## Lane `paint-group` (cellPAINT grouping)

Select a few painted (or file) instances and make them a new ingredient: a **group**, painted and grown like a protein.

- **Picking the members**: a "Group" section on a list's rows: **Pick instances**: while on, a click on a particle adds
  or removes it (highlighted, a count shown; Shift-drag box add, if it fits the size); any list's particles, painted or
  from the file, of one list.
- **Make group**: a name (default "Group 1"); the group's frame: its center the members' centroid, its axes their
  principal axes (+z the smallest, so a flat cluster lies on a surface), a radius the members' bounding sphere.
  Members kept as (brush: target/entity, a structure brush, or another group; pose relative to the group's frame).
- **The group is a brush**: listed as an entity of the list ("Group 1 · 4 members"), in Paint's brush and in
  right-click "Paint with"; painting places all members at once by the group's pose (surface placement and the normal
  rule by the group's frame); the copy under the pointer shows the whole group. Grow from a group copy works in every
  mode (each grown copy expands to the members). A group may hold groups (ultrastructure: build bigger from smaller).
- **The originals**: stay where they are (the group is a template), unless "Replace with a group copy" is ticked.
- **Stored** in `ParticleListPainted` (`groups`, beside `structures`), in sessions; ungroup (a copy back to its
  members) as a right-click on a group copy.
- **Open for Ludo** (defaults taken): export a group as a file (a cellPACK recipe ingredient or an mmCIF of its
  members) is a later lane; the group's +z: the smallest principal axis.
- Tests: a group's members' poses reproduce the picked ones exactly when painted at the group's own pose; painted at a
  pose P, every member at P · relative pose; nesting (a group of groups) expands to leaves; surface placement turns
  the whole group; grow from a group copy (Tiling, Symmetry if merged later); undo; sessions; ungroup.
- Check: paint 3 1CRN close together, Pick instances, Make group, paint the group on the HIV capsid VTP, tile it,
  nest it in a bigger group; screenshots.

## Lane `density-fit` (density weight / small density fit)

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
