# A typed builder for MesoViewSpec documents (2026-11-08, lane `mvs-builder`)

## Brief

- **Asked** (Ludo, 2026-11-08: "usable like Seq\*"). Seq\* has `@molstar/seq-core/builder`: documents written in
  TypeScript, refs returned and passed on, never typed by hand. MesoViewSpec documents are written as object literals
  today (`spec/src/examples/*.ts`). **Check:** the β-cell example rewritten with the builder reads shorter and produces
  a document `deepEqual` to today's `betaCellDoc()` (and the same S-expression print); a wrong reference (a population
  on a compartment the builder never made) is a TypeScript error, not a validation issue.
- **Spec:** a "Builder" section in the spec (`_spec/` — after `mvs-spec-reference` merges, its topic file for the
  format; until then a short section in design.md §3 that the spec lane will move), modelled on Seq\*'s builder docs.
- **Shape** (designed on Opus, from `packages/sequences/core/src/builder`): `createMesoDocument({ title, units })` → a
  builder with `entity()`, `compartment()`, `population()`, `instance()`, `superstructure()`, `relation()`, `model()`,
  `resource()`, `evidence()`, `view()`, `tour()`; each returns a typed ref (`EntityRef`, `CompartmentRef`, …) that later
  calls take; MesoQL addresses built from refs (`q.population(p)`, `q.part(q.copies(g, 12), vamp)`) or given as strings;
  ids generated from labels when not given, stable and unique; `.build()` returns the document and runs `validate`
  (issues returned, never thrown).
- **Tests:** quick: the five examples rebuilt with the builder equal today's documents (`deepEqual`); generated ids
  stable across runs and unique; refs type-checked (a `// @ts-expect-error` test file in the tsc run); `build()` returns
  validation issues; MesoQL helpers print the same strings `printMesoQL` does.
- **Touches:** new `packages/mesoscale/spec/src/builder/` (index, refs, query helpers), tests, the examples (rewritten
  to use it only if they stay `deepEqual`; keep the old literal in the test as the oracle). **Stays off:** `mvs-patch`'s
  files (format/patch.ts, doc.ts Look, sexpr.ts) and `mvs-spec-reference`'s (`_spec/` moves, `spec/scripts/`);
  `package.json` `exports` (the entries lane adds `./builder`).
- **Size:** ~450 production lines.
- **Lane model:** Sonnet; the builder's API designed on Opus.
- **Steps and models:** 1. Opus: the API (refs, id policy, MesoQL helpers), from Seq\*'s builder 2. Sonnet: the builder
  and tests 3. Sonnet: the examples rebuilt, `deepEqual` 4. Sonnet: checks 5. gate (Opus).

## Built

- `spec/src/builder/` (refs, ids, query, builder, index): `createMesoDocument`, typed refs, id registry, `q`, `build()`.
- Tests: `_test/builder.test.ts` (ids, document, `q` against the symbol table), `_test/builder.types.test.ts` (the
  `@ts-expect-error` file, run by `npx tsc -p packages/mesoscale/spec/tsconfig.test.json`),
  `_test/builder-examples.test.ts` (the five examples and three argument variants equal their frozen oracles by value
  and as S-expression text).
- The five paired examples rewritten with the builder; `packages/mesoscale/examples/` unchanged (`git diff` empty).
- design.md §3.15 Builder (§3.14 was taken, so appended as 3.15).

## Decided

