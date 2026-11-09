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

## Decided

## Learned

## Size

## Review

| Finding | Severity | Verdict | Commit / open |
| ------- | -------- | ------- | ------------- |
