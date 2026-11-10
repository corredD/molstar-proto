# MesoViewSpec: MesoQL

What a MesoQL address means: the S-expression language that selects copies, sites and residues. The concepts and terms
are in [README.md](README.md); the reasons and the numbers are in [design.md](design.md).

## MesoQL: addresses, MesoLocation, MesoLoci (`format/mesoql.ts`, `ir/loci.ts`)

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
  [renderer finding R1](renderer-recommendations.md) asks Mol\* for.
- **Symbols:** the table of symbols, their arguments, keywords and examples is generated from the code, in
  [reference/mesoql.md](reference/mesoql.md).
- **Where it is used:** a view's `looks[].select`, `selection` and annotation `target` (anchored at the selected copies'
  centroid); relation `entry` and `exit`; site `at`. A look that covers part of a population becomes a partial look with
  its runs; Prism cannot draw it ([renderer finding R8](renderer-recommendations.md)) and the adapter says so.
- **Skill:** `mesoQLSkill()` (`format/mesoql-skill.ts`) writes the agent's text from the table; committed at
  [reference/mesoql-skill.md](reference/mesoql-skill.md), which a test keeps equal (`-u` updates it). The CLIs
  ([design.md](design.md) §12.1) print what it says a query reports.
- **Stored as** its canonical S-expression string in JSON. SeqQL stores a JSON tree with full names; which to keep is
  [open decision 10](design.md#11-what-held-what-the-prototypes-exposed-what-is-open).

### MesoLocation as a union (proposed, v0.5; for David and Ludo)

David (2026-11-09): "`MesoLocation` should likely be a discriminated union to support pointers to tomograms,
segmentations, etc too".

**Not built.** Today a MesoLocation is a copy and nothing else (`ir/loci.ts`), and MesoLoci are copy runs keyed by
placement set. A document already points into other data: a compartment's geometry can be "a `segmentation` resource +
label", an instance's pose can be read in a tomogram's voxels, and resources include `tomogram` and `segmentation`. An
address cannot name those things yet, and a pick on a tomogram cannot be a location. As Mol\*'s `Location` is a union (a
structure element, a volume cell, a shape group), so should these be:

```ts
type MesoLocation =
  | { kind: 'copy'; set: string; index: number } // today's, stable id `<population>#<ordinal>`
  | { kind: 'label'; resource: Id; label: number | string } // a segmentation's label, as a compartment's geometry
  | { kind: 'voxel'; resource: Id; ijk: Vec3 } // a tomogram's or map's voxel, in its frame
  | { kind: 'point'; frame: Id; position: Vec3 } // a place with nothing at it
  | { kind: 'face'; resource: Id; face: number } // a mesh resource's face (a compartment's surface)
  | { kind: 'arc'; set: string; fiber: number; s: number }; // a place along one fiber, at arc length s

interface MesoLoci {
  copies: ReadonlyMap<string, readonly number[]>; // set key → runs, as today
  labels?: ReadonlyMap<Id, readonly (number | string)[]>; // segmentation → labels
  voxels?: ReadonlyMap<Id, readonly VoxelBox[]>; // volume → boxes, in its voxels (not doc.ts's `Box`, Å, world)
  faces?: ReadonlyMap<Id, readonly number[]>; // mesh → face runs
}
```

- **Copies stay runs.** The `copies` part is today's MesoLoci: the run operations keep their algorithm, and their
  callers read `.copies`. The other parts are empty for every address the examples use.
- **`point`** has no MesoLoci part: no address yields one. It is a pick on empty space, or an annotation's anchor.
  `Annotation.target`'s `{position}` becomes a `point` location, so a pick and an anchor say "here" the same way. (Ludo,
  2026-11-09.)
- **`arc`** names a place along a fiber (an actin filament at 1.2 µm from its pointed end), between its copies; like
  `point`, a location without a MesoLoci part.
- **Regions and copies, both ways.** A label, a voxel box or a mesh's faces is a region, and a copy is in it if its
  centre is. (Ludo, 2026-11-09.)
  - **Regions filter copies:** `(and (population p.ribosomes) (label r.seg 3))` is the ribosomes whose centres are in
    label 3. A combination's copies are what each operator gives today once the regions have filtered them.
  - **Regions combine as regions:** `and`, `or` and `not` on regions of one resource are set operations on its labels,
    boxes or faces; regions of different resources meet only through the copies they filter.
  - **A copy selects a region only by name:** `(region-of <copies> <resource>)` gives the labels (or faces) the copies'
    centres sit in. `and` and `or` never turn copies into regions on their own.
  - `in`'s `:location` keeps its meaning for compartments; a compartment whose geometry is a segmentation label and
    `(label …)` of the same label select the same copies.
- **New symbols:** `(label <resource> <label>)`, `(voxels <resource> <box>)`, `(faces <resource> <runs>)`,
  `(region-of <copies> <resource>)`. They would be generated into [reference/mesoql.md](reference/mesoql.md) like the
  others.
- **Only `copy` would be built at first.** Adding `kind` to `MesoLocation` breaks nothing: only `ir/index.ts` re-exports
  it, and no code takes one (`rowOfCopy` takes a set and an index). The work is MesoLoci's new shape: `ir/loci.ts`
  (`evaluateMesoQL`, `perInstance`, `within`, `lociSize`, `lociToIds`, `lociSphere`), `runtime/runtime.ts`
  (`materialize`), `molstar/src/prism-adapter.ts` (`drawnRuns`, `runsOn`) and `molstar/src/document-model.ts`
  (`mesoLoci`). A small lane after lane 4 (`mvs-drive`), which also edits `document-model.ts`.

**Decided (Ludo, 2026-11-09), for David's review:**

1. Kinds specified: `copy`, `label`, `voxel`, `point`, `face`, `arc`. Only `copy` is built first.
2. Both ways: regions filter copies, regions combine as regions, and a copy selects a region only through
   `(region-of …)`.
3. `point` replaces `Annotation.target`'s `{position}`.

**Still open:** what `within` gives between a region and copies (distance to the region's surface, or to its centre).