- **API** (Opus subagent, 2026-11-08): refs are branded id strings (kind + scope `doc`/`inner`, so an inner population
  is not a doc one, as `validate`'s two indexes); a ref is a string at run time so `q` strings, shared `looks` arrays
  and spread nodes work with no resolve pass (Seq\*'s lazy handles would need one). A string becomes a ref only through
  `get(kind, id)` and `add(section, nodes)`; MesoQL slots stay `MesoQL` strings. Entity refs carry their site names.
  Inputs derive from doc.ts types (`In<T, R>` replaces the id-holding fields), so the `Look` lane's change flows
  through.
- **Ids:** label slug under the kind's prefix, else from what the node refers to, else a per-builder counter; `-2`, `-3`
  when taken; explicit ids kept (duplicates are `validate`'s `id.duplicate`, never thrown). No module state.
- **`q`** hand-written (typed by ref kind); a test over `MesoQLSymbols` keeps it in sync and round-trips through
  `parseMesoQL`/`printMesoQL`.
- **Oracle** (differs from the brief: "the old literal in the test"): the committed `examples/*.mesoviewspec.json` plus
  `_test/fixtures/builder-oracles.json` for the arguments' variants; frozen before the rewrite, compared with
  `toStrictEqual` through JSON (importer nodes carry undefined keys) and by `printData` text (key order).
- **Type tests** run by `tsconfig.test.json` in the spec package (tsconfig.json excludes `_test`); not in `tsc -b`. The
  package `typecheck` script is not changed (the entries lane edits that package.json).

- **A ref of another builder compiles** (§3.15 says so): branding refs per builder would need a type parameter on every
  call. A departure from the brief's check (a population on a compartment the builder never made is a TS error holds for
  a compartment of the wrong kind or scope, not for one of another builder); `validate` reports it (`ref.missing`). Open
  for Ludo.
- **Merge:** me/mesoviewspec moved during the lane (Look.id, Look.emissive, `revision`, look ids in exosome); merged
  forward, the builder gained `revision`, the `look` kind and reserved look ids.

## Learned

- Explicit ids dominate the rewrites: a label's slug rarely equals the short ids the literals use (`e.granule` for
  "insulin secretory granule"), so the builder pays through refs, `q`, shared looks and checked slots, not line count.
- Sections are emitted in document order, so evidence and resources are made first and later nodes cite their refs; only
  true cycles (activity <-> alignment/model, an entity's own site address) need `get`.
- An importer's nodes (cellPACKgpu) have plain-string populations: `add` takes them verbatim; typing them would need
  casts.

## Size

Production lines: builder/ 623 after the review fixes (605 at first build) against ~450: over by ~155, the room went to
the doc.ts-derived input types (refs.ts) and to the doc-order emission. Examples: betacell 212 -> 176, nucleoid 115 ->
119, gallery 187 -> 179, exosome 328 -> 332, yeast 419 -> 448 (1261 -> 1254): not shorter overall, the brief's "reads
shorter" holds only for betacell (shared looks, `q`).

## Review

| Finding                                                                              | Severity               | Verdict   | Commit / open                                                                |
| ------------------------------------------------------------------------------------ | ---------------------- | --------- | ---------------------------------------------------------------------------- |
| M1 base moved: no `revision`, no `look` kind; NEW1 look ids not reserved             | must                   | confirmed | f5639148c                                                                    |
| M2 `build()` shares arrays and nodes with the builder; N5 `add` keeps caller objects | must                   | confirmed | c989145ad                                                                    |
| M3 fiber `path.resource` a plain string                                              | must (skeptic: should) | confirmed | 85fff6637, a00243212                                                         |
| M4 no changelog                                                                      | must (skeptic: should) | confirmed | 03e477fd8                                                                    |
| S1 type tests run by nothing                                                         | should                 | confirmed | 325f332ea (script; CI does not follow `tsconfig.test.json`, repo-wide, open) |
| S2 `get` reserves, a later generated id skips it                                     | should (skeptic: nit)  | confirmed | wording in §3.15, 74ecea7b4; open: no code change                            |
| S3 id suffix scan quadratic                                                          | should                 | confirmed | 2d7c9b0dc                                                                    |
| S4 inner membrane a type error                                                       | should                 | confirmed | 04f2570c8, a00243212                                                         |
| S5a `range` one number                                                               | should                 | confirmed | 1506c6c2e                                                                    |
| S5b/NEW2 `q` and `printMesoQL` do not quote numeric or `;` atoms                     | should                 | confirmed | open (TODO: shared printer fix in format/mesoql.ts)                          |
| S6 other-builder ref compiles                                                        | nit                    | confirmed | Decided, open for Ludo                                                       |
| N1 undefined or empty values in the document                                         | nit                    | confirmed | a1743055c                                                                    |
| N2 key order wording                                                                 | nit                    | confirmed | 74ecea7b4 (wording)                                                          |
| N3 weak site typing for non-literal `sites`, `get`                                   | nit                    | confirmed | open                                                                         |
| N4 `q` accepts empty variadics, negative copies                                      | nit                    | confirmed | open                                                                         |
| N6 generated annotation ids collide with later explicit                              | nit                    | refuted   | the general explicit-id rule                                                 |
| N7 empty label skips the fallback                                                    | nit                    | confirmed | ac19e116b; open: ß/Æ/α slugs                                                 |
| N8 site-id test cannot fail                                                          | nit                    | confirmed | c5162a26d                                                                    |
| N9 `as unknown as MesoBuilder` cast                                                  | nit                    | confirmed | open                                                                         |

Counts: 20 reviewer findings (4 must, 6 should, 9 nits + 1 more should) of which 19 confirmed, 1 refuted; 3 new from the
skeptic (NEW1 fixed, NEW2, NEW3 as above).
