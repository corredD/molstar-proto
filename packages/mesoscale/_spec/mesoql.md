# MesoViewSpec: MesoQL

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
