# MesoViewSpec: The document

What a MesoViewSpec document means: its nodes, what each says, and what it leaves out. The concepts and terms are in
[README.md](README.md); the reasons and the numbers are in [design.md](design.md).

## Shape

A document is plain JSON:

```
{ format: "meso_view_spec", version, revision?, metadata, units?,
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

  The tree belongs in the [IR](ir.md).

- **`custom` is keyed by namespace** (as in SeqViewSpec), so an unknown extension is kept and ignored.
- **Versioning:** semver. From 1.0 a minor version only adds; while the format is 0.x a minor version may break (0.2
  made looks MesoQL strings instead of selector objects), with no upgrade path yet. A newer major version is refused
  (`format.version`).

## Biology

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
- **IR `resolve` node.** The params go into its normalized `input`, where they are visible and hashed
  ([ir.md](ir.md#construction-details-live-in-resolve-nodes)).

## Resources in their native formats

A `Resource` is `{kind, format, uri | accession, frame, checksum, license, select}`. The document never copies data.

- **`kind`:** tilt-series, tomogram, segmentation, mesh, structure, recipe, placements, volume, table, document,
  dataset, …
- **`format`:** the community's own name: `mrc`, `star`, `obj`, `pdb-id`, `cellpack-gpu-serialized`, `paxdb-tsv`, …
- **`select`:** picks a part of a resource: a segmentation label, a STAR table, an mmCIF assembly.
- **`uri`:** a relative `uri` resolves against the document's own location (its file's folder, or its URL), by the CLIs
  and prism-me's open. `fixture://x` is `fixtures/x` beside the document. A document in a repository names its files
  from where it lies (the committed examples: `../spec/src/examples/fixtures/…` for the recipes, `fixtures/…` for the
  meshes and tables). A CLI's `--base dir` (repeatable) overrides: it is tried before the document's folder.
- **Readers** turn raw content into what resolvers use (`runtime/readers.ts`: STAR, OBJ, cellPACKgpu JSON, placement
  JSON). They are pluggable, like resolvers.

## Frames and alignment

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

## Evidence, provenance, tracing

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

## Catalogs (a gap the yeast cell exposed)

- **The problem.** A proteome is 5,638 species: too many to list as populations, and as data they belong in a table.
- **The prototype's answer.** `catalogs[]`: `{resource, columns, abundanceKind}`, one row per population.
- **The gap.** The runtime has no catalog expander yet and says so (`catalog.unexpanded`).
- **Open:** expand catalogs in the runtime (a reader that emits populations), or let a resolver consume them directly.

## The S-expression spelling (`format/sexpr.ts`)

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
- **Patches** print as
  `(patch :base r1 :revision r2 :ops [(set l.catalase :fields (:color #ff0000)) (remove an.picks)])` (`printPatch`,
  `readPatch`, `PatchCodec`): an op is headed by its name with the id it addresses first; an inserted `node` is a
  record, so its fields keep their order. A look with an id prints as `(look l.x …)` (`looks` is a section of the
  codec); one without, as a record.
- **Layout:** SeqQL's printer rules (positionals then keywords, one line when it fits 80 columns), Lisp indentation.
- **Tested:** `read(print(json))` equals `json` and `print(read(text))` is a fixed point, on all five example documents
  and their IR summaries (`_test/sexpr.test.ts`).
- **Not done:** the S-expression is not yet editable in the stories (they display it); the reader exists for that.

## Superstructures: reusable, nested, instanced (`Superstructure`)

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

## By value or by reference

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

## Relations as constraints with addresses

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

