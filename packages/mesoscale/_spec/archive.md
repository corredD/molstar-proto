# MesoViewSpec: the `.mesoviewx` archive

One file that carries a document and the data it names, as MolViewSpec's `.mvsx` carries an `.mvsj` and its files.
**Proposed, not built** (first draft, 2026-11-11). David (2026-11-11): "allow .mesoviewX files that correspond to
molviewspec's mvsx files with resources?"; Ludo: yes. The draft takes its binary layout from Mesoscale Explorer v1's
generic format (`apps/mesoscale-explorer/src/data/generic/preset.ts`), which already ships placements as byte ranges in
shared files.

## What Mesoscale Explorer v1 holds

A zip with a `manifest.json` (`GenericManifest`):

- **`roots` and `groups`:** a tree of labelled groups, for the UI only.
- **`entities`:** one structure or mesh file each (`cif`, `bcif`, `pdb`, `gro`, `xyz`, `mol`, `sdf`, `mol2`, `ply`), a
  color, a `sizeFactor` (1 atomic, 2 C-alpha, 1.5 Martini), the groups it belongs to, and its `instances`.
- **`instances`:** `positions` (x y z Å per copy) and `rotations` (`euler` XYZ, `quaternion` XYZW or `matrix` row-major
  3×3 per copy). Each is either inline numbers or **a range**: `{file, view: {byteOffset, byteLength}}`, little-endian
  Float32 in a file of the zip. Many entities share one binary file, each reading its own range, as glTF's buffer views
  do. Absent, one copy at the origin.
- **`trajectories`:** frames with a `time`, each giving new instances per entity file. Declared in the type; the
  explorer does not load them.

The ranges are what MesoViewSpec lacks: its placements are JSON (`meso-placements+json`) or a community format (RELION
STAR), and a tile's payload has no file format (streaming.md: "a network protocol or a tile file format" comes later).

## The archive

- **A zip** whose root holds `index.mesoview.json`, the document as it is stored today. Other files sit anywhere in the
  zip. The name `.mesoviewx` and the index file follow `.mvsx` and `index.mvsj`.
- **Relative `uri`s resolve inside the zip,** from the index's folder, before the document's own location (format.md,
  Resources). An absolute `uri` or an `accession` is fetched as today, so an archive may hold some resources and point
  at others. A resource whose relative `uri` is not in the zip is `resource.unavailable`, as a file not found is.
- **`checksum`** is checked on the bytes read from the zip, as on a fetch.
- **Opening:** prism-me's open and the CLIs take `.mesoviewx` beside `.mesoview.json`, as Prism's loader takes `.mvsx`
  (a zip's `PK` signature, then the name's extension). **Saving:** "Save as archive" writes the document and every
  resource with a relative `uri` it can read; a resource it cannot read stays a reference and is reported.

## Ranges: a resource that is part of a file

A resource gains an optional **`range: {byteOffset, byteLength}`** beside `uri`, Mesoscale Explorer's `view`. The
resource is those bytes of the file, not the whole file; `checksum` covers the range. Outside an archive a range works
the same over HTTP (a `Range` request) or on disk.

```json
{ "id": "r.placements-catalase", "kind": "placements", "format": "meso-placements+f32",
  "uri": "placements.bin", "range": { "byteOffset": 0, "byteLength": 14168 },
  "select": { "count": 506, "rotations": "quaternion" } }
```

## `meso-placements+f32`: placements as Float32 ranges

A placements format for large sets, read straight into the IR's placement set (ir.md: `positions` Float32 xyz Å,
`rotations` Float32 xyzw) without parsing.

- **Layout:** `count` positions (3 Float32 each) then `count` rotations, little-endian, in the resource's range.
- **`select`** carries the shape: `count`, and `rotations`: `quaternion` (XYZW, the default and the IR's own), `euler`
  (XYZ, radians) or `matrix` (row-major 3×3), as Mesoscale Explorer's variants; the reader converts the last two to
  quaternions. Optional `types` (Int32 per copy, an index into the model's populations) after the rotations, for a set
  that mixes populations, as a tile does.
- **Read by** `meso.precomputed`, beside `relion-star` and `meso-placements+json`. Positions are in the resource's
  `frame`, as for the other formats.
- **Validation** (phase `load`, a new code `resource.format`): the range's length is `count × (3 + 4) × 4` bytes for
  quaternions (`count × 3 × 4` for Euler, `count × 9 × 4` for matrices, plus `count × 4` with `types`); every number
  finite; a quaternion's norm within 10⁻³ of 1.

## What it answers

- **Derived results as resources** (design.md open decision 3; David: "serialize result of the gpu computation … load it
  from file … similar as streaming"): a resolver's output is written into the archive as a `meso-placements+f32` range
  with `derivedFrom: {model, key}` (a new field of `Resource`). Opened again, the model's cache key matches and the
  runtime reads the range instead of running the resolver.
- **A tile file format** (streaming.md): a `meso-tiles` manifest whose tiles name ranges of `meso-placements+f32` with
  `types` is a static stream: one binary file, one range per tile, loaded on demand by HTTP `Range` or from the zip. A
  provider for it is the first provider that is not code.
- **Mesoscale Explorer v1 files open** through a converter: each entity becomes an entity with a `structure` resource
  and a population with a `meso.precomputed` model reading its ranges; `roots` and `groups` become compartments of kind
  `group` (no geometry) or labels only, a choice left open; `sizeFactor` becomes a look's size; `color`, a look.

## Open

- Whether `index.mesoview.json` may be the S-expression spelling too (`index.mesoview`).
- Whether Mesoscale Explorer's `trajectories` (timed frames of instances) are the start of time in the document (David's
  "time abstraction(s)"), or only an import.
- Compression of the ranges (Mesoscale Explorer's TODO: BinaryCIF's encoders, such as integer-packed fixed point).
- msgpack as a second encoding of the index (David: "msgpack might be a good candidate").
