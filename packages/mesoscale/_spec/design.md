# MesoViewSpec: design

A prototype of a declarative format for mesoscale science, with its IR and a small runtime, built to test the design.
For David's review. Renderer findings are in a separate document,
[renderer-recommendations.md](renderer-recommendations.md), to discuss with Alex.

- **Status:** a prototype on branch `me/mesoviewspec` (worktree `~/prism-me-lanes/mesoviewspec`, off `prism-me`). It is
  not pushed. Nothing in Mol\* itself was changed.
- **Code:** `packages/mesoscale/spec` (`@molstar/meso-spec`: the format, IR, runtime and resolvers; no Mol\* imports)
  and `packages/mesoscale/molstar` (`@molstar/meso-molstar`: the Prism adapter, the MolViewSpec export and the stories).
- **Paired examples:** each scene as a document and as the IR the runtime makes of it, in `packages/mesoscale/examples/`
  (`exosome`, `gallery`, `yeast`, as `*.mesoviewspec.json` and `*.ir.json`). A quick-lane test keeps them current.
- **Number labels:** **[measured]** (with where and how), **[target]** (proposed) or **[fixture]** (computed on
  synthetic or trimmed inputs). Hypotheses are labelled as such.

## 1. What it is for

A MesoViewSpec document describes a mesoscale system in biological terms and connects it to the evidence behind it. It
covers:

- the biology: entities, compartments, populations and their relations;
- the evidence and the processing behind the model: raw and processed cryo-ET, segmentations, structures, recipes and
  precomputed models, each in its native format;
- the view state needed to reopen and explore the scene.

It is **not**:

- a packing algorithm;
- a renderer's scene graph;
- a replacement for the formats it points to.

A **runtime** validates the document and gives each model to a pluggable **resolver**. The resolvers' output is an
**IR**, which a **renderer adapter** puts into a viewer.

```
MesoViewSpec ──validate──▶ normalize (Å, counts, frames) ──▶ resolvers (keyed, cached) ──▶ IR ──▶ adapter ──▶ Mol*/Prism
   authored                      runtime                       derived                    derived      view
```

## 2. The same scene, twice

The thin slice is an exosome in plasma:

- its biology comes from a real cellPACKgpu recipe (Ludo's `exo_serialized.json`, trimmed to 14 ingredients);
- its membrane comes from a cryo-ET segmentation;
- 24 of its catalase copies come from template matching in the same tomogram.

The cryo-ET data are synthetic fixtures, labelled as such in the document (`custom.meso.fixture`); the recipe is real.

**MesoViewSpec** (excerpt of `examples/exosome.mesoviewspec.json`):

```json
{ "frames": [
    { "id": "f.model", "kind": "world", "units": "nm", "handedness": "right", "convention": "origin at the vesicle centroid" },
    { "id": "f.tomo", "kind": "instrument", "units": "nm", "voxelSize": 1, "handedness": "right" } ],
  "alignments": [ { "id": "al.tomo-model", "from": "f.tomo", "to": "f.model",
                    "transform": { "translation": [-200, -200, -100] }, "activity": "act.align" } ],
  "compartments": [ { "id": "c.exosome", "kind": "vesicle", "parent": "medium",
                      "geometry": { "kind": "mesh", "resource": "r.membrane-mesh" },
                      "membrane": { "thickness": { "value": 15, "unit": "A" } }, "evidence": ["ev.membrane-segmented"] } ],
  "populations": [
    { "id": "p.catalase.observed", "entity": "e.catalase", "compartment": "c.exosome", "location": "interior",
      "abundance": { "count": 24 }, "evidence": ["ev.catalase-picked"] },
    { "id": "p.catalase", "entity": "e.catalase", "compartment": "c.exosome", "location": "interior",
      "abundance": { "count": 506 }, "evidence": ["cellpack.count-rule"] } ],
  "models": [
    { "id": "m.picks", "kind": "precomputed", "method": "meso.precomputed", "populations": ["p.catalase.observed"],
      "inputs": ["r.picks"], "activity": "act.pick" },
    { "id": "m.recipe", "kind": "procedural", "method": "cellpack-gpu", "populations": ["p.ALB", "…", "p.catalase"],
      "inputs": ["r.recipe"], "avoid": ["m.picks"], "seed": 1,
      "params": { "ingredients": { "p.catalase": { "path": "root.exosome.interior.proteins.catalase" } } } } ] }
```

**IR** (excerpt of `examples/exosome.ir.json`; the placement buffers are summarized):

```json
{ "ref": "m.picks/resolve", "kind": "resolve", "origin": ["m.picks", "p.catalase.observed"],
  "params": { "resolver": "meso.precomputed", "version": "0.1.0", "key": "m.picks@cde3af8d53db8f44",
    "input": { "resources": [ { "id": "r.picks", "format": "relion-star", "contentKey": "941694e4997102f5",
                                "toWorld": [10,0,0,0, 0,10,0,0, 0,0,10,0, -2000,-2000,-1000,1] } ],
               "types": [ { "population": "p.catalase.observed", "radius": 40, "requested": 24 } ] } },
  "children": [ { "ref": "m.picks/placements/0", "kind": "placements",
                  "params": { "set": { "key": "m.picks@cde3af8d53db8f44#0", "frame": "world", "count": 24, "bytes": 864 } } } ] }
```

The two layers hold different things:

- **The document** says what is in the scene and why.
- **The IR** gives:
  - the voxel-to-world matrix (voxel size × alignment, in Å);
  - the key the result is cached under;
  - the 36 bytes each copy costs.

**The same document against the slice's three requirements:**

- **Color edit:** it touches `views[].looks` only. No resolver runs.
- **Density edit:** changing `p.miRNA`'s concentration reruns `m.recipe` only. `m.picks` and the bilayer are cache hits.
- **Unmet constraint:** the recipe's 506 catalase copies do not fit. The runtime reports this as data:
  `354 of 506 fit in the inside of exosome, now 22% filled …` **[fixture]**. mesobuild hit the same limit on the same
  recipe (181/506 before relaxation, `~/prism-me-lanes/mesobuild/exosome/out/SUMMARY.md`).

## 3. The language (`format/doc.ts`)

### 3.1 Shape

A document is plain JSON:

```
{ format: "meso_view_spec", version, metadata, units?,
  frames, alignments, resources,                       // where things are and what data exist
  entities, compartments, populations, catalogs, relations,  // the biology
  models, evidence, activities,                         // how the biology was realized and why we believe it
  views, session,                                       // persistent view state
  custom }                                              // namespaced extensions
```

- **One id namespace for the whole document.** Ids are unique across all sections and match
  `^[A-Za-z][A-Za-z0-9_.:-]*$`. Nodes refer to each other by id only. This is SeqViewSpec's rule (every node has a
  `ref`; `packages/sequences/_spec/format.md`), not MolViewSpec's optional `ref`.
