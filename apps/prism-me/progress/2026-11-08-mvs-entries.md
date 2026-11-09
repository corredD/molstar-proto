# Package entries and the folder graph (2026-11-08, lane `mvs-entries`)

## Brief

- **Asked** (Ludo, 2026-11-08: "usable like Seq\*"). Seq\*'s packages export one entry per folder (a subpath export that
  names what the folder offers, the host's contract), import across folders only through those entries, and test the
  folder graph (`packages/sequences/core/_test/layers.test.ts`, `layers.grit`). `@molstar/meso-spec` and
  `@molstar/meso-molstar` today export `./*` (any file) and import across folders by relative path. **Check:** a host
  imports `@molstar/meso-spec/format`, `/ir`, `/runtime`, `/resolvers`, `/examples`, `/cli` (and `/builder` if
  `mvs-builder` has merged) and nothing deeper; `pnpm test:unit packages/mesoscale` includes a layers test that fails
  when, say, `format/` imports `runtime/`.
- **Spec:** the packages section of the spec (design.md §12 Packaging, or `_spec/README.md`'s packages table if
  `mvs-spec-reference` has merged by then): each entry, what it holds, what it may import, as Seq\*'s README table.
- **Decides** (Opus): the folder graph (expected today: `format` ← nothing; `ir` ← `format`; `resolvers` ← `format`,
  `ir`; `runtime` ← `format`, `ir`, `resolvers`?; `examples`, `cli` ← all; check against the real imports and say where
  the code disagrees); what each entry exports (an `index.ts` per folder naming the public API; internals unexported,
  tests reach them by path); `./*` kept or removed (Seq\* removes it).
- **Tests:** quick: the layers test (each folder imports only its allowed folders, across folders only by entry); every
  type a public signature names is exported by some entry (Seq\*'s rule; a small check if Seq\* has one, else the tsc
  build of a consumer file importing only entries); the existing tests still pass with imports rewritten.
- **Touches:** `packages/mesoscale/spec/package.json` and `packages/mesoscale/molstar/package.json` (`exports`), a new
  `index.ts` per folder, imports rewritten across folders in both packages, `_test/layers.test.ts` (new), Biome
  overrides if Seq\* uses them (`biome.json`'s `packages/sequences` overrides as the model), workspace inventory if the
  check asks. **Stays off:** `mvs-builder`'s new `builder/` folder (add its entry only if it has merged into
  `me/mesoviewspec` when you start step 3; else leave a note) and `mvs-spec-reference`'s `_spec/` moves and
  `spec/scripts/`.
- **Size:** ~250 production lines (mostly index files and rewritten imports).
- **Lane model:** Sonnet; the graph and the entries' contents decided on Opus.
- **Steps and models:** 1. Opus: the graph and the entries, from the real imports (a Sonnet subagent lists every
  cross-folder import first) 2. Sonnet: index files, exports, imports rewritten 3. Sonnet: the layers test, the checks
  (`check:workspace` matters here) 4. gate (Opus).

## Built

- `@molstar/meso-spec`: an `index.ts` per folder (`format`, `ir`, `runtime`, `resolvers`, `examples`, `cli`), explicit
  exports; `package.json` `exports` are those six, `./_test/*: null`, `sideEffects: false`; `./*` and `.` and the root
  `src/index.ts` gone. Cross-folder imports in `src/` name the entries (one commit); Biome's `noRestrictedImports` lets
  the package import its own entries.
- `@molstar/meso-molstar`: `src/index.ts` (`.`), `./*` gone, `./_test/*` and `./_stories/*` hidden; its imports of
  meso-spec name the entries (one commit).
- Behaviour-neutral moves that break the runtime/resolvers cycle: `mulQuat`, `rotationOf` to `ir/placements`; `meshArea`
  to `runtime/readers`. Exported `Anchor`, `At`, `ListKey`, `Kind`, `StreamNode`, `SetBounds`.
- `spec/src/_test/layers.test.ts` (quick): the graph, entries only across folders, no `export *`, the six entries; with
  a check that the check fails on a wrong edge. `spec/src/_test/exports.test.ts` (heavy): the contract (found
  `SetBounds`; fixed in its own commit).
- design.md 12.2 Entries, README lines. Checks run: `tsc -b`, `tsc --noEmit -p apps/prism-me`, `lint`,
  `check:workspace`, `test:unit`/`medium`/`heavy` of `packages/mesoscale`, Storybook dev: the stories' modules and their
  meso-spec entries resolve (HTTP 200; index.json 422 entries, 20 mesoscale).
- Rebased onto `me/mesoviewspec` after the review began: `mvs-builder` and `mvs-spec-reference` had merged (the review's
  M1). Added the `/builder` entry (explicit type exports for its refs; `builder` <- `format`; `examples` <- `builder`),
  rewrote the examples' conflicted import blocks with the same script, rewrote `_spec/README.md`'s Packages section (the
  entries and graph live there; design.md 12.2 points to it).
- (superseded) note for `mvs-builder`: not merged at the time of step 3 (`git log me/mesoviewspec` ended at the R5
  opt-in). When it merges: add `builder` to `ALLOWED` in `layers.test.ts`, a `./builder` export block and
  `builder/index.ts`, a row in design.md 12.2, and the `@molstar/meso-spec/builder` negation in `biome.json`.

## Decided