## Instances: copies stated one by one (`Instance`)

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
read by `meso.precomputed` ([runtime.md](runtime.md#procedural-and-precomputed-models-together)). A pose is in the world
frame, or in `frame`'s own coordinates (a tomogram's voxels).

## Builder (`builder/`)

A document written in TypeScript, as Seq\*'s builder (`@molstar/seq-core/builder`). A builder is not part of the format:
a document from it means what the literal means. Nothing is added, empty optional sections are left out, sections come
in the order of `MesoViewSpecDoc`, the nodes of a section in the order they were made, a node's keys `id` first and then
in the order the caller wrote them, a superstructure's in `Superstructure`'s order (the S-expression print follows the
order).

```ts
const b = createMesoDocument({ title: 'β-cell slice', organism: { name: 'Mus musculus', taxon: 10090 }, units: { length: 'nm' } });
const granule = b.entity({ id: 'e.granule', label: 'insulin secretory granule', kind: 'assembly', superstructure: ss.ref });
const cell = b.compartment({ id: 'c.cell', label: 'β-cell', kind: 'cell', geometry: { kind: 'sphere', radius: 1500 } });
const granules = b.population({ id: 'p.granules', entity: granule, compartment: cell, location: 'interior', abundance: { count: 120 } });
b.view({ id: 'v.g12', camera: { focus: q.part(q.copies(granules, 12), vamp2), framing: 'context' }, looks });
const { doc, issues } = b.build();
```

- **Refs.** A node call returns the node's ref: its id, branded by the kind of node and by its scope (`doc`, or `inner`
  inside a superstructure, as `validate`'s two indexes, §3.9). A slot that holds an id takes a ref of its kind and
  scope, never a plain string: a population where a compartment is wanted, or a compartment of the document inside a
  superstructure, is a TypeScript error (`_test/builder.types.test.ts`, run by `tsc -p spec/tsconfig.test.json`). A ref
  is a string at run time. An entity's ref carries the names of its declared `sites`, so `q.site(e, 'name')` is checked.
- **Where a string becomes a ref.** `get(kind, id)`: a node added elsewhere or made later (a cycle between an activity
  and what it generated); `add(section, nodes)`: nodes made elsewhere (an importer's), copied as they are, their ids
  registered; the node `get` names is made with that id given explicitly (a label's generated id would skip it, the id
  being reserved). The MesoQL slots (`select`, `focus`, `cutaway`, `target`, `entry`) stay `MesoQL` strings. `validate`
  checks all three (`ref.missing`, `ref.kind`, `mesoql.*`). A ref of another builder is not a TypeScript error.
- **Ids.** An id nobody gave is made from the label (`insulin granule` → `e.insulin-granule`), else from what the node
  refers to (a population `p.<entity>`, a relation `rel.<subjects>-<kind>-<objects>`, an alignment, a resource by its
  accession or format), else counted. Prefixes: `f. al. r. e. s. c. p. i. cat. rel. m. ev. act. v. an. t.`. A slug is
  lowercase ASCII words joined by `-`, at most 40 characters, cut on a word. A taken id takes `-2`, `-3`. An id depends
  on the calls and their order only, one registry per builder. An explicit id is kept as given (a duplicate is
  `id.duplicate` at build). Site and state ids are not document ids.
- **Superstructures.** `superstructure()` returns a builder for its compartments, populations, models, relations and
  entities, whose refs are `inner`. Nesting is an entity whose `superstructure` is its `ref`.
- **MesoQL.** `q` has one helper per symbol of `MesoQLSymbols`, typed by the refs the symbol takes, printing the text
  `printMesoQL` prints; a test checks that every symbol has a helper and that the output parses and prints back.
- **`build()`** returns `{ doc, issues }`: `validate`'s issues, never thrown, callable again.

## Not in the document

- placements and other derived results;
- renderer settings: representation types, LOD, quality;
- transient UI state.

See [views.md](views.md#session-state-what-one-document-restores).

## Units

- **The document** chooses its length unit (`units.length`: A, nm or µm; nm by default). A `{value, unit}` quantity
  overrides it.
- **Other quantities:** concentrations in nM, µM, mM or M; densities per nm² or per µm² (per leaflet for a bilayer);
  masses in Da, kDa or MDa.
- **The IR is in Å.** Every structure and every renderer we target already is.
- **Conversion happens once,** when the runtime normalizes (`format/units.ts`). Resolvers and adapters never see a
  document unit.
