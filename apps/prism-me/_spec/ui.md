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
│                              │ ▾ Clips            │   every clip of the scene
│  [view buttons]              ├────────────────────┤   a split the person can drag
│                              │ properties of the  │   the properties of the node
│                              │ node clicked       │   clicked in the tree or in 3D
└──────────────────────────────┴────────────────────┘
```

The rail keeps two buttons: the panel (the tree) and Settings (the canvas settings). ⌘K and the assistant as Prism has
them.

The filter keeps each row whose name holds its text, with the rows it is in (looked for in every row, opened or not); a
category with no hit goes (as Prism's tree). While filtering, a row's chevron folds it (its hits under it hidden); a new
filter opens every row again.

## 2. Opening

- Drag and drop anywhere: every format (features.md, "Opening files"); each lands in its category. A clip made anywhere
  (a node's Clips, Add clip…) lands in Clips (§3), and so does one a session or a file brings.
- **+ Open** at the top of the tree: Files…; PDB / PDB-IHM / EMDB id…; Examples (the Mesoscale Explorer's); Session….
- The tree empty: a short line in its place, "Drop files here, or + Open", with the formats.

## 3. The tree

Four categories of objects, then Clips (Ludo, 2026-10-28), each shown when it holds something. Under each object
category, what was opened, then its parts; the parts' parts are loaded when first opened (thousands of entities cost
nothing until looked at). Under Clips, every clip of the scene (§4, Clip).

| Category   | An item                                                                                | Its children                                                                                                                                                      |
| ---------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structures | a PDB / mmCIF / other structure file or entry (1CRN)                                   | its entities, then chains                                                                                                                                         |
| Particles  | a cellPACK or PetWorld model; a particle list (RELION, Dynamo, EM, NDJSON, Simularium) | a model: its groups (compartments, or functions by its Group by), then entities. A list: its targets (a class each when by class), each showing what decorates it |
| Volumes    | a map, tomogram, tilt series (MRC…)                                                    | its representations (slice, isosurface)                                                                                                                           |
| Meshes     | a mesh file (OBJ, PLY, VTP)                                                            | its segments, when it has several                                                                                                                                 |
| Clips      | a clip (Prism's cut, its tag): its shape and number (Plane 1), how many it cuts        | none: what it cuts is in its properties (§4, Clip)                                                                                                                |

A model's groups follow its Group by (§4), a model's own choice: compartments (the dotted names' tree) by default when
it has some, else functions; switching remakes that model's rows only. A group row stands for its entities (their ids),
so its eye, Look, Clips and picks are the same under both groupings. A label made at a group the model's grouping does
not show now is a row under the model (picked, hidden, edited and revealed there), back under its group when that
grouping is shown again (a default, to confirm).

Every row: a color dot where it has one color, its name, a count (atoms, particles, entities) faint, then its eye and
its ⋯, always in view, each in a column of its own down the tree; a row without an eye (a structure's entity or chain:
Prism hides whole representations) keeps its room (Ludo, 2026-10-28). The ⋯ is its right-click (§5), which holds what
the row's tools did: Color… (a color for all of it), Add clip… (a clip of it) and Remove (an object, a clip, a label, a
distance, one step; not a part). A row's color dot opens its colors, as Color…. There is no Hide in a menu: the eye is
there.

- **The eye** shows or hides what the row stands for, one step. A parent's eye sets every row under it, all the way
  down, folded or not (a model's entities, a list's targets, a volume's representations; a category's objects and all of
  each), in one step; each row keeps its own state after (hide the model, then show one group alone). Showing a part
  draws its object again, its other parts as they are. A parent's eye is open when it and everything under it are shown,
  else closed: never "some shown"; pressed, it sets all of it. A volume's representations are its views, not parts: a
  tomogram's hidden slices leave its eye open. The labels, distances and clips under a row keep their own eyes (Ludo,
  2026-10-28; the cascade is the coordinator's default for what "every row" covers).
- **Dragged** (C4D's eyes, Ludo 2026-10-28): press an eye and drag along the column; every row passed takes the first
  row's new state (with the rows under each), shown at once and set on release in one step; a fast move sets the rows
  between too; a cancel (Esc, a lost release) puts the eyes back. A click is a drag of one row.
- **A category's ⋯**: Color… (its color theme for every object under it: the themes its kind takes, each object by its
  own, `mesoscale.theme`, one step; Ludo, 2026-10-27): Structures by object, entity, chain or one color; Particles by
  object, entity (a list with no entities: by object), generated colors or one color; Volumes (their isosurfaces: slices
  show the data) and Meshes by object or one color; one color (Uniform…) picked in Prism's color picker at the ⋯ and
  applied once (one step); and Add clip… (a new clip of every object under it, or one of the scene's used on all of
  them).
- **The Clips category** (lane `clips-category`): its eye draws every clip in the scene, or none (one step), open when
  all are drawn; its ⋯ has New clip… (a new clip of every object of the scene). A clip's row: its eye its drawing, its ⋯
  Remove.

Labels made at a node are rows under it (§5), and distances under their first point's row (§7), each with its own eye. A
clip is never a row under a node: it is a row of Clips (Ludo, 2026-10-28).

A click on a row picks it: highlighted in 3D, its properties below. A category is picked too (Ludovic, 2026-10-25). The
arrows move the pick (↑/↓, Home, End; → opens or goes in, ← closes or goes to the parent), as a click. A double click
focuses the camera on it. The tree follows what is picked in 3D (a click on a particle picks its entity's row and opens
the way to it).

## 4. Properties

The properties of the picked row, in sections that fold. Only what applies to it. Its header: the row's name and its
kind in words (Structure, Mesoscale model, Particle list, Clip…). The sections are Prism's `SectionList`, the app's and
its mock's (`explorer/properties-view.tsx`), in the table's order: all start folded, and one opened (or folded) stays so
from row to row this session, whatever the row's kind (one slot; a folded section is paused). A line is a label in the
label column (`--msp-label-width`) and its control, Prism's (styling.md §4).

| Section           | For                                                                                                                                          | What                                                                                                                                                                                                                                                                                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Look              | a category; structures, their entities and chains; models, their groups and entities; meshes (a volume, a list, a target: none of their own) | color (picker; for a model or group: Generate colors), opacity, glow; a mesh: color, surface, wireframe or both, opacity, scale; a category: visible and a color theme, for all under it (the themes of §3, as its brush: one step; Uniform's color in Prism's picker, applied once). A node's visible is its eye in the tree (a Visible line here: open, TODO.md) |
| Representation    | structures (a preset), models, particle lists, a volume's slices; a volume's isosurfaces in Isosurface                                       | the type (spheres or the decorating objects; slice or isosurface) and its settings; a structure: a preset                                                                                                                                                                                                                                                          |
| Decoration        | a particle list, a model, a target, a model's group or entity                                                                                | what decorates it: an object of the scene, a PDB id or URL, spheres; targets by class                                                                                                                                                                                                                                                                              |
| Slice             | a volume (each of its slices a block), a slice                                                                                               | axis, position, contrast                                                                                                                                                                                                                                                                                                                                           |
| Position          | every object (not its parts)                                                                                                                 | Handles (Move and turn / Hide), position and rotation as numbers on demand, handle size, a list's scale, reset                                                                                                                                                                                                                                                     |
| Clips             | every node but a volume's slice or isosurface; a category                                                                                    | the clips on it, each its name (a click picks its row) and × (no longer cut by it, one step), then New clip (a shape: it cuts this, one step) and Use a clip (one of the scene's, one step); a model's or list's Clip whole; the handle size. A category's: New clip and Use a clip for every object in it; the Clips category's: where its clips are              |
| Clip              | a clip's row (Clips)                                                                                                                         | its editor (its Handles, its numbers on demand: position, turn, size; On top, remove; its shape, Prism's five, and invert, one `clipping.update` each: Ludovic, 2026-10-25, 2026-10-27), then What it cuts: every object or part it is given, each its name (a click picks its row) and × (one step), Cut also… (one step)                                         |
| Labels            | every node but a category                                                                                                                    | its labels (§5: those made at it, its row's key), each: text, size, remove (one step each); a label's row: also its color, plate and tether                                                                                                                                                                                                                        |
| Graphics & Motion | every object (a structure, a model, a particle list, a volume; not a part)                                                                   | quality (Ultra, Quality, Balanced, Fast) of that object alone; wiggle and tumble (a toggle at 1 Å, an amplitude) where it moves: not a volume                                                                                                                                                                                                                      |
| Group by          | a model with compartments                                                                                                                    | Compartment or Function: how the tree groups its entities; above the sections, not folded; view state (no operation, no step)                                                                                                                                                                                                                                      |

A clip and what it cuts (Ludo, 2026-10-28; lane `clips-category`): a clip is one Prism cut, its tag, over the
representations it is given (`clipping.md` §1). Of an object it cuts all, some particles (a model's entities, a list's
targets: the representations' layers record them by the tag, clipping.md §5) or some atoms (the rest kept whole by its
group bit). So What it cuts lists, object by object in the tree's order: an object it cuts all of; of a model, the
largest groups it cuts all of (as the model's grouping shows them), then entities; a list's targets; a structure's
entities, or their chains, it cuts all of; a model's compartments when the clip is of compartments (Prism's selector,
from ⌘K or the agent: given an entity too, it keeps them). A node's Clips lists the clips that cut all of it (an
object's: any clip on it). Cut also… offers each object, a structure's entities, a model's groups and a list's targets
it does not cut all of (a model's entities from their own Clips: they are many). Each add or take-off is one step
(`explorer.clipUse`: Prism's `clipping.apply`, `particles.look` cuts, `clipping.keep` and `release` in one run). The
last thing a clip cuts has no × (greyed: a clip cuts something; remove the clip instead), as Prism's `clipping.apply`
refuses it: in a clip's What it cuts, its only line; in a node's Clips, a clip whose every line is in the node (an
object cut in two parts). Many objects given or taken off at once (a category's) are one `clipping.apply`; a part of a
structure cut again is that part only (`clipping.release` with a target), another structure's kept atoms stay kept.
Limits, Prism's: 16 clips a representation; a clip of a part only among the first six on it (Mol\*'s clipping groups).

Graphics & Motion (Ludovic, 2026-10-24: on every object, what does not apply left out): `mesoscale.graphics` and
`mesoscale.motion` with an `object` (the mesoscale extension's ops, so Prism stays as it is). A mode sets, by kind:

| Mode        | quality (structure, volume) | levels of detail (particle lists, structures), smallest sphere drawn | steps per cell (direct volume) |
| ----------- | --------------------------- | -------------------------------------------------------------------- | ------------------------------ |
| ultra       | highest                     | 1.5 px                                                               | 5                              |
| quality     | high                        | 3 px                                                                 | 3                              |
| balanced    | medium                      | 4 px                                                                 | 2                              |
| performance | low                         | 6 px                                                                 | 1                              |

The levels of detail are by size on screen (`Spheres.LodPixelPresets[mode]`: the levels and their `lodPixelSize`, as a
particle target's and the mesoscale preset's defaults; Ludo, 2026-10-29, cellVIEW evaluation item 1), on every
representation that has levels (a list's spacefill and target, a structure's spacefill or cartoon). The distance presets
(`LodLevelsPresets`) are ignored once `lodPixelSize` is set: a mode that wrote them changed a target's strides only. A
particle list's mode is read back by both, the levels and the pixel size, on its representations that have levels (not a
cellPACK list's fibers); a structure's and a volume's by quality.

One object's mode leaves the canvas alone; without `object` (⌘K, `?graphics-mode=`, the agent) every object changes, in
one step, and so does the canvas resolution (pixel scale, sharpening), which is the canvas's props, outside the history:
an undo does not bring it back. Motion writes the `animation` params of that object's representations (per structure,
where Mol\*'s component options are scene-wide). A structure's and a volume's quality starts `auto`, no mode's; a
particle list lights a mode when its levels of detail are that mode's preset, so a list drawn by targets alone starts at
Quality, lit, and one with a spacefill (levels `[]`, 0 px) lights none until one is picked. The scene-wide component
options change only the representations that had their previous value, so one structure keeps its own (v6 #2057). Limits
(TODO.md): a structure's own Representation preset and a representation added later bring their defaults; the object
then reads as mixed (every representation read, a list's mode on those with levels: no mode lit, the motion off). A
state saved before 2026-10-29 has the distance presets: it lights no mode until one is picked again.

## 5. Right-click

On the canvas, at the level of what is picked (the selection granularity: an object, a group, an entity, a chain…), and
on a tree row (its right-click or its ⋯), the same menu, in this order:

- **Focus**
- **Move and turn** (Ludovic, 2026-10-25: one item): shows the handles, move and turn together (live, one undo step on
  release, Esc or an undo during the drag cancels it); **Hide the handles** while they are on. On an object: the object
  itself. On a part (an entity, a chain): **[to decide]** the whole object it belongs to, or only that part.
- **Color…**: a color for all of it (swatches; a model's or a group's Generate colors first).
- **Add label**: plain text at that place, for that node (Ludovic, 2026-10-18); it becomes a row under the node.
- **Add clip…** (Ludo, 2026-10-28): a new clip of each shape (New plane, sphere, box, cylinder, cone) that cuts that
  node (only its particles or atoms), then every clip of the scene (Use Plane 1…), used on it too (one step), those on
  it already greyed. A new clip is a row of Clips (§3), its handles shown. Several per node (Ludovic, 2026-10-18; a clip
  of a part among the first six on a particle list's or a structure's representation). A category's Add clip… lists the
  same for every object in it.
- **Show only** (cellVIEW's, Ludo 2026-10-28), on a part of a model or a list: **Show only this**; on a model's entity
  also **Show only its group** (the group it is under as the tree groups the model) and **Show only its compartment**
  (cellPACK's `root.<compartment>.(surface|interior).<group>`: every entity whose compartment path is the same before
  its last surface or interior, so a membrane beside them is in it and a compartment inside it, the capsid in the
  envelope, is not; by function the same, read from the compartments); **Show all again**. Each one step through
  `particles.look`, the object drawn again if hidden.
- **Remove** (an object: with its file and labels).

On a clip or a label (its guide in 3D, or its row): **Move**, **Rotate**, (a clip: **Size**, **Flip**; a label: **Edit
text**), **Remove**. On a distance: **Focus**, **Remove**. No **Hide**: every row's eye is in view (Ludo, 2026-10-28).

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
  Prism's handles' and Clipping's, not repeated here (until 2026-10-25: a clip's shape and invert are its fields, §4).
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
  expanded); Up and Down pick the row before or after, Right opens a closed row or picks its first child, Left closes an
  open row or picks its parent; the picked row comes into view. Not while typing in a field. Since 2026-10-27 Prism's
  `TreeNavigation` (a category picked too, Home and End; below). The Decoration's Targets row is always there: File
  alone, and why, when the file has no columns (CC, class, score) to split its targets by (an NDJSON list).
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
- Remove (2026-10-22, Ludovic): a loaded object's menu (a structure, a model, a list, a volume, a mesh; its row's ⋯ and
  its right-click) has a Remove (and its row's trash, §3): the object goes with its file (all the file holds: a model's
  unit cell) and its labels; a file holding another listed object keeps it (Prism's `structure.remove`,
  `particles.remove`, `volume.remove` of the one object). One step of the history (its labels, if any, a step after it).
  The entry is given to `state.remove` by its ref alone: an example's (a download, loaded by address) is no kind a
  `#ref` selector reaches.
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
- The tree on its mock (2026-10-27, lane `tree-view`; the coordinator's defaults, not Ludo's): the explorer draws its
  tree with the mock's view (`explorer/tree-view.tsx`, `tree.module.css`: Prism UI only, the Storybook mock draws the
  same), its own rows on Prism's `VirtualList` (Prism's `SceneTree` is not exported): a screenful made, an opened
  model's thousands of entities too; rows keyed and kept while the same (`keepRows`, field by field: no JSON). Keys:
  Prism's `TreeNavigation` (↑/↓, Home, End, → opens or goes in, ← closes or goes to the parent, Enter a click), the pick
  following a click or a key's move (not a focus alone: a row made again takes the focus back), a category's too (its
  properties: its name). A row: an object's icon, its color dot, its name (cut by the fade), its count faint, then
  brush, scissors, eye, trash and ⋯ (its right-click's menu, under it), on hover or focus, always on a touch screen, a
  hidden node's eye kept. A label's row says so faint after its text (where a count is), a distance's reads "Distance
  10.67 Å" (as the mock): no icon on child rows (styling.md §4), where the label and ruler were. The tree takes the
  panel above the properties; the split between them is `drag()`, ↑/↓ by 16 px (Shift 64), the properties 80 px at least
  and the tree too.
- A category's tools (2026-10-27, lane `tree-view`): its eye shows or hides every object under it in one step
  (`state.visibility` of their refs; shown while any is), its scissors add one Prism cut of all of them (`clipping.add`
  by their refs, its handles shown), its brush colors them by a theme (Ludo, 2026-10-27: `mesoscale.theme`, the
  mesoscale extension's, as §3 lists: one change, in one data transaction: the representations' themes in one commit,
  the structures' own colors (their row's brush, an overpaint) cleared (Ludo, 2026-10-27), every list's look colors
  cleared or generated in one `particles.look` (several lists), every mesh in one `cryoet.mesh` (several colors); a
  theme an object does not take changes nothing).
