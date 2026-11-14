# Lane grow-helix (2026-11-13)

## Brief

**Ludo's words (2026-11-13):** "we now need an helical path on the surface, the instance picked is the start of the
helix/spiral on the surface." Agreed placement: a new Grow mode, Helix, beside Random walk, Tiling, Sphere, Crystal.

**What.** Grow › Helix: a fiber path that starts at the Grow source (its right-click "Grow from this instance…" or the
last copy painted) and winds as a helix.

- **On a mesh (Grow › On a mesh):** the helix winds about an axis through the mesh's center (Axis Auto: the mesh's
  principal (longest) axis; View: the camera's view direction; X/Y/Z), starting at the source's point on the surface.
  Each point is brought onto the surface toward the axis (as the walk projects its points: `GrowSurface.project`), so on
  a tube or a cone (the HIV capsid, `~/Downloads/HIV-Capsid/capsid_tiling.vtp`) it is a helix that follows the radius,
  and on a closed round mesh a spiral pole to pole. It ends where the surface ends (as the walk does).
- **In space (On None):** a cylindrical helix about the source's Fiber Axis through a point at Radius from the source
  (the source on the helix).
- **Settings:** Pitch (Å a turn), Turns (or the length the path reaches), Hand (right, left), Direction (up, down the
  axis from the source), Axis (Auto, View, X, Y, Z), Radius (space only; empty: the copy's diameter), Seed not needed
  (deterministic).
- **It is a fiber stroke, as Random walk:** points every Rise along the path, the units turned by Twist ± Jitter, their
  up along the surface normal on a mesh (round 2 of paint-refine), the grown fiber's own Rise/Twist/Jitter live on the
  last grow (one undo step a drag), one stroke, one undo step, saved in sessions, the 20000 cap.
- **Also:** `mesoscale.grow` mode `helix` (⌘K command and assistant tool by the same path as the other modes); docs
  (ui.md, features.md), changelog `.v6/changelogs/grow-helix.md`.

**Tests, failing first.**

- Space: points lie on the cylinder of Radius about the axis; consecutive turns Pitch apart along the axis; Hand flips
  the sense (sign of (r × t) · axis); the first point is the source's.
- Mesh: on a synthetic cylinder mesh, every point on the surface (distance to axis = R ± tolerance) and the advance per
  turn = Pitch; on a synthetic cone, the radius follows the cone; on a sphere, a spiral that ends at a pole; Direction
  down mirrors along the axis; Axis View uses the given view vector.
- The path ends where an open mesh ends.
- Live Rise/Twist on a grown helix redraws the same path (as for the walk).
- Undo/Redo of a helix grow.

**Ludo's check (app).** Load `capsid_tiling.vtp`, paint one 1CRN copy on it (Place Surface), Grow › Helix, Pitch ~200,
Turns 5: a helix up the cone from the copy, units on the surface; change Hand and Direction; drag Rise/Twist.

**Size.** ~150–200 production lines (grow.ts path builder ~80, UI ~50, operation and wiring ~40) plus tests.

**Models.** Lane on Opus: the surface helix (axis estimate, projection toward the axis, stopping rule) is geometry
design. Mechanical steps (checks, screenshots) may go to Sonnet subagents. Gate: lane-reviewer then lane-skeptic.

**Port.** Dev server on 1368 (`node scripts/esbuild/app.mjs apps/prism-me --dev --port 1368`, log
`~/prism-me-lanes/dev-1368.log`); left running for Ludo's try.

## Built

- `grow.ts`: `helixPath(source, axis, rise, p, on?, normals?)`, the mode `helix`, `HelixParams`, `HelixLine`,
  `HelixAxes`. One loop for both cases: a line (`foot`, `d` up the way it goes), the source at angle 0, a point every
  5°, the height Pitch × θ / 2π. In space the line is the Fiber Axis turned by the source, a Radius away along its
  offset direction (`fiberOffsetDirection`), and the path starts a rise along the helix (its arc a radian is constant).
  On a mesh each point is projected onto the surface, its normals kept; the first rise is cut off the path
  (`trimStart`).
- `mesh-surface.ts`: `meshAxis(mesh, transform, axis, view?)`, the axis line in the scene.
- `mesoscale.grow { mode: 'helix', pitch, turns, hand, direction, axis, helixRadius }` (+ rise, twist, jitter as the
  walk's): the same fiber stroke as the walk (`fiber`, `seed`, `own`, `normals`, `grow { id }`), so `grown-fiber`, undo,
  sessions and the cap hold unchanged. The walk's fiber set-up (rise, axis, own) shared by both. `pathLength` shared
  with `grown-fiber`. `growParams`: the helix's keys; Axis only on a mesh, Radius only in space.
- The Grow section: Helix in Mode; Pitch, Turns, Hand, Direction; Radius in space, Axis on a mesh; Rise, Twist and
  Jitter shared by Random walk and Helix, live on the last helix too.
- `_spec/ui.md` (Grow › Helix), `features.md` row, `.v6/changelogs/grow-helix.md`.

## Decided

- (author) **The axis on a mesh**: through the mean of the mesh's vertices; Auto, their largest principal axis
  (`PrincipalAxes.ofPositions`), signed so its largest part is positive (an eigenvector's sign is arbitrary: Up stays
  the same way from one grow to the next); View, camera position − target (toward the viewer, as paint's View); X, Y, Z
  the scene's. A sphere has no longest axis (Auto is arbitrary there: pick X, Y or Z).
- (author) **The projection**: each point's guess is the axis point at its height plus the previous point's radius along
  its radial direction u; projected along u (`GrowSurface.project`) within half that radius (a cone's slope is followed;
  the opposite wall, 2 radii away, is out of reach). The normal starts on the source's side (as the walk's), then is
  kept continuous.
- (author) **The stopping rule**: the helix ends at the first point where the surface is not on its radial line: no hit
  at all, or the projector's fallback (the surface's nearest point) off the line by more than a quarter of a step's
  chord (an open edge, past a pole, a cap the line grazes), or the hit at the axis or past it; else at Turns. On the HIV
  capsid, up from the wide end it reaches the narrow cap (4.8 of 5 turns at Pitch 200); down, the wide cap (1.4 turns).
- (author) **Hand** is the helix's own: right turns counterclockwise about the way it advances, Up or Down. So Direction
  Down is the same helix going the other way (its heights the negatives of Up's), not a mirror (a mirror would flip the
  hand). The brief's "Direction down mirrors along the axis" read as the heights only.
- (author) **The source is not one of the units**: the helix passes through it (angle 0), the fiber's first unit a rise
  along it (as the walk's first step), so no copy lands on the painted one.
- (author) **Path density**: a point every 5° whatever the rise (chords within 0.1 % of the radius); `makeFiber`
  resamples it every rise, so a live Rise redraws the same path. The cap checks the units (length / rise + 1), after the
  path; in space before it too (its length is known), so 1000 turns are refused before they are made.
- (author) **Defaults**: Pitch 4 × the copy's diameter, Turns 5, Right, Up, Auto, Radius the copy's diameter (the
  brief). Radius is its own key (`helixRadius`): Sphere's `radius` has another meaning and default.
- (author) **The Axis applies on a mesh only**: in space the helix winds about the Fiber Axis (the brief); X/Y/Z in
  space is not offered.

## Learned

- The repo formats TypeScript with biome (`pnpm format:check`), not prettier; prettier is for md/yaml/scss only.
- `GrowSurface.project` falls back to the nearest point when its line misses: a rule that stops on an edge has to test
  that the hit is on the line, not how far it moved (a cone's radius changes legitimately).