- **A flat document, not a tree.** MolViewSpec is a tree (`packages/mvs/builder/src/tree/generic/tree-schema.ts`,
  `Node`: `{kind, params, custom, ref}` with `children`), because it describes a render pipeline. A mesoscale scene is a
  graph:
  - a population refers to an entity, a compartment and its evidence;
  - a model realizes several populations;
  - an activity uses and generates resources.

  The tree belongs in the IR (§4).

- **`custom` is keyed by namespace** (as in SeqViewSpec), so an unknown extension is kept and ignored.
- **Versioning:** semver; a minor version only adds. A newer major version is refused (`format.version`).

### 3.2 Biology

| Concept       | Fields                                                                                                                                                                                                    | Meaning                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `Entity`      | `kind` (protein, complex, nucleic-acid, lipid, glycan, small-molecule, assembly), `identifiers` (`uniprot`, `pdb`, `emdb`, …), `structure: {resource, assembly, selection}`, `radius`, `mass`, `topology` | a molecular species                                             |
| `Compartment` | `kind`, `parent`, `geometry` (sphere, ellipsoid, box, `mesh` resource, `segmentation` resource + label, `implicit`), `membrane: {thickness, leaflets}`                                                    | nested containment (not a coordinate transform)                 |
| `Population`  | `entity`, `compartment`, `location` (interior, membrane, outer-surface, inner-surface, exterior), `abundance` (count, concentration, density, volumeFraction), `range`, `arrangement`, `constraints`      | copies of an entity somewhere                                   |
| `Arrangement` | `random`, `lattice` (hexagonal/square, spacing), `fiber` (rise, twist, path or growth rule), `bilayer`                                                                                                    | how copies are arranged, in biological terms                    |
| `Constraint`  | `placed-fraction` (min), `min-distance` (to, distance)                                                                                                                                                    | a requirement the result must meet                              |
| `Relation`    | binds, part-of, colocalizes, anchored-to, excludes                                                                                                                                                        | a statement; honoured only by resolvers that say so (`honours`) |

**Biological constraints stay in the document; construction details go to the IR.**

- **Document (what is true).** "500 catalase in the lumen", "pores in a hexagonal lattice 22 nm apart", "actin with a
  persistence length of 1 µm".
- **Model `params`, opaque to the language, passed to the resolver.**
  - packing tries and give-up thresholds;
  - cellPACK principal vectors and membrane offsets;
  - the recipe path an ingredient maps to.
- **IR `resolve` node.** The params go into its normalized `input`, where they are visible and hashed (§4.3).

### 3.3 Resources in their native formats

A `Resource` is `{kind, format, uri | accession, frame, checksum, license, select}`. The document never copies data.

- **`kind`:** tilt-series, tomogram, segmentation, mesh, structure, recipe, placements, volume, table, document,
  dataset, …
- **`format`:** the community's own name: `mrc`, `star`, `obj`, `pdb-id`, `cellpack-gpu-serialized`, `paxdb-tsv`, …
- **`select`:** picks a part of a resource: a segmentation label, a STAR table, an mmCIF assembly.
- **Readers** turn raw content into what resolvers use (`runtime/readers.ts`: STAR, OBJ, cellPACKgpu JSON, placement
  JSON). They are pluggable, like resolvers.

### 3.4 Frames and alignment

- **`Frame`:**
  - `kind`: one `world` frame, plus `instrument` or `resource` frames;
  - `units`, `voxelSize`, `handedness`;
  - `convention`: origin and axes, in words.
- **`Alignment`:** `{from, to, transform, method, residual, evidence, activity}`.
  - The transform is a similarity: a quaternion, a translation in the document's length unit, and a scale (or a 4×4
    matrix).
  - It acts on Å coordinates. The voxel size converts voxels to Å first.
- **Spatial resources declare their frame.** The runtime composes alignments in either direction into each frame's
  voxel-to-world-Å matrix (`frameMatrices`), and the IR records that matrix.
- **Undeclared handedness is a warning, never a guess.** The yeast document shows why: its source states the units but
  not the origin, axes or handedness, and the runtime reports exactly that (`frame.handedness` on three frames).
- **A spatial resource whose frame no alignment reaches** is `frame.unaligned`.

### 3.5 Evidence, provenance, tracing

- **`Evidence`:**
  `{kind: observation | measurement | literature | database | prediction | assumption, statement, source: {resource, citation, location}, confidence}`.
  - Any node can cite evidence.
  - Conflicting evidence is kept side by side. Yeast ribosomes cite both the model's 169,000 and a growth-law estimate
    of about 3 × 10⁵, with `range: [169000, 300000]`.
- **`Activity`:** after W3C PROV's activity: `{kind, used, generated, software, parameters, agent, date}`.
  - Resources, models and alignments are generated by activities.
  - A model points at the activity that made it.
- **Tracing** (`format/trace.ts`, `trace(doc, id)`) walks this graph backwards from any population, compartment, model
  or resource. Picked catalase gives:

  ```
  population p.catalase.observed  ─cites→ ev.catalase-picked ─source→ r.picks
    ─realized by→ m.picks ─made by→ act.pick (template matching) ─used→ r.tomogram
       ─generated by→ act.reconstruct ─used→ r.tilts ─generated by→ act.acquire
    r.picks ─aligned by→ al.tomo-model ─made by→ act.align ─used→ r.membrane-mesh ─generated by→ act.segment
  ```

- **Every recipe choice is recorded.** The cellPACKgpu import records each choice it makes as an `assumption`, cited by
  the populations that depend on it: which count field wins, what a surface molarity is per, the medium box, the
  thickness unit.

### 3.6 Catalogs (a gap the yeast cell exposed)

- **The problem.** A proteome is 5,638 species: too many to list as populations, and as data they belong in a table.
- **The prototype's answer.** `catalogs[]`: `{resource, columns, abundanceKind}`, one row per population.
- **The gap.** The runtime has no catalog expander yet and says so (`catalog.unexpanded`).
- **Open:** expand catalogs in the runtime (a reader that emits populations), or let a resolver consume them directly.

### 3.7 Not in the document

- placements and other derived results;
- renderer settings: representation types, LOD, quality;
- transient UI state.

See §5.

## 4. The IR (`ir/ir.ts`, `ir/placements.ts`)

