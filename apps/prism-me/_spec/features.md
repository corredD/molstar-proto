# prism-me features

Every feature the app is meant to have, with its status. **Done**: built and tested by unit tests (on a headless
viewer); the flows of the test list below were also seen working in Chrome (Playwright, 2026-10-18), the others not yet.
**Partial**: works with a limit, said. **Deferred**: not built, with why. The operation is what views, commands and the
agent run (one undo step each); the command menu (⌘K) has each.

## Opening files (drag and drop, Open, URL)

| Feature                                                                                                      | Status   | How                                                                                 |
| ------------------------------------------------------------------------------------------------------------ | -------- | ----------------------------------------------------------------------------------- |
| mmCIF, BinaryCIF, PDB… structures                                                                            | Done     | Prism's `load.files`                                                                |
| cellPACK and PetWorld models (mmCIF, BinaryCIF) as particles                                                 | Done     | `mmcif_particles` (content-sniffed on drop)                                         |
| Particle lists: RELION `.star`, Dynamo `.tbl`, Artiatomi `.em`, CryoET Data Portal `.ndjson`                 | Done     | the plugin's particle formats                                                       |
| Tomograms and tilt series: `.mrc`, `.map`, `.ccp4`, `.rec`, `.st`, `.ali`, `.mrcs`; MRC modes 0, 1, 2, 6, 12 | Done     | CCP4/MRC reader (modes 6 and 12 added)                                              |
| Segmentation meshes: OBJ (+MTL), PLY, VTP                                                                    | Done     | the plugin's shape formats; wireframe visual                                        |
| Sessions `.molx`, `.molj`                                                                                    | Done     | Prism's `session.open`                                                              |
| Mesoscale Explorer examples (its list at molstar.org/me/examples)                                            | Done     | `mesoscale.example`; Home › Mesoscale examples; `?example=`                         |
| PDB and PDB-IHM entries                                                                                      | Done     | Prism's `load.entry`; `?pdb=`, `?pdbihm=`                                           |
| The explorer's URL (`url` + `type`, `pdbihm`/`pdbdev`, `graphics-mode`, `example`)                           | Done     | `apps/prism-me/src/url.ts`                                                          |
| The explorer's generic zip (`manifest.json`) and Martini `instanced_structure.json`                          | Deferred | needs a reader to a `ParticleList`; the classic explorer's loader builds structures |
| Tilt angles (`.tlt`, `.rawtlt`) shown with the images                                                        | Deferred | no reader; the images step along z                                                  |
| Binning of large tomograms                                                                                   | Deferred | decision of 2026-10-18                                                              |

## Mesoscale (the Mesoscale Explorer's features)

