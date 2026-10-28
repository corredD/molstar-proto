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

| Category   | An item                                                                                | Its children                                                                                                                                                      |
| ---------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structures | a PDB / mmCIF / other structure file or entry (1CRN)                                   | its entities, then chains                                                                                                                                         |
| Particles  | a cellPACK or PetWorld model; a particle list (RELION, Dynamo, EM, NDJSON, Simularium) | a model: its groups (compartments, or functions by its Group by), then entities. A list: its targets (a class each when by class), each showing what decorates it |
| Volumes    | a map, tomogram, tilt series (MRC…)                                                    | its representations (slice, isosurface)                                                                                                                           |
| Meshes     | a mesh file (OBJ, PLY, VTP)                                                            | its segments, when it has several                                                                                                                                 |

A model's groups follow its Group by (§4), a model's own choice: compartments (the dotted names' tree) by default when
it has some, else functions; switching remakes that model's rows only. A group row stands for its entities (their ids),
so its eye, Look, clips and picks are the same under both groupings. A label made at a group the model's grouping does
not show now is a row under the model (picked, hidden, edited and revealed there), back under its group when that
grouping is shown again (a default, to confirm).

Every row: a color dot where it has one color, its name, a count (atoms, particles, entities) faint, then its tools at
the end (Ludovic, 2026-10-25, as Prism's tree): the brush (a color for all of it), the scissors (a clip), where it has
them, the eye (show, hide, at its level) and ⋯ (its right-click). The tools show on the row's hover or focus, always on
a touch screen; a hidden node keeps its eye in view. A category's row has the brush (its color theme), the scissors and
the eye, for every object under it. Clips and labels made at a node are rows under it (§5), and distances under their
first point's row (§7), each with its own eye.

A click on a row picks it: highlighted in 3D, its properties below. A category is picked too (Ludovic, 2026-10-25). The
arrows move the pick (↑/↓, Home, End; → opens or goes in, ← closes or goes to the parent), as a click. A double click
focuses the camera on it. The tree follows what is picked in 3D (a click on a particle picks its entity's row and opens
the way to it).

## 4. Properties

The properties of the picked row, in sections that fold. Only what applies to it.

| Section           | For                                                                        | What                                                                                                                                                                      |
| ----------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Look              | every node                                                                 | visible, color (picker; for a model or group: Generate colors), opacity, glow; a category: visible and a color theme, for all under it                                    |
| Representation    | structures, entities, particle lists, volumes, meshes                      | the type (cartoon, spacefill…; spheres or the decorating objects; slice or isosurface; surface, wireframe, both) and its few main settings                                |
| Decoration        | a particle target or list                                                  | what decorates it: an object of the scene, a PDB id or URL, spheres; targets by class                                                                                     |
| Slice             | a volume                                                                   | axis, position, contrast                                                                                                                                                  |
| Position          | every object (not its parts)                                               | Handles (Move and turn / Hide), position and rotation as numbers on demand, handle size, a list's scale, reset                                                            |
| Clips             | every node, a category                                                     | its clips (§5), each: its Handles, its numbers on demand (position, turn, size: sliders), On top, remove (Ludovic, 2026-10-25, 2026-10-27); a category's cut all under it |
| Labels            | every node                                                                 | its labels (§5), each: text, size, remove                                                                                                                                 |
| Graphics & Motion | every object (a structure, a model, a particle list, a volume; not a part) | quality (Ultra, Quality, Balanced, Fast) of that object alone; wiggle and tumble (a toggle at 1 Å, an amplitude) where it moves: not a volume                             |
| Group by          | a model with compartments                                                  | Compartment or Function: how the tree groups its entities; above the sections, not folded; view state (no operation, no step)                                             |

Graphics & Motion (Ludovic, 2026-10-24: on every object, what does not apply left out): `mesoscale.graphics` and
`mesoscale.motion` with an `object` (the mesoscale extension's ops, so Prism stays as it is). A mode sets, by kind:

| Mode        | quality (structure, volume) | levels of detail (particles, spacefill) | steps per cell (direct volume) |
| ----------- | --------------------------- | --------------------------------------- | ------------------------------ |
| ultra       | highest                     | ultra                                   | 5                              |
| quality     | high                        | quality                                 | 3                              |
| balanced    | medium                      | balanced                                | 2                              |
| performance | low                         | performance                             | 1                              |

One object's mode leaves the canvas alone; without `object` (⌘K, `?graphics-mode=`, the agent) every object changes, in
one step, and so does the canvas resolution (pixel scale, sharpening), which is the canvas's props, outside the history:
an undo does not bring it back. Motion writes the `animation` params of that object's representations (per structure,
where Mol\*'s component options are scene-wide). No mode is lit until one is picked: a structure's and a volume's
quality starts `auto` and a particle list's levels of detail at their own default, neither a mode's. The scene-wide
component options change only the representations that had their previous value, so one structure keeps its own (v6
#2057). Limits (TODO.md): a structure's own Representation preset and a representation added later bring their defaults;
the object then reads as mixed (every representation read: no mode lit, the motion off).

## 5. Right-click

On the canvas, at the level of what is picked (the selection granularity: an object, a group, an entity, a chain…), and
on a tree row, the same menu:

- **Focus**
- **Move and turn** (Ludovic, 2026-10-25: one item): shows the handles, move and turn together (live, one undo step on
  release, Esc or an undo during the drag cancels it); **Hide the handles** while they are on. On an object: the object
  itself. On a part (an entity, a chain): **[to decide]** the whole object it belongs to, or only that part.
- **Add label**: plain text at that place, for that node (Ludovic, 2026-10-18); it becomes a row under the node.
- **Add clip**: a plane, sphere or box for that node (only its particles or atoms are cut); it becomes a row under it.
  Several per node (Ludovic, 2026-10-18; up to 8 per particle list).

On a clip or a label (its guide in 3D, or its row): **Move**, **Rotate**, (a clip: **Size**, **Flip**; a label: **Edit
text**), **Hide**, **Remove**.

## 6. Not now

Snapshots and stories, the sequence view, angles and other measurements than distances, export: reachable from ⌘K, not
on screen. Added when needed.

## 7. Measurements

A distance between two points: atoms, residues, chains, instances and particles (one, or all of a multi-particle pick
such as a fiber, from their middle) (Ludovic, 2026-10-24), and volumes (Ludovic, 2026-10-25): a volume point is the
voxel under the click, on an isosurface or a slice ("map.mrc voxel (i, j, k)"); at a coarse pick granularity (Mol*'s
`structure`, which takes a volume whole) it is the whole volume's center ("map.mrc (center)"), following "the
granularity of what is selected". Its position is Mol*'s (the voxel's or the grid's sphere, in the volume's frame). A
voxel is picked on an isosurface, a slice or a direct volume (where it looks solid: Mol*'s `surfaceOpacity`; the same
`Volume.Cell` pick). A segment of a segmentation counts as the whole volume.

- **In selection mode** (its button under the 3D view) (Ludovic, 2026-10-24): that mode already selects everything in
  the scene; there, two ⌘+clicks on a Mac, two Ctrl+clicks elsewhere, also make a distance. A modifier click selects
  exactly as a plain click does (Ludovic, 2026-10-25: the distance is added, the selection not replaced; `spec.ts` gives
  Mol*'s selection-mode click toggle Ctrl and ⌘ triggers), on a structure, a particle or a volume. Outside it, nothing
  measures and the canvas's Ctrl+click and ⌘+click do what Mol* does (focus; `spec.ts` keeps them) and pick the row of
  what they hit, as a plain click; the status line says "Turn on selection mode to measure: ⌘+click two points"
  (Ctrl+click off a Mac) (Ludovic, 2026-10-25), on nothing too (a missed point, as in selection mode). In selection
  mode, Mol*'s camera bindings still answer a Ctrl+click (off a Mac): each point clicked recenters the camera on it
  (`clickCenterFocusSelectMode`), and a Ctrl+click on nothing resets the camera (`clickResetCameraOnEmptySelectMode`)
  while the first point is kept. ⌘+click (on a Mac) is bound to nothing else there: the camera stays. Leaving selection
  mode lets a first point go.
- **A point follows the pick granularity** (Ludovic, 2026-10-24): residues by default, so CA 1 to CA 10 of 1CRN reads
  10.67 Å between the residues' centers, and 12.60 Å at atom granularity; a chain, an instance at theirs; a bond: its
  atoms. The point is the row its pick reveals.
- **⌘ on a Mac, Ctrl elsewhere** (Ludovic, 2026-10-24): Ctrl+click is a right-click on a Mac. The status line names the
  platform's gesture.

- **⌘/Ctrl+click** a first point: it is selected (as the click selects) and said on the status line; its row is picked.
  ⌘/Ctrl+click a second: the distance is made (`stage.distance`, one step) and its row picked. Esc on the canvas, or a
  plain click, lets the first point go. ⌘/Ctrl+click on nothing, a label or a distance says what can be measured and
  keeps the first point. When the first point's object is removed, the next ⌘/Ctrl+click is a new first point (said).
  The same two points again, either way round: no second distance; the first one's row is picked and the status line
  says so; a failure says why.
- Drawn by Mol*'s `DistanceRepresentation` (a dashed line and its value), one cell from the root that depends on both
  objects: removing either removes the distance in the same step. Its text and line are scaled by the larger of the two
  things measured (an atom: Mol*'s own size; a particle: its radius, else its decoration's), so a distance between two
  proteins of a model reads at the model's scale. Its value is between the centers of the spheres around the points, as
  Mol*'s text says it.
- **Its row** is under the first point's row (its `node`: the row key at the time; a model's group not shown now: under
  the model, as a label; a key no row has: under its first object's row), its kind told before its value ("Distance
  12.34 Å"), with its eye. A click on its line in 3D picks the row (its text is not pickable: Mol*'s text geometry sets
  `pickable: false`).
- **Its properties** (Distance): the value, its two points (a click picks the point's row), text size and line width
  (times its own, 0.1–100: readable at a volume's scale; Ludovic, 2026-10-25), opacity; a log slider and its number box;
  one step a release.
- **Its right-click** (on the row or on the line): Focus (the camera on its two points), Hide, Remove.
- ⌘K and the agent: `stage.distance` takes a point as a pick (`{ loci }`), a structure target (`A:10@CA`) or a particle
  (`<list ref>#<index>`); `stage.editDistance` changes or removes one. A point is named "THR 1 CA (A)" (an atom), "LYS
  120 (A)" (a residue: author number and chain), "SerumAlbumin #12" or "Fiber (8 particles)".

## Status

- Step 1 (2026-10-18): the panel and the tree. The Scene tab opens at start (`view.open` after creation: an extension's
  tab registers after the shell starts, so `ui.layout.start` cannot name it); Prism's other tabs, the sequence band, the
  animation and export buttons are hidden (`overrides`, `showSequence: false`). Tree: four categories; a structure's
  entities and chains, a model's groups and entities, a list's targets, a volume's representations; eyes, counts,
  filter; click picks (highlight), double click focuses. + Open: files, an entry, examples, a session. Objects are named
  by their file. Properties: the picked row's name only (step 2). Code: `src/explorer/` (`operations.ts`: the `explorer`
  area; `ui.tsx`: the panel), test `src/explorer/_test/`.
- Step 1 fixes (2026-10-18): an eye flips at once (the operation runs after the frame is painted; on MG it was 0.1–0.6
  s, now one frame) and follows visibility changes (the scene read listens to cells' state); unchanged rows are kept (a
  change remakes only its rows); the row under the pointer is lit, in the tree and in 3D.
- Step 2 (2026-10-18): the properties, under the tree, a drag line between them (the tree as tall as it is, the
  properties in the rest). Sections that fold, by what is picked:
  - a structure, an entity, a chain: Look (color, opacity, glow, as its layers make it now: the last layer that covers
    all of it; a structure also: Color by a theme, Reset); a structure: Representation (a preset). Entities and chains
    are targeted by their label ids (`{ loci }`), not author chains.
  - a model, a group, an entity of a model: Look (color, opacity, glow; mixed when its entities differ; Generate colors,
    Reset; a model also Import colors…: a JSON color file, `mesoscale.importColors`, one step, by full name, else by the
    entity name (the last dotted part; the compartment path is not checked), the names it did not find said in the run's
    message, and the entities it names twice (a name in two compartments is one entity: the last color kept; v5 colored
    each compartment's copy)); a model: Graphics (mode, wiggle, tumble, as the representations have them).
  - a particle list or a target: Decoration (the cryo-ET Decorations control). A volume: Slice. A mesh: its look.
  - Shared controls moved to exported modules: `@molstar/cryoet-extension/controls` (Decorations, Slice, MeshControls),
    `@molstar/mesoscale-extension/controls` (GraphicsMode, Motion; the motion read from the representations, new
    `mesoscale.graphicsState`). A slider acts once released (one step).
- Step 2 additions (2026-10-18, Ludovic's test):
  - A particle list (and a model, a target): Representation, each of its representations with an eye
    (`explorer.representationVisibility`) and its whole form, as Prism's inspector has it (`ParamsFormModel` on the
    transform's params): the type (spheres, orientation, the targets…) and its params, the color and size themes; a
    change acts a moment after the last (`particles.update`). A type change rebuilds a large list's glyphs (a few
    seconds).
  - Decoration with an entity of a model: the decoration selects list, under each cellPACK or PetWorld model, its
    entities; `cryoet.decorate` `with: entity` (`entity: "motor.bcif › 8WIW"` or the name alone). Library:
    `ParticleListWithTargets` takes a `target` source (a particle list and its target id: that list's own reference
    object, the entity's structure; a dependency, as `ref`).
  - A mesh: Scale (a slider by powers of ten and a field; a mesh in pixels: the pixel size), about the file's origin;
    `cryoet.mesh` `scale` (the shape's instance transform), read back in `MeshInfo.scale`.
- Volumes (2026-10-18, Ludovic's test): a volume dropped opens as its three slices, X, Y, Z (the middle ones), no
  isosurface (`withTomogramSlices`: the CCP4 / MRC provider's visuals in the app's plugin spec, `sliceVisuals`). The
  tree: the volume, then Slice X, Slice Y, Slice Z and any isosurface. Properties: the volume, a section per slice
  (position, contrast), Isosurface (its form, or Add an isosurface); a slice, its position and contrast then its whole
  form; an isosurface, its form. `cryoet.slice` acts on the slice of its axis (made if missing; a moved slice keeps what
  its form set); `cryoet.slices` shows the three (and hides the isosurfaces unless asked not to).
- Step 3a (2026-10-18): one right-click menu, on the canvas and on a tree row, at the level of what is picked (the
  selection's granularity: a structure, an entity, a chain; a model, an entity; a list, a target; a volume; a mesh):
  Focus, Hide (where an eye hides it), and for now the stage's cuts (until Add clip, 3b); on a cut's guide, the stage's
  own items (move, turn, size, flip, remove). The tree follows a pick in 3D (a left- or right-click): its row picked,
  the way to it unfolded, brought into view. What a click is on is the stage's (`stage.pickedAt`: the object and its
  part, a label under the pointer first; 2026-10-27), its row the explorer's (`pickedRow`; `pickedOf(loci)` for a loci),
  `menu.ts`; stage-tools lets a host open the menu (`menuHosted`, the request's `loci`; its items in
  `@molstar/stage-tools-extension/menu`).
- Step 3b (2026-10-19, as the Mesoscale Explorer's rows): a row's tools at its right end, the brush (a color for all of
  it: swatches; a model's or group's Generate colors) and the scissors (a clip: plane, sphere, box; a part's also
  cylinder), beside its eye. Several clips at each level: an object's (structure, model, list, volume) cut all of it
  (`stage.cut add`, `stage.uncut index`), a part's (group, entity, target) its particles (`mesoscale.clip add`, `cut`:
  which). The properties' Clips: each clip, its name, Move / Turn / Size in 3D, its shape's eye (`setGuideShown`, a view
  aid), remove; an object's clip, its side; a part's, its type and placement. The right-click: Color…, Add a clip…. A
  structure's entities and chains, meshes and slices have no scissors yet (their clipping is Prism's, by groups). The
  scissors icon is added to Prism UI's icon set.
- Step 3c (2026-10-19): labels, plain text. The right-click's Add a label puts one in front of the node (its sphere's
  center, brought toward the camera by its radius; sized to its object), named after it, and picks its row: it is listed
  under the row it was made at, its text edited in its properties (as typed), its size and color, removed. A label's
  right-click: Focus, Edit the text, Hide, Remove; picked in 3D, its row. A state transform of the stage tools
  (`StageLabel`: saved in a session, undone), drawn as text by a shape representation under it; `stage.label`,
  `stage.editLabel`, `labelsState`. Its move comes with 3d.
- Labels, fixed (2026-10-20, Ludovic's test): made on the canvas, a label goes where it was clicked (the click's point
  on what it picked, `StageMenuRequest.position`), not the node's center (an entity's copies or a group around a model
  have their center at the model's); made from the tree, on the part's particle nearest the camera (`anchorOf`). Its
  height is the stage's (`stage.label` `radius`, the part's radius, 2026-10-27): about half the part's size, at least a
  15th of its object's and 2 Å, in half-Å steps; at a point clicked, in front of it by that height. A label is found
  under the pointer by its box on the screen (`stage.labelAt`: Mol* draws text, it does not pick it), so a left-click
  picks its row and its right-click is its own: Edit the text… (a field where it was clicked, Enter keeps it), Move,
  Focus, Hide, Remove. Its properties: text, size, color; its plate (shown, its color, its opacity) and its tether (on,
  its length: the text set off up and to the right, a line to its place); on its representation too (a text's plate is
  drawn by its props).
- Step 3d (2026-10-19): Move and Turn, by dragging on the canvas (a layer takes the pointer; the drawing follows,
  `previewMove`, the state unchanged; released: one step, `stage.move`; Esc: back, no step), for a whole object: a
  structure (its transform, Prism's), a particle list (`ParticleListTransform`, a new decorator), a volume
  (`VolumeTransform`), a mesh (its shape's transform, its scale kept); a label is moved too. Its clips and labels move
  with it, in the same step. What reads where an object is reads it as drawn, down its decorators (`drawnObject`).
  Library: the particles' target representation takes a representation's transform (it ignored it).
- Prism first (Ludovic, 2026-10-21): upstream main and v6 Prism have priority over this branch's own code. Clipping is
  Prism's (#2021, its `clipping.*` and its handles): an object's scissors (a structure, a model, a list, a volume, a
  mesh) add Prism's cut of all of it (`clipping.add` by node), its handles shown on it; its Clips list Prism's cuts
  through its representations, each: its handles (move, turn, size in 3D), its drawing in the scene (`clipping.show`),
  its shape and side, remove. A cut's drawing is not a mesh. An entity's or group's clips stay ours (the mesoscale cuts:
  Prism cuts whole representations), with their guides. The stage tools' whole-object cuts (`stage.cut`, `adjust`,
  `uncut`, `cuts`, their tree row) are gone.
- Moving is Prism's too (2026-10-21): Move and turn shows Prism's handles (its gizmo library) on the object, a drag
  previewed, each release one step: a structure's are Prism's own (`api.move`, its structure-move feature), a particle
  list's, a volume's or a mesh's the stage's on the same library (`ObjectMoveGizmos`, committing `stage.move`; a mesh's
  scale kept under the turn); one object's handles at a time; the properties' Position shows or hides them. A label
  keeps its drag (Move: nothing to turn).
- Particle lists (2026-10-22, Ludovic's test): one with orientations opens as its spheres and its axes, both shown
  (`PluginConfig.Particles.ShowOrientations`, on in the app's spec; a library option, off by default); each has its eye
  in Representation. What stands for the particles follows their decoration: the objects while any target is decorated,
  else the spheres and axes; a target representation made before (or hidden) is shown again, not made twice
  (`ensureTargetRepresentation`). Before, back to Spheres left the list drawn by nothing.
- One clip system, Prism's (2026-10-22, Ludovic): the scissors are on whole objects only (a structure, a model, a list,
  a volume, a mesh); a group's, an entity's or a target's are gone, and so are the stage tools' guides (their drawing,
  eye, drag and menu items, `stage.guides`, `stage.object`). An object's Clips list Prism's cuts of it, each: its name,
  its handles (shown or hidden: move, turn and size it in 3D), remove; and Add a clip. Its shape, side and drawing are
  Prism's handles' and Clipping's, not repeated here.
- Parts cut by Prism (2026-10-22, Ludovic: "Prism clipping should cut every level"). Step 1, a structure's entity or
  chain: its scissors add Prism's cut of only its atoms (`clipping.add` `only`, a library change: the rest its
  representations draw kept whole by Mol\*'s clipping groups); its Clips list the cuts of exactly its atoms (a cut's
  `atoms`, read back), its object's list all of them, a part's named by its part. Step 2, a model's or list's group,
  entity or target: its scissors add Prism's cut of only its particles (`clipping.add` `particles`, by node: the others
  ignore it, recorded by the cut's tag in the representation's layers); its Clips list the cuts of exactly its
  particles. `mesoscale.clip` (the explorer's own sliders, by place) is gone. Next: shapes.
- A list's representations (2026-10-22, Ludovic: "I lost the default representation and can't bring it back"): each in
  Representation has its eye, its form and a remove (Prism's `particles.remove`), named Spheres, Axes, Objects (the
  decoration); Add a representation lists the kinds not shown (Prism's `particles.representation`), and Spheres and axes
  at once when both are gone. A decoration switches what is drawn only when the list becomes decorated (the objects
  shown, spheres and axes hidden) or no longer (the spheres back, made again if removed); between, the eyes are the
  person's. An entity is picked by its name as written before names that differ in case only (7CGOA, 7CGOa).
- Targets by class and back (2026-10-22, Ludovic's test: Class, then File drew nothing): back to the file keeps the
  decorator (no attribute: the list as it is), as deleting it took the representations under it; a switch clears the
  decorations (they were of the other targets' ids) and switches what is drawn as a decoration does. File, Class, Score…
  have a tooltip (Prism UI's Choices: the app's `data-tip`, as its buttons, not a native title).
- Keys in the tree (2026-10-22, Ludovic): a click on a row focuses the tree (a `tree` of `treeitem`s: level, selected,
  expanded); Up and Down pick the row before or after (past the categories), Right opens a closed row or picks its first
  child, Left closes an open row or picks its parent (`treeKey`); the picked row comes into view. Not while typing in a
  field. The Decoration's Targets row is always there: File alone, and why, when the file has no columns (CC, class,
  score) to split its targets by (an NDJSON list).
- Clip whole (2026-10-22, Ludovic: "on a cellPACK model we either clip the atoms or the proteins"): a model's or a
  list's Clips, while it draws objects, has Clip whole: Proteins (Mol\*'s `instance` variant: an object whose center is
  cut goes, the others stay whole) or Atoms (`pixel` with the spheres' `clipPrimitive`: each atom whose center is cut
  goes, the objects carved); as made, neither (cut through). On its target representations, one step
  (`stage.clipWhole`); a cut of a part (an entity) keeps to its part either way.
- Some targets decorated (2026-10-22, Ludovic's test: a class decorated, everything else gone): the spheres, axes and
  other representations of a list stay and draw the targets not decorated; the decorated ones are left out of them
  (their layers' `hidden`, a library param: fully transparent), so a class drawn as objects is not drawn twice and the
  others still show. The objects are shown when the list becomes decorated and hidden when no longer (they draw nothing
  then); the spheres are made again if removed. This replaces hiding the spheres as a whole.
- Three fixes (2026-10-22, Ludovic's test). Open a mesoscale example offers its examples by name (the 13 of
  molstar.org/me/examples it can open; its molx sessions left out), not a free id; one the live list no longer has is
  said so. A list's color theme changed in its form clears the colors set in Look (Generate colors, painted over the
  theme, hid any change of it). Wiggle and Tumble move the model they are shown for (`mesoscale.motion` `particles`),
  not every list of the scene; the graphics mode stays the scene's (a performance setting).
- Handle size (2026-10-22, Ludovic): Position and Clips have a Handle size slider (25–400%), one setting for every
  handle on the canvas (Prism's clip and move handles, the stage's), from the gizmo library's `GizmoAppearance` (a
  library change): the handles sized about their center, live; a cut's body as it is. X-ray: see Handles on top.
- Handles on top (2026-10-26, Ludo): Position's Handles line and each clip's line have On top (a toggle, the same
  setting in both, `canvas.handles` `onTop`; ⌘K "Handles on top"): every handle on the canvas (Prism's clip and move
  handles, the stage's, the oblique slice's, a particle's) drawn over everything, so a handle inside or behind a model
  is seen and grabbed through it (a press on it drags it, not what is in front). Every part of a gizmo is on top, its
  body too (a clip's plane, a slice's frame: Ludo, 2026-10-26, a handle one cannot see cannot be grabbed); the body is
  not picked. Off by default; one viewer-wide setting (the coordinator's default, not one per handle); a view setting,
  no undo step, kept with the canvas (not across reloads; prism-me keeps no canvas setting across one). Off: the handles
  hide behind what is in front, as before. A hovered handle turns yellow, on top or not (Ludo, 2026-10-27: a strong
  color, no grow), and stays so while dragged: on top no outline (the marking pass draws the scene only) and no glow
  show it.
- Particle scale (2026-10-23, Ludovic: "important for tomograms and Simularium"): a list's or model's Position has Scale
  (Å per unit of its file, 0.01–100 on the slider, any value typed): its positions scaled about the file's origin,
  before its move and turn (the list transform's `scale`, a library param), so particles in a tomogram's pixels line up
  with it; the objects drawn at them keep their size. One step (`stage.scale`, the agent's `scale_particles`); a move
  keeps it, and the move handles sit on the list as scaled. Next (agreed): the handle's options (six sliders, its place
  and turn), a decoration's offset per list or target, its local handle (All on: the offset of the group; off: the
  picked instance itself).
- Place by numbers (2026-10-23, step 2): Position's handle row has an options button (sliders): six sliders, X, Y, Z
  (where the object's center is, Å, within twice its size of it) and Turn X, Y, Z (Euler, X then Y then Z, °), each with
  its number. A slider shows the object as it goes (`previewPose`) and its release is one step (`stage.pose`: the change
  as a move after where it is, its clips and labels with it; a list's scale kept); the handles show the same pose, and a
  handle's drag sets the numbers. For a structure, a list, a volume, a mesh (`placementOf`, a structure's now too).
- Decoration offset (2026-10-23, step 3): in Decoration, All targets and each target (a class when split by one) have an
  options button: six sliders, X, Y, Z (Å, along each particle's own axes) and Turn X, Y, Z (°, about them, X then Y
  then Z), each released one step (`cryoet.offset`); lit while an offset is set. The particles of those targets are
  placed so (a library decorator, `ParticleListOffsets`, the last of the list's: its classes and decorations known), so
  what decorates them follows; all targets' offset and a target's add up. A switch of classes clears them (they were of
  the other targets' ids).
- Local handle (2026-10-23, step 4): a right-click on a particle offers Move this instance (handle) and Offset all like
  it (handle): Prism's gizmo handles on that particle, in its own frame. All off edits the particle alone (the offsets'
  `instances`, by index: one protein of a cellPACK model moved and turned); All on edits the offset of its kind (its
  target: its class, its entity). A drag draws the list's representations with the particles offset (the state, and its
  history, untouched: Prism's watcher would make the steps before unsafe), its release is one step (`cryoet.instance` or
  `cryoet.offset`); the edited offset solved so the particle is where the handle took it, the other offsets around it
  kept. Position shows, while it is on the list: Local handle, the particle, All, hide, and the offset by numbers.
- Models decorated too (2026-10-23, Ludovic: "why can't we change the target in Simularium"): a model (a list with
  entities: Simularium, cellPACK, PetWorld) has the Decoration section, so each of its targets (an agent, an entity) can
  be drawn as another object of the scene. A particle list's own shape (a Simularium simulation box) is not listed as a
  mesh.
- IMOD's look (2026-10-23, Ludovic): a dropped MRC opens as 3dmod opens a tomogram: its middle XY slice (along z) shown,
  grayscale at mean ± 3σ, the camera straight down z (x right, y up) framed to the slice; the x and y slices made too,
  hidden (their eyes show them). The properties' sections all start closed; one opened stays open from row to row this
  session.
- Remove (2026-10-22, Ludovic): a loaded object's row (a structure, a model, a list, a volume, a mesh) has a trash icon
  after its scissors, and its menu a Remove: the object goes with its file (all the file holds: a model's unit cell) and
  its labels; a file holding another listed object keeps it (Prism's `structure.remove`, `particles.remove`,
  `volume.remove` of the one object). One step of the history (its labels, if any, a step after it). The entry is given
  to `state.remove` by its ref alone: an example's (a download, loaded by address) is no kind a `#ref` selector reaches.
- A volume moves as one (2026-10-24, Ludovic: "the volume, the parent, this should move everything, not jump"): its
  slices and isosurfaces are drawn in its frame and have no place of their own: no Position, and their menu's move shows
  their volume's handles ("Move and turn its volume"); a grid slice moves through the volume by its index only. A
  whole-cell map (an EMDB map centered on 0) had its slices drawn half a box from the volume (a library fix,
  `createPeriodicVolume` keeping the grid's origin): the handles, on the volume's center, turned them about a corner.
- The oblique slice (2026-10-24, Ludovic: "a special slice … that use its position to get the volume value"): a volume's
  slice on any plane (Mol*'s slice `mode: 'plane'`), "Add an oblique slice" in the volume's properties (a new one
  through the middle, tilted 30° about X and Y, its handle shown). Its row (Oblique slice) and section: a handle
  (Prism's gizmo library at its point, its Z the plane's normal: moved anywhere, tilted about X and Y; no ring about its
  normal, which a point and a normal cannot hold), its point (X, Y, Z: Å from the volume's center along its axes) and
  tilt (about X, then Y) by numbers, its contrast; Remove. The numbers are in the volume's frame (its grid's center and
  axes), so they stay as the volume moves; the plane the slice is given is in the scene's Å, and the stage's move of a
  volume moves it in the same step (`movedRepresentationParams`, with the clip objects). A drag shows the slice cut
  where the handle is (its representation given the plane, the state untouched); the release is one step
  (`cryoet.oblique`); the handle keeps the turn about the normal it was released at while the plane is unchanged (a turn
  about its own Y tilts and twists it; the twist is not the plane's, so the handle does not spin back on release; an
  undo, a reload or the numbers show the plane's own frame). Outside the volume it is not drawn (the slice's box trim).
  Its menu: Move and tilt it. The x, y and z slices are grid slices only (`mode: 'grid'`): `cryoet.slice` never takes
  the oblique slice for one.
- Group by (2026-10-24, Ludovic: in the tree, not the Entities tab): a model with compartments has a Compartment /
  Function switch (Prism's `Choices`) in its properties, above the sections; its tree rows follow it. The grouping is
  the explorer's view state by model ref (`SceneModel.groupings`, a `keyedState`; no operation, no history step), read
  through `infoState(ref, groupings.key(ref))`, so a switch re-reads and remakes that model's rows alone. A function's
  group row is keyed apart from a compartment's (`g:<ref>:fn:<name>`). Group rows act by entity ids, so eyes, Look,
  clips and picks need no grouping; Look's Generate colors passes the model's grouping (`mesoscale.colors` `groupBy`).
  `mesoscale.entities` and `mesoscale.style` take `groupBy` for ⌘K and the agent.
- Graphics & Motion (2026-10-24, Ludovic: quality and motion on every object, not only cellPACK): the model-only
  Graphics section became Graphics & Motion on a structure, a model, a particle list and a volume (quality only); a part
  has none (§4). Per object: `mesoscale.graphics` and `mesoscale.motion` take `object`, one step each; the global mode
  stays for ⌘K, `?graphics-mode=` and the agent, and is now the only way to set the canvas resolution. Control:
  `ObjectGraphics` (`@molstar/mesoscale-extension/controls`). A volume's quality changes little (Mol\*'s `quality` only
  turns off double-sided faces at low on a slice or an isosurface; a direct volume's steps per cell show).
- A part's move (an entity, a chain, a group, a target): greyed in the menu, for now. Spiked: a model's or list's part
  is simple (the transform with a selection: only those particles); a structure's chain needs its own component, taken
  out of the others, with a transform under it (presets would undo it). Ludovic to choose.
- Not yet (step 3, with the right-click menu): Position, Clips, Labels. Also: the tree following a pick in 3D; a
  structure entity's or chain's eye (Prism hides representations, not parts); a color dot only where a color was set;
  the mesh section repeats the mesh's eye and name.
