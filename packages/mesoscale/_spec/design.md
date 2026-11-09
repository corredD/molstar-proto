# MesoViewSpec: design

A prototype of a declarative format for mesoscale science, with its IR and a small runtime, built to test the design.
For David's review. Renderer findings are in a separate document,
[renderer-recommendations.md](renderer-recommendations.md), to discuss with Alex.

- **Status:** a prototype on branch `me/mesoviewspec` (worktree `~/prism-me-lanes/mesoviewspec`, off `prism-me`). It is
  not pushed. Nothing in Mol\* itself was changed.
- **The spec** is [README.md](README.md) and its topic files; this document is its design record: why, the numbers and
  the decisions. Each section moved to a topic file leaves its heading here, linked.
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
| MesoQL: addresses, MesoLocation and MesoLoci (runs)                              | §3.8    | built: 14 symbols, views use it                             |
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

### 3.1 Shape → [format.md](format.md#shape)

### 3.2 Biology → [format.md](format.md#biology)

### 3.3 Resources in their native formats → [format.md](format.md#resources-in-their-native-formats)

### 3.4 Frames and alignment → [format.md](format.md#frames-and-alignment)

### 3.5 Evidence, provenance, tracing → [format.md](format.md#evidence-provenance-tracing)

### 3.6 Catalogs (a gap the yeast cell exposed) → [format.md](format.md#catalogs-a-gap-the-yeast-cell-exposed)

### 3.7 The S-expression spelling (`format/sexpr.ts`) → [format.md](format.md#the-s-expression-spelling-formatsexprts)

### 3.8 MesoQL: addresses, MesoLocation, MesoLoci (`format/mesoql.ts`, `ir/loci.ts`) → [mesoql.md](mesoql.md#mesoql-addresses-mesolocation-mesoloci-formatmesoqlts-irlocits)

### 3.9 Superstructures: reusable, nested, instanced (`format/doc.ts` `Superstructure`) → [format.md](format.md#superstructures-reusable-nested-instanced-superstructure)

- **Measured [fixture]:** the β-cell example (`examples/betacell.ts`) imports the granule from Ludo's cellPACKgpu ISG
  recipe (trimmed to Vamp2, Rab3a, Chga, Scg2: 2,229 copies) and places 120 granules. The template resolves once; more
  granules rerun only the cell's packing; `detail: entity` reruns nothing and keeps the granules' poses. The IR holds 83
  kB for the granules; expanded for Prism they are 267,480 copies, 9.2 MB (renderer finding R7).
- **Answers open decision 1 (placement frames) for superstructures:** frames travel (instances are poses in the IR), and
  the adapter expands only because Prism cannot instance lists. Plain placement sets stay baked in the world frame.

### 3.10 By value or by reference → [format.md](format.md#by-value-or-by-reference)

### 3.11 Relations as constraints with addresses → [format.md](format.md#relations-as-constraints-with-addresses)

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

### 3.13 Instances: copies stated one by one (v0.3, `Instance`) → [format.md](format.md#instances-copies-stated-one-by-one-instance)

### 3.14 Not in the document → [format.md](format.md#not-in-the-document)

### 3.15 Builder (`builder/`) → [format.md](format.md#builder-builder)

## 4. The IR (`ir/ir.ts`, `ir/placements.ts`)

### 4.1 A tree in the manner of `mol-state` → [ir.md](ir.md#a-tree-in-the-manner-of-mol-state)

### 4.2 One leaf: the placement set → [ir.md](ir.md#one-leaf-the-placement-set)

### 4.3 Construction details live in `resolve` nodes → [ir.md](ir.md#construction-details-live-in-resolve-nodes)

### 4.4 The cases → [runtime.md](runtime.md#which-resolver-by-case)

### 4.5 Procedural and precomputed models together → [runtime.md](runtime.md#procedural-and-precomputed-models-together)

- **Saved results can stand in for procedural ones** (cache-as-precomputed). A procedural result could be saved as a
  `placements` resource with `custom.meso.derivedFrom: {model, key}`; on load, a matching key would replace resolution.
  This is not built: §11, open decision 3.

## 5. Session state: what one document restores → [views.md](views.md#session-state-what-one-document-restores)

### 5.1 The semantic camera (v0.3, `Camera`, `Tour`) → [views.md](views.md#the-semantic-camera-camera-tour)

## 6. Runtime contracts

### 6.1 Pipeline (`runtime/runtime.ts`, `compile`) → [runtime.md](runtime.md#pipeline-runtimeruntimets-compile)

### 6.2 The resolver contract (`runtime/resolver.ts`) → [runtime.md](runtime.md#the-resolver-contract-runtimeresolverts)

### 6.3 Resolvers in the prototype → [runtime.md](runtime.md#resolvers-in-the-prototype)

### 6.4 Plugging in a recipe kind: cellPACKgpu → [runtime.md](runtime.md#plugging-in-a-recipe-kind-cellpackgpu)

**Comparison with Mesoscope.** Mesoscope's serialized parser (`~/Developments/mesoscope/js/cp_serialized.js`,
`parseCellPackRecipeSerialized`) and its LLM authoring rules (`SKILLS.md`: an evidence CSV with confidence and
references for each ingredient) are the authoring side of the same data. Its evidence CSV maps one-to-one onto
`Evidence` plus population fields.

### 6.5 The renderer adapter contract (`runtime/adapter.ts`) → [runtime.md](runtime.md#the-renderer-adapter-contract-runtimeadapterts)

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

