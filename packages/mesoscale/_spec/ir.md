# MesoViewSpec: The IR

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

### 7.2 Ids and keys

| What            | Form                                                | Stability                                                                          |
| --------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Document ids    | `^[A-Za-z][A-Za-z0-9_.:-]*$`                        | author-chosen                                                                      |
| IR refs         | derived from document ids (`m.recipe/placements/0`) | stable across runs                                                                 |
| Resolution keys | `<model>@<hash>`                                    | change exactly when the projection, the resolver version or an avoided set changes |
| Set keys        | `<key>#<n>`                                         | follow the resolution key                                                          |
| Copy ids        | `<population>#<ordinal>`                            | stable within one key                                                              |
