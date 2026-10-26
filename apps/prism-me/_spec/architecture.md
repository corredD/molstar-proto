# prism-me architecture (2026-10-24)

What prism-me is (read at `129b85933`, before the distance measure of #5), how it holds and draws its data, how the UI
reaches it, where it is weak, and the decisions taken on it (§7). A lane that changes one of these updates this page in
the same PR.

## 1. The four layers

```
 app            apps/prism-me            the explorer: one Scene panel (tree, properties, right-click menu),
                (~3.9k lines)            the v5 URL, the canvas look, hidden Prism tabs
   │ api.run('<op>')  +  reads (watched states)  +  a few direct calls
 extensions     mesoscale  (~1.7k)       entities and groups of a model, their looks, colors, motion, graphics
                cryoet     (~2.3k)       decorations (what each particle is drawn as), classes, slices, meshes
                stage-tools (~1.9k)      right-click menu, moving things by hand, labels, scale
   │ operations: Mol* state transforms, one commit each (mostly)
 Prism viewer   packages/prism           the shell, operations (structure, volume, particles, clipping, load…),
                                         gizmo library, commands (⌘K), the assistant
   │
 Mol* library   packages/plugin, graphics, model
                (+~3k lines on this branch)  particle lists and their decorators, target drawing, layers; volumes
```

The rule we set (README): views, commands and the agent change the scene only through operations, one undo step each; an
extension uses another's operations by id, never by import. It mostly holds; §5 lists where it does not.

## 2. What manages the data

All the data is in Mol*'s state tree. prism-me adds no store of its own: every view reads the tree (through Prism's
hierarchy managers and the extensions' watched states) and every change is a transform applied or updated.

**A particle list** (cellPACK, PetWorld, RELION, Dynamo, …; one model for mesoscale and cryo-ET):

```
file data → parse → Particle List                     coordinates, rotations, targets (an id per particle),
                                                       entities and compartments (mesoscale), attributes (cc, class…)
  → TargetsFromAttribute    (cryoet: a target per class)            new on this branch
  → WithTargets             (cryoet: what each target is drawn as: a structure/mesh/map of the scene, a PDB id, a file)
  → Transform               (stage-tools: the list moved by hand)    new
  → Offsets                 (stage-tools: one particle or kind moved) new
  → Representation 3D       target (instanced objects), spacefill (the rest), orientation axes, fibers, unit cell
      → Layers              per-entity looks: visible, color, transparency, emissive; + cryoet's `hidden`,
                            + Prism's partial `cuts`                                          new
```

**A volume** (tomogram, map):
`data → Volume → [VolumeTransform: its position, as a matrix in the grid] → representations` (slice along x/y/z, oblique
plane, isosurface). Slices and isosurfaces have no position of their own: moving the volume moves them.

**A mesh** (OBJ, PLY, VTP): `data → Shape Provider (its transform, its scale) → Shape Representation` (surface,
wireframe, color, opacity).

**A structure** (mmCIF/PDB): Prism's own (presets, components, overpaint layers); prism-me only reads it and runs
Prism's operations.

**Who writes what**

| Data                             | Owner                                   | Also written by                                                           |
| -------------------------------- | --------------------------------------- | ------------------------------------------------------------------------- |
| per-entity looks (Layers cell)   | mesoscale (`layers`)                    | cryoet (`hidden`), Prism clipping (`cuts`): **three writers of one cell** |
| decorations, classes             | cryoet                                  | —                                                                         |
| list and particle positions      | stage-tools (`Transform`, `Offsets`)    | cryoet (`offset`, `instance` operations)                                  |
| motion, level of detail          | mesoscale (the representation's params) | —                                                                         |
| slices                           | cryoet                                  | stage-tools moves plane slices with the volume                            |
| mesh look / mesh transform       | cryoet / stage-tools                    | cryoet writes the scale too                                               |
| labels                           | stage-tools                             | —                                                                         |
| canvas (pixel scale, sharpening) | mesoscale `graphics`                    | outside the state: not in undo or sessions                                |

## 3. How it is drawn

- **Particles with a target:** one instanced visual per target (each particle an instance of the structure, mesh or
  map), merged by type into few render objects: a 2-million-particle model stays a handful of draw calls.
- **Looks:** the Layers cell becomes overpaint, transparency and emissive layers on those visuals; no geometry is
  rebuilt (fast to apply). Each change recomputes every layer and refills the textures.
- **Level of detail:** one `lodLevels` per representation, shared by all its targets (set by the graphics mode).
- **Picking:** one particle at a time (a target counts as one group): never an atom inside a decorated particle.
- **Volumes:** Mol*'s slice and isosurface visuals, slices in a gray window; the oblique slice is a plane slice cut to
  the volume's box.

## 4. How the UI talks to it

- **Reads:** watched states rebuilt on every state change (`objectsState`, `infoState`, `decorationsState`,
  `sliceState`, …), compared by `JSON.stringify`. The tree's rows are derived from them (`rows.ts`), the properties pick
  their sections by the row's kind (`properties.tsx`), the menu its items by kind (`menu.ts`).
- **Writes:** `api.run('<op>', params)`; ~35 operation ids across Prism, the three extensions and the app (two of its
  own: `explorer.representationVisibility`, `explorer.clipWhole`).
- **Handles:** three hosts (oblique slice, object move, particle) on Prism's `GizmoHandles` (§7.4), as Prism's own
  structure move and cuts: they draw the preview outside the state (no history), commit one operation on release, and an
  undo during a drag cancels it.
- **Right-click:** stage-tools turns a secondary click into a menu request; the app replaces the menu with its own items
  per kind.

## 5. Where it is weak

Ranked by what they cost you. The first three are bugs or design faults; the rest are cleanup.

1. **One looks cell, three writers** (built 2026-10-25, lane `looks-owner`, §7.1). mesoscale, cryoet and Prism's
   clipping each wrote the same Layers cell, each from what it had read, with its own rule for deleting it: mesoscale
   rewrote every layer from the first representation's (a class hidden by target came back as an entity's layer). Now
   `particles.look` (Prism) is the one writer, by patch; the others call it.
2. **Not one undo step each.** Undo is one step per top-level operation (`packages/prism/ui/src/managers/history.ts`):
   the commits inside a run, and the operations it calls through `ctx.api`, join its step, so `cryoet.decorate`,
   `cryoet.classes` (up to four commits) and `stage.move` on a structure (two) are one step each. What lost a change was
   the writes (1), not undo. Still more than one step, or none:
   - the oblique slice's sliders run the operation ~60 ms after each pause of the pointer, so one drag leaves several
     undo steps (the handle does it right: preview, then one commit);
   - graphics mode changes the canvas outside the state, so undo and sessions miss it.
3. **The app reaches past the operations.**
   - `explorer.clipWhole` edits particle representation params inside the app;
   - a few extension methods are called directly (`cryoet.oblique`, `cryoet.slices`, previews), and several
     `transform.params as any`.
   - The tree's node kinds are plain strings, repeated in three files; the scene's kinds (`model`, `list`) and the
     tree's (`mesoscale model`, `particle list`) differ. (A list's target row sent its target ids as entity ids to
     `mesoscale.style`: right only because a list without entities has its targets as entities; the menu's Hide on it
     now writes the targets' layer through `particles.look`, 2026-10-25; the row has no eye.)
4. **The same helper, many times.**
   - walking up to a file's root cell (×6);
   - walking down a list's decorators (×5);
   - CSS color parsing (×3, behaving differently);
   - list parameters (×2), plane types (×2);
   - Euler pose math (×4);
   - the three gizmo classes were near copies: one class now (§7.4).
5. **Reads cost more than they need.** Every state change rebuilds the whole scene list (scanning every cell for meshes)
   and compares it as JSON; per-model entity info is kept only while the panel is open.
6. **Big files.** `properties.tsx` 1,190 lines, `cryoet/operations.ts` 1,276; `ScenePanel` ~220 lines, `sectionsOf`
   ~150.

**Limits of the data model**, not bugs: what the v5 explorer did that this model cannot do as is.

- **Level of detail per entity:** one setting per representation, so per-entity LOD means a representation per entity
  group, which loses the merged draw calls.
- **Pattern, illustrative, cel shading per entity:** the Layers cell carries color, transparency, emissive only (the
  target visual already takes substance).
- **Atom picking or measuring inside a particle:** a target is one pick group.
- **At most six partial cuts** per representation.
- **Moving a list or one particle** copies all coordinates.

## 6. What holds up

- One model for mesoscale and cryo-ET (particle lists + decorators) works: swapping a decoration reloads only the
  targets that changed, and the looks never rebuild geometry.
- Volumes moving as one, with slices that have no position of their own.
- Handles that preview outside the state and commit once.
- The library changes are mostly upstream-ready (the decorators, layers, target caching, the volume fixes).

## 7. Decisions (Ludovic, 2026-10-24)

1. **The looks cell has one owner:** a single `particles.look` operation (in Prism or the library) owns the Layers cell.
   Mesoscale, cryoet and clipping call it by id. One undo step per change, and no writer drops another's change. Built
   (2026-10-25, lane `looks-owner`): `patchParticleLook` (`packages/prism/viewer/src/sources/particles/look.ts`) is the
   only code that creates, updates or deletes the cell; `particles.look` runs it on a list's representations in one
   update; clipping's partial cuts call the helper in their own commit, mesoscale's styles and cryoet's decorations the
   operation. A layer is keyed by its selector's sorted ids; an absent field is kept, `null` clears one; a
   representation added to a list (`particles.representation`) takes the list's layers.
2. **No per-entity LOD or styles:** one LOD and one style per model. The v5 feature is marked deferred in features.md.
3. **No atom-level work inside particles for now:** picking stays per particle, and features.md says so.
4. **One handle class in Prism's gizmo library** for anything that moves: preview outside the state, one commit on
   release. The three bindings become uses of it. It is a candidate for upstream. Built (2026-10-26, lane
   `gizmo-handles`): `GizmoHandles` (`packages/prism/viewer/src/sources/gizmos`, Prism's
   [gizmos.md](../../../packages/prism/viewer/_spec/gizmos.md)) hosts Prism's structure move and cuts and the three
   extension handles; each keeps only its preview and commit. A drag is cancelled when the cells it starts from change
   (its item's and those under it, or what places it: an undo), which the three extension handles did not do; the object
   move uses Prism's placement math (`PlacementHandles`), the slice and the particle `frameHandles`.
5. **The app becomes only a spec:** its logic (`clipWhole`, picks, label sizing, direct extension calls) moves as
   operations into the extension that owns the data. The app keeps layout, URL and defaults.
6. **Refactor in place, not a prism-me-v2** (Ludovic, 2026-10-25, after the Storybook mocks of PR #6): the mocks'
   comparison ([../progress/2026-10-25-explorer-mocks.md](../progress/2026-10-25-explorer-mocks.md)) found the app's
   operations and sections the same and its views different (its own rows, keys, sections and colors where Prism has
   them). The views are rebuilt on the mocks one at a time, each checked against its story.