| Feature                                                                                                        | Status   | Operation / where                                                                                                            |
| -------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Entities, by compartment tree (cellPACK) or function, with counts                                              | Done     | `mesoscale.entities`; the Scene tree (a model's groups, then entities; its Group by in its properties)                       |
| Show, hide an entity or a whole group                                                                          | Done     | `mesoscale.style` (`visible`) by `particles.look`; the eyes                                                                  |
| Color an entity (picker), generate colors (a hue per compartment, its entities around it), theme colors, reset | Done     | `mesoscale.style`, `mesoscale.colors`                                                                                        |
| Opacity, emissive of entities                                                                                  | Done     | `mesoscale.style` (`transparency`, `emissive`)                                                                               |
| Filter the entities by name                                                                                    | Done     | the Scene tree's filter: a hit with the rows it is in                                                                        |
| Graphics modes: ultra, quality, balanced, performance (level of detail, quality, pixel scale, sharpening)      | Done     | `mesoscale.graphics`: every object, or one (`object`; Graphics & Motion); `?graphics-mode=`                                  |
| Wiggle and tumble, per object (structures, models, particle lists; not volumes)                                | Done     | `mesoscale.motion` (`object`; Graphics & Motion); the explorer tumbled all but membranes (TODO)                              |
| The explorer's look: multiscale occlusion, shadows, outlines, edges                                            | Done     | the app's canvas defaults (`look.ts`)                                                                                        |
| Group by function                                                                                              | Done     | a model's Group by (its properties), the tree follows; `mesoscale.entities`, `mesoscale.style`, `mesoscale.colors` `groupBy` |
| Lightness, pattern, illustrative and cel shading per entity                                                    | Deferred | need particle layers beyond color, transparency, emissive                                                                    |
| Level of detail per entity                                                                                     | Partial  | one level for all (graphics mode)                                                                                            |
| Clip per entity, group or target: plane, sphere, box, cylinder, cone; moved, turned and sized by handles       | Done     | `clipping.add` `particles` (Prism); the row's scissors; Clips in the properties                                              |
| Quick styles (Default, Celshading, Illustrative, Shiny, Stylized, DOF)                                         | Deferred | Prism's quick styles are structure presets                                                                                   |
| Color file import (JSON), x, y, z or CSS: by full name, else the entity name (last dotted part)                | Done     | `mesoscale.importColors`; a model's Look: Import colors…                                                                     |
| Snapshot descriptions' links `#key`, `i<names>`, `g<group>.<names>`                                            | Deferred | Prism's markdown host claims only `!command` links                                                                           |
| The guided tour (driver.js)                                                                                    | Deferred | Prism has its own help                                                                                                       |
| Selection list, focus info, measurements                                                                       | Partial  | distances in the explorer (Stage tools); the rest Prism's own Selection tab, inspector and measurements                      |

## Cryo-ET

| Feature                                                                                                 | Status   | Operation / where                                                               |
| ------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------- |
| Decorate a particle list (every target or some) with an object of the scene: a structure, a mesh, a map | Done     | `cryoet.decorate` `with: object`; Decorations row; right-click › Decorate with… |
| … with a PDB id or URL                                                                                  | Done     | `cryoet.decorate` `with: pdb`                                                   |
| … with nothing (spheres)                                                                                | Done     | `cryoet.decorate` `with: none`                                                  |
| Swap a decoration quickly                                                                               | Done     | an object of the scene: no parsing; only the changed targets reload             |
| A target per class (or another attribute: cc, score), each decorated apart                              | Done     | `cryoet.classes`; Decorations row's Targets                                     |
| The spheres hidden once decorated                                                                       | Done     | `cryoet.decorate` adds a target representation                                  |
| Color particles by attribute (cc, class, score)                                                         | Done     | Prism's particle color themes (`particles.representation`)                      |
| Tomogram slice along x, y, z, its position, a gray window in σ                                          | Done     | `cryoet.slice`; Slice row                                                       |
| Tilt series stepped image by image                                                                      | Done     | `cryoet.slice` along z                                                          |
| Oblique slice: a plane through a volume, its handle and numbers in the volume's frame, moved with it    | Done     | `cryoet.oblique`; Oblique slice row                                             |
| Segmentation meshes: show, hide, surface, wireframe, both, opacity, color                               | Done     | `cryoet.meshes`, `cryoet.mesh`; Segmentations tab                               |
| A class's decoration chosen from a column of the file other than an attribute (a tomogram name)         | Deferred | string columns are not particle attributes                                      |

## Stage tools (Stories Untold)

| Feature                                                                                                                             | Status   | Operation / where                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| Clip an object (plane, sphere, box, cylinder, cone): Prism's cuts, moved, turned and sized by its handles                           | Done     | `clipping.*` (Prism); the tree's scissors; Clips in the properties                                                    |
| Clip a model's or list's objects whole (proteins), or their atoms whole                                                             | Done     | `stage.clipWhole`; Clip whole in Clips, while it draws objects                                                        |
| Handles on top: every handle seen and grabbed through what is in front of it; a toggle, off by default                              | Done     | `canvas.handles` `onTop` (Prism); On top in Position and in a clip's line; ⌘K                                         |
| Right-click menu on what was picked: focus, hide or color the entity, decorate                                                      | Done     | the canvas (prism-me frees the right button from the camera's focus)                                                  |
| Keys on cuts (animation)                                                                                                            | Deferred |                                                                                                                       |
| Measure a distance between atoms, residues, chains, instances, particles, volume voxels: in selection mode, ⌘/Ctrl+click two points | Done     | `stage.distance`, `stage.editDistance`; a row under the first point; outside selection mode a hint says to turn it on |
| Commands for the agent and ⌘K                                                                                                       | Done     | the three areas' commands and skills                                                                                  |

## Known issues found on the way (Prism, upstream)

- Home's "Current session" says "Nothing loaded" when only particles are loaded.
- `particles.representation` checks the types against the list as loaded, not as decorated (the cryoet extension builds
  its target representation itself).
- The scene tree has no node for shapes (meshes): hence the Segmentations tab.
- A tomogram slice shows faint stripes at clamped high values (seen once on EMD-1181 with WebGPU; not investigated).

## Testing it (for Ludovic)

Start: `node scripts/esbuild/app.mjs apps/prism-me --dev --port 1343`, open
`http://localhost:1343/apps/prism-me/build/`.

1. The panel's Open › Mesoscale examples… › CellPack HIV (or `?example=cellpack-hiv1`). In the Scene tree, pick the
   model: Look › Generate colors; Group by: Function, then Compartment; fold and unfold its groups; hide `membrane`;
   color one entity; Graphics & Motion: Fast, then Quality; Wiggle, Tumble. The model's Look: Import colors…,
   `data/examples/mesoscale/cellpack-hiv1-colors.json` (one name not found is said, and the entities the file names
   twice, in two compartments: one entity per name, the last color kept; a key matches by full name, else by the entity
   name, the last dotted part: the compartment path is not checked); Undo once brings the colors back.
2. Right-click a protein: Hide it, Color it…; Cut with a plane; Cut row: Position, Flip; right-click again: Remove the
   cut. Try the sphere and the box.
3. Drop a RELION `.star` with classes. Structure tab › its Decorations row: Targets: Class; drop or load a structure
   (1CRN) and a mesh (OBJ); pick them per class; type a PDB id and Enter. Right-click a particle › Decorate with….
4. Drop a tomogram (`.mrc` or `.rec`): its Slice row: Show a slice, move it, change the contrast, axis Z for a tilt
   series. Add an oblique slice: drag its handle (move, tilt), push it half out of the volume (not drawn outside); move
   the volume by its handles: the oblique slice goes with it, its numbers kept.
5. Drop OBJ, PLY and VTP meshes: Segmentations tab: Surface, Wireframe, Both; opacity; color.
6. Undo (⌘Z) after each step: one step each (tried on CellPack MG, 2.1 million particles: about 0.3 s). ⌘K: type "cut",
   "decorate", "entities".
7. `?example=petworld-hiv&graphics-mode=balanced` opens it directly.
8. Load 1CRN, PetWorld HIV and a volume: 1CRN's Graphics & Motion: Wiggle (1CRN alone moves); the model's: Fast (1CRN
   unchanged); the volume's: quality only, no wiggle or tumble.