Opus (design step; the Sonnet inventory first), 2026-11-08. `mvs-builder` had not merged into `me/mesoviewspec` when the
lane started: no `/builder` entry; add it when that lane merges (folder `builder` may import `format`, `ir`, `runtime`,
`resolvers` as it needs; one line in the layers test's ALLOWED, one export block, one table row).

- **Graph** (`@molstar/meso-spec`): `format` <- nothing; `ir` <- `format`; `runtime` <- `format`, `ir`; `resolvers` <-
  `format`, `ir`, `runtime`; `examples` (with `examples/fixtures`) <- `format`, `runtime`, `resolvers`; `cli` <-
  `format`, `ir`, `runtime`, `resolvers`, and the only folder with `node:*`.
- **Where the code disagreed with the brief:** the brief expected `runtime <- resolvers`; the code has
  `resolvers -> runtime` (every resolver implements runtime's `Resolver` contract and uses `runtime/random`,
  `runtime/readers`) and runtime leaned back on three pure helpers (a cycle). Fix, behaviour-neutral: `mulQuat` and
  `rotationOf` move from `resolvers/precomputed` to `ir/placements`; `meshArea` from `resolvers/geometry` to
  `runtime/readers`. Also: `examples` imports no `ir`; `examples/fixtures` is part of `/examples`.
- **Entries:** `/format`, `/ir`, `/runtime`, `/resolvers`, `/examples`, `/cli` for meso-spec, each an `index.ts` of
  explicit `export { ... } from` (no `export *`); internals (unit tables, `canonicalJson`, `readerFor`, the individual
  resolvers, `geometry`, `packing`) stay unexported and tests reach them by path. `./*` and `.` removed, the root
  `src/index.ts` deleted (nothing imports it), `./_test/*: null`, `sideEffects: false`. `@molstar/meso-molstar`: one `.`
  entry (session, adapter, camera, MolViewSpec export, particle list); `./*` removed; stories and tests import their
  package relatively and meso-spec through entries.
- **Enforcement:** Biome keeps banning Mol* in `spec/src` with negations for the package's own entries;
  `_test/layers.test.ts` (folder graph, no `export *`); a heavy `_test/exports.test.ts` (every type a public signature
  names is exported by some entry; port of Seq*'s `contractGaps`).
- **Spec:** design.md 12.2 Entries (table: entry, holds, imports); `packages/mesoscale/README.md` lines.
  `_spec/README.md` does not exist yet (`mvs-spec-reference` has not merged).

## Learned

- The brief's expected graph had the runtime/resolvers edge backwards; the real code was a cycle of three pure helpers.
  `examples` never imports `ir`.
- Biome's `!@molstar/...` negations are needed for the package's own entries once it imports itself; `tsc` resolves
  self-references through the `molstar-src` custom condition.
- `check:workspace` does not look at private packages' `exports`; no inventory change was needed. `tsc -b` (tsgo)
  panicked once on the first run and passed on the second.
- `pnpm -C storybook build --test` was not run; `storybook dev` plus fetching the stories' transformed modules shows the
  entries resolve.

## Size

Brief: ~250 production lines. Built: ~640 added, ~315 removed in `packages/mesoscale` outside tests and specs, of which
~310 are the seven index files (the format's ~50 document types are named one by one, as `export *` is not allowed) and
~330 changed lines are the mechanical import rewrites (merged imports). Over the brief by that: named exports and
rewrites.

## Review

| Finding                                                                                                                         | Severity   | Verdict                                                           | Commit / open                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| M1 the `/builder` entry missing, lane behind its base (rebase conflicts: 5 example import blocks, `src/index.ts` modify/delete) | must-fix   | confirmed (skeptic: 6 conflicts)                                  | rebased; entry and graph in the commits "the /builder entry" and "builder and examples import by entry" |
| M2 importing `@molstar/meso-spec/cli` throws when `argv[1]` is no path (`node -e`), `runMain` called `realpathSync`             | must-fix   | confirmed (minor)                                                 | test `runMain ... does not throw`, fix `runMain is false, not a throw`                                  |
| M3 no changelog; `mvs-patch.md` and `mvs-builder.md` name paths that no longer resolve                                          | must-fix   | confirmed                                                         | `.v6/changelogs/mvs-entries.md` says what replaces them; other lanes' files left alone                  |
| S1 `prism.md` proposes `@molstar/meso-molstar/document-model`                                                                   | should-fix | confirmed                                                         | prism.md one line                                                                                       |
| S2 contract test tagged heavy, brief says quick                                                                                 | should-fix | partly refuted (it takes ~2.5 s, not 0.5 s; the deviation stands) | quick lane, 30 s timeout                                                                                |
| S3 no-star regex misses `export type *`, `export * as` (the builder index had one)                                              | should-fix | confirmed                                                         | `exportsStar` with cases, in the layers test commit                                                     |
| S4 negative self-check used an identity resolver                                                                                | should-fix | confirmed                                                         | real resolver and legal relative cases, same commit                                                     |
| S5 `mvs-spec-reference`'s README said the opposite                                                                              | should-fix | confirmed                                                         | Packages section rewritten here                                                                         |
| N1 unused `examples` Biome negation                                                                                             | nit        | fixed                                                             | dropped with the builder commit                                                                         |
| N2 design text "unit tables not exported" vs `LengthToAngstrom`                                                                 | nit        | fixed                                                             | README says "but `LengthToAngstrom`"                                                                    |
| N3 specifier regex misses template-literal `import()`, `require`, `@import`                                                     | nit        | left open                                                         | none in src today                                                                                       |
| N4 `@typescript/typescript6` not in spec's devDependencies                                                                      | nit        | left open                                                         | resolves through the root; one line when someone adds the dependency                                    |
