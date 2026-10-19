# prism-me UI (draft for review)

What a person sees and does. Simple first: one panel, one tree, one properties view, one right-click menu. Everything
else Prism offers stays reachable from ⌘K or the assistant, not on screen. Features already built (features.md) are
exposed through these four places only; what does not fit them waits.

Decisions (Ludovic, 2026-10-18): one panel, the tree above the properties; four top categories, particles apart; kept
from Prism: the canvas's view buttons, the canvas settings panel, ⌘K and the assistant. Not kept on screen: Home, the
Structure, Selection, Snapshots and other tabs, the Entities, Segmentations tabs and the rows added to Prism's tree
(their operations stay, for ⌘K, the agent and this UI).

## 1. Layout

```
┌──────────────────────────────┬────────────────────┐
│                              │ + Open   ⌕ filter  │   the panel, pinned, on the right
│                              │ ▾ Structures       │
│          canvas              │ ▾ Particles        │   the tree
│                              │ ▾ Volumes          │
│                              │ ▾ Meshes           │
│  [view buttons]              ├────────────────────┤   a split the person can drag
│                              │ properties of the  │   the properties of the node
│                              │ node clicked       │   clicked in the tree or in 3D
└──────────────────────────────┴────────────────────┘
```

The rail keeps two buttons: the panel (the tree) and Settings (the canvas settings). ⌘K and the assistant as Prism has
them.

## 2. Opening

- Drag and drop anywhere: every format (features.md, "Opening files"); each lands in its category.
- **+ Open** at the top of the tree: Files…; PDB / PDB-IHM / EMDB id…; Examples (the Mesoscale Explorer's); Session….
- The tree empty: a short line in its place, "Drop files here, or + Open", with the formats.

## 3. The tree

Four categories, shown when they hold something. Under each, what was opened, then its parts; the parts' parts are
loaded when first opened (thousands of entities cost nothing until looked at).

| Category   | An item                                                                                | Its children                                                                                                                        |
| ---------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Structures | a PDB / mmCIF / other structure file or entry (1CRN)                                   | its entities, then chains                                                                                                           |
| Particles  | a cellPACK or PetWorld model; a particle list (RELION, Dynamo, EM, NDJSON, Simularium) | a model: its compartments (groups), then entities. A list: its targets (a class each when by class), each showing what decorates it |
| Volumes    | a map, tomogram, tilt series (MRC…)                                                    | its representations (slice, isosurface)                                                                                             |
| Meshes     | a mesh file (OBJ, PLY, VTP)                                                            | its segments, when it has several                                                                                                   |

Every row: an eye (show, hide, at its level), a color dot where it has one color, its name, a count (atoms, particles,
entities) faint at the end. Clips and labels made at a node are rows under it (§5), with their own eye.

A click on a row picks it: highlighted in 3D, its properties below. A double click focuses the camera on it. The tree
follows what is picked in 3D (a click on a particle picks its entity's row and opens the way to it).

## 4. Properties

The properties of the picked row, in sections that fold. Only what applies to it.

| Section        | For                                                   | What                                                                                                                                       |
| -------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Look           | every node                                            | visible, color (picker; for a model or group: Generate colors), opacity, glow                                                              |
| Representation | structures, entities, particle lists, volumes, meshes | the type (cartoon, spacefill…; spheres or the decorating objects; slice or isosurface; surface, wireframe, both) and its few main settings |
| Decoration     | a particle target or list                             | what decorates it: an object of the scene, a PDB id or URL, spheres; targets by class                                                      |
| Slice          | a volume                                              | axis, position, contrast                                                                                                                   |
| Position       | every object (not its parts)                          | position and rotation as numbers, reset                                                                                                    |
| Clips          | every node                                            | its clips (§5), each: shape, invert, position, rotation, size, remove                                                                      |
| Labels         | every node                                            | its labels (§5), each: text, size, remove                                                                                                  |
| Graphics       | a model (cellPACK, PetWorld)                          | quality (ultra… fast), wiggle, tumble                                                                                                      |

## 5. Right-click

On the canvas, at the level of what is picked (the selection granularity: an object, a group, an entity, a chain…), and
on a tree row, the same menu:

- **Focus**
- **Move** and **Rotate**: drag in 3D (live, one undo step on release, Esc cancels). On an object: the object itself. On
  a part (an entity, a chain): **[to decide]** the whole object it belongs to, or only that part.
- **Add label**: plain text at that place, for that node (Ludovic, 2026-10-18); it becomes a row under the node.
- **Add clip**: a plane, sphere or box for that node (only its particles or atoms are cut); it becomes a row under it.
  Several per node (Ludovic, 2026-10-18; up to 8 per particle list).

On a clip or a label (its guide in 3D, or its row): **Move**, **Rotate**, (a clip: **Size**, **Flip**; a label: **Edit
text**), **Hide**, **Remove**.

## 6. Not now

Snapshots and stories, the sequence view, measurements, export: reachable from ⌘K, not on screen. Added when needed.

## Status

- Step 1 (2026-10-18): the panel and the tree. The Scene tab opens at start (`view.open` after creation: an
  extension's tab registers after the shell starts, so `ui.layout.start` cannot name it); Prism's other tabs, the
  sequence band, the animation and export buttons are hidden (`overrides`, `showSequence: false`). Tree: four
  categories; a structure's entities and chains, a model's groups and entities, a list's targets, a volume's
  representations; eyes, counts, filter; click picks (highlight), double click focuses. + Open: files, an entry,
  examples, a session. Objects are named by their file. Properties: the picked row's name only (step 2). Code:
  `src/explorer/` (`operations.ts`: the `explorer` area; `ui.tsx`: the panel), test `src/explorer/_test/`.
- Not yet: the drag split between tree and properties; the tree following a pick in 3D; a color dot only where a
  color was set.
