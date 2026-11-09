# MesoViewSpec: design

A prototype of a declarative format for mesoscale science, with its IR and a small runtime, built to test the design.
For David's review. Renderer findings are in a separate document,
[renderer-recommendations.md](renderer-recommendations.md), to discuss with Alex.

- **Status:** a prototype on branch `me/mesoviewspec` (worktree `~/prism-me-lanes/mesoviewspec`, off `prism-me`). It is
  not pushed. Nothing in Mol\* itself was changed.
- **Code:** `packages/mesoscale/spec` (`@molstar/meso-spec`: the format, IR, runtime and resolvers; no Mol\* imports)
  and `packages/mesoscale/molstar` (`@molstar/meso-molstar`: the Prism adapter, the MolViewSpec export and the stories).
- **Paired examples:** each scene as a document and as the IR the runtime makes of it, in `packages/mesoscale/examples/`
  (`exosome`, `gallery`, `yeast`, `betacell`, `nucleoid`, as `*.mesoviewspec.json` and `*.ir.json`). A quick-lane test
  keeps them current.
- **Number labels:** **[measured]** (with where and how), **[target]** (proposed) or **[fixture]** (computed on
  synthetic or trimmed inputs). Hypotheses are labelled as such.

**Version 0.2, after David's review (2026-11-08).** David asked for a high-level scene graph that compiles through two
or three layers, declarative addresses ("MesoQL"), reusable nested ultrastructures, relations reconciled by the runtime,
and engines composed over a common representation. Ludo's list of what goes wrong in practice (DNA-bending proteins,
flagellar motors, nuclear pores, lattices with defects, lipid composition) was the test set. What changed:

| Change                                                                           | Section | Status                                                      |
| -------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------- |
| The layers, named: document → constraint graph → MesoComplex → render IR         | §1      | built                                                       |
| S-expression spelling: the document, IR, issues and traces in the UI             | §3.7    | built, round-trip tested                                    |
| MesoQL: addresses, MesoLocation and MesoLoci (runs)                              | §3.8    | built: 13 symbols, views use it                             |
| Superstructures: reusable, nested, instanced; `parts` or `entity` detail         | §3.9    | built: β-cell, 120 granules from Ludo's ISG recipe          |
| Values by value or by reference: lipid composition, conformational states, sites | §3.10   | language; sites used by relations                           |
| Relations as constraints with site addresses (binds, bends, branches, contacts)  | §3.11   | `bends` and `binds` reconciled (HU on DNA); others reported |
| Application composition: a model `refines` another                               | §6.7    | built: `meso.relax`, catalase 354 → 506 of 506              |
| MesoCraft (Ivan's paper) mapped onto these concepts                              | §3.12   | reference                                                   |

**Version 0.4, streaming (2026-11-08).** David after v0.1: "it needs … streaming concepts". A `stream` source on a
model, a tile manifest (level 0: counts and envelopes; level 1: one placement set per tile), a provider contract, a
deterministic planner under a copy budget, and a camera that reads level 0 (§6.8). Decisions 5 and 12 narrowed (§11).
Status: designed; the build is lane `mesoviewspec-streaming`.

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
**IR**, which a **renderer adapter** puts into a viewer. In David's words, a high-level scene graph "which still has 2-3
layers it compiles to below". The prototype has these four:

| Layer                          | What it holds                                                                                                                                                                                        | Where                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **1. Document** (MesoViewSpec) | biology, evidence, provenance, relations, views, by id; addresses as MesoQL                                                                                                                          | `format/doc.ts`                                                                   |
| **2. Constraint graph**        | the document normalized: Å, counts, frame matrices, MesoQL checked, relation sites materialized, superstructures as sub-documents                                                                    | `runtime/runtime.ts` (`NormalizedPopulation`, `NormalizedRelation`, `ResolveJob`) |
| **3. MesoComplex**             | what resolvers and refine stages produce and consume: placement sets, superstructure templates and their instances (David's name for the common representation, the analogue of Mol\*'s `Structure`) | the IR's `resolve`, `placements`, `superstructure`, `instances` nodes             |
| **4. Render IR**               | what an adapter commits: drawable world sets, looks, camera; instances expanded when the renderer cannot instance                                                                                    | `runtime/instancing.ts` (`flattenInstances`), `runtime/adapter.ts`                |

Engines compose at layer 3: a rigid-body placement feeds a relaxation (§6.7), each reconciling the same layer-2
constraints. Addresses (MesoQL) are written at layer 1 and materialize at layer 3 (MesoLoci).

**Why agents.** A document is plain data with one id namespace, an S-expression spelling, checked addresses and issues
with reasons. An agent that reasons in it leaves a scene anyone can inspect, diff and trace back to evidence
("inspectable by default", David). The same document is the glue for Ludo's twin of mesoscale models and cryo-ET: a
model and its simulated tomogram come from one description (open decision 9).

## 2. The same scene, twice

The thin slice is an exosome in plasma:

- its biology comes from a real cellPACKgpu recipe (Ludo's `exo_serialized.json`, trimmed to 14 ingredients);
- its membrane comes from a cryo-ET segmentation;
- 24 of its catalase copies come from template matching in the same tomogram.

The cryo-ET data are synthetic fixtures, labelled as such in the document (`custom.meso.fixture`); the recipe is real.

**MesoViewSpec** (excerpt of `examples/exosome.mesoviewspec.json`, printed in its S-expression spelling by `printData`;
the file is the JSON spelling of the same tree):

```lisp
(meso_view_spec
  :version 0.2.0
  :frames
    [(frame f.model
       :kind world
       :units nm
       :handedness right
       :convention "origin at the vesicle centroid")
     (frame f.tomo
       :kind instrument
       :units nm
       :voxel-size 1
       :handedness right
       :convention "voxel indices, origin at the first voxel's corner")]
  :alignments
    [(alignment al.tomo-model
       :from f.tomo
       :to f.model
       :transform (:translation [-200 -200 -100])
       :method "centred on the segmentation centroid"
       :activity act.align)]
  :compartments
    [(compartment c.exosome
       :label exosome
       :kind vesicle
       :parent medium
       :geometry (mesh :resource r.membrane-mesh)
       :membrane (:thickness (15 A))
       :evidence [ev.membrane-segmented])]
  :populations
    [(population p.catalase
       :entity e.catalase
       :compartment c.exosome
       :location interior
       :abundance (:count 506)
       :evidence [cellpack.count-rule])
     (population p.catalase.observed
       :entity e.catalase
       :compartment c.exosome
       :location interior
       :abundance (:count 24)
       :evidence [ev.catalase-picked])]
  :models
    [(model m.picks
       :label "catalase, picked"
       :kind precomputed
       :method meso.precomputed
       :populations [p.catalase.observed]
       :inputs [r.picks]
       :activity act.pick)
     (model m.recipe
       :label "cellPACKgpu recipe, packed"
       :kind procedural
       :method cellpack-gpu
       :populations [p.ALB … p.catalase]
       :inputs [r.recipe]
       :seed 1
       :params
         (:ingredients
            (:"p.catalase" (:path root.exosome.interior.proteins.catalase)))
       :avoid [m.picks]
       :activity act.pack)])
```

**IR** (excerpt of `examples/exosome.ir.json`, printed by `printData` with the IR codec; the placement buffers are
summarized):

```lisp
(resolve m.picks/resolve
  :origin [m.picks p.catalase.observed]
  :params
    (:model m.picks
     :resolver meso.precomputed
     :version 0.1.0
     :key m.picks@cde3af8d53db8f44
     :input
       (:resources
          [(:id r.picks
            :format relion-star
            :content-key 941694e4997102f5
            :to-world [10 0 0 0 0 10 0 0 0 0 10 0 -2000 -2000 -1000 1])]
        :populations p.catalase.observed
        :types
          [(:population p.catalase.observed
            :entity e.catalase
            :label "catalase (catalse)"
            :compartment c.exosome
            :radius 40
            :requested 24)])
     :cached false)
  :children
    [(placements m.picks/placements/0
       :origin [p.catalase.observed]
       :params
         (:set
            (:key m.picks@cde3af8d53db8f44#0
             :model m.picks
             :frame world
             :count 24
             :bytes 864
             :types
               [(:index 0
                 :population p.catalase.observed
                 :entity e.catalase
                 :label "catalase (catalse)"
                 :compartment c.exosome
                 :radius 40)]
             :first [119.4 12.9 -47.2 -20.3 -156 26.7])))])
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
- **Versioning:** semver. From 1.0 a minor version only adds; while the format is 0.x a minor version may break (0.2
  made looks MesoQL strings instead of selector objects), with no upgrade path yet. A newer major version is refused
  (`format.version`).

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

### 3.7 The S-expression spelling (`format/sexpr.ts`)

One tree, three spellings, as SeqQL has them (`packages/sequences/_spec/seqql.md`): the S-expression for people, agents
and tests; JSON for storage; the types for code. Every data panel in the stories shows the S-expression first, with a
JSON toggle.

```lisp
(meso_view_spec
  :version 0.2.0
  :populations
    [(population p.catalase.observed
       :entity e.catalase
       :compartment c.exosome
       :location interior
       :abundance (:count 24)
       :evidence [ev.catalase-picked])]
  :views
    [(view v.near-picks
       :looks
         [(:select (all) :visible false)
          (:select (within (in c.exosome) :of (population p.catalase.observed) :distance 15) :visible true)])])
```

- **Codec:** a section item is `(section-singular id :key value …)`; an object with a `kind` word is `(kind …)`; a
  quantity is `(15 A)`; any other object is a record `(:key value …)`; arrays are `[…]`; camelCase keys are kebab-case
  keywords, and a key that would not read back (an id used as a key) is quoted, `:"p.ALB"`. MesoQL values are written as
  forms, not strings, at their slots only: a look's `select`, a view's `selection` and `cutaway`, a camera's `focus`, an
  annotation's `target`, a site's `at`, a relation's `entry` and `exit` (matched by the key and its parent's, so
  `params.target` stays data). A form is printed on one line, and only when the string is already its canonical text;
  any other string (two spaces, a comment) stays a quoted string. So `read(print(json))` is the JSON for every string,
  and reading hand-written text keeps an address's canonical text.
- **Layout:** SeqQL's printer rules (positionals then keywords, one line when it fits 80 columns), Lisp indentation.
- **Tested:** `read(print(json))` equals `json` and `print(read(text))` is a fixed point, on all five example documents
  and their IR summaries (`_test/sexpr.test.ts`).
- **Not done:** the S-expression is not yet editable in the stories (they display it); the reader exists for that.

### 3.8 MesoQL: addresses, MesoLocation, MesoLoci (`format/mesoql.ts`, `ir/loci.ts`)

David: "you need something like MesoQL … declarative addresses which then the runtime can resolve", with a schematized
form and a materialized one, as Mol\* has `SchemaItem` and `Location`/`Loci`.

- **Schematized:** an address is written with document ids, `(and (entity e.catalase) (in c.exosome))`. It is checked
  against the document (symbol, arity, types, and that every id names a node of the right kind), with issues at the
  document path, like any other. Its type is the one its slot asks for, not its head's: a look's `select`, a view's
  `selection` and `cutaway`, a camera's `focus` and an annotation's `target` are selections; a relation's `entry` and
  `exit` are sites, whose names are checked against the entity's `sites`; a site's `at` and a contact's `a` and `b` are
  residues.
- **Materialized:** `evaluateMesoQL` turns it into **MesoLoci**: per placement set, sorted runs `[start, end)` of copy
  indices. A **MesoLocation** is one copy, `{set, index}`, with the stable id `<population>#<ordinal>`. Runs, not one
  entry per copy: every resolver writes a population contiguously, so `(population p.lipids)` is one run however many
  lipids there are (the exosome's 88,666; a quick test checks every population of the exosome is one run). This is what
  renderer finding R1 asks Mol\* for.
- **Symbols** (the reference is generated from the table, `mesoQLReference`):

| Symbol                                         | Returns   | Meaning                                                                                 |
| ---------------------------------------------- | --------- | --------------------------------------------------------------------------------------- |
| `(all)`                                        | selection | every copy                                                                              |
| `(population p…)`, `(entity e…)`, `(model m…)` | selection | copies by population, entity or model                                                   |
| `(in c… :nested :location)`                    | selection | copies in compartments (and those nested in them unless `:nested false`), at a location |
| `(copies p start count)`                       | selection | copies by ordinal (valid for one resolution)                                            |
| `(and …)`, `(or …)`, `(not Q :in U)`           | selection | set algebra on runs                                                                     |
| `(within Q :of Q2 :distance d)`                | selection | copies near others (hash grid, O(N))                                                    |
| `(part Q p.inner)`                             | selection | an inner population in the superstructure instances `Q` picks (§3.9)                    |
| `(site e name)`                                | site      | a named site of an entity: the "pointer" relations attach to (§3.11)                    |
| `(residues e :chain :range)`                   | residues  | a schematized residue address; needs the structure loaded                               |

- **Where it is used:** a view's `looks[].select`, `selection` and annotation `target` (anchored at the selected copies'
  centroid); relation `entry` and `exit`; site `at`. A look that covers part of a population becomes a partial look with
  its runs; Prism cannot draw it (renderer finding R8) and the adapter says so.
- **Stored as** its canonical S-expression string in JSON. SeqQL stores a JSON tree with full names; which to keep is
  open decision 10.

### 3.9 Superstructures: reusable, nested, instanced (`format/doc.ts` `Superstructure`)

Ludo: "a virus is an ultrastructure made of ultrastructures made of molecules made of atoms"; an insulin granule "can
have thousands of instances in a cell". David: `.superstructure({ params })`, holding "both" the reconstructed and the
opaque form, "depending on context".

- **In the document:** `superstructures[]`, each a fragment of a document (compartments, populations, models, relations,
  its own entities) in its own frame, centred on its envelope compartment. An entity names one (`superstructure`), as an
  entity names its structure: the insulin granule is an entity whose parts are a superstructure. Populations instance it
  like any entity. Superstructures nest; a cycle is refused (`superstructure.cycle`).
- **Both levels from one description:** a population's `detail` is `parts` (each copy resolved into the superstructure's
  contents) or `entity` (one body a copy). Ids inside share the document's namespace, so MesoQL addresses them; a
  structural reference (a population's compartment or entity, a model's populations, a relation's subjects) sees only
  its own document's sections, so a superstructure's contents stay its own, and a superstructure does not see a
  sibling's.
- **Resolved once:** the runtime compiles each superstructure as a document of its own, with the session's cache
  (`superstructureDoc`), and the IR keeps one `superstructure` node (its template sets, its frame) plus an `instances`
  node under each placement set whose copies stand for it. Nothing is multiplied in the IR.
- **Copy ids through the nesting:** `(part (copies p.granules 12) p.Vamp2)` materializes as one virtual set per
  instance, and its copies read `p.granules#12/p.Vamp2#305`.
- **Measured [fixture]:** the β-cell example (`examples/betacell.ts`) imports the granule from Ludo's cellPACKgpu ISG
  recipe (trimmed to Vamp2, Rab3a, Chga, Scg2: 2,229 copies) and places 120 granules. The template resolves once; more
  granules rerun only the cell's packing; `detail: entity` reruns nothing and keeps the granules' poses. The IR holds 83
  kB for the granules; expanded for Prism they are 267,480 copies, 9.2 MB (renderer finding R7).
- **Answers open decision 1 (placement frames) for superstructures:** frames travel (instances are poses in the IR), and
  the adapter expands only because Prism cannot instance lists. Plain placement sets stay baked in the world frame.

### 3.10 By value or by reference

David: "it could be passed by value or reference … rigid and strict in one place, and use a recipe in another".

- **Lipid composition:** `membrane.composition` is either `{lipids: [{entity, fraction, leaflet}]}` (by value) or
  `{resource}` (a recipe or a table, by reference). It is metadata a resolver may honour; the prototype's bilayer draws
  one lipid kind.
- **Conformational states:** `entity.states[]`, each a structure reference and a fraction.
- **Sites:** `entity.sites[]`, each a point and an axis in the entity's frame (by value) and/or a residue address (by
  reference to the structure, materialized when it is loaded).
- **Lattices with defects:** `arrangement.defects.vacancy`, the share of empty sites, honoured by `meso.lattice`
  (seeded: the same holes every run). Ludo's example: a membrane protein placed at random until a cryo-ET study showed a
  hexagonal lattice with defects. The fix is an edit of one arrangement, citing the new evidence.

### 3.11 Relations as constraints with addresses

David: "encode the relations as a graph … and then reconcile that in the runtime"; Ludo: "the bending is highly
specific, you need point of entry/output".

```lisp
(relation rel.hu-bends-dna
  :kind bends
  :subjects [p.hu]
  :objects [p.dna]
  :entry (site e.hu dna-entry)
  :exit (site e.hu dna-exit)
  :angle 120
  :spacing 30)
```

- **Kinds:** `binds`, `bends`, `branches` (Arp2/3, 73° in the yeast model), `contacts` (residue pairs for
  bead-and-spring engines: `a`, `b` residue addresses, a distance), `part-of`, `colocalizes`, `anchored-to`, `excludes`.
- **Reconciled by the resolvers that honour them** (`Resolver.honours`). `meso.fiber` honours `binds` and `bends`: every
  `spacing` of strand it places a subject copy with its entry site on the strand and its entry→exit axis along it, using
  MesoCraft's attachment-point rule `x = q − R·p` (Jia et al. 2026, eq. 1). The strand resumes at the exit site, turned
  by the angle. A quick test checks every HU's entry site sits on a DNA copy, the next copy sits at its exit site, and
  the turn is the stated angle. A traced path is an observation: binders go on it, but it is not bent (an info issue).
- **Not reconciled, reported:** a site given only by residues cannot be materialized without the structure (IHF in the
  nucleoid example: `constraint.unmet` with that reason); `branches` and `contacts` have no resolver yet
  (`relation.ignored`).
- **Rigid or bead-and-spring is the engine's choice, not the language's** (Ludo's question): a rigid-body engine uses
  sites and angles; a bead-and-spring engine uses `contacts`. Each declares what it honours, and the runtime reports the
  rest.

### 3.12 MesoCraft, mapped (Ivan's paper)

MesoCraft (Jia, Kouyoumdjian, Strnad, …, Viola, arXiv 2610.37954, [html](https://arxiv.org/html/2610.37954v1)) is a
rule-based procedural modeller: ingredients, skeletons (geometric references), rules with distributions, and an enriched
mmCIF carrying the rule graph. Its constraint catalogue is in `~/Dev/mesocraft-react/modeling/capabilityCatalog.mjs`.

| MesoCraft                               | MesoViewSpec                                                                                                   |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| ingredient, instance                    | entity, copy (placement set)                                                                                   |
| skeleton (17 shapes, OBJ)               | compartment geometry; a skeleton that is not a compartment (a scaffold, a guide path) has no concept yet (gap) |
| placement `(x, R)`, pivot `x = q − R·p` | site + relation, materialized by the resolver (§3.11)                                                          |
| Parent–Child Distance                   | population at `outer-surface`/`membrane` with an offset (a resolver param)                                     |
| Parent–Child Relative                   | lattice or superstructure sites (gap: placement at a scaffold's sites)                                         |
| Siblings, Siblings–Parent               | fiber (rise, twist) along a path or a growth rule                                                              |
| Fill                                    | `random` population in a compartment                                                                           |
| Connection                              | a fiber by path between two copies (gap: a path defined by two addresses)                                      |
| Symmetry Assembly                       | superstructure, or a helical arrangement (gap: the microtubule case)                                           |
| distributions (uniform, Gaussian)       | gap: arrangement parameters are numbers, not distributions                                                     |
| rule graph in enriched mmCIF            | models, `refines`, `avoid` in the document                                                                     |

A MesoCraft rule graph could be a resolver (`mesocraft`) that takes it as a model's input, as cellPACKgpu's recipe is.
The gaps above are where its vocabulary is richer than this format's.

### 3.13 Instances: copies stated one by one (v0.3, `Instance`)

David's comment on v0.2: a population is not the top-level abstraction, it is how we state copies today because we
cannot list every one. The document now has three ways to state copies, and populations are one of them:

| Way           | The document says                                        | Example                                        |
| ------------- | -------------------------------------------------------- | ---------------------------------------------- |
| individually  | this copy, here, with this id (`instances`)              | a docked granule; a ribosome someone segmented |
| statistically | how many, how arranged, where (`populations`)            | 2,000 ribosomes in the cytoplasm               |
| structurally  | the copies a superstructure contains (`superstructures`) | the VAMP2 on every granule                     |

```lisp
(:instances
  [(instance i.granule-docked
      :label "a docked granule"
      :entity e.granule  :compartment c.cell
      :pose (:translation [0 -1300 0])
      :evidence [ev.docked])])
```

**What an instance adds is identity.** `(copies p.granules 12)` is an ordinal: valid for one resolution, and a repack
makes it another granule. `(instance i.granule-docked)` is the same copy after any edit that does not touch it. A quick
test (`_test/instances.test.ts`) repacks the cell with another seed and with fewer ribosomes: the instance keeps its id,
its pose and the camera framed on it, while granule 12 moves.

**How it is realized.** The runtime turns each instance into a population of one copy under the instance's id, placed by
`meso.precomputed` from an inline table in world Å (`withInstances`, `runtime/runtime.ts`). Given poses therefore have
one code path, whether a file (picks) or the document holds them. Every procedural model avoids the instances, so a
packer works around them. Superstructure expansion, looks, relations, MesoQL and the camera needed nothing new.

**Limits.** Each instance is its own type: fine for tens or hundreds, not for 10⁵ copies, which belong in a resource
read by `meso.precomputed` (§4.5). A pose is in the world frame, or in `frame`'s own coordinates (a tomogram's voxels).

### 3.14 Not in the document

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
- **(v0.2) superstructures:** `superstructure` (a superstructure's resolved tree, once) and `instances` (under a
  placement set: its copies of one type stand for a superstructure, `parts` or `entity`). Together with the placement
  sets, this evaluated part is what David calls the MesoComplex.
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
  quick test compares the two. As that reader, it takes a row's origin shift (`rlnOrigin*`, pixels; `rlnOrigin*Angst`,
  Å, by the frame's voxel size) off its coordinate, and turns the row by its subtomogram angles (subtomogram · particle,
  the shift too). A `populations.column` the table does not have is an error.
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

- **Restored, into the viewer** (the Prism adapter applies them):
  - the scene hierarchy (compartments, populations, models);
  - visibility, colors and transparency;
  - the camera.
- **Derived into the IR, not yet applied by the Prism adapter:**
  - the selection (by semantic id, or by copy id within one resolution): `IRView.selection`;
  - annotations: `IRView.annotations`.

  A quick test checks that switching `session.view` derives them, the looks and the camera; drawing them is adapter
  work.

- **Representations, as hints.** A look can carry `representation: spheres | structure | surface`. It is a hint with a
  fallback, in SeqViewSpec's "what, not how" sense:
  - the IR carries it (`IRLook.representation`);
  - the Prism adapter draws spheres and reports a `render`-phase issue (`representation.fallback`) for the others
    (medium-lane test, the exosome's _Lumen only_ view).

  Open decision 4 is which hints beyond spheres an adapter must honour.

- **Not restored:** clipping, and annotations drawn in the viewer.
- **Copy ids are only as stable as the resolution.** A copy id (`p.catalase#12`) is valid only for one resolution key: a
  model edit can renumber copies. Selections that must survive edits should use semantic selectors, or name the copy as
  an instance (§3.13).

### 5.1 The semantic camera (v0.3, `Camera`, `Tour`)

David: "now we just need the semantic layer for it to control the camera". A camera can say what to look at instead of
where to stand:

```lisp
(view v.docked
  :camera (:focus (instance i.granule-docked)
           :framing context        ; close | fit | context
           :from outside           ; or a direction [x y z]
           :transition 1500)       ; ms
  :cutaway (within (population p.ribosomes) :of (instance i.granule-docked) :distance 250))

(tour t.granule
  :steps [(:view v.cell :duration 3000 :caption "A slice of a β-cell")
          (:view v.docked :duration 4000 :caption "A granule named in the document")])
```

- **`focus`** is any MesoQL address. The runtime materializes it over the resolved copies (through superstructure
  instances) into a bounding sphere (`lociSphere`, `ir/loci.ts`) and places the camera at radius / sin(fov / 2) × 0.6,
  1.1 or 2.5 for `close`, `fit`, `context`. Because it is an address, the camera follows the scene when it is
  re-resolved. An address that picks a superstructure's contents (`(population p.Vamp2)`) is read where those copies sit
  in the world, through every instance: the template is bounded once and its ball moved by each instance pose, so the
  centre is exact and the radius an upper bound (within 5 % on the β-cell); `within` reads them the same way.
- **`from outside`** looks in from beyond the scene's centre through the focus: the natural way into a cell.
- **`cutaway`** is an address for the copies to hide so the focus shows. It is materialized into the IR; Prism clips by
  planes, not by copies, so the adapter reports it (renderer R8).
- **A numeric camera** (`position`, `target`) is read in its view's `frame`: a camera written in a tomogram's voxels
  lands where the tomogram is. Directions turn with the frame too (`up`, a `from` vector); a numeric annotation is a
  point in the view's frame.
- **`up`** written in the view turns with its frame; unstated, it is the world's y. Either way the runtime makes it
  perpendicular to the view direction, so a camera looking along y (a granule docked below the cell's centre) still has
  a defined roll.
- **Tours** step through views with durations and captions; `session.tour` names one to play.

The _Semantic camera_ story switches views (no resolver reruns; about 10 ms) and plays the tour.

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
     - a model that avoids a failed model also fails (as SeqViewSpec's "unavailable with a cause"); when only the
       refiner of an avoided model fails, the avoiding model avoids the unrefined result instead (§6.7).
   - A model that avoids a refined model avoids what is drawn: it runs after the refiner and its key follows the
     refiner's. A refiner keeps the `avoid` of every model up its chain, instances included.
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

| Id                 | Realizes                                                                                  | Complexity        |
| ------------------ | ----------------------------------------------------------------------------------------- | ----------------- |
| `meso.pack`        | random populations: interiors, membranes, surfaces, the space around a compartment        | O(N · tries)      |
| `meso.lattice`     | lattices on spheres and ellipsoids                                                        | O(N)              |
| `meso.fiber`       | fibers by path or by growth; honours `binds` and `bends` (subjects placed by their sites) | O(N)              |
| `meso.bilayer`     | lipid bilayers                                                                            | O(N)              |
| `meso.precomputed` | RELION STAR, placement JSON                                                               | O(rows)           |
| `cellpack-gpu`     | cellPACKgpu serialized recipes                                                            | O(N · tries)      |
| `meso.relax`       | (v0.2) refine stage: inserts missing copies, relaxes overlaps (§6.7)                      | O(N · iterations) |

All of them are in `resolvers/index.ts`, `DefaultResolvers`. The copies of the models a model avoids: the packers place
nothing on them, `meso.relax` holds them fixed, `meso.lattice` skips the sites they take, `meso.fiber` grows around them
(a traced path is kept where it is and its overlaps reported); `meso.bilayer` and `meso.precomputed` do not look at them
(lipids are drawn without footprints, §11; given poses are given).

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

### 6.7 Application composition: refine stages

David: "one engine/runtime can use some cheap fills, other can do a physical simulation … all trying to reconcile the
same high-level constraints"; "Ivan's rigid body could feed into a simulation process that refines the structure".

- **In the document:** a model with `refines: <model>` takes that model's result as its input and replaces it. It
  realizes the same populations and is checked against the same constraints.
- **In the runtime:** refine stages run after what they refine (`topoOrder`); their key includes the upstream key, so
  re-resolving the upstream reruns them and nothing else; the refined model keeps its `resolve` node (key, input,
  `refinedBy`) but its sets leave the IR, only once the refiner has resolved: a refiner that fails leaves the upstream
  drawn and counted, with the failure reported. A model has at most one refiner (validation refuses two).
- **`meso.relax`** (`resolvers/relax.ts`): inserts the copies still missing, relaxes overlaps by pushing pairs apart
  (hash grid, O(N) an iteration), and keeps copies in their compartments with signed distance grids, then a last phase
  with the exact inside test (`sdfGrid` in `resolvers/geometry.ts`, which also answers the O(triangles) mesh gap).
  Membrane copies and avoided models stay fixed.
- **Measured [fixture]:** on the exosome, the recipe's packing stops at 354 of 506 catalase; adding `m.relax` inserts
  152, converges in 41 iterations, then checks every copy against the exact mesh with its margin (and against the
  compartments it must stay out of, with theirs); it meets 506 of 506 with a largest overlap of 0.78 Å measured after
  the last step (tolerance 1 Å) and no copy outside the membrane. Lipids are not part of the check: the bilayer is drawn
  without the proteins' footprints (a gap, §11). The packing is a cache hit when the stage is added. mesobuild's
  `relax.py` reached 506 of 506 on the same recipe.

### 6.8 Streaming (v0.4)

David, after v0.1: "it needs … streaming concepts". A document can name a scene too large to hold at once (L in §8.1:
the yeast cell's 2.5 × 10⁷ copies in 6,416 tiles of 200 nm). The viewer shows all of it coarse first, then loads copies
where the camera looks, within a budget.

**Levels** (decision 12, as a runtime concept; the document's sections do not move):

| Level | Holds                                                         | In v0.4                                          |
| ----- | ------------------------------------------------------------- | ------------------------------------------------ |
| 0     | statistical: per tile, a count and an envelope per population | always loaded, from the manifest; never budgeted |
| 1     | copies: one placement set per tile                            | loaded around the focus, within the budget       |
| 2     | atoms: the structures at those poses                          | declared in a manifest, never loaded             |

**The rules, in one place:**

- Streaming is outside `compile`. `compile` loads the manifest and emits one `stream` IR node with level 0 and no
  placement set. The session splices loaded tiles into that node as `placements` children. `planCommit` and the adapter
  see ordinary sets and need no change.
- One set per tile, keyed. A tile's key does not change while the manifest and the stream's types do not, so a stream
  step commits only the tiles added and removed (decision 5).
- The camera reads level 0, never the loaded copies. A focus that picks streamed populations frames their level-0
  envelopes, before and after any tile loads. So the camera does not move as tiles arrive, and the planner sees the same
  focus on every step.
- The budget is a hard cap on loaded level-1 copies. It is a session option, not a document field (§3.14: renderer
  settings stay out of the document).

#### 6.8.1 Source (`format/doc.ts`)

A model realizes streamed populations through a `stream` source. Its tiles are a resource of kind `placements`, format
`meso-tiles`. The host supplies the provider that reads that resource (`RuntimeOptions.tiles`), as it supplies `load`
for other resources.

```ts
// format/doc.ts
export interface Model {
  // … as today
  /** Streamed copies (design.md §6.8): the tiles of a `meso-tiles` resource, loaded by the host's provider. */
  readonly stream?: StreamSource;
}

export interface StreamSource {
  /** A resource of kind `placements`, format `meso-tiles`; its frame is the world frame (or none). */
  readonly resource: Id;
}
```

```lisp
(model m.tiles :kind precomputed :method meso.stream
  :populations [p.a p.b]
  :stream (:resource r.tiles))
```

- **A stream model** has `kind: 'precomputed'` and `method: 'meso.stream'`. No resolver of that id exists. `compile`
  never dispatches a model that has `stream`.
- **S-expression:** no codec change. The generic codec writes `stream` as a record (above), and a quick test round-trips
  it.
- **Static validation** (`validate.ts`, phase `static`; codes in `format/issues.ts`):
  - `stream.resource` names a resource (`ref.missing`) of kind `placements` (`ref.kind`) and format `meso-tiles`
    (`value.range`);
  - the model's `kind` is `precomputed` and its `method` is `meso.stream` (`value.range`);
  - the resource's `frame` is absent or the world frame (`stream.unsupported`);
  - the model has no `avoid` and no `refines`, and no model avoids or refines it (`stream.unsupported`): its copies
    would be whatever happens to be loaded;
  - no streamed population's entity has a `superstructure` (`stream.unsupported`);
  - at most one model in the document has `stream` (`stream.unsupported`);
  - its populations count as realized: `model.overlap` applies, `model.unrealized` does not, and no default resolver
    takes them.
- **New issue codes:** `stream.unsupported`, `stream.manifest` (the manifest is unavailable or invalid), `stream.tile`
  (a tile failed to load or disagreed with its manifest), `stream.budget` (one tile alone exceeds the budget).

#### 6.8.2 Manifest (`format/doc.ts`, the `meso-tiles` format)

The manifest is the format of the tile resource, so its types sit beside the document's. Coordinates are world Å. Tiles
are axis-aligned boxes; v0.4 refuses a stream in a rotated frame rather than transform boxes (above).

```ts
// format/doc.ts
/** An axis-aligned box, Å, world frame; `min[k] < max[k]` on every axis. */
export interface Box {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

export type StreamLevel = 0 | 1 | 2;

export interface TileManifest {
  readonly format: 'meso-tiles';
  /** Must hold 0 and 1, ascending, no repeats; 2 is declared only (an `info` issue: not loaded in v0.4). */
  readonly levels: readonly StreamLevel[];
  /** The box every tile lies in. */
  readonly bounds: Box;
  /** The populations the tiles hold, by document id: exactly the stream model's `populations`, in type order. */
  readonly populations: readonly Id[];
  /** In a fixed order: global copy ordinals follow it (below). */
  readonly tiles: readonly TileEntry[];
}

export interface TileEntry {
  /** Unique in the manifest; matches `IdPattern` (`t.3.0.7`). */
  readonly id: string;
  readonly box: Box;
  /** Level 0: copies per population (non-negative integers); a population absent from the record has none here. */
  readonly counts: Readonly<Record<Id, number>>;
  /** Level 0: where a population's copies are in the tile; default the tile's box. Inside `box`. */
  readonly envelopes?: Readonly<Record<Id, Box>>;
}
```

- **Validation** (`validateManifest(m, model, doc): Issue[]` in `validate.ts`, phase `load`, code `stream.manifest`,
  path `/models/<i>/stream`). It is synchronous and pure, and is called by `compile` once the provider returns the
  manifest:
  - `format` is `meso-tiles`;
  - `levels` holds 0 and 1, only values in {0, 1, 2}, ascending, unique; a 2 gives an `info` issue;
  - `bounds` and every box: six finite numbers, `min < max` on each axis;
  - every tile box lies inside `bounds` (tolerance 10⁻³ Å); tiles may touch; overlap is not checked;
  - `populations`: unique, and the same set as the model's `populations`;
  - at least one tile; tile ids match `IdPattern` and are unique;
  - `counts`: keys in `populations`, values non-negative integers;
  - `envelopes`: keys in `counts`, each box inside its tile's box (same tolerance).
- **An invalid or unavailable manifest** fails the stream model as a failed resolver does: its populations are achieved
  0, the issue says why, and the rest of the scene compiles.
- **Global ordinals.** A copy's ordinal is its index in the tile among its population's copies, plus the sum of that
  population's counts in the tiles before it in manifest order. Copy ids (`<population>#<ordinal>`, §7.2) are therefore
  unique and stable across loads and evictions.
- **Keys.** `streamKey = <model>@<contentHash({manifest, types})>` (`ir/hash.ts`; `types` is the stream's type table
  below, so an entity radius edit changes it). A tile's set key is `<streamKey>#<tileId>`, its IR ref
  `<model>/stream/<tileId>`. This follows §7.2's `<key>#<n>`, with the tile id as `n`.

#### 6.8.3 Provider contract (`runtime/streaming.ts`)

```ts
// runtime/streaming.ts
export interface TileProvider {
  /** The manifest; the provider memoizes it (compile asks on every model edit). Rejects: `stream.manifest`. */
  manifest(signal?: AbortSignal): Promise<TileManifest>;
  /**
   * A tile's copies at `level` (1 in v0.4). Rejects with an `AbortError` once `signal` aborts; a result that arrives
   * after the abort is ignored anyway. Any other rejection, an `AbortError` of the provider's own included (the
   * signal not aborted), and a throw before it returns a promise: `stream.tile`, and the tile is not asked for again
   * until the stream key changes.
   */
  load(tile: string, level: 1, signal: AbortSignal): Promise<TilePayload>;
}

/** A tile's copies, in the placement set's layout (design.md §4.2), world Å; the streamer adds the rest. */
export interface TilePayload {
  readonly count: number;
  /** x y z per copy. */
  readonly positions: Float32Array;
  /** x y z w per copy. */
  readonly rotations: Float32Array;
  /** Index into the manifest's `populations` (= the stream's type table) per copy. */
  readonly types: Int32Array;
}

// runtime/runtime.ts
export interface RuntimeOptions {
  // … as today
  /** The provider of a `meso-tiles` resource, by resource id; undefined: `stream.manifest` (unavailable). */
  readonly tiles?: (resource: Id) => TileProvider | undefined;
}
```

- **The streamer makes the set:**
  `{key, model, frame: 'world', count, positions, rotations, types, ordinals, typeTable}`. It shares the payload's
  buffers (no copy). It allocates `ordinals` and fills them with global ordinals. Every tile shares one `typeTable`
  object, the stream node's `types`, so MesoQL, looks and the adapter work unchanged.
- **A payload is checked before it is kept.** Buffer lengths must match `count`, every type must be in range, and the
  copies per type must equal the tile's manifest `counts`. Otherwise the tile is rejected (`stream.tile`, warning) and
  marked failed. A rejected tile never counts toward the budget.
- **Ownership.** The provider may cache raw data (HTTP, IndexedDB); nothing relies on it. The streamer owns residency: a
  tile is loaded exactly when its set is in the IR. Eviction removes it from the IR, and the adapter deletes its list
  (and store entry) as for any removed set. v0.4 keeps no CPU cache of evicted tiles: a tile seen again is loaded again.
- **Concurrency.** At most `maxInFlight` loads (default 4), started in the plan's order. One `AbortController` per load.
  The streamer aborts a load when the plan cancels it or the stream key changes. Each load carries the stream key and a
  generation number, and a result whose key or generation is stale is dropped.

#### 6.8.4 Planner and budget (`runtime/streaming.ts`)

`planStream` is pure and deterministic. It reads no clock and no randomness, and its output depends only on its
arguments, never on the order of `manifest.tiles`.

```ts
// runtime/streaming.ts
/** A sphere in world Å: the camera's target and its focus radius (0 for a numeric camera). */
export interface StreamFocus {
  readonly center: readonly [number, number, number];
  readonly radius: number;
}

export interface StreamState {
  /** Resident tiles and their copies. */
  readonly loaded: ReadonlyMap<string, number>;
  /** Tiles being loaded. */
  readonly pending: ReadonlySet<string>;
  /** Tiles that failed or were rejected: never planned again for this stream key. */
  readonly failed: ReadonlySet<string>;
}

export interface StreamBudget {
  /** Hard cap on resident level-1 copies plus copies in flight. */
  readonly copies: number;
  /** Å subtracted from a resident tile's distance (floored at 0), so a tile at the edge does not thrash. Default 0. */
  readonly hysteresis?: number;
}

export interface StreamPlan {
  /** The tiles wanted at level 1, nearest first: resident, pending and new. Their copies total at most the budget. */
  readonly want: readonly string[];
  /** To start loading, nearest first (want minus loaded, pending and failed). */
  readonly request: readonly string[];
  /** Resident tiles to drop now, farthest first. */
  readonly evict: readonly string[];
  /** Pending loads to abort. */
  readonly cancel: readonly string[];
  /** The tiles the focus sphere touches (distance ≤ radius). */
  readonly focus: readonly string[];
  /** Tiles shown at level 0 only once the plan is done: every tile not in `want`, in id order. */
  readonly level0: readonly string[];
  /** Copies of `want`: resident once the requests arrive. */
  readonly copies: number;
  /** A tile that alone exceeds the budget, when one stopped the walk (reported as `stream.budget`). */
  readonly overBudget?: string;
}

export function planStream(
  manifest: TileManifest,
  focus: StreamFocus,
  state: StreamState,
  budget: StreamBudget,
): StreamPlan;
```

The algorithm:

1. **Copies and distance.** `copies(t)` is the sum of the tile's `counts`. `d(t)` is the Euclidean distance from
   `focus.center` to the tile's box (0 inside or on it). For a resident tile, `d'(t) = max(0, d(t) − hysteresis)`;
   otherwise `d' = d`. Failed tiles are left out.
2. **Order.** Sort by (not a focus tile, `d'`, id) ascending, a focus tile being one with `d ≤ focus.radius` (step 4), so
   hysteresis never lets a resident tile push one out; ids compare by UTF-16 code units (`a < b`), never `localeCompare`.
3. **Walk, nearest first.** Add each tile's copies while the total stays at or under `budget.copies`, and stop at the
   first tile that does not fit. The walk never skips ahead to a smaller tile farther out, so the loaded region stays
   one shell around the focus.
   - A tile with 0 copies is wanted at no cost.
   - If the first tile that does not fit has more copies than the whole budget, it is `overBudget`. The walk stops there
     anyway: the cap is hard, so that tile stays at level 0 and the issue says so.
4. **Focus tiles.** `focus` is every tile with `d ≤ focus.radius`. A focus on a tile boundary has `d = 0` for the tiles
   on both sides, so both sort first and both are wanted when the budget allows. Ties at `d = 0` go by id.
5. **Diff.**
   - `request` is `want` minus resident, pending and failed, in `want` order.
   - `evict` is resident minus `want`, sorted by `(d, id)` descending: farthest first. A focus tile is never evicted
     while a non-focus tile is wanted, because focus tiles come first in the walk.
   - `cancel` is pending minus `want`.
6. **Level 0** needs no work: every tile is at level 0 from compile on, and level 0 never counts toward the budget.

- **Invariant (quick test):** after the session applies a plan, resident copies plus copies in flight are at most
  `budget.copies`. Evictions and cancellations apply in the same step that starts the requests, and `want`'s total is
  within the budget.
- **Budget 0** gives a level-0-only scene: no request.
- **No load radius.** The budget bounds the region. A distance cap and prefetch by camera velocity are not in v0.4.

#### 6.8.5 The IR, the session and the adapter

**The `stream` node** (`ir/ir.ts`), a child of the world frame node beside the `resolve` nodes:

```ts
// ir/ir.ts, added to IRNode
  | IRNodeOf<
    'stream',
    {
      readonly model: string;
      readonly resource: string;
      /** `<model>@<hash>`: tile set keys are `<key>#<tileId>`. */
      readonly key: string;
      readonly levels: readonly StreamLevel[];
      readonly bounds: Box;
      /** One per manifest population, in its order; shared by every tile's set. */
      readonly types: readonly PlacementType[];
      /** Level 0: the manifest's tiles (the same objects), with their counts and envelopes. */
      readonly tiles: readonly TileEntry[];
    }
  >
```

- At compile time the node has no children. `ir.streams` and per-model annotations were rejected: the node is the
  smallest thing that already sits in the tree, is walked by `placementSets`, and carries level 0 to any reader.
- **Who reads level 0:** the camera (below), the story's panel (counts by population, tiles), and `irToJson`. `irToJson`
  prints a stream node as `{model, key, levels, bounds, tiles: <n>, copies: <total by population>}`, not every tile. The
  Prism adapter does not draw envelopes in v0.4.
- **`compile`** (`runtime/runtime.ts`). For the stream model it calls `o.tiles?.(resource)?.manifest()` (phase `load`),
  then `validateManifest`, and builds `types` from the normalized populations as `meso.precomputed` builds its type
  table. It emits the node with no resolver run. `counts[p]` is `{requested, achieved}` with `achieved` the manifest
  total: level 0 is the realization. Constraints are not checked for streamed populations: their copies are given.
- **The paired examples** (`examples.test.ts`) leave the tiled fixture out: its IR is level 0 only, and its provider is
  code, not a file.

**Pure helpers** (`runtime/streaming.ts`):

```ts
/** The stream node of an IR (v0.4: at most one). */
export function streamNode(ir: IR): Extract<IRNode, { kind: 'stream' }> | undefined;

/**
 * The IR with `sets` as the stream node's `placements` children (refs `<model>/stream/<tileId>`), in manifest order.
 * Every other node keeps its object; the view is unchanged (call `updateView` after).
 */
export function withTiles(ir: IR, sets: ReadonlyMap<string, PlacementSet>): IR;

/** The tile's placement set from a checked payload: global ordinals, the stream's types, the key `<key>#<tile>`. */
export function tileSet(node: Extract<IRNode, { kind: 'stream' }>, tile: TileEntry, p: TilePayload): PlacementSet;

/**
 * The IR as the camera reads it: each stream node's tiles replaced by one proxy set (key `<key>#level0`) with one copy
 * per (population, tile) with a count > 0 (population-major, so a population is one run), at the envelope's centre, identity rotation, and its own type whose radius
 * is the envelope's half-diagonal (population, entity and compartment as the stream's type).
 */
export function level0IR(ir: IR): IR;
```

**The camera reads level 0.** `deriveCamera` (`runtime/runtime.ts`) materializes `focus`, and the scene centre for
`from outside`, over `level0IR(ir)` instead of `ir`. `lociSphere` then gives a sphere that holds the envelopes of the
streamed copies the address picks, together with the non-streamed copies it picks. The sphere is the same whether 0 or
all tiles are loaded. Addresses by ordinal (`(copies p.a 12)`) on a streamed population pick proxy rows, not copies:
this is a v0.4 limit, and the fixture's tour does not use them. Looks, selection and cutaway still read the real IR. The
camera gets its own materializer and loci cache over `level0IR(ir)`, and calls `lociSphere` with that same IR:
`deriveView`'s materializer is bound to the real IR and caches by address string, so a look and a focus with the same
address (`v.all`'s `(population p.a)`) would otherwise hand the camera real-IR loci that miss in the level-0 IR. The
proxy set is cached per stream node object (a `WeakMap`), since `updateView` runs at least twice an edit.

**The streamer** (`runtime/streaming.ts`) holds the state between steps and calls the provider. It imports nothing of
Mol\*:

```ts
export interface StreamOptions {
  readonly budget: StreamBudget;
  /** Default 4. */
  readonly maxInFlight?: number;
}

export interface StreamStats {
  readonly tiles: number;
  /** Resident now. */
  readonly resident: number;
  readonly inFlight: number;
  /** Cumulative since the stream key last changed; `requested` counts loads started (not plan entries). */
  readonly requested: number;
  readonly loaded: number;
  readonly evicted: number;
  readonly cancelled: number;
  readonly failed: number;
  /** Resident level-1 copies, the budget, and the copies level 0 stands for. */
  readonly copies: number;
  readonly budget: number;
  readonly level0Copies: number;
}

export class TileStreamer {
  constructor(
    tiles: (resource: Id) => TileProvider | undefined,
    options: StreamOptions,
    /** Called when a load settles; the session queues one stream step (coalesced). */
    onSettled: () => void,
  );
  /**
   * One step over a freshly compiled or view-updated IR. It takes in the arrivals still wanted, plans from
   * `ir.view.camera` (center = target, radius = focus radius or 0; no camera: the bounds' centre, radius 0), aborts
   * `cancel`, drops `evict`, starts `request` up to `maxInFlight`, and returns the IR with the resident tiles spliced
   * in (`withTiles`), the plan and issues (`stream.tile`, `stream.budget`; phase `load`). A changed stream key (or no
   * stream node) aborts everything and drops every resident tile first.
   */
  step(ir: IR): { readonly ir: IR; readonly plan?: StreamPlan; readonly issues: readonly Issue[] };
  /** Every issue standing for the stream key: failed tiles, the over-budget tile while it is over. `step` returns the new ones. */
  issues(): readonly Issue[];
  /** The viewer did not take the last step's IR: resident becomes the tiles `drawn` holds, the rest wait as arrivals. */
  restore(drawn: IR | undefined): void;
  stats(): StreamStats;
  dispose(): void;
}
```

**The session** (`molstar/src/session.ts`):

- `MesoSession` takes `stream?: StreamOptions`. When the options have `tiles` and `stream` is set, the session makes a
  `TileStreamer`.
- **Every edit runs the streamer before it commits.** A view edit runs `updateView`; a model edit runs `compile`. Then
  `streamer.step(ir)`, then `updateView(doc, stepped.ir)` (looks for the spliced sets), then `adapter.commit`. After a
  model edit with an unchanged stream key, `step` splices the same set objects back, so `planCommit` keeps them: no full
  rebuild.
- **Issues.** Each step replaces the session's `stream.tile` and `stream.budget` issues with `streamer.issues()`, so a
  model edit keeps a failed-tile warning. A stream step is recorded only when it adds, removes or reports something new.
- **A commit that throws.** The streamer goes back to what the viewer still shows (`restore(this.ir)`): a tile it took
  in that was not drawn is not resident, and the next step takes it in again. An edit's commit failure rejects the edit
  and changes nothing else (as before). A stream step's commit failure is a `render`-phase error issue
  (`adapter.failed`) on the session; nothing rejects, since no caller waits for a settled load.
- **A settled load queues a `stream` step** through the session's existing `queue`, so it never diffs against the same
  previous IR as an edit. Arrivals while a step is queued and not started join that step: one commit per burst. A stream
  step is `step(this.ir)` with the last IR's tile children ignored (the streamer splices its own), then `updateView`,
  then `commit`.
- **`EditRecord`** gains `kind: 'stream'` and
  `stream?: StreamStats & { readonly plan?: { readonly request: number; readonly evict: number; readonly cancel: number } }`.
- **A tour** is a sequence of view edits (`session.view` set to each step's view). Each edit moves the semantic camera
  (§5.1), and the step after it requests and evicts. The tour does not wait for tiles; arrivals commit as they come.
- **The panel reports**, from the last record and `streamer.stats()`: tiles requested, loaded, evicted, cancelled and
  failed (cumulative); resident tiles and in flight; resident copies against the budget (a bar); level-0 copies.

**The adapter needs nothing new.** `planCommit` sees tile sets as sets. Each stream step adds and removes lists by key,
and keeps the other lists' objects.

- **Known cost [measured]:** `looksChanged` is true whenever a set is added, so each step that adds a tile rewrites
  every list's looks (one `particles.look` call): 4,004 layers at 1,000 lists, 44 at 10. A remove writes none. Up to 100
  lists a remove stays at 5 ms or less and a color edit about 105 ms; at 1,000 they take 163 and 218 ms (§6.8.7, R5).

#### 6.8.6 Fixture (`spec/src/examples/streaming.ts`)

```ts
export interface TiledFixtureOptions {
  /** Tiles per axis; default [4, 4, 2]. */
  readonly grid?: readonly [number, number, number];
  /** Å, default 2000 (200 nm, the yeast viewer's tile). */
  readonly tileSize?: number;
  /** Copies a tile per population; default { 'p.a': 300, 'p.b': 100 }. */
  readonly perTile?: Readonly<Record<string, number>>;
  readonly seed?: number;
  /** For tests: ms before a load resolves (abort tests), and tiles whose load rejects. */
  readonly delayMs?: number;
  readonly fail?: readonly string[];
}

export function tiledFixture(o?: TiledFixtureOptions): {
  readonly doc: MesoViewSpecDoc;
  readonly provider: TileProvider;
};
```

- **The document:**
  - a world frame (right-handed);
  - a box compartment `c.box` over the grid;
  - entities `e.a` (radius 40 Å) and `e.b` (radius 60 Å);
  - populations `p.a` and `p.b` with `count` the grid total;
  - resource `r.tiles` (`placements`, `meso-tiles`), with no `uri`;
  - model `m.tiles` (above);
  - three instances as landmarks: `i.corner` inside the first tile, `i.middle` exactly on the boundary between two
    tiles, `i.far` in the last tile;
  - views: `v.all` (focus `(population p.a)`, `fit`), and `v.corner`, `v.middle` and `v.far` (focus on each landmark,
    `context`);
  - tour `t.stream`: `v.all`, `v.corner`, `v.middle`, `v.far`.
- **The provider** generates everything; there is no file.
  - The manifest is the grid in x, y, z order, with tile id `t.<i>.<j>.<k>` and envelopes equal to the tile box shrunk
    by the population's radius.
  - A tile's copies are uniform in its envelope with random unit quaternions, from `createRandom(subSeed(seed, tileId))`
    (`runtime/random.ts`). They are deterministic, need no overlap test, and are sorted by type.
  - `manifest()` is memoized.
- **Sizes:** the default is 32 tiles and 12,800 copies. The story uses budget 3,000 (7 tiles). The quick tests use
  `grid: [3, 3, 1]` and small counts.

#### 6.8.7 Tests and the R5 measurement

**quick** (`spec/src/_test/streaming.test.ts`, plus cases in `validate.test.ts` and `sexpr.test.ts`; the session's
streaming cases without a viewer are in `molstar/src/_test/session.test.ts`; the scaling guard, run by `test:scaling`,
is `spec/src/_test/streaming.scaling.ts`):

- **Static validation:** each `stream.*` rule above, on broken documents; a stream document round-trips through the
  S-expression.
- **`validateManifest`:**
  - levels without 0 or 1, an unknown level, repeats, a 2 (`info`);
  - a box with `min ≥ max`, a box outside `bounds`, an envelope outside its tile;
  - duplicate and malformed tile ids;
  - negative and fractional counts, an unknown population, a population set that differs from the model's.
- **Compile:** the stream model gives a `stream` node with level 0 and no placement set. Counts are the manifest totals,
  0 resolver runs, and no `model.unrealized`.
- **Planner:**
  - budget 0 gives no request;
  - requests come nearest first;
  - the budget is never exceeded, over a seeded set of 200 random foci and states;
  - a focus on a boundary wants both tiles;
  - eviction is farthest first, and the focus tiles stay;
  - a tile over the budget is skipped and `overBudget` is set;
  - the same arguments give the same plan, and so does a shuffled `manifest.tiles`;
  - hysteresis keeps a resident tile at a tie.
- **Sets:** global ordinals make copy ids unique across tiles. Keys are stable across two compiles. `withTiles` keeps
  every other node's object.
- **Camera:** a focus on a streamed population gives the same `IRView.camera` with 0 and with all tiles loaded.
- **Streamer**, with the fixture's `delayMs` and `fail`:
  - a tile evicted while in flight is aborted, and its late result is dropped;
  - a failed tile is reported once and not asked for again;
  - a payload whose counts disagree with the manifest is rejected;
  - a provider's own `AbortError` and a synchronous throw from `load` fail the tile, once, without a retry;
  - a stream key change clears the old key's issues; `issues()` keeps the standing ones across steps.

**integration (medium)** (`molstar/src/_test/streaming.test.ts`, headless Prism; the quick lane's session cases are in
`molstar/src/_test/session.test.ts`): `MesoSession` with the fixture
provider and the Prism adapter plays `t.stream`, then waits for the in-flight loads to settle.

- Every commit's `added` and `removed` are exactly the step's arrivals and evictions.
- Every kept tile keeps its list object (`listObject(key)` identity).
- Resident copies stay at most the budget at every commit.
- A model edit that leaves the stream alone (an added instance) keeps every tile list: `removed` holds no tile key.
- A view edit (a color) adds and removes no tile.

**performance (heavy)** (`molstar/src/_test/r5.perf.test.ts` for 1, 10 and 100 sets, `r5-1000.perf.test.ts` for 1,000, both
running the cases of `r5-cases.ts`; and the story's probe in the browser) is R5. 1M copies are
split into 1, 10, 100 and 1,000 placement sets by the fixture (one population, tile counts equal). For each split,
through the Prism adapter:

- commit time of the whole scene;
- the first frame and a steady frame (mean of 10), when a GL context exists (none in the run below);
- memory: placement and adapter bytes (exact), and the JS heap Δ after `gc()`;
- a stream step: add 1 set and remove 1 set at that split, which includes the looks rewrite;
- a color edit.

The numbers go into renderer-recommendations R5, with its conclusion. `MESO_PERF_OUT` writes them as JSON.

**Results [measured]** (headless Prism, M1 Pro, no GL context: no frame was drawn, so frame times are not measured; heap
Δ with `--expose-gc`; the cases run in files of their own, `molstar/src/_test/r5-*.ts`). Commit of the whole scene: 772,
1,540, 5,586 and 39,443 ms for 1, 10, 100 and 1,000 sets, about 36 ms and 0.1 MB of heap per list; placements (34.3 MB)
and adapter (7.6 MB) are the same at every split. A stream step stays small up to 100 sets (remove 5 ms, add 60 ms,
color 111 ms) and grows at 1,000 (remove 163 ms, add 108 ms, color 218 ms), since the looks are rewritten on every list.
The 1,000-set case peaks at about 6 GB of RSS. **[observed]** In the browser the _Streaming_ story keeps 7 tiles of 400
resident and commits only arrivals and evictions. Conclusion: per-list overhead is real for commit and memory; keep
resident lists at 100 or fewer; frame cost per list is still open (R5).

#### 6.8.8 Not in v0.4, and what it touches

**Not in v0.4:**

- level 2 (atoms at close range);
- prefetch, and priorities by camera velocity or view direction;
- a distance cap or a load radius beyond the budget;
- GPU culling per tile, and a list that grows by appending tiles (R5's recommendation);
- a network protocol or a tile file format: a provider is code, and a `meso-tiles` reader for HTTP comes later;
- more than one stream model, and streams in rotated frames;
- streamed superstructures, and streamed models in `avoid` or `refines`;
- a CPU cache of evicted tiles;
- envelopes drawn in the viewer;
- camera addresses by ordinal on streamed populations.

**Touched files** (production, about 600 lines [target]):

| File                                              | What                                                                              | Lines [target] |
| ------------------------------------------------- | --------------------------------------------------------------------------------- | -------------- |
| `spec/src/format/doc.ts`                          | `StreamSource`, `Model.stream`, `Box`, `StreamLevel`, `TileManifest`, `TileEntry` | 40             |
| `spec/src/format/issues.ts`                       | four `stream.*` codes                                                             | 5              |
| `spec/src/format/validate.ts`                     | the static rules; `validateManifest`                                              | 90             |
| `spec/src/ir/ir.ts`                               | the `stream` node; `irToJson`'s summary                                           | 25             |
| `spec/src/runtime/runtime.ts`                     | `RuntimeOptions.tiles`; the stream node in `compile`; the camera over `level0IR`  | 60             |
| `spec/src/runtime/streaming.ts` (new)             | provider types, `planStream`, `withTiles`, `tileSet`, `level0IR`, `TileStreamer`  | 260            |
| `spec/src/examples/streaming.ts` (new)            | `tiledFixture`                                                                    | 90             |
| `molstar/src/session.ts`                          | the streamer in `run`, the `stream` step, `EditRecord.stream`                     | 50             |
| `molstar/src/_stories/streaming.stories.ts` (new) | the _Streaming_ story: tour, panel (not counted)                                  | —              |

`resolvers/`, `ir/loci.ts` and `runtime/adapter.ts` do not change.

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

| Item                                      | Budget | Status                          |
| ----------------------------------------- | ------ | ------------------------------- |
| Placements                                | 36 B   | met, exactly                    |
| Adapter additions                         | ≤ 8 B  | met                             |
| Renderer, everything else on the CPU side | ≤ 64 B | not established; see 8.2 and R3 |

**What that allows:**

- S and M fit comfortably: 1M copies ≈ 108 MB.
- **L does not fit as one scene** at the budget's 108 B a copy: 2.5 × 10⁷ × 108 B ≈ 2.7 GB. L needs tiles or streaming,
  which is how the yeast viewer itself stores its model (200 nm tiles). (v0.4) Streamed by tiles within a copy budget
  (§6.8); decision 5.

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

| Measure                                                 | Result                                                                                                                  |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Packing 5k / 20k / 80k copies (15% volume fraction)     | 34 / 64 / 257 ms; 6.9 / 3.2 / 3.2 µs a copy: linear once warm (the 5k run includes JIT warm-up)                         |
| Bilayer, 1,000,038 lipids                               | 145 ms to resolve; 34.3 MB of placements; ArrayBuffer growth 30.7 MB (allocated once; GC noise)                         |
| On the 1M scene: view edit (`updateView`)               | 0.1 ms; (v0.2) 2.8 ms now that looks are MesoQL addresses: one O(N) scan a set for its type runs, cached, then O(types) |
| On the 1M scene: cached compile of a recolored document | 0.4 ms, 0 resolver runs                                                                                                 |
| On the 1M scene: `planCommit`                           | 0.1 ms                                                                                                                  |

**Adapter and renderer (Node + headless `gl`, `molstar/src/_test/perf.test.ts`):**

| Scene      | Resolve ms | Commit ms | First image ms | Color commit ms | Image after the color ms |
| ---------- | ---------- | --------- | -------------- | --------------- | ------------------------ |
| pack 50k   | 183        | 274       | 909            | 9.4             | 292                      |
| bilayer 1M | 154        | 784       | 2442           | **112**         | 1709                     |

**Browser (Storybook _Performance › Probe_):**

| Scene                                                | Copies    | Resolve ms | Commit ms | First frame ms | Color edit ms (to the frame) | Lists rebuilt by the color | Placements | Adapter adds | JS heap Δ |
| ---------------------------------------------------- | --------- | ---------- | --------- | -------------- | ---------------------------- | -------------------------- | ---------- | ------------ | --------- |
| pack                                                 | 10,000    | 31         | 97        | 15             | 22                           | none                       | 0.3 MB     | 0.1 MB       | 2.0 MB    |
| pack                                                 | 50,000    | 137        | 12        | 8              | 16                           | none                       | 1.7 MB     | 0.4 MB       | 7.8 MB    |
| bilayer                                              | 100,037   | 14         | 19        | 5              | 13                           | none                       | 3.4 MB     | 0.8 MB       | 26.0 MB   |
| bilayer                                              | 1,000,038 | 113        | 104       | 29             | **49**                       | none                       | 34.3 MB    | 7.6 MB       | 129.2 MB  |
| bilayer, again, with `gc()` before each heap reading | 1,000,038 | 113        | 111       | 35             | **81**                       | none                       | 34.3 MB    | 7.6 MB       | 62.8 MB   |

A second run of both Node lanes on the same machine gave the same picture: a 1M color commit of 109 ms, 8.6 ms at 50k,
and packing at 3.2–3.9 µs a copy. Timings vary by about 15% from run to run; the byte counts do not.

Notes on the browser table:

- The first run's commit includes loading Prism's lazy particles feature: 97 ms here, 243 ms on a cold load.
- **[fixture]** Exosome slice (Node): 3 resolver runs, 335 ms in all.
  - `m.recipe` takes 300 ms of that, mostly mesh inside-tests against a 320-triangle surface.
  - The other two are `m.picks` (0.7 ms) and the bilayer (88,666 lipids, 33 ms).

**What the numbers say:**

1. **The runtime side holds.** No copies, linear resolution, and view edits independent of N.
2. **A color edit is O(N) inside Mol\*'s graphics** (profiled: per-copy loci painted into overpaint; Prism and the state
   take under 1.5 ms). 9.4 ms at 50k, 112 ms at 1M (Node); 49–81 ms to the frame at 1M (two runs) in the browser. That
   misses the 16 ms target at 1M. Renderer finding R1.
3. **Memory per copy beyond the IR is not established.** Without a GC before reading, the 1M scene's heap Δ was 129 MB
   (87 B a copy beyond the placements and the adapter); with one, 63 MB (21 B a copy). The JS heap may not count
   ArrayBuffer backing stores and GPU memory is unmeasured, so this needs a heap snapshot and the WebGL allocations
   (R3).

The GC-dependent heap numbers are approximate. The placement and adapter numbers are exact.

**(v0.4) One list per tile:** 1M copies as 1 to 1,000 lists, commit, stream step, color edit and memory: §6.8.7 and
renderer-recommendations R5.

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
| _Superstructures and addresses › Beta cell_ (v0.2)                        | 120 insulin granules from Ludo's ISG recipe, resolved once: a slider for the count (only the cell packing reruns), a switch between parts and one body a granule (nothing reruns), the expansion Prism needs reported                                                                                                                                                                                                                                                   |
| _Superstructures and addresses › Addresses (exosome, β-cell)_ (v0.2)      | type a MesoQL address: its canonical form, its issues, its MesoLoci (copies, sets, runs, time) and the first copies by stable id, nested ones included; the reference generated from the table                                                                                                                                                                                                                                                                          |
| _Resolver mocks › Relations: HU bends DNA_ (v0.2)                         | HU on a DNA strand by its sites, a slider for the bend angle; IHF's residue-only site reported                                                                                                                                                                                                                                                                                                                                                                          |
| _Thin slice_ (v0.2 additions)                                             | the S-expression spelling in every panel with a JSON toggle; an "Add a relax stage" button (composition: the packing is a cache hit, the constraint becomes met)                                                                                                                                                                                                                                                                                                        |

**Checked in a browser:** (v0.2) the new stories and the S-expression panels were loaded in headless Chromium too,
without a console error. Before that, I loaded all 13 stories in headless Chromium through Playwright, and the probe
headed. None raised a console error. I looked at screenshots of the thin slice, the probe and the Fibers mock; the
Fibers mock exposed the adapter's `excludeFibers` bug (§11).

**Run them:** `pnpm -C storybook storybook` (port 6006), or `npx storybook dev -p 6011` in `storybook/`.

## 10. Test lanes

| Lane                                | Command                                                                                                                                                     | What it verifies                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **quick** (default; 76 tests, ~8 s) | `pnpm test:unit packages/mesoscale`                                                                                                                         | **Validation:** every rule, on broken documents. **Units and imports:** counts from concentrations and densities; the cellPACKgpu import (both count rules, the surface unit). **Provenance:** traces. **Determinism:** the same placements from the same document. **Edits:** a color edit is 0 resolver runs with the same placement objects; a density edit is 1 run, the right one. **Scene:** an unmet constraint with its reason; procedural copies avoid the picks; frames carry the picks from voxels to world Å; membrane orientation; 36 B a copy. **Runtime:** dispatch by arrangement; nesting, lattices, fibers, bilayers; the yeast document's issues; a toy resolver plugged in. **Mol\* side:** the paired example files are current; the MVS export validates; STAR rotations match Mol\*'s; the particle list shares the IR's buffers |
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
- **(v0.2) The same keyed runtime carried superstructures, relations and refine stages** without a new mechanism: a
  superstructure is a sub-document resolved with the same cache, a relation is resolver input, a refine stage is a model
  whose key includes its upstream's.
- **(v0.2) Runs as the materialized address.** Every address the examples use is one run a population, which keeps view
  edits O(types) after one scan a set.

- **(v0.3) Addresses carried the camera and identity.** The semantic camera is one more consumer of MesoLoci, and
  instances are populations of one to everything after the runtime's first step.

**Gaps the prototypes exposed:**

| Gap                                                                         | Layer                | Note                                                                                                          |
| --------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------- |
| A helical lattice on a tube (microtubules, 13 protofilaments)               | language             | `fiber` is one copy per rise; MesoCraft's Symmetry Assembly is the model                                      |
| Distributions for arrangement parameters (MesoCraft's uniform, Gaussian)    | language             | numbers only today                                                                                            |
| Skeletons that are not compartments; paths between two addresses            | language             | MesoCraft's skeletons and Connection rule (§3.12)                                                             |
| `branches` and `contacts` relations                                         | resolver             | reported as not reconciled; no resolver grows branches or simulates beads                                     |
| Superstructure detail per view (LOD)                                        | language / adapter   | `detail` is per population; "depending on context" suggests the view chooses                                  |
| Partial looks (copy runs)                                                   | adapter              | Prism layers select whole targets (renderer R8)                                                               |
| Nested instancing                                                           | renderer             | the adapter expands instances × template (renderer R7)                                                        |
| Membrane proteins overlap lipids (up to 28 Å on the exosome)                | resolver             | the bilayer is drawn without the proteins' footprints; no resolver packs lipids around them                   |
| `meso.relax` rebuilds sets type by type                                     | resolver             | a refined fiber's CSR would need remapping; the prototype refines packings only                               |
| Catalogs                                                                    | runtime              | not expanded (§3.6)                                                                                           |
| Segmentation surface extraction                                             | resolver             | prototype takes meshes only                                                                                   |
| Mesh inside test is O(triangles)                                            | resolver             | (v0.2) signed distance grids for the relax stage; the packer still uses the exact test                        |
| Random sequential addition stops at a give-up heuristic                     | resolver             | (v0.2) answered by composition: a `meso.relax` stage reaches 506/506 (§6.7)                                   |
| `min-distance` constraints and relations are reported, not honoured         | resolver             |                                                                                                               |
| Representations beyond spheres, clipping, drawn annotations                 | adapter / view state |                                                                                                               |
| The camera snapshot needs the scene radius                                  | adapter              | fixed: a radius left from a smaller scene clipped the front of a larger one                                   |
| Particle spacefill hides fiber particles by default                         | adapter              | fixed: the Fibers mock showed an empty view until the adapter set `excludeFibers: false` for sets with fibers |
| Prism's particles feature is lazy                                           | adapter              | an in-memory list needs `extensions.load('particles')` first                                                  |
| In-memory data enter `mol-state` only through a side store keyed by a param | plugin API           | renderer-recommendations R6                                                                                   |
| `cached` is part of the IR                                                  | IR                   | it makes two IRs of the same document differ by history; it should move to the stats                          |
| `View.frame` is declared but not applied                                    | runtime              | (v0.3) fixed: a numeric camera is placed by its view's frame matrix (§5.1)                                    |
| Selection and annotations are derived, not drawn                            | adapter              | `IRView.selection` and `.annotations` reach the adapter, which ignores them                                   |

**Open decisions for David:**

1. **Placement frames.** The prototype bakes every placement set into the world frame at resolution, and `frame` nodes
   record the matrices. (v0.2) Superstructure instances already carry their frames to the renderer (§3.9). Bake plain
   sets, or carry every frame?
2. **Catalogs.** Runtime expansion into populations, or a resolver input?
3. **Derived results as resources.** Store a resolution as a `placements` resource with `derivedFrom: {model, key}`, so
   an expensive procedural result (cellPACKgpu on a GPU) can be shipped and replayed?
4. **Representation hints.** The hint exists (§5) and falls back to spheres. Which hints must an adapter honour, and
   should a document be able to state a fallback chain (SeqViewSpec's)?
5. **L scenes.** Tiles as a first-class IR concept (a set per tile, keyed), or a renderer-side streaming source?
   **(v0.4) Decided for the IR:** one placement set per tile, keyed `<model>@<hash>#<tileId>`, spliced under a `stream`
   node by the session, so `planCommit` commits only the tiles added and removed and every adapter gets streaming for
   free (§6.8). **Still open:** whether a renderer should hold thousands of tiles as thousands of lists, or one list
   that grows and is culled per tile (renderer-recommendations R5: commit and memory grow per list, about 36 ms and 0.1
   MB each; frame cost not measured); a tile file format and its network protocol.
6. **Patches and history.** Patches over one tree for snapshots and undo (SeqViewSpec: `applyPatch`, `diff`, inverses),
   or whole documents with `classifyEdit`, as the prototype does?
7. **Schema.** JSON Schema or OpenAPI published (as MolViewSpec), or reference tables generated from the types (as
   SeqViewSpec)?
8. **(v0.2) Detail per view.** Is `parts` vs `entity` a population's property (now) or a view's (David's "depending on
   context")? A view-level choice needs both levels resolved, or resolution on demand.
9. **(v0.2) Derived products.** Should a document declare derived products (a simulated tilt series of the model, for
   training data, Ludo's twin) as activities whose outputs are resources, so the model and its synthetic data share one
   provenance graph?
10. **(v0.2) MesoQL storage.** The canonical S-expression string (now) or a JSON tree with full names (SeqQL)?
11. **(v0.2) Authoring by agents and by hand.** Painting (cellPAINT-style strokes) and agent edits as `activities` with
    an `agent`, their result a precomputed model: is that enough to keep hand-made placements inspectable and
    replayable?
12. **(v0.3) Organization at the top, populations as one way to state copies.** David: "a population is just how we do
    things now because we can't represent every atom individually". v0.3 adds instances beside populations and
    superstructures (§3.13) without moving anything. The larger change is to put the organization (the copies, however
    stated) at the centre of the document and let each way of stating them be a source. A hypothesis that ties this to
    streaming (decision 5): **level 0 is statistical** (a population: counts and arrangement, no poses), **level 1 is
    copies** (poses, from a resolver, a file or instances), **level 2 is atoms** (the structures at those poses). A
    viewer far away needs level 0, then streams level 1 where the camera looks, then level 2 close up. Restructure the
    top level, or keep the sections and treat the levels as a runtime concept? **(v0.4) The levels are decided as a
    runtime concept:** a stream's manifest declares them; level 0 (counts and envelopes per tile and population) is
    always in the IR and is what the camera reads; level 1 is loaded within a copy budget; level 2 is declared and
    refused (§6.8). The document's sections do not move. **Still open:** whether to restructure the top level around the
    organization; level 2 (atoms close up); whether a population or an instance could itself be a stream's level 0
    (today only a stream model's manifest is).

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
- **Enforcement.** "No Mol\* imports" is enforced: a Biome `noRestrictedImports` override for
  `packages/mesoscale/spec/src/**` (`biome.json`), as the AI package has one.

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

**Found after the first draft:**

- **Ivan's paper: MesoCraft.** D. Jia, A. Kouyoumdjian, O. Strnad, U. Smajdek, C. Bohak, D. Bayraktar, A. Esparza, P.
  Mindek, T. Klein, S. T. Arold, I. Viola. _MesoCraft: a web-based tool for interactive procedural modeling of mesoscale
  biological structures._ arXiv 2610.37954, https://arxiv.org/html/2610.37954v1. Mapped in §3.12. Its rule framework
  extends Nguyen et al. 2021 (_Modeling in the time of COVID-19: statistical and rule-based mesoscale models_, IEEE TVCG
  27(2)).
- **Ludo's NIH research strategy** (`~/Documents/MIRA/02_Research_Strategy/03_Research_Strategy_DRAFT_v17.md`): the
  bidirectional coupling of mesoscale models and cryo-ET (synthetic tomograms from lab-built models as training data),
  the motivation for open decision 9.

**Was missing in the first draft:**

- **Ivan's paper: not found.**
  - Not among the local PDFs. The Obsidian vault was unreachable (its local API refused connections).
  - The candidates in `apps/prism-me/_spec/references.bib` are Klein2018 (_Instant Construction and Visualization of
    Crowded Biological Environments_, closest to recipes and building) and Alharbi2025 (_Nanouniverse_, closest to
    instancing at scale).
  - To do: confirm which one is meant and add it here.