### 4.1 A tree in the manner of `mol-state`

- **The tree:** each node is `{ref, kind, params, children, origin}`. Children are evaluated after their parent, as in
  `packages/core/src/state` (`StateTransform`: ref, parent, transformer, params).
- **Units:** every length is in Å, every frame a matrix, every abundance a count.
- **Node families:**
  - **space:** `scene`, `frame`, `compartment` (shape, free volume, area), `membrane` (thickness);
  - **construction:** `resolve` (model, resolver, version, normalized `input`, `key`, `cached`);
  - **evaluated:** `placements` (a placement set).
- **Looks and the camera are not in the tree.** They live in `IRView`: one look per (set, type), concrete colors, the
  camera in Å. A color edit never touches a node.
- **Refs come from document ids, never from content** (`m.recipe/placements/0`, `c.exosome/membrane`). The same scene
  gets the same refs on every run.

### 4.2 One leaf: the placement set

Every resolver produces placement sets, and every adapter consumes them:

- `positions` Float32 xyz Å, `rotations` Float32 xyzw, `types` Int32, `ordinals` Int32;
- a `typeTable` of `{population, entity, compartment, radius, label}`;
- optional `fibers` in CSR form.

The layout is Mol\*'s particle list (`packages/model/src/model/particles/particle-list.ts`, `ParticleList.coordinates`,
`.rotations`, `.targets`), so the adapter hands the buffers on without copying.

- **Memory:** 36 B a copy (12 position + 16 rotation + 4 type + 4 ordinal). **[measured]**, exact: a quick test checks
  it, and the heavy test checks that 1M lipids are allocated once.
- **Stable copy ids:** `<population>#<ordinal>`.

**Reuse the IR or extend it?** This single leaf is the test.

- **It can reuse the IR:** a new kind whose output is copies of entities at poses. Examples: a new packer, a new recipe
  format, a new particle-list format.
- **It needs a new IR node:** a new kind of _geometry_: a volume to draw, a mesh to draw, a continuous density (a
  filament drawn as a tube rather than copies).
- **It needs the language extended:** a new _biological statement_ that the current concepts cannot express. Examples:
  - a helical lattice on a tube, such as microtubule protofilaments;
  - a binding relation a resolver must honour;
  - a population defined by a table (§3.6).

### 4.3 Construction details live in `resolve` nodes

A resolver's `project(job)` returns the normalized input its result depends on:

- radii, counts and shapes, all in Å;
- the recipe's content hash;
- its own `params`.

The runtime keys the result by `hash(resolver id, version, input, keys of the sets it avoids)` (`ir/hash.ts`: canonical
JSON, typed arrays hashed by content). The IR shows the input, so a reader can see exactly what a model was built from.

**The rule:** what is not in the projection must not change the result.

- **Same rule elsewhere:**
  - MolViewSpec: Mol\* refs from a hash of the parent ref and transformer, versions from a params hash
    (`setParamsHashVersion` in `packages/core/src/state/transform.ts`, used by `packages/mvs/runtime/src/load.ts`);
  - SeqViewSpec: "affected" means modified or depending on a modified node (`packages/sequences/_spec/format.md`).
- **Why it matters:** this is what makes "a color edit reuses placements" true by construction rather than by care.

### 4.4 The cases

| Case                       | In the document                                                                 | In the IR / resolver                                                                                                                          | Where it is exercised                                                          |
| -------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Nested compartments        | `parent`                                                                        | compartment nodes nest; free volume = volume − children's; packers keep copies out of children (with their membranes)                         | gallery: ribosomes outside the nucleus, vesicle and mitochondrion (quick test) |
| Spheres, ellipsoids, boxes | `geometry`                                                                      | `IRShape`, exact samplers (`resolvers/geometry.ts`)                                                                                           | gallery, scale scenes                                                          |
| Imported geometry          | `geometry: {kind: mesh, resource}`                                              | mesh moved into the world frame by its frame's matrix; area-weighted surface sampling, ray-parity inside test                                 | exosome (OBJ)                                                                  |
| Cryo-ET surfaces           | `geometry: {kind: segmentation, resource, label}` + the activities that made it | `implicit` here: surface extraction is not in the prototype; a mesh exported from the segmentation is the supported path                      | yeast (declared), exosome (as a mesh)                                          |
| Curved lipid bilayers      | `arrangement: bilayer`, density per leaflet                                     | `meso.bilayer`: both leaflets ¼ of the thickness off the middle, heads out; Fibonacci sites on spheres; allocated once, exactly               | exosome (88k lipids), Bilayer mock, 1M scale                                   |
| Oriented membrane proteins | `location: membrane`, `topology.nTerminus`; (recipe) principal vector           | the copy's axis turned onto the outward normal (inward if N-terminus inside), random spin; cellPACK offset along the axis                     | exosome: RAB5A's −z axis points out (quick test)                               |
| Lattices                   | `arrangement: lattice`                                                          | `meso.lattice`: Fibonacci sites at the lattice density; a count below the sites fills a patch; above, a shortfall saying how many sites exist | gallery: pores (fits), ATP synthase (69 of 400 sites)                          |
| Seeded packing             | `random` + model `seed`                                                         | `meso.pack` / `cellpack-gpu`: random sequential addition, hash grid, per-population sub-seeds                                                 | everywhere                                                                     |
| Fibers, by path            | `fiber.path` (points or a resource)                                             | copies `rise` apart along the arc, +z on the tangent, `twist` a copy; CSR `fibers`                                                            | gallery microtubule                                                            |
| Fibers, by growth          | `fiber.growth` (persistence, length, count)                                     | worm-like random walk, bend variance 2·rise/P, turned back at the boundary                                                                    | gallery actin, Fibers mock                                                     |

### 4.5 Procedural and precomputed models together

- **Both kinds end as placement sets.** A precomputed model (`meso.precomputed`: a RELION STAR file or placement JSON)
  and a procedural one produce the same output.
- **`avoid` orders them.** `m.recipe` has `avoid: ["m.picks"]`, so the picks are inserted into the packer's grid before
  any procedural copy. A quick test checks that no procedural copy overlaps a pick.
- **The key covers the avoided sets.** It includes the keys of the sets a model avoids, so re-picking reruns the
  packing.
- **Rotation conventions match Mol\*.** The precomputed resolver reads STAR angles with the same rotation as Mol\*'s
  reader: `(Rz(rot) Ry(tilt) Rz(psi))ᵀ`, `relionEulerToRotation` in `packages/model/src/formats/particles/star.ts`. A
  quick test compares the two.
