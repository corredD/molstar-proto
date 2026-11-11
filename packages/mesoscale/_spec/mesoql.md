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

#### Down to atoms (decided 2026-11-11, not built)

David (2026-11-11): "i think this is missing levels. we should be able to address all the way to atomic level imo. in a
way this is a superset to mol\*'s Location (but should be its own independent thing)". Two levels lie below a copy of a
population: a copy inside a superstructure copy, and an atom of a copy.

- **Inside a superstructure copy: already a `copy`.** `(part (copies p.granules 7) p.Vamp2)` (`format/mesoql.ts`)
  evaluates to virtual sets keyed `<set>@<instance>><template set>` (`ir/loci.ts`), so one Vamp2 in granule 7 is a
  `copy` location whose `set` is that key; deeper nesting chains the keys. No new kind. Under `detail: entity` the
  address still names the template's copies but draws nothing, and says so (`render` issue), so a pointer survives the
  switch.
- **`element`**, a new kind: one atom of one copy.

  ```ts
  | { kind: 'element'; set: string; index: number; chain: string; seq: number; atom: string; operator?: string }
  ```

  `chain`, `seq` and `atom` are the mmCIF `label_asym_id`, `label_seq_id` and `label_atom_id` in **the entity's own
  structure** (`Entity.structure`), never a scale rule's `source`; `operator` names the assembly operator when the
  entity's structure is an assembly whose chains share ids. These do not change when the copy moves or the scene is
  re-resolved with the same copies (`_atom_site.id` would not do: operator copies share it). A residue is the elements
  with one `chain`, `seq` and `operator`; it has no kind of its own, as in Mol\*.

- **MesoLoci** gain `elements?: ReadonlyMap<string, readonly {copy: number; atoms: readonly ElementKey[]}[]>`: per set,
  per copy, the elements picked. An address whose elements would exceed 10⁶ is refused, not expanded (`mesoql.too-fine`,
  a new code).
- **Symbols, extending what exists.** `residues` today takes an entity and returns the `residues` type (a site's `at`, a
  contact's `a` and `b`); that form stays. It gains a second form whose first argument is a copy selection, with the
  same keywords (`:chain`, `:range`): `(residues (copies p.insulin 3) :chain B :range 1-30)` is those residues of one
  insulin. A new `(atoms <selection> :name CA :id 1204)` narrows to atoms, of copies or of residues. Both return a new
  type, `elements`, accepted where a selection is (a look's `select`, a view's `selection`, a camera's `focus`), so they
  compose with the rest (David's "monadic").
- **Independent of Mol\*:** the kind names document things (sets, copies, mmCIF labels), not Mol\* units or element
  indices. Where a copy is drawn as a structure (a `structure` look or scale rule), the adapter maps an `element` to
  Mol\*'s `StructureElement.Location` and back. Where it is drawn as a particle, an element selects its whole copy and a
  `render` issue says so.
- **Static pointers:** `locationToAddress` writes
  `(atoms (residues (copies p.insulin 3 :key …) :chain B :range 12-12) :name CA)`, and a part copy as
  `(copies <virtual set> 12 :key …)` printed back as `(part …)`.
- **Touches:** `ir/loci.ts` (`element`, `elements` in MesoLoci), `format/mesoql.ts` (the `residues` copies form,
  `atoms`, the `elements` type), `format/issues.ts` (`mesoql.too-fine`), the Prism adapter (to and from
  `StructureElement.Location`), `reference/mesoql.md` (generated).

#### `within` between a region and copies (decided 2026-11-11, not built)

David (2026-11-11): "add `:scope` or something like that that allows different 'filters' (e.g. 'closest', 'average') …
alternatively, allow filtering regions/copies etc before calling within? given the language should be 'monadic' … this
should be quite easy". Today `within`'s `:of` is a copy selection and the distance is centre to centre. The region kinds
(`label`, `voxels`, `faces`, above) are declared and not built, so none of this works yet; it is the rule they are built
to.

- **Filter first.** Once regions exist they filter copies (above), and `within` takes any copy selection, so
  `(within (and (population p.ribosomes) (label r.seg 3)) :of (instance i.granule-docked) :distance 250)` narrows before
  measuring. No symbol needs a special form for regions.
- **`:of` a region.** `:of` takes a selection or a region. A region symbol alone in `:of` is the region; inside `and`
  with copies it filters them, as above. `(within (population p.ribosomes) :of (label r.seg 3) :distance 100)` is the
  ribosomes within 100 Å of label 3.
- **`:to`** says where the distance is measured to when `:of` is a region: `surface` (its boundary: 0 inside; the
  default, since "within 10 nm of a membrane" is what people ask) or `centre` (its centroid). Between copies `:to` is
  refused (`mesoql.keyword`): the distance stays centre to centre.
- **Picking the closest:** David's "closest" as a filter is a new symbol,
  `(nearest <selection> :to <selection or region> :count n)`, the `n` copies nearest to it (ties by copy id). It
  composes like the others.
- **`average`** is a measurement of a selection (a mean distance), not a filter of it. It is left to the measuring tools
  and stays out of MesoQL.
- **Touches:** `ir/loci.ts` (`within` on regions, `nearest`), `format/mesoql.ts` (`:of` typed selection or region,
  `:to`, `nearest`), `reference/mesoql.md`.

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