- Clips as rows (2026-10-27, lane `tree-view`): each of Prism's cuts is a row under the row it was made at (an object's;
  an entity's, a chain's, a group's or a target's for a cut of only them; their category's for a cut of several
  objects), named by its shape and number (Plane 1). Its eye draws it in the scene or not (`clipping.show`, one step;
  the coordinator's default: a Prism cut has no on and off); picked, its properties show its name only and it has no ⋯
  (its menu and properties are the right-click's and the properties' lanes).
- The eyes and the ⋯ (2026-10-29, lane `tree-eyes`; Ludo, 2026-10-28, from the cellVIEW evaluation): every row's eye and
  ⋯ always in view, each in a column of its own (`tree-view.tsx`, shared with the mock); the brush, the scissors and the
  trash moved into the ⋯ as Color…, Add clip… and Remove, a category's ⋯ its Color… (Uniform… at the ⋯) and Add clip…, a
  clip's ⋯ its Remove; no Hide in a menu. A parent's eye sets all under it in one step (`setEyes` in `rows.ts`: one
  `api.group`; a model's entities in one `mesoscale.style`, a list's targets in one `particles.look`), a shown part
  draws its object again, a parent open when all under it is. The eyes dragged along the column (Prism's `drag()`: a
  preview in the tree's eye states, one step on release, put back on a cancel; the column read in the tree's root, a
  shadow root in the app); a click is a press and a release (Enter and Space click). A list's class has its eye (the
  cryo-ET area reads a target hidden by its own layer). The color dot opens Color…'s items. Show only (§5) on a part's ⋯
  and the canvas's right-click.
- Not yet (step 3, with the right-click menu): Position, Clips, Labels. Also: a structure entity's or chain's eye (Prism
  hides representations, not parts); a color dot only where a color was set; the mesh section repeats the mesh's eye and
  name.
