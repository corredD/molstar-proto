# Lane grow-helix (2026-11-13)

## Brief

**Ludo's words (2026-11-13):** "we now need an helical path on the surface, the instance picked is the start of the
helix/spiral on the surface." Agreed placement: a new Grow mode, Helix, beside Random walk, Tiling, Sphere, Crystal.

**What.** Grow › Helix: a fiber path that starts at the Grow source (its right-click "Grow from this instance…" or the
last copy painted) and winds as a helix.

- **On a mesh (Grow › On a mesh):** the helix winds about an axis through the mesh's center (Axis Auto: the mesh's
  principal (longest) axis; View: the camera's view direction; X/Y/Z), starting at the source's point on the surface.
  Each point is brought onto the surface toward the axis (as the walk projects its points: `GrowSurface.project`),
  so on a tube or a cone (the HIV capsid, `~/Downloads/HIV-Capsid/capsid_tiling.vtp`) it is a helix that follows the
  radius, and on a closed round mesh a spiral pole to pole. It ends where the surface ends (as the walk does).
- **In space (On None):** a cylindrical helix about the source's Fiber Axis through a point at Radius from the
  source (the source on the helix).
- **Settings:** Pitch (Å a turn), Turns (or the length the path reaches), Hand (right, left), Direction (up, down
  the axis from the source), Axis (Auto, View, X, Y, Z), Radius (space only; empty: the copy's diameter), Seed not
  needed (deterministic).
- **It is a fiber stroke, as Random walk:** points every Rise along the path, the units turned by Twist ± Jitter,
  their up along the surface normal on a mesh (round 2 of paint-refine), the grown fiber's own Rise/Twist/Jitter live
  on the last grow (one undo step a drag), one stroke, one undo step, saved in sessions, the 20000 cap.
- **Also:** `mesoscale.grow` mode `helix` (⌘K command and assistant tool by the same path as the other modes); docs
  (ui.md, features.md), changelog `.v6/changelogs/grow-helix.md`.

**Tests, failing first.**
- Space: points lie on the cylinder of Radius about the axis; consecutive turns Pitch apart along the axis; Hand
  flips the sense (sign of (r × t) · axis); the first point is the source's.
- Mesh: on a synthetic cylinder mesh, every point on the surface (distance to axis = R ± tolerance) and the advance
  per turn = Pitch; on a synthetic cone, the radius follows the cone; on a sphere, a spiral that ends at a pole;
  Direction down mirrors along the axis; Axis View uses the given view vector.
- The path ends where an open mesh ends.
- Live Rise/Twist on a grown helix redraws the same path (as for the walk).
- Undo/Redo of a helix grow.

**Ludo's check (app).** Load `capsid_tiling.vtp`, paint one 1CRN copy on it (Place Surface), Grow › Helix, Pitch
~200, Turns 5: a helix up the cone from the copy, units on the surface; change Hand and Direction; drag Rise/Twist.

**Size.** ~150–200 production lines (grow.ts path builder ~80, UI ~50, operation and wiring ~40) plus tests.

**Models.** Lane on Opus: the surface helix (axis estimate, projection toward the axis, stopping rule) is geometry
design. Mechanical steps (checks, screenshots) may go to Sonnet subagents. Gate: lane-reviewer then lane-skeptic.

**Port.** Dev server on 1368 (`node scripts/esbuild/app.mjs apps/prism-me --dev --port 1368`, log
`~/prism-me-lanes/dev-1368.log`); left running for Ludo's try.
