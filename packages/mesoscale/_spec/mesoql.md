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

**Built: `copy` only** (lane `mvs-location`; the types are in `ir/loci.ts`, the other kinds declared and never
produced). Before it a MesoLocation was a copy and nothing else, and MesoLoci were copy runs keyed by placement set. A
document already points into other data: a compartment's geometry can be "a `segmentation` resource + label", an
instance's pose can be read in a tomogram's voxels, and resources include `tomogram` and `segmentation`. An address
cannot name those things yet, and a pick on a tomogram cannot be a location. As Mol\*'s `Location` is a union (a
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
- **Only `copy` is built (done).** Adding `kind` to `MesoLocation` breaks nothing: only `ir/index.ts` re-exports it, and
  no code takes one (`rowOfCopy` takes a set and an index). The work is MesoLoci's new shape: `ir/loci.ts`
  (`evaluateMesoQL`, `perInstance`, `within`, `lociSize`, `lociToIds`, `lociSphere`), `runtime/runtime.ts`
  (`materialize`), `molstar/src/prism-adapter.ts` (`drawnRuns`, `runsOn`) and `molstar/src/document-model.ts`
  (`mesoLoci`). Built in lane `mvs-location`, after lane 4 (`mvs-drive`).

**Decided (Ludo, 2026-11-09), for David's review:**

1. Kinds specified: `copy`, `label`, `voxel`, `point`, `face`, `arc`. Only `copy` is built first.
2. Both ways: regions filter copies, regions combine as regions, and a copy selects a region only through
   `(region-of …)`.
3. `point` replaces `Annotation.target`'s `{position}`.

**Decided (Ludo, 2026-11-11, after David's review; not built):** `within` between a region and copies, below.

#### Down to atoms: `part` and `element` (decided 2026-11-11, not built)

David (2026-11-11): "i think this is missing levels. we should be able to address all the way to atomic level imo. in a
way this is a superset to mol\*'s Location (but should be its own independent thing)". A copy was the finest location;
two kinds go below it:

```ts
type MesoLocation =
  | … // the six kinds above
  | { kind: 'part'; set: string; index: number; part: MesoLocation } // inside a superstructure copy
  | { kind: 'element'; set: string; index: number; atom: number }; // one atom of one copy
```

- **`part`** is a location inside one copy of a superstructure (a granule): the copy, then a location in the template's
  own sets (a Vamp2 copy, or deeper). Today such a copy is reached only through the expanded world sets; `part` names it
  the way the document does, as template and instance, so it survives `detail` switching between `parts` and `entity`.
- **`element`** is one atom of one copy: `atom` is the atom's id in the entity's structure resource (mmCIF
  `_atom_site.id`), which does not change when the copy moves or the scene is re-resolved with the same copies. A
  residue is a set of elements; it has no kind of its own, as in Mol\*.
- **MesoLoci** gain `elements?: ReadonlyMap<string, readonly {copy: number; atoms: readonly number[]}[]>`: per set, per
  copy, sorted atom runs. A selection of 10⁵ copies at atom level is refused rather than expanded (`mesoql.too-fine`),
  as a renderer could not draw it either.
- **Symbols:** `(residues <copies> :chain A :seq [10 20])`, `(atoms <copies> :name CA)`, and `(part <copy> <address>)`.
  They take a copy selection and narrow it, so they compose with the rest (David's "monadic"):
  `(residues (copies p.insulin 3) :chain B)` is chain B of one insulin.
- **Independent of Mol\*:** the kinds name document things (sets, copies, structure atom ids), not Mol\* units or
  element indices. The adapter maps an `element` to Mol\*'s `StructureElement.Location` and back; nothing else does.
- **Static pointers:** `locationToAddress` writes `(atoms (copies p.insulin 3 :key …) :id 1204)` and
  `(part (copies p.granules 7 :key …) (copies p.Vamp2 12))`.
- **Touches:** `ir/loci.ts` (the two kinds, `elements` in MesoLoci), `format/mesoql.ts` (the symbols), the Prism adapter
  (to and from `StructureElement.Location`), `reference/mesoql.md` (generated).

#### `within` between a region and copies (decided 2026-11-11, not built)

David (2026-11-11): "add `:scope` or something like that that allows different 'filters' (e.g. 'closest', 'average') …
alternatively, allow filtering regions/copies etc before calling within? given the language should be 'monadic' … this
should be quite easy". Both:

- **Filter first** already works: regions filter copies (above), and `within` takes any copy selection, so
  `(within (and (population p.ribosomes) (label r.seg 3)) :of (instance i.granule-docked) :distance 250)` narrows before
  measuring. Every symbol takes a selection and returns one; none needs a special form for regions.
- **`:to`** says what distance `within` measures when `:of` is a region: `surface` (to the region's boundary; the
  default, since a copy 10 nm from a membrane is what people ask for), `centre` (to the region's centroid) or `closest`
  (to its nearest voxel or face, the same as `surface` from outside and 0 inside). Between copies `:to` is ignored: the
  distance stays centre to centre, as today.
- **`average`** (David's example) is not a distance: it belongs to a measurement, not a filter, and stays out of MesoQL.
- **Touches:** `ir/loci.ts` (`within` on regions), `format/mesoql.ts` (the keyword), `reference/mesoql.md`.

### Static pointers: a location written down (proposed, v0.5; for David and Ludo)

David (2026-11-10): "can't recall seeing MesoSchemaItem … basically a serializable version of the meso location (with a
function in MesoQL to read it) … to allow for static pointers".

**What exists.** An address is the schematized form, Mol\*'s `SchemaItem`; it is stored as its S-expression and
evaluated to MesoLoci. `(copies p.catalase 12)` names one copy, but it is "valid for one resolution": rerun the model
(another seed, another count) and copy 12 is another copy. Nothing turns a pick (a MesoLocation) back into text.

**Proposed:**

- **`locationToAddress(location, ir)`**, the inverse of `evaluateMesoQL` for one location, beside `lociToIds`. It writes
  one address per kind:
  - `copy` → `(copies p.catalase 12 :key <model key>)`
  - `label` → `(label r.seg 3)`
  - `voxel` → `(voxels r.tomo :box [i j k i j k])`
  - `face` → `(faces r.mesh 120)`
  - `point` → `(point f.cell [x y z])`
  - `arc` → `(arc p.actin 4 :s 1200)`

  For loci, `lociToAddress` writes `(or …)` of runs. These are the "MesoSchemaItem": a location as text that MesoQL
  reads back, saved in a document, a view's selection, an annotation's target or an agent's message.

- **A copy pointer pins its resolution.** `:key` is the cache key of the model that placed the copy. Evaluated against
  an IR whose model has another key, the address picks nothing and warns `mesoql.stale` (the copy it named is gone),
  rather than silently pointing at another copy. Without `:key`, `copies` keeps today's meaning.
- **The other kinds are static by nature.** A label, a voxel, a face, a point and an arc name data or space, not a
  resolver's output, so they need no key. A pointer that must survive repacking is better written as a region or a point
  than as a copy.
- **A copy as an instance.** A copy someone points at often (the docked granule) is better promoted to an `instance` (it
  has an id of its own and is placed by the document); `(instance i.granule-3)` is static without a key.

**Open:** whether a precomputed model's copies (a saved placement set) need `:key` at all: its key changes only when its
resource does.
