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

## Learned

- Explicit ids dominate the rewrites: a label's slug rarely equals the short ids the literals use (`e.granule` for
  "insulin secretory granule"), so the builder pays through refs, `q`, shared looks and checked slots, not line count.
- Sections are emitted in document order, so evidence and resources are made first and later nodes cite their refs; only
  true cycles (activity <-> alignment/model, an entity's own site address) need `get`.
- An importer's nodes (cellPACKgpu) have plain-string populations: `add` takes them verbatim; typing them would need
  casts.

## Size

Production lines: builder/ 605 (refs 182, builder 271, query 67, ids 69, index 16) against ~450: over by ~155, the room
went to the doc.ts-derived input types (refs.ts) and to the doc-order emission. Examples: betacell 212 -> 176, nucleoid
115 -> 119, gallery 187 -> 179, exosome 328 -> 332, yeast 419 -> 448 (1261 -> 1254): not shorter overall, the brief's
"reads shorter" holds only for betacell (shared looks, `q`).

## Review

| Finding | Severity | Verdict | Commit / open |
| ------- | -------- | ------- | ------------- |
