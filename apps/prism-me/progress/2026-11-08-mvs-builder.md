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

## Decided

## Learned

## Size

## Review

| Finding | Severity | Verdict | Commit / open |
| ------- | -------- | ------- | ------------- |