- **Saved results can stand in for procedural ones** (cache-as-precomputed). A procedural result could be saved as a
  `placements` resource with `custom.meso.derivedFrom: {model, key}`; on load, a matching key would replace resolution.
  This is not built: §11, open decision 3.

## 5. Session state: what one document restores

| Category            | Where                                   | Examples                                                                                                                                               | Persisted?                                                               |
| ------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| **Authored**        | the document, outside `views`/`session` | biology, evidence, models and their params, frames                                                                                                     | yes (the document)                                                       |
| **Derived**         | the IR, the runtime's cache             | placements, counts, issues, frame matrices                                                                                                             | no; recomputed, keyed; optionally saved as a precomputed resource (§4.5) |
| **Persistent view** | `views[]`, `session.view`               | camera, looks (color, visible, transparency) by population, entity or compartment, the selection (by population or copy id), annotations with evidence | yes (the document)                                                       |
| **Transient UI**    | the viewer                              | hover, open panels, the undo stack, the scroll position                                                                                                | never (as in SeqViewSpec: "interaction is the viewer's")                 |

`classifyEdit(prev, next)` (`runtime/runtime.ts`) returns `view` when only `views`, `session` or `metadata` differ. A
`view` edit takes the fast path, `updateView(doc, ir)`: the IR tree is reused as is, and the work is O(types).

**What the prototype restores:**

- **Restored:**
  - the scene hierarchy (compartments, populations, models);
  - visibility, colors and transparency;
  - the camera;
  - the selection (by semantic id, or by copy id within one resolution);
  - annotations (as data).
- **Not restored:**
  - **Representations.** The adapter draws spheres (`spacefill`) and nothing else. A view would need a `representation`
    hint per selector: spheres, structure, surface. This is open decision 4. The hint must stay a hint in the document,
    as SeqViewSpec's "what, not how" rule requires.
  - **Clipping.**
  - **Annotations drawn in the viewer.**
- **Copy ids are only as stable as the resolution.** A copy id (`p.catalase#12`) is valid only for one resolution key: a
  model edit can renumber copies. Selections that must survive edits should use semantic selectors.

## 6. Runtime contracts

### 6.1 Pipeline (`runtime/runtime.ts`, `compile`)

1. **Validate.** `format/validate.ts`, phase `static`. It checks ids, references and their kinds, containment cycles,
   membranes for membrane locations, units and ranges, models realizing a population twice, `avoid` cycles, frames and
   alignments. Nothing throws; errors stop before resolution.
2. **Normalize.**
   - frames into matrices;
   - resources loaded once through `options.load`, then the format's reader;
   - compartments in Å, with volume, free volume and area;
   - populations as counts: a concentration × free volume, a density × area (×2 for a bilayer).
3. **Assign models.**
   - The document's models are used as written.
   - Populations no model realizes go to the **default resolver of their arrangement**: random → `meso.pack`, lattice →
     `meso.lattice`, fiber → `meso.fiber`, bilayer → `meso.bilayer`. The gallery declares no model at all.
4. **Resolve.**
   - Models run in `avoid` order. Each is `project`ed, keyed and looked up in the session's cache (`options.cache`);
     only on a miss is `resolve` called.
   - Each failure is reported where it happens:
     - an unknown resolver, an arrangement or location it cannot place, an unavailable input;
     - a model that avoids a failed model also fails (as SeqViewSpec's "unavailable with a cause").
   - Constraints are checked against `achieved`, and each shortfall becomes an issue with the resolver's reason.
5. **Assemble** the IR, then **derive the view** from the active view.

### 6.2 The resolver contract (`runtime/resolver.ts`)

```ts
interface Resolver<I> {
  id: string; version: string;            // version bump: old cached results stop matching
  arrangements: Arrangement['kind'][]; locations: Location[]; honours?: Relation['kind'][]; formats?: string[];
  project(job: ResolveJob): I;            // the normalized inputs the result depends on (Å, counts), hashed into the key
  resolve(input: I, job: ResolveJob): ResolveOutput | Promise<ResolveOutput>;
}
interface ResolveOutput { sets: PlacementSet[]; achieved: Record<Id, number>; shortfall?: Record<Id, string>;
                          issues?: Issue[]; report?: Record<string, unknown> }
```

A `ResolveJob` holds:

- the model;
- its normalized populations;
- all normalized compartments, including meshes in world Å;
- the loaded inputs, with their content keys and world matrices;
- the obstacle sets of the models it avoids;
- the seed.

### 6.3 Resolvers in the prototype

| Id                 | Realizes                                                                           | Complexity   |
| ------------------ | ---------------------------------------------------------------------------------- | ------------ |
| `meso.pack`        | random populations: interiors, membranes, surfaces, the space around a compartment | O(N · tries) |
| `meso.lattice`     | lattices on spheres and ellipsoids                                                 | O(N)         |
| `meso.fiber`       | fibers by path or by growth                                                        | O(N)         |
| `meso.bilayer`     | lipid bilayers                                                                     | O(N)         |
| `meso.precomputed` | RELION STAR, placement JSON                                                        | O(rows)      |
| `cellpack-gpu`     | cellPACKgpu serialized recipes                                                     | O(N · tries) |

All of them are in `resolvers/index.ts`, `DefaultResolvers`.

### 6.4 Plugging in a recipe kind: cellPACKgpu

`resolvers/cellpack-gpu.ts` shows the split between the document and the adapter:

- **The import reads the recipe's biology** (`parseCellpackGpuRecipe` → `importCellpackGpuRecipe`) and writes it as
  MesoViewSpec.
  - **Paths:** rebuilt as `PostProcessSceneGraph` does. `surface` and `interior` are child compartments by name in the
    serialized format (`CellPackLoader.cs`), so they become locations, not compartments.
  - **Counts:** `nbMol`, a concentration or a per-area density.
  - **Every choice the recipe leaves open is made explicitly**, each with an `assumption` evidence and an issue:
    - **Which count field wins.** `UImanager.cs:9231` lets a nonzero `nbMol` win; `PopulateTest.cs:4939` lets a molarity
      in (0, 1) overwrite it. The two disagree on real data: the insulin granule recipe sets both, e.g. Chga `nbMol` 454
      vs 4.39e-5 M. The import takes `countRule`, and a quick test shows both rules.
    - **What unit a surface molarity is in.** The source asks the same question in its own comment
      (`PopulateTest.cs:4953`).
    - **The medium box.** The serialized format has none.
    - **The thickness unit.**
  - **Not imported:** fibers. A serialized recipe gives a fiber no path or length, so the import reports this
    (`cellpack.fiber`) instead of inventing one.
  - Ludo's rule that recipe counts are copies, never mass-rescaled, holds.
- **The resolver reads the recipe's construction details** on top of the shared packer: principal vectors, membrane
  offsets, cellPACK's largest-first order.
  - **Counts and radii come from the document**, so a document edit wins over the recipe.
  - **Not reproduced:** cellPACKgpu's offset sign quirks (`CellPackLoader.cs:850–877`). Noted in the code.

**Adding a kind is a resolver entry.** A quick test plugs a toy `toy.grid` resolver into the runtime with no change to
the format, the IR or the adapter.

**When a kind needs more than a resolver:** see the criteria in §4.2.

**Comparison with Mesoscope.** Mesoscope's serialized parser (`~/Developments/mesoscope/js/cp_serialized.js`,
`parseCellPackRecipeSerialized`) and its LLM authoring rules (`SKILLS.md`: an evidence CSV with confidence and
references for each ingredient) are the authoring side of the same data. Its evidence CSV maps one-to-one onto
`Evidence` plus population fields.

