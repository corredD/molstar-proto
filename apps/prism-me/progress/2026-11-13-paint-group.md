# Lane paint-group (2026-11-13, night)

## Brief

From [plans/2026-11-13-night-lanes.md](../plans/2026-11-13-night-lanes.md) (Ludo, 2026-11-13). Branch `me/paint-group` from
prism-me at eaf253942 (grow-helix merged).

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

**Shared rules for the night.** New code in new files where it can be; edits to operations.ts, controls.tsx, paint.ts
kept to the wiring (four lanes touch the mesoscale package). Nothing pushed, no PR. Tests fail first; the gate
(lane-reviewer, then lane-skeptic); progress file, `.v6/changelogs/paint-group.md`, ui.md and features.md.

**Size.** ~500 production lines. **Model.** Opus. **Port.** 1371
(`node scripts/esbuild/app.mjs apps/prism-me --dev --port 1371`, log `~/prism-me-lanes/dev-1371.log`), left
running for Ludo's morning try.
