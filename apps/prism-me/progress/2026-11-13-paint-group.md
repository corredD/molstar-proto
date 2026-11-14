# Lane paint-group (2026-11-13, night)

## Brief

From [plans/2026-11-13-night-lanes.md](../plans/2026-11-13-night-lanes.md) (Ludo, 2026-11-13). Branch `me/paint-group`
from prism-me at eaf253942 (grow-helix merged).

Select a few painted (or file) instances and make them a new ingredient: a **group**, painted and grown like a protein.

- **Picking the members**: a "Group" section on a list's rows: **Pick instances**: while on, a click on a particle adds
  or removes it (highlighted, a count shown; Shift-drag box add, if it fits the size); any list's particles, painted or
  from the file, of one list.
- **Make group**: a name (default "Group 1"); the group's frame: its center the members' centroid, its axes their
  principal axes (+z the smallest, so a flat cluster lies on a surface), a radius the members' bounding sphere. Members
  kept as (brush: target/entity, a structure brush, or another group; pose relative to the group's frame).
- **The group is a brush**: listed as an entity of the list ("Group 1 · 4 members"), in Paint's brush and in right-click
  "Paint with"; painting places all members at once by the group's pose (surface placement and the normal rule by the
  group's frame); the copy under the pointer shows the whole group. Grow from a group copy works in every mode (each
  grown copy expands to the members). A group may hold groups (ultrastructure: build bigger from smaller).
- **The originals**: stay where they are (the group is a template), unless "Replace with a group copy" is ticked.
- **Stored** in `ParticleListPainted` (`groups`, beside `structures`), in sessions; ungroup (a copy back to its members)
  as a right-click on a group copy.
- **Open for Ludo** (defaults taken): export a group as a file (a cellPACK recipe ingredient or an mmCIF of its members)
  is a later lane; the group's +z: the smallest principal axis.
- Tests: a group's members' poses reproduce the picked ones exactly when painted at the group's own pose; painted at a
  pose P, every member at P · relative pose; nesting (a group of groups) expands to leaves; surface placement turns the
  whole group; grow from a group copy (Tiling, Symmetry if merged later); undo; sessions; ungroup.
- Check: paint 3 1CRN close together, Pick instances, Make group, paint the group on the HIV capsid VTP, tile it, nest
  it in a bigger group; screenshots.

**Shared rules for the night.** New code in new files where it can be; edits to operations.ts, controls.tsx, paint.ts
kept to the wiring (four lanes touch the mesoscale package). Nothing pushed, no PR. Tests fail first; the gate
(lane-reviewer, then lane-skeptic); progress file, `.v6/changelogs/paint-group.md`, ui.md and features.md.

**Size.** ~500 production lines. **Model.** Opus. **Port.** 1371
(`node scripts/esbuild/app.mjs apps/prism-me --dev --port 1371`, log `~/prism-me-lanes/dev-1371.log`), left running for
Ludo's morning try.

## Built