### 6.5 The renderer adapter contract (`runtime/adapter.ts`)

```ts
interface RendererAdapter { id: string; commit(ir: IR): Promise<CommitReport>; dispose(): void | Promise<void> }
```

**The adapter diffs by keys, never by content.** It receives the whole IR on each commit, and `planCommit(prev, next)`
gives the same diff to every adapter:

- sets added, removed and kept, by key;
- looks, by value, O(types);
- the camera, by value.

**The Prism adapter** (`molstar/src/prism-adapter.ts`, `PrismMesoAdapter`) follows prism-me's rules
(`apps/prism-me/AGENTS.md`):

- Each new set becomes one particle list, through a state transform whose only param is the set's key (`MesoPlacements`,
  store: `MesoPlacementStore`). Arrays never go through params.
- Each list gets one `spacefill` representation (`particles.representation`).
- Looks are written as Prism layers: one `particles.look` call for all lists, one layer per type. There is never a
  representation per type.
- **No copy of the IR buffers.** The particle list shares the IR's `positions`, `rotations` and `types` buffers (a
  medium-lane test checks identity). The adapter adds only what Mol\* requires and the IR does not have: a radius per
  copy and a key per copy, 8 B a copy (renderer-recommendations R2).
- **[measured] what each edit replaces** (medium lane, headless Prism with prism-me's spec):
  - a color edit replaces no list or representation object;
  - a density edit replaces exactly the rerun model's list.
- **[measured] with a GL context** (`gl`, Node): the scene is drawn, and a color edit changes pixels without a new list.

`molstar/src/session.ts`, `MesoSession`, is the host the stories use:

- **A view edit** goes through `updateView`, then `commit`.
- **A model edit** goes through `compile` with the session's cache, then `commit`.
- **Every edit leaves a record:** kind, resolver runs, cache hits, and the time of each phase.

### 6.6 Two integration paths

|        | Compile the IR to MolViewSpec                                                                                                                                                                    | Direct to Mol\*/Prism (built)                                               |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| How    | one `primitives` group per type, an ellipsoid with the copies as `instances` 4×4 matrices (`molstar/src/mvs-export.ts`, `irToMolViewSpec`)                                                       | a `ParticleList` over the IR's buffers, one representation, looks as layers |
| Valid? | yes: `MVSData.validationIssues` is clean (quick test)                                                                                                                                            | yes: medium and GL tests                                                    |
| Size   | **[measured]** 94 B of JSON a copy (50k copies: 4.5 MB, export 100 ms)                                                                                                                           | 0 B: the buffers are shared; +8 B a copy for radii and keys                 |
| Edits  | a change to any copy rewrites its group's instance list (`StructureInstances` and primitives `instances` are one param each; `packages/plugin/core/src/state/transforms/structure/hierarchy.ts`) | by key: unchanged sets untouched; looks O(types) in the adapter             |
| Loses  | structures at copies (it can draw spheres), provenance, keys                                                                                                                                     | nothing the IR has                                                          |
| Gains  | portability: any MVS viewer, MVS stories, snapshots                                                                                                                                              | speed, identity, Prism's operations, undo, the agent                        |

**Recommendation:**

- **Render directly**, through the adapter.
- **Use the MolViewSpec export for small scenes and sharing.** At most about 10⁵ copies, as a snapshot.
- **Give MolViewSpec a particle-list node.** It would let MVS carry placement sets without a JSON matrix per copy. That
  is an MVS proposal, outside this prototype.
- **Treat MolViewSpec as a view target, not as this format's IR.** MVS describes how to draw a structure; MesoViewSpec
  describes a scene and its evidence. The two meet in a view.

## 7. Units, ids, reproducibility, failures

### 7.1 Units

- **The document** chooses its length unit (`units.length`: A, nm or µm; nm by default). A `{value, unit}` quantity
  overrides it.
- **Other quantities:** concentrations in nM, µM, mM or M; densities per nm² or per µm² (per leaflet for a bilayer);
  masses in Da, kDa or MDa.
- **The IR is in Å.** Every structure and every renderer we target already is.
- **Conversion happens once,** when the runtime normalizes (`format/units.ts`). Resolvers and adapters never see a
  document unit.

### 7.2 Ids and keys

| What            | Form                                                | Stability                                                                          |
| --------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Document ids    | `^[A-Za-z][A-Za-z0-9_.:-]*$`                        | author-chosen                                                                      |
| IR refs         | derived from document ids (`m.recipe/placements/0`) | stable across runs                                                                 |
| Resolution keys | `<model>@<hash>`                                    | change exactly when the projection, the resolver version or an avoided set changes |
| Set keys        | `<key>#<n>`                                         | follow the resolution key                                                          |
| Copy ids        | `<population>#<ordinal>`                            | stable within one key                                                              |

### 7.3 Reproducibility

- **Deterministic resolution.** The same document, resolver versions and seed give the same placements, bit for bit
  (quick test: content digest).
- **Per-population sub-seeds** (`subSeed(seed, populationId)`): adding a population does not reseed the others.
  - **Limit:** in a shared packing, exclusion still couples them.
- **What reproducing a result needs:**
  - the document;
  - the resolver ids and versions, which the IR records;
  - the resources' content keys: the `checksum` when declared, otherwise a hash of the content.
- **A resource without a checksum** can only be checked after loading.

### 7.4 Failures and unmet constraints

Each issue is `{code, severity, phase, message, path, ids, constraint?}`:

- **`code`:** namespaced and stable (`IssueCodes` in `format/issues.ts`).
- **`phase`:** `static`, `load`, `resolve` or `render`.
- **`path`:** a JSON pointer into the document.
- **`constraint`:** for an unmet constraint, `{kind, requested, achieved, reason}`. The UI shows it as is.

The stories show each case:

- **An unmet constraint:**
  - the 506 catalase copies, with the reason;
  - ATP synthase: `the membrane of mitochondrion holds 69 hexagonal sites 120 Å apart; 400 asked`.
  - A shortfall is a `warning` by default and an `error` when the population asked for a `placed-fraction` it did not
    reach.
- **A missing resource** fails its model and every model that avoids it, each reported where it happens.
- **An unknown resolver** is reported, and the rest of the scene still resolves.
- **A catalog** that is not expanded.
- **A relation** that no resolver honours (`relation.ignored`, info).

## 8. Performance

### 8.1 Budgets and complexity [target]

**Scene sizes:**

| Size | Copies        | Example                                          |
| ---- | ------------- | ------------------------------------------------ |
| S    | 10⁴           | the exosome without lipids                       |
| M    | 10⁵–10⁶       | the exosome's bilayer; a bacterial slice         |
| L    | 10⁷–2.5 × 10⁷ | the yeast cell: 21.6 M instances by its MODEL.md |

**Memory per copy:**

| Item                                      | Budget | Status           |
| ----------------------------------------- | ------ | ---------------- |
| Placements                                | 36 B   | met, exactly     |
| Adapter additions                         | ≤ 8 B  | met              |
| Renderer, everything else on the CPU side | ≤ 64 B | not met; see 8.2 |

**What that allows:**

- S and M fit comfortably: 1M copies ≈ 108 MB.
- **L does not fit as one scene:** 2.5 × 10⁷ × 108 B ≈ 2.7 GB. L needs tiles or streaming, which is how the yeast viewer
  itself stores its model (200 nm tiles). This is open decision 5.

**Complexity per update type:**

| Update                                             | Target                                                                                    | Status                                 |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------- |
| Validate                                           | O(document)                                                                               |                                        |
| Resolve                                            | O(N · tries) for packing, O(N) for the rest; never O(N²): overlaps go through a hash grid |                                        |
| View edit (color, visibility, camera, active view) | O(types) in the runtime, **< 16 ms at any N** end to end                                  | the end-to-end target fails at 1M (R1) |
| Model edit                                         | only the touched models rerun; unchanged sets keep their objects and their renderer state |                                        |
| Commit of a new set                                | O(N) in the renderer, no copy of the IR buffers                                           |                                        |

### 8.2 Results [measured]

**Hardware:** Ludo's Mac (Apple M1 Pro, macOS). Two environments:

- **Node 22:** Vitest's heavy lane. Rendering uses headless `gl`, a software-path WebGL.
- **Browser:** Chromium 1243 driven by Playwright, headed, on the GPU. These are the Storybook _Performance › Probe_
  runs.

**Runtime (Node, `spec/src/_test/perf.test.ts`):**

| Measure                                                 | Result                                                                                          |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Packing 5k / 20k / 80k copies (15% volume fraction)     | 34 / 64 / 257 ms; 6.9 / 3.2 / 3.2 µs a copy: linear once warm (the 5k run includes JIT warm-up) |
| Bilayer, 1,000,038 lipids                               | 145 ms to resolve; 34.3 MB of placements; ArrayBuffer growth 30.7 MB (allocated once; GC noise) |
| On the 1M scene: view edit (`updateView`)               | 0.1 ms                                                                                          |
| On the 1M scene: cached compile of a recolored document | 0.4 ms, 0 resolver runs                                                                         |
| On the 1M scene: `planCommit`                           | 0.1 ms                                                                                          |

**Adapter and renderer (Node + headless `gl`, `molstar/src/_test/perf.test.ts`):**

| Scene      | Resolve ms | Commit ms | First image ms | Color commit ms | Image after the color ms |
| ---------- | ---------- | --------- | -------------- | --------------- | ------------------------ |
| pack 50k   | 183        | 274       | 909            | 9.4             | 292                      |
| bilayer 1M | 154        | 784       | 2442           | **112**         | 1709                     |

**Browser (Storybook _Performance › Probe_):**

| Scene   | Copies    | Resolve ms | Commit ms | First frame ms | Color edit ms (to the frame) | Lists rebuilt by the color | Placements | Adapter adds | JS heap Δ |
| ------- | --------- | ---------- | --------- | -------------- | ---------------------------- | -------------------------- | ---------- | ------------ | --------- |
| pack    | 10,000    | 31         | 97        | 15             | 22                           | none                       | 0.3 MB     | 0.1 MB       | 2.0 MB    |
| pack    | 50,000    | 137        | 12        | 8              | 16                           | none                       | 1.7 MB     | 0.4 MB       | 7.8 MB    |
| bilayer | 100,037   | 14         | 19        | 5              | 13                           | none                       | 3.4 MB     | 0.8 MB       | 26.0 MB   |
| bilayer | 1,000,038 | 113        | 104       | 29             | **49**                       | none                       | 34.3 MB    | 7.6 MB       | 129.2 MB  |

A second run of both Node lanes on the same machine gave the same picture: a 1M color commit of 109 ms, 8.6 ms at 50k,
and packing at 3.2–3.9 µs a copy. Timings vary by about 15% from run to run; the byte counts do not.

Notes on the browser table:

- The first run's commit includes loading Prism's lazy particles feature: 97 ms here, 243 ms on a cold load.
- **[fixture]** Exosome slice (Node): 3 resolver runs, 335 ms in all.
  - `m.recipe` takes 300 ms of that, mostly mesh inside-tests against a 320-triangle surface.
  - The other two are `m.picks` (0.7 ms) and the bilayer (88,666 lipids, 33 ms).

**What the numbers say:**

1. **The runtime side holds.** No copies, linear resolution, and view edits independent of N.
2. **A color edit is O(N) inside Mol\*/Prism.** 9.4 ms at 50k, 112 ms at 1M (Node); 49 ms to the frame at 1M in the
   browser. That misses the 16 ms target at 1M. Renderer finding R1.
3. **Mol\* holds about 87 B a copy beyond the IR and the adapter** at 1M copies (129 MB heap Δ − 34 MB − 8 MB), over the
   64 B budget. Attribution is a hypothesis (R3).

The GC-dependent heap numbers are approximate. The placement and adapter numbers are exact.

### 8.3 What is fixture-backed

- **Expensive modeling steps are stand-ins.** cellPACKgpu's GPU packing, the segmentation, the template matching and the
  yeast tile packing are replaced by labelled stand-ins:
  - the shared CPU packer, run on the real recipe;
  - synthetic OBJ and STAR files (`spec/src/examples/fixtures/synthetic.ts`; also written to `examples/fixtures/`);
  - for the yeast cell, a description only.
- **Fixture timings measure the stand-ins.** They say nothing about the tools the stand-ins replace.

## 9. Storybook (`MesoViewSpec` in the sidebar)

| Story                                                                     | What it tests                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| _Docs › Principles_                                                       | responsibilities of the language, IR, resolvers and adapters; the rules the stories check                                                                                                                                                                                                                                                                                                                                                                               |
| _Docs › Paired examples_ (Exosome, Gallery, Yeast)                        | each document and the IR computed from it in the browser, its issues, a provenance trace                                                                                                                                                                                                                                                                                                                                                                                |
| _Thin slice_ (End to end, Color edit, Density edit, Unmet constraint)     | document → validation → resolvers → IR → **the real Prism viewer**, side by side. The edit bar applies view and model edits, and an edit table shows each edit's kind, resolver runs, cache hits, compile and commit times, and sets added, removed and kept. The Color edit story shows `0` runs and `=3` sets kept; the Density edit story shows 1 run and `+1 −1 =2`; the Unmet constraint story explains the shortfall, then meets the constraint by asking for 150 |
| _Resolver mocks_ (Membrane lattice, Compartment packing, Fibers, Bilayer) | the cases the slice leaves out, each with its construction parameter on a slider (a model edit that reruns that resolver alone)                                                                                                                                                                                                                                                                                                                                         |
| _Performance › Probe_                                                     | resolve, commit, first frame and a color edit at 10k–1M copies, measured separately in the browser                                                                                                                                                                                                                                                                                                                                                                      |

**Checked in a browser:** I loaded all 13 stories in headless Chromium through Playwright, and the probe headed. None
raised a console error. I looked at screenshots of the thin slice, the probe and the Fibers mock; the Fibers mock
exposed the adapter's `excludeFibers` bug (§11).

**Run them:** `pnpm -C storybook storybook` (port 6006), or `npx storybook dev -p 6011` in `storybook/`.

## 10. Test lanes

| Lane                                | Command                                                                                                                                                     | What it verifies                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **quick** (default; 40 tests, ~6 s) | `pnpm test:unit packages/mesoscale`                                                                                                                         | **Validation:** every rule, on broken documents. **Units and imports:** counts from concentrations and densities; the cellPACKgpu import (both count rules, the surface unit). **Provenance:** traces. **Determinism:** the same placements from the same document. **Edits:** a color edit is 0 resolver runs with the same placement objects; a density edit is 1 run, the right one. **Scene:** an unmet constraint with its reason; procedural copies avoid the picks; frames carry the picks from voxels to world Å; membrane orientation; 36 B a copy. **Runtime:** dispatch by arrangement; nesting, lattices, fibers, bilayers; the yeast document's issues; a toy resolver plugged in. **Mol\* side:** the paired example files are current; the MVS export validates; STAR rotations match Mol\*'s; the particle list shares the IR's buffers |
| **integration** (medium)            | `pnpm test:medium packages/mesoscale`; with GL: `pnpm native:install` once, then `NODE_PATH=.cache/native/node_modules pnpm test:medium packages/mesoscale` | the real Prism viewer, headless, with prism-me's spec: lists hold the IR's buffers; a color edit replaces no list or representation object; a density edit replaces only the rerun model's list. With `gl`: the scene draws, and a color edit changes pixels without a new list. Without `gl`, the GL test is skipped, not failed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **performance** (heavy, opt-in)     | `pnpm test:heavy packages/mesoscale` (`MESO_PERF_OUT=<file>` writes the numbers as JSON)                                                                    | packing scales linearly (16× copies, under 3× the time per copy); 1M lipids are allocated once, exactly; on 1M copies, view edits, cached compiles and commit plans are N-independent; adapter commit, first image and color edit at 50k and 1M; MVS bytes a copy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

**To refresh the paired example files:** `MESO_UPDATE_EXAMPLES=1 pnpm test:unit packages/mesoscale/spec`.

## 11. What held, what the prototypes exposed, what is open

**Held up:**

- **A flat document, a tree IR.** The biology is a graph, so ids in one namespace serve it better than nesting. The
  build is a tree, as in `mol-state`.
- **One IR leaf (the placement set) in the renderer's layout.** Six resolvers and two adapters use it. It cost no
  copies, and the toy-resolver test shows a new kind is one entry.
- **Keyed resolution by projection.** "A color edit reuses placements" holds by construction, and is checked at four
  levels:
  - in the runtime;
  - by object identity in Prism;
  - in pixels;
  - in the browser.
- **Assumptions as evidence.** The cellPACKgpu ambiguities became visible, citable data instead of hidden defaults.
- **Issues with requested, achieved and a reason.** The UI explains a shortfall without knowing the resolver.

**Gaps the prototypes exposed:**

| Gap                                                                         | Layer                | Note                                                                                                          |
| --------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------- |
| A helical lattice on a tube (microtubules, 13 protofilaments)               | language             | `fiber` is one copy per rise                                                                                  |
| Catalogs                                                                    | runtime              | not expanded (§3.6)                                                                                           |
| Segmentation surface extraction                                             | resolver             | prototype takes meshes only                                                                                   |
| Mesh inside test is O(triangles)                                            | resolver             | needs a signed distance grid, as mesobuild's `engine/geometry.py` has                                         |
| Random sequential addition stops at a give-up heuristic                     | resolver             | 354/506 catalase; relaxation (mesobuild `engine/relax.py`) would place more                                   |
| `min-distance` constraints and relations are reported, not honoured         | resolver             |                                                                                                               |
| Representations beyond spheres, clipping, drawn annotations                 | adapter / view state |                                                                                                               |
| The camera snapshot needs the scene radius                                  | adapter              | fixed: a radius left from a smaller scene clipped the front of a larger one                                   |
| Particle spacefill hides fiber particles by default                         | adapter              | fixed: the Fibers mock showed an empty view until the adapter set `excludeFibers: false` for sets with fibers |
| Prism's particles feature is lazy                                           | adapter              | an in-memory list needs `extensions.load('particles')` first                                                  |
| In-memory data enter `mol-state` only through a side store keyed by a param | plugin API           | renderer-recommendations R6                                                                                   |
| `cached` is part of the IR                                                  | IR                   | it makes two IRs of the same document differ by history; it should move to the stats                          |

**Open decisions for David:**

1. **Placement frames.** The prototype bakes every placement set into the world frame at resolution, and `frame` nodes
   record the matrices. For 10⁷-copy precomputed sets, an adapter-side transform would avoid a pass. Bake, or carry
   frames to the renderer?
2. **Catalogs.** Runtime expansion into populations, or a resolver input?
3. **Derived results as resources.** Store a resolution as a `placements` resource with `derivedFrom: {model, key}`, so
   an expensive procedural result (cellPACKgpu on a GPU) can be shipped and replayed?
4. **Representation hints in views.** Spheres, structure or surface per selector, as hints with fallbacks (SeqViewSpec's
   fallback chains)?
5. **L scenes.** Tiles as a first-class IR concept (a set per tile, keyed), or a renderer-side streaming source?
6. **Patches and history.** Patches over one tree for snapshots and undo (SeqViewSpec: `applyPatch`, `diff`, inverses),
   or whole documents with `classifyEdit`, as the prototype does?
7. **Schema.** JSON Schema or OpenAPI published (as MolViewSpec), or reference tables generated from the types (as
   SeqViewSpec)?

## 12. Packaging

**Option: `packages/mesoscale/*` in Mol\*, as `@molstar/meso-*`.** This is the prototype's layout:

- `@molstar/meso-spec` (format, IR, runtime, resolvers);
- `@molstar/meso-molstar` (adapter, stories).

**For:**

- It is the shape SeqViewSpec took (`packages/sequences/{core,viewer,…}`): a format package with no viewer dependencies,
  and a viewer package on top.
- It runs on Mol\*'s quick, medium and heavy test lanes and in Mol\*'s Storybook.
- The adapter must live next to Prism, whose operations it calls.

**Against, or to settle:**

- **The name.**
  - `packages/extensions/mesoscale` already is `@molstar/mesoscale-extension` (prism-me's operations), and
    `apps/mesoscale-explorer` exists.
  - A future `@molstar/meso-*` family should absorb or rename the extension, or take another prefix:
    `@molstar/mvs-meso`, `@molstar/mesoscale-spec`.
- **Independence.** The format and runtime have no Mol\* imports. A Python or C++ reader (cellPACK, mesobuild) might
  want them in a repository of their own, as MolViewSpec keeps its Python builder in `molstar/mol-view-spec`.
- **Enforcement.** "No Mol\* imports" is a convention here. It should become a Biome `noRestrictedImports` rule for
  `packages/mesoscale/spec`, as the AI package has one.

**Recommendation:**

- Keep the format in Mol\* while it changes, in `packages/mesoscale/spec` with the import rule.
- Move it out only if a second implementation appears.
- Rename the existing extension rather than the new packages.

## 13. References

**Read for this design:**

- **MolViewSpec:**
  - Tree and schema: `packages/mvs/builder/src/tree/generic/tree-schema.ts` (`Node`, `TreeSchema`),
    `…/tree-validation.ts` (`treeValidationIssues`), `…/mvs/mvs-tree.ts` (`MVSTreeSchema`),
    `packages/mvs/builder/src/mvs-data.ts` (`MVSData`, `SupportedVersion`).
  - Runtime: `packages/mvs/runtime/src/load.ts` (`loadMVS`, `MolstarLoadingActions`), `…/tree/molstar/conversion.ts`
    (`convertMvsToMolstar`), `…/load-helpers.ts` (`applyTransformAndInstances`), `packages/mvs/runtime/_spec/load.md`.
  - Spec docs: `~/Developments/mol-view-spec/docs`.
- **SeqViewSpec:** `packages/sequences/_spec/{README,format,viewer,model}.md`; `packages/sequences/core/src/format/`
  (`validate.ts` `validate`, `patch/patch.ts` `applyPatch`/`diff`, `upgrade.ts` `upgrade`, `load/compile.ts` `compile`).
- **mol-state:** `packages/core/src/state/` (`transformer.ts`, the update contract `Unchanged`/`Updated`/`Recreate`;
  `transform.ts` `setParamsHashVersion`), `packages/core/src/state/_spec/{README,reconcile,dependencies}.md`.
- **PRISM-ME:**
  - App: `apps/prism-me/{AGENTS.md,_spec/architecture.md,_spec/features.md}`.
  - Model: `packages/model/src/model/particles/particle-list.ts` (`ParticleList`).
  - State transforms: `packages/plugin/core/src/state/transforms/particles/{representation,layers}.ts`
    (`ParticlesRepresentation3D`, `ParticleRepresentation3DLayers`).
  - Prism: `packages/prism/viewer/src/features/particles/operations.ts` (`particles.representation`, `particles.look`),
    `packages/prism/viewer/src/testing/real-viewer.ts` (`RealViewerStory`).
  - Graphics: `packages/graphics/src/theme/size/particle-size.ts` (`ParticleSizeTheme`).
  - Extensions: `packages/extensions/mesoscale`.
- **Mesoscope:** `~/Developments/mesoscope/{SKILLS.md,js/cp_serialized.js,js/main.js}`.
- **mesobuild:**
  `~/prism-me-lanes/mesobuild/{README.md,engine/build.py,engine/geometry.py,engine/relax.py,docs/landscape.md}`;
  `exosome/out/SUMMARY.md`.
- **cellPACKgpu:**
  - Recipes: `~/Dev/cellpackgpu/Data/recipes/{exo_serialized.json,root_serialized(68).json}`; the fixtures are trimmed
    from these.
  - Code: `Assets/Scripts/Utils/CompartmentUtils.cs` (`Compartment`, `Ingredient`, `GenericManifest`),
    `Assets/Scripts/Loaders/CellPackLoader.cs`, `Assets/Scripts/Misc/UImanager.cs:9231`, `PopulateTest.cs:4939,4953`.
- **The yeast cell:** https://github.com/zoidpuff/yeast_cell_viewer: `MODEL.md` (cited by section in `yeastDoc`),
  `source/pipeline/webenc.py` (tile format), https://zoidpuff.github.io/yeast_cell_viewer/.
  - **No license is stated:** only a description is used, and no data or text is copied.
  - **The two sources disagree** on the instance count: 25.2 M on the viewer page, 21.6 M in `MODEL.md`.

**Missing:**

- **Ivan's paper: not found.**
  - Not among the local PDFs. The Obsidian vault was unreachable (its local API refused connections).
  - The candidates in `apps/prism-me/_spec/references.bib` are Klein2018 (_Instant Construction and Visualization of
    Crowded Biological Environments_, closest to recipes and building) and Alharbi2025 (_Nanouniverse_, closest to
    instancing at scale).
  - To do: confirm which one is meant and add it here.
