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
    Reset); a model: Graphics (mode, wiggle, tumble, as the representations have them).
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
  the way to it unfolded, brought into view. `explorer.pickedOf(loci)`, `menu.ts`; stage-tools lets a host open the menu
  (`menuHosted`, the request's `loci`; its items in `@molstar/stage-tools-extension/menu`).
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
  have their center at the model's); made from the tree, on the part's particle nearest the camera (`anchorOf`). A label
  is found under the pointer by its box on the screen (`stage.labelAt`: Mol* draws text, it does not pick it), so a
  left-click picks its row and its right-click is its own: Edit the text… (a field where it was clicked, Enter keeps
  it), Move, Focus, Hide, Remove. Its properties: text, size, color; its plate (shown, its color, its opacity) and its
  tether (on, its length: the text set off up and to the right, a line to its place); on its representation too (a
  text's plate is drawn by its props).
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
  (`explorer.clipWhole`); a cut of a part (an entity) keeps to its part either way.
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
  library change): the handles sized about their center, live; a cut's body as it is. X-ray (handles seen through what
  is in front): to come, a renderer change.
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
- A part's move (an entity, a chain, a group, a target): greyed in the menu, for now. Spiked: a model's or list's part
  is simple (the transform with a selection: only those particles); a structure's chain needs its own component, taken
  out of the others, with a transform under it (presets would undo it). Ludovic to choose.
- Not yet (step 3, with the right-click menu): Position, Clips, Labels. Also: the tree following a pick in 3D; a
  structure entity's or chain's eye (Prism hides representations, not parts); a color dot only where a color was set;
  the mesh section repeats the mesh's eye and name.