- `paint-group.ts` (new): the group model. `makeGroup` (its frame from the picks: centroid; x the largest principal
  axis, +z the smallest made perpendicular and turned the way the members' own +z go on average, y = z × x so no member
  is mirrored; two members: x along their line, +z their up; one: its own pose; radius the bounds with the members'
  radii), `groupLeaves` (a group's leaves, nested groups expanded depth first, made once a groups array), `expandGroups`
  (a group stroke's copies to its leaves, a copy's leaves in a row, each at the copy's pose · its own), `groupCopyAt`
  (the group copy a painted particle is of, following a stroke's ungrouped paths one level at a time), `nextGroupId`,
  `groupCopyList` (the whole group as a list for the copy under the pointer).
- `paint.ts` (wiring): `PaintStroke.group` and `split`; `paintParticles` and `strokeCounts` expand group strokes after
  `makeFibers` (so `followSources` counts them); a group stroke's points carry their own target, entity and compartment;
  `ParticleListPainted.groups` (its update compares them).
- `operations.ts` (wiring): `mesoscale.group` (indices as drawn; a member of a group copy stands for the copy; refuses a
  bank's unit and a class-target list; its fibers entry a rise of its diameter), `mesoscale.paint { group }`
  (`groupInto`: the group's id its target and entity), `mesoscale.ungroup` (the copy's path added to its stroke's
  `split`), a grow from a group copy (`groupSourceOf`: its pose, radius and first particle; the grown stroke a group
  stroke), structures' ids after the groups', `instanceAt`, `groupPick`/`startGroupPick`, `MesoscaleInfo.paintGroups`;
  the two commands.
- `group-pick.ts` (new): `InstancePick`, the Pick instances state (a click toggles an instance, a group copy whole; the
  instances selected in 3D; the canvas in selection mode meanwhile; painting stops it).
- Paint: `PaintBrushTarget.group`; the host's radius, cursor (`pluginGroupCursor`: all leaves, +z its axis) and stroke;
  the Paint section without Fiber for a group.
- Explorer: the Group section (`group-properties.tsx`, new), the group's row ("Group 1 · 3 members", kind `paint group`,
  `NodeRef.paintGroup`) and its Paint section, Paint with on its right-click, Ungroup this … on a group copy's particle,
  a click diverted while picking, Esc stops.
- Tests: `paint-group.test.ts` (the frame: right-handed, +z the smallest, own pose reproduced to 1e-4 Å, P · relative,
  one and two members, nesting to leaves, counts and lookup), `paint-group-operation.test.ts` (make one step and undo,
  paint at its pose and at P, surface placement, tiling from a copy, nesting, ungroup and grow after, ungroup a group of
  groups one level, sessions, Pick instances), `explorer/_test/group.test.tsx` (the section, the row, Paint with,
  Ungroup), `paint-group.scaling.ts` (made, expanded, looked up: linear).
- Checked in the app (port 1371, `~/prism-me-lanes/paint-group-check.cjs`, Chrome headless): 3 1CRN painted close
  together, Pick instances by three clicks in 3D, Make group (Group 1 · 3 members), painted on the HIV capsid VTP (Place
  Surface, the whole group under the pointer), Grow › Tiling 2 rings on the mesh from it (18 copies, 54 1CRN lying
  flat), Big of three tiled copies (Big · 3 members) painted on the capsid elsewhere, its copy ungrouped one level (its
  inner copies Group 1 copies still). Screenshots in the session's scratchpad `paint-group/`.

## Decided

- **A group copy is drawn as its leaves**, particles of the list as any painted copy (members keep their own target,
  entity and compartment: their looks, colors and picks are their kind's); the group stroke keeps the copies' poses, so
  a particle tells its copy (`groupCopyAt`).
- **Ungroup keeps the particles**: the copy's place goes in its stroke's `split` (its path, "3" or "3.1"), so no key
  moves and the grows from it stay; its members are instances of their own one level down (a member group's copy is
  still a group copy, ungrouped again on its own).
- **The group's row is not an entity**: its members are their own entities, so a group entity would count nothing and
  Look, Show only and Paint would act on nothing; it is a row of kind `paint group` after the entities, with Paint
  (`MesoscaleInfo.paintGroups`). Only lists with entities (models, the Painting list) show the rows; a plain list's
  groups are there for the operations (none of the explorer's yet).
- **Its id** is above every target, entity, structure and group id of the list (one id, its target and its entity); a
  structure painted after a group takes the next.
- **Orientation**: Turn Auto as any brush (along the normal on a surface, else random); along the normal its +z. Axis is
  its +z too. Its strokes are copies (no Fiber in Paint); its fibers are grown (walk, helix, spiral: its copies a
  diameter apart, +z along the path; the rise its fibers entry, set at Make group).
- **Pick instances in selection mode**: a plain click then neither centers the camera nor resets it, and leaving
  selection mode (or Esc) ends the picking; the mode was off: it is off again after.
- **A file's particle** picked is a member by its target, entity and compartment, at its pose in the list's frame; its
  own Move this instance (an offset) is not read (the pose before it).
- **Replace with a group copy** is not built: the file's particles cannot be removed by a stroke, and removing painted
  copies moves later keys; left open with export (features.md, Deferred).

## Learned

- The mesoscale `vitest.scaling.config.ts` and the guards' harness path (`sequences/core/_test/model/scaling.js`) are
  gone from the tree: this lane's guard imports `test-harness/src/scaling.js` and runs with a config pointed at it (the
  package's config still fails on `heapTests`).
- TS formatting is biome's (`pnpm format`), prettier only for Markdown and YAML.
- A plain left click on the canvas centers the camera (Mol*'s `FocusLoci`), and on nothing resets it; selection mode
  takes both off the plain click.

## Size

About 1,050 production lines (tests and docs apart) against ~500: `paint-group.ts` 412 (with its doc comments and the
cursor's list), the operations 250 (two operations, the grow's group source, the brush), the explorer ~180, the pick
state 90. The ungroup's paths and the group cursor took the room past the brief.
