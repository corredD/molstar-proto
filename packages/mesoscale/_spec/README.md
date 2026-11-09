# MesoViewSpec: the specification

MesoViewSpec is a declarative format for mesoscale science: a document describes a scene in biological terms (entities,
compartments, populations and their relations), connects it to the evidence and the processing behind it, and holds the
view state needed to reopen it. It never says how the scene is built or drawn. Around it: MesoQL, its address language;
an IR that a runtime makes of a document by giving each model to a pluggable resolver; and a Mol\* adapter that puts the
IR into Prism. It is a prototype, built to test the design. This spec says what the code cannot say for itself: what a
document means, what an address picks, what the IR guarantees, the contracts a resolver, an adapter and a tile provider
are held to, and what a view restores. The code is the truth for how. Where the code holds a table (node kinds, issue
codes, MesoQL's symbols, the resolvers), the reference is generated from it into [reference/](reference/). Why the
design is what it is, what was measured and what is open is in [design.md](design.md).

## What MesoViewSpec is

- **The format**, a document: biology, evidence and provenance, frames and alignments, resources in their native
  formats, views and the session, as plain JSON with one id namespace. It has a second spelling, the S-expression, for
  people, agents and tests.
- **MesoQL**, an address language: an address is written with the document's ids, checked against the document, and
  materialized over the resolved scene as MesoLoci, runs of copies per placement set.
- **The IR**: the scene made concrete (Å, matrices, counts), a tree in the manner of `mol-state` whose one leaf is the
  placement set. Construction details sit in its `resolve` nodes, under the key the result is cached by.
- **The runtime and the resolvers**: the runtime validates, normalizes, dispatches each model to a resolver, assembles
  the IR and derives the active view; a streamed model is loaded by tiles around the camera, within a copy budget. The
  built-in resolvers pack, tile lattices, grow fibers, lay bilayers, read precomputed placements, relax, and read
  cellPACKgpu recipes; a new recipe kind is one more resolver.
- **The Prism adapter**: commits an IR into Prism by keys, sharing the IR's buffers with Mol\*'s particle lists. A
  MolViewSpec export is a second, measured path for small scenes.

## Packages

Two packages. Each folder of `@molstar/meso-spec` is an entry (a subpath export); a host imports
`@molstar/meso-spec/format`, `/builder`, `/ir`, `/runtime`, `/resolvers`, `/examples` or `/cli`, nothing deeper (`./*`
and `.` are not exported), and tree shaking keeps what it does not import out of its bundle. An entry's `index.ts` names
what it exports (no `export *`): the host's contract, and every type a public signature names is exported by some entry,
so a host can name it. Internals (the unit tables but `LengthToAngstrom`, `canonicalJson`, the individual resolvers, the
packer and the geometry samplers) are not exported; the package's tests reach them by path.

**`@molstar/meso-spec`** (`packages/mesoscale/spec`): the format, the builder, the IR, the runtime and the resolvers. It
imports nothing of Mol\* (a Biome `noRestrictedImports` override on `packages/mesoscale/spec/src/**`, which lets it
import its own entries) and no Node built-in outside `/cli` and its tests.

| Entry        | Holds                                                                                                                                       | Imports (of the package)                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `/format`    | the document's types, issue codes, units, validation, MesoQL and its skill, patches, the S-expression codecs, trace                         | nothing                                     |
| `/builder`   | `createMesoDocument` and `q`: a typed builder for documents (branded refs, ids from labels)                                                 | `format`                                    |
| `/ir`        | the IR tree, the placement set and its quaternion helpers, content hashes, MesoLoci and MesoQL evaluation over an IR                        | `format`                                    |
| `/runtime`   | `compile` and `updateView`, the resolver and adapter contracts, readers (`meshArea` with them), instancing, streaming, the seeded generator | `format`, `ir`                              |
| `/resolvers` | `DefaultResolvers`, the cellPACKgpu import, `relionQuat`                                                                                    | `format`, `ir`, `runtime`                   |
| `/examples`  | the example documents as code (exosome, gallery, yeast, β-cell, nucleoid, scale scenes, the tiled fixture) and their fixtures               | `builder`, `format`, `runtime`, `resolvers` |
| `/cli`       | the five commands' `run` and `CliIO` (the `meso-*` bins)                                                                                    | `format`, `ir`, `runtime`, `resolvers`      |

A resolver implements `runtime`'s contract, so `resolvers` imports `runtime` and not the other way; the helpers
`runtime` shares with the resolvers live below both (`mulQuat` and `rotationOf` in `ir`, `meshArea` in `runtime`'s
readers).

**`@molstar/meso-molstar`** (`packages/mesoscale/molstar`): what needs Mol\*. One entry, `.`: `PrismMesoAdapter` (and
the camera helpers), `MesoSession` (one document edited, with the runtime's cache, an adapter and the streamer; its
`EditRecord`s), `irToMolViewSpec` (the IR compiled to MolViewSpec), `toParticleList` with the `MesoPlacements` transform
and its store. `./_test/*` and `./_stories/*` are hidden; the stories (under _MesoViewSpec_, private) import the package
by relative path and `meso-spec` through its entries.

**Enforcement.** Biome (no Mol\* in `spec/src`); `spec/src/_test/layers.test.ts` (the folder graph above, entries only
across folders, no `export *`, the entries and nothing deeper); `spec/src/_test/exports.test.ts` (every type a public
signature names is exported by some entry of the two packages).

`packages/mesoscale/examples/` is not a package: the paired example files, each document as authored
(`*.mesoviewspec.json`) and the IR the runtime makes of it (`*.ir.json`), kept current by a quick-lane test.

## Principles

- **What, not how.** A document says what a scene is, why we believe it and how it is meant to be seen; never how it is
  built (the resolvers') nor how it is drawn (the adapter's).
- **A flat document, a tree IR.** The biology is a graph of nodes in one id namespace that refer to each other by id;
  the build is a tree.
- **Biology in the document, construction in the IR.** A biological constraint is a document field; packing details are
  a model's opaque `params`, visible and hashed in its `resolve` node.
- **Data stay where they are.** A resource is named in its community's own format and never copied into the document.
- **Never a guess.** An undeclared handedness, an unexpanded catalog, a relation no resolver honours, a representation
  an adapter cannot draw: each is reported, never silently assumed or dropped.
- **Identity is the id, never content.** IR refs derive from document ids; a copy id is valid for one resolution, an
  instance's for good.
- **What is not in the projection must not change the result.** A model's result is keyed by its resolver's projection
  of the document, so a view edit reuses every placement by construction.
- **One leaf.** Every resolver produces placement sets and every adapter consumes them, in the renderer's own layout,
  with no copy.
- **Ångström once.** The document chooses its units; the runtime converts once, and resolvers and adapters see Å only.
- **Deterministic.** The same document, resolver versions and seed give the same placements, bit for bit.
- **A relation is honoured by the resolvers that say so.** Each resolver declares what it honours; the rest is reported,
  not reconciled.
- **Unmet constraints are data.** Every issue has a stable code, a phase and a path; a shortfall carries requested,
  achieved and the resolver's reason.
- **Everything traces back.** Any population, compartment, model or resource traces to its evidence and the activities
  that made it; a choice a recipe leaves open is recorded as an assumption.
- **Hints with a fallback.** A drawing preference in a document is a hint an adapter may decline, saying so.
- **No Mol\* in the format.** The format, IR and runtime import nothing of Mol\*; adapters live beside the viewer.

## Glossary

| Term             | Meaning                                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| document         | a MesoViewSpec document: plain JSON, one id namespace, sections from frames to views                                 |
| entity           | a molecular species, or an assembly whose parts may be a superstructure                                              |
| compartment      | nested containment with a geometry and an optional membrane; not a coordinate transform                              |
| population       | copies of an entity in a compartment at a location, stated statistically (abundance, arrangement)                    |
| instance         | one copy stated individually, with an id that survives re-resolution                                                 |
| superstructure   | a reusable fragment of a document in its own frame, resolved once and placed by pose                                 |
| detail           | how a population draws a superstructure: `parts` (its contents) or `entity` (one body a copy)                        |
| relation         | a statement between populations (binds, bends, branches, contacts, …), honoured only by resolvers that declare it    |
| site             | a named point and axis on an entity, or a residue address, that relations attach to                                  |
| catalog          | a table of populations, one per row                                                                                  |
| evidence         | why a node is believed: an observation, a measurement, literature, a database, a prediction or an assumption         |
| activity         | what made a resource, model or alignment (after W3C PROV)                                                            |
| trace            | the walk from a node back through its evidence and activities                                                        |
| frame, alignment | a coordinate frame (one `world`); a similarity from one frame to another                                             |
| model            | a realization of populations by a resolver (`method`), procedural or precomputed                                     |
| refine           | a model that takes another's result as input and replaces it (`refines`)                                             |
| resolver         | realizes a model's populations as placement sets; declares the arrangements, locations and relations it handles      |
| projection       | the normalized input a resolver's result depends on, hashed into its key                                             |
| key              | `<model>@<hash>`: a resolution's cache key; set keys are `<key>#<n>`                                                 |
| constraint graph | the document normalized: Å, counts, frame matrices, checked addresses, materialized sites                            |
| IR               | the tree the runtime makes of a document: space, `resolve` nodes, placement sets, superstructures, streams           |
| MesoComplex      | the IR's evaluated part: placement sets, superstructure templates and their instances                                |
| placement set    | the IR's one leaf: positions, rotations, types and ordinals of copies, struct of arrays, world Å                     |
| copy id          | `<population>#<ordinal>`, stable within one key                                                                      |
| MesoQL           | the address language, written as S-expressions over document ids                                                     |
| MesoLocation     | one copy, `{set, index}`                                                                                             |
| MesoLoci         | what an address materializes to: per placement set, sorted runs of copy indices                                      |
| view, look       | a persistent way to see the scene (camera, looks, selection, annotations); a look styles the copies an address picks |
| camera, tour     | a camera says what to frame (a MesoQL `focus`) or where to stand; a tour steps through views                         |
| issue            | `{code, severity, phase, message, path, ids, constraint?}`: every failure, shortfall and assumption, as data         |
| adapter          | puts an IR into a viewer, diffing by keys                                                                            |
| stream source    | a model whose copies are the tiles of a `meso-tiles` resource                                                        |
| manifest         | a stream's level 0: its tiles, with counts and envelopes per population                                              |
| tile             | an axis-aligned box of a stream; loaded, its copies are one placement set                                            |
| level            | a stream's detail: 0 statistical (counts, envelopes), 1 copies, 2 atoms (declared, not loaded)                       |
| provider         | the host's `TileProvider`: serves a stream's manifest and its tiles                                                  |
| planner          | `planStream`: which tiles to load, keep, evict or cancel around the focus                                            |
| budget           | the cap on loaded level-1 copies; a session option, never a document field                                           |

## Files

| File                                                       | Says                                                                                                      |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [format.md](format.md)                                     | what a document means: its sections, biology, resources, frames, evidence, superstructures, instances     |
| [mesoql.md](mesoql.md)                                     | what a MesoQL address means and what it materializes to                                                   |
| [ir.md](ir.md)                                             | the IR: its tree, the placement set, `resolve` nodes, ids and keys                                        |
| [runtime.md](runtime.md)                                   | the pipeline, the resolver and adapter contracts, the built-in resolvers, refine stages, failures         |
| [streaming.md](streaming.md)                               | streamed models: the source, the `meso-tiles` manifest, the provider, the planner and budget, the session |
| [views.md](views.md)                                       | what one document restores: session state, looks, the semantic camera, tours                              |
| [prism.md](prism.md)                                       | how prism-me opens, shows and edits a document (a design)                                                 |
| [renderer-recommendations.md](renderer-recommendations.md) | what the prototypes showed about Mol\*'s renderer                                                         |
| [design.md](design.md)                                     | the design record: rationale, measurements, open decisions, packaging, references                         |

## Generated references

Written by `packages/mesoscale/spec/scripts/spec.ts generate` from the code; `spec.ts check` (run by
`pnpm -C packages/mesoscale/spec spec`) regenerates them and fails on any difference. Never edit them by hand.

| File                                             | From                                                                                                | Written by         |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------ |
| [reference/format.md](reference/format.md)       | the document's node kinds and their fields (`format/doc.ts`)                                        | `spec.ts generate` |
| [reference/issues.md](reference/issues.md)       | the issue codes, their meaning (`IssueCodes`, `format/issues.ts`)                                   | `spec.ts generate` |
| [reference/mesoql.md](reference/mesoql.md)       | MesoQL's symbols (`MesoQLSymbols`, `format/mesoql.ts`)                                              | `spec.ts generate` |
| [reference/resolvers.md](reference/resolvers.md) | the built-in resolvers (`DefaultResolvers`): id, version, arrangements, locations, formats, honours | `spec.ts generate` |

`reference/mesoql-skill.md`, the agent's MesoQL skill, arrives with `mvs-skill-cli` and is that lane's: written by its
own generator, not by `spec.ts generate`.

## Keeping the spec

A change to a contract updates this spec in the same commit; where spec and code disagree, fix whichever is wrong. The
check (`pnpm -C packages/mesoscale/spec spec`) fails when a reference is stale, when a source file under
`packages/mesoscale` lacks Mol\*'s header, when a link between `_spec` files does not resolve, or when a source under
`packages/mesoscale/spec/src` reports an issue code `format/issues.ts` does not register.