### 6.7 Application composition: refine stages → [runtime.md](runtime.md#application-composition-refine-stages)

- **Measured [fixture]:** on the exosome, the recipe's packing stops at 354 of 506 catalase; adding `m.relax` inserts
  152, converges in 41 iterations, then checks every copy against the exact mesh with its margin (and against the
  compartments it must stay out of, with theirs); it meets 506 of 506 with a largest overlap of 0.78 Å measured after
  the last step (tolerance 1 Å) and no copy outside the membrane. Lipids are not part of the check: the bilayer is drawn
  without the proteins' footprints (a gap, §11). The packing is a cache hit when the stage is added. mesobuild's
  `relax.py` reached 506 of 506 on the same recipe.

### 6.8 Streaming (v0.4) → [streaming.md](streaming.md#streaming)

#### 6.8.1 Source (`format/doc.ts`) → [streaming.md](streaming.md#source-formatdocts)

#### 6.8.2 Manifest (`format/doc.ts`, the `meso-tiles` format) → [streaming.md](streaming.md#manifest-formatdocts-the-meso-tiles-format)

#### 6.8.3 Provider contract (`runtime/streaming.ts`) → [streaming.md](streaming.md#provider-contract-runtimestreamingts)

#### 6.8.4 Planner and budget (`runtime/streaming.ts`) → [streaming.md](streaming.md#planner-and-budget-runtimestreamingts)

#### 6.8.5 The IR, the session and the adapter → [streaming.md](streaming.md#the-ir-the-session-and-the-adapter)

#### 6.8.6 Fixture (`spec/src/examples/streaming.ts`) → [streaming.md](streaming.md#fixture-specsrcexamplesstreamingts)

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
`molstar/src/_test/session.test.ts`): `MesoSession` with the fixture provider and the Prism adapter plays `t.stream`,
then waits for the in-flight loads to settle.

- Every commit's `added` and `removed` are exactly the step's arrivals and evictions.
- Every kept tile keeps its list object (`listObject(key)` identity).
- Resident copies stay at most the budget at every commit.
- A model edit that leaves the stream alone (an added instance) keeps every tile list: `removed` holds no tile key.
- A view edit (a color) adds and removes no tile.

**performance (heavy)** (`molstar/src/_test/r5.perf.test.ts` for 1, 10 and 100 sets, `r5-1000.perf.test.ts` for 1,000,
both running the cases of `r5-cases.ts`; and the story's probe in the browser) is R5. 1M copies are split into 1, 10,
100 and 1,000 placement sets by the fixture (one population, tile counts equal). For each split, through the Prism
adapter:

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

#### 6.8.8 Not in v0.4, and what it touches → [streaming.md](streaming.md#not-yet-and-what-it-touches)

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

### 7.1 Units → [format.md](format.md#units)

### 7.2 Ids and keys → [ir.md](ir.md#ids-and-keys)

### 7.3 Reproducibility → [runtime.md](runtime.md#reproducibility)

### 7.4 Failures and unmet constraints → [runtime.md](runtime.md#failures-and-unmet-constraints)

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
   or whole documents with `classifyEdit`, as the prototype does? **Built** (lane `mvs-patch`; [prism.md](prism.md) §2):
   Seq\*'s patches, ops by id (`set`, `remove`, `insert`, `move`), all or nothing, an inverse returned; a viewer
   proposes, the document's owner commits. Looks need an `id` and `emissive` for it. Undo stays Prism's checkpoints,
   which hold the document; inverses are for the record. `classifyEdit` stays for whole documents (an open, an undo).
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
    (today only a stream model's manifest is). In prism-me the tree is the document's compartments, populations and
    instances ([prism.md](prism.md) §4.1); a new top level changes those rows only.

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
  `packages/mesoscale/spec/src/**` (`biome.json`), as the AI package has one; the entries and the folder graph, §12.2
  and [README.md](README.md#packages).

**Recommendation:**

- Keep the format in Mol\* while it changes, in `packages/mesoscale/spec` with the import rule.
- Move it out only if a second implementation appears.
- Rename the existing extension rather than the new packages.

### 12.1 CLIs (`spec/src/cli/`, `bin` of `@molstar/meso-spec`)

Five commands, as Seq\*'s `svs-*`, each `run(argv, io)` (tests call it in-process). A document is JSON or S-expression
text (a path, or `-`); the product goes to stdout (S-expression, `--json` for JSON, `-o file`), issues to stderr one per
line (`file#path: severity code: message`). Exit 0: no errors; 1: errors; 2: usage or unreadable input.

| Command                                   | Product                                                                                 |
| ----------------------------------------- | --------------------------------------------------------------------------------------- |
| `meso-validate <doc>`                     | the static issues                                                                       |
| `meso-compile <doc> [--base dir]...`      | the IR summary (`examples/*.ir.json`); resources read from files                        |
| `meso-print <file>`                       | the same tree as an S-expression, or JSON with `--json` (document codec, else IR codec) |
| `meso-trace <doc> <id>`                   | the provenance tree (§3.5)                                                              |
| `meso-query <doc> <address\|-> [--limit]` | the address checked, then its copies: count, per population, first copy ids             |

`pnpm -C packages/mesoscale/spec meso-<cmd>` builds first and runs from `packages/mesoscale`, so example paths are
relative to it. A relative resource `uri` resolves against the document's folder
([format.md](format.md#resources-in-their-native-formats)); `--base dir` (repeatable) adds folders tried after it.

### 12.2 Entries

The entries, the folder graph and what enforces them are in [README.md](README.md#packages).

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
