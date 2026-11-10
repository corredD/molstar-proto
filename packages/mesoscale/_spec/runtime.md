# MesoViewSpec: Runtime

What the runtime and its resolvers guarantee: the pipeline, the resolver and adapter contracts, composition,
reproducibility and failures. The concepts and terms are in [README.md](README.md); the reasons and the numbers are in
[design.md](design.md).

## Which resolver, by case

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

## Procedural and precomputed models together

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

## Pipeline (`runtime/runtime.ts`, `compile`)

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
       refiner of an avoided model fails, the avoiding model avoids the unrefined result instead
       ([refine stages](#application-composition-refine-stages)).
   - A model that avoids a refined model avoids what is drawn: it runs after the refiner and its key follows the
     refiner's. A refiner keeps the `avoid` of every model up its chain, instances included.
   - Constraints are checked against `achieved`, and each shortfall becomes an issue with the resolver's reason.
   - **Stopping** (`options.signal`, an `AbortSignal`): checked before each model and, for the resolvers that run long
     (`meso.pack`, `cellpack-gpu`, `meso.relax`), in their loops, which give the event loop back every 30 ms when a
     signal is given (`runtime/cancel.ts`, `drive`; with no signal they run straight through, synchronously, as before).
     A stopped compile rejects with an `AbortError` and keeps nothing half-resolved (what finished is the cache's); an
     abort in a resolver is never filed as `resolver.failed`. The signal rides on `ResolveJob`, not in the projected
     input, so it is not part of a model's key. `options.onProgress` is told, before each model that has to resolve,
     which one and how many are done of how many.
5. **Assemble** the IR, then **derive the view** from the active view.

## The resolver contract (`runtime/resolver.ts`)

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

## Resolvers in the prototype

| Id                 | Realizes                                                                                                             | Complexity        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `meso.pack`        | random populations: interiors, membranes, surfaces, the space around a compartment                                   | O(N · tries)      |
| `meso.lattice`     | lattices on spheres and ellipsoids                                                                                   | O(N)              |
| `meso.fiber`       | fibers by path or by growth; honours `binds` and `bends` (subjects placed by their sites)                            | O(N)              |
| `meso.bilayer`     | lipid bilayers                                                                                                       | O(N)              |
| `meso.precomputed` | RELION STAR, placement JSON                                                                                          | O(rows)           |
| `cellpack-gpu`     | cellPACKgpu serialized recipes                                                                                       | O(N · tries)      |
| `meso.relax`       | refine stage: inserts missing copies, relaxes overlaps (see [refine stages](#application-composition-refine-stages)) | O(N · iterations) |

All of them are in `resolvers/index.ts`, `DefaultResolvers`. The copies of the models a model avoids: the packers place
nothing on them, `meso.relax` holds them fixed, `meso.lattice` skips the sites they take, `meso.fiber` grows around them
(a traced path is kept where it is and its overlaps reported); `meso.bilayer` and `meso.precomputed` do not look at them
(lipids are drawn without footprints, [design.md](design.md#11-what-held-what-the-prototypes-exposed-what-is-open);
given poses are given).

## Plugging in a recipe kind: cellPACKgpu

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

**When a kind needs more than a resolver:** see the criteria in [ir.md](ir.md#one-leaf-the-placement-set).

## The renderer adapter contract (`runtime/adapter.ts`)

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
  copy and a key per copy, 8 B a copy ([renderer-recommendations.md](renderer-recommendations.md), R2).
- **[measured] what each edit replaces** (medium lane, headless Prism with prism-me's spec):
  - a color edit replaces no list or representation object;
  - a density edit replaces exactly the rerun model's list.
- **[measured] with a GL context** (`gl`, Node): the scene is drawn, and a color edit changes pixels without a new list.

`molstar/src/session.ts`, `MesoSession`, is the host the stories use:

- **A view edit** goes through `updateView`, then `commit`.
- **A model edit** goes through `compile` with the session's cache, then `commit`.
- **Every edit leaves a record:** kind, resolver runs, cache hits, and the time of each phase.

## Application composition: refine stages

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

## Reproducibility

- **Deterministic resolution.** The same document, resolver versions and seed give the same placements, bit for bit
  (quick test: content digest).
- **Per-population sub-seeds** (`subSeed(seed, populationId)`): adding a population does not reseed the others.
  - **Limit:** in a shared packing, exclusion still couples them.
- **What reproducing a result needs:**
  - the document;
  - the resolver ids and versions, which the IR records;
  - the resources' content keys: the `checksum` when declared, otherwise a hash of the content.
- **A resource without a checksum** can only be checked after loading.

## Failures and unmet constraints

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
