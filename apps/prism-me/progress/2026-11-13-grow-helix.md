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
  chord (an open edge, past a pole, a cap the line grazes); else at Turns, or at the grow's cap (`limit`, review M1). A
  hit is within half the radius of its guess (the reach), so it never reaches the axis (review N1: that check removed).
  On the HIV capsid, up from the wide end it reaches the narrow cap (4.8 of 5 turns at Pitch 200); down, the wide cap
  (1.4 turns).
- (review M1) **At most 200 turns** (`MaxHelixTurns`): a point every 5° is a projection each on a mesh (about 0.25 ms on
  a 128 × 80 tube, so 200 turns some 3.5 s); the UI's Turns stops at 50. On a mesh it also stops as it is made once its
  length passes the cap's units (`HelixParams.limit`), so a spiral of 0.1 Å rises is refused in well under a second.
- (review New 1) **Two units at least**: a helix shorter than two rises is refused, its rise named (a unit alone would
  be a copy unturned, as the walk's one point, review N1 of lane grow).
- (review S5) **Another Mode ends the live fiber**: Helix shows Rise, Twist and Jitter as Random walk does, so a drag
  after switching mode sets the next grow's only (ui.md's rule gains "another Mode").
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
- (author) **Turns, not a length**: the brief's "Turns (or the length the path reaches)" built as Turns only (with the
  grow's cap as a length limit inside); a Length setting left to TODO.md.
- (author) **The Axis applies on a mesh only**: in space the helix winds about the Fiber Axis (the brief); X/Y/Z in
  space is not offered.

## Learned

- The repo formats TypeScript with biome (`pnpm format:check`), not prettier; prettier is for md/yaml/scss only.
- `GrowSurface.project` falls back to the nearest point when its line misses: a rule that stops on an edge has to test
  that the hit is on the line, not how far it moved (a cone's radius changes legitimately).

## Size

About 444 production lines against the brief's ~150–200: grow.ts +156 (the path builder ~100, its trim and the types),
mesh-surface.ts +25 (`meshAxis`), operations.ts +166 −32 (the helix branch ~70, its seven params with their descriptions
~50 for ⌘K and the assistant, the shared fiber set-up moved, the review's caps, count and refusals), controls.tsx +97 −5
(the Helix block, the shared fiber sliders, the mode's end of the live fiber). The room went to the params'
descriptions, the UI block and the review's fixes. Tests +597 (grow-helix.test.ts, grow-operation.test.ts, the app's
grow.test.tsx, the scaling guard, `tubeMesh`).

## App check (Ludo's check, port 1368)

`~/prism-me-lanes/grow-helix-capsid.cjs` (headless Chrome): `capsid_tiling.vtp` and 1CRN loaded, one copy painted on the
capsid's wide end (Place Surface), Grow › Helix, Pitch 200, Turns 5, Axis Auto. Right/Up: 244 units winding up the cone
to its narrow cap (4.8 turns); Left/Up the other sense, 243; Right/Down 55 units to the wide cap (1.4 turns); Rise
dragged 29.4 → 30.1 Å (238 units, the same path; one step a drag is proven by the unit and app tests), Twist 19.1° (one
step), two undos back to 29.4 Å and 244, one more the helix gone. Screenshots in
`/private/tmp/claude-501/-Users-ludovicautin-molstar-proto-git/bc8a7dcf-b4ed-4027-911e-5f56df74a469/scratchpad/grow-helix/`:
`h1-helix-right-up.png`, `h2-helix-left-up.png`, `h3-helix-right-down.png`, `h5-rise.png`, `h6-twist.png`,
`h7-undone.png`.

## Review (lane-reviewer, then lane-skeptic)

| Finding                                                                                       | Verdict                        | Severity | Done                                                                      |
| --------------------------------------------------------------------------------------------- | ------------------------------ | -------- | ------------------------------------------------------------------------- |
| M1 trimStart's spread overflows at ~1000 turns on a mesh; the mesh cap checked after the path | confirmed                      | medium   | f5fc1064b (copy one by one, ≤ 200 turns, `limit` at the cap; tests first) |
| S1 a new source keeps Pitch and Radius (review G1)                                            | confirmed                      | minor    | 3819f5ade                                                                 |
| S2 `value.count` the path's points, not the units                                             | confirmed (no agent reads it)  | nit      | d1d6a0dfc                                                                 |
| S3 no scaling guard for the helix on a mesh                                                   | confirmed (process)            | nit      | a350e937c (n 20 → 80 turns: ×4.9 time, ×4.9 allocation; control ×17)      |
| S4 growParams, a moved/scaled list, undo on a mesh untested                                   | confirmed                      | minor    | 6ff2c1c6a (tests; they passed: no fix needed)                             |
| S5 Rise under Helix still live on the last walk                                               | confirmed                      | minor    | f80202166                                                                 |
| N1 the axis check never fires                                                                 | confirmed                      | nit      | e90effa28 (removed)                                                       |
| N2 wrong hint for a helix shorter than a rise                                                 | confirmed                      | minor    | d1d6a0dfc (with New 1)                                                    |
| N3 the first normal not unit                                                                  | refuted (`upAlong` normalizes) | none     | —                                                                         |
| N4 `as never`, unused box axes                                                                | confirmed                      | nit      | e90effa28                                                                 |
| N5 docs list no Helix on a mesh                                                               | half confirmed (features.md)   | nit      | e90effa28                                                                 |
| N6 walk's validation order changed                                                            | confirmed, not a defect        | nit      | —                                                                         |
| New 1 a one-unit helix, unturned                                                              | confirmed                      | minor    | d1d6a0dfc                                                                 |
| New 2 the grow's doc comment                                                                  | confirmed                      | nit      | e90effa28                                                                 |
| New 3 the record names `radius`, the param `helixRadius`                                      | confirmed, no reader           | nit      | left (the record's own name)                                              |

## Open

- The mesoscale package's `test:scaling` tier does not start on prism-me: its config imports `heapTests` from
  `sequences/vitest.shared.ts` and the `*.scaling.ts` import `sequences/core/_test/model/scaling.js`, both gone (the
  harness is now `@molstar/test-harness/scaling`). The helix guard follows its siblings' import; it was run with a
  scratch config aliasing the harness. Not this lane's: a lane of its own.
- `meshSurface.project` allocates about 170 KB a pick on a 128 × 400 tube (the scaling guard's 250 MB for 20 turns): the
  walk and Tiling share it. Linear, but worth a look (grow-mesh's projector).
- In a test, `mesoscale.fiber` run before a list's move was inserted put the painted copies above the move (they drew in
  the scene's frame, unmoved); not checked in the app. Not the helix's; noted for the grow lanes.
- `pnpm check:workspace` fails on prism-me's base too
  (`@molstar/plugin-ui: Export pattern ./*.css has no matching files`).
- Moved to TODO.md's Backlog (Grow › Helix, what it left). No Storybook story renders the Grow section (none did
  before).
- For Ludo: Pitch's default (4 × the copy's diameter), the hand kept when going Down (not a mirror), Axis on a mesh
  only.
