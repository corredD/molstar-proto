# The examples' resources resolve from the document (2026-11-09, lane `mvs-example-uris`)

## Brief

- **Asked** (found by lane `mvs-open` in the app, 2026-11-09; Ludo: "make it usable"). Opening
  `?mesoviewspec=/packages/mesoscale/examples/exosome.mesoviewspec.json` in prism-me draws only the lipids and the
  picks: the recipe 404s, because the example's resource uris (`examples/fixtures/exosome.cellpack-gpu.json`) are
  relative to `packages/mesoscale/spec/src`, not to the document. **Check:** that URL on a prism-me dev server from this
  worktree draws the whole exosome (90,736 copies in 3 lists, as a drop of the four files does), with no 404 in the
  console; the β-cell and the other committed examples open the same way;
  `pnpm -s -C packages/mesoscale/spec meso-compile examples/betacell.mesoviewspec.json` works without `--base`.
- **Spec:** `_spec/format.md` (Resources: a relative `uri` resolves against the document's own location; the rule a host
  follows); `_spec/views.md` or prism.md §3 if they say otherwise; design.md §12.1 CLIs (`--base` default).
- **Decide (Sonnet, simple):** the fixtures stay where they are (`spec/src/examples/fixtures/`, imported by the example
  code); the committed JSON examples (`packages/mesoscale/examples/*.mesoviewspec.json`) carry uris relative to their
  own folder (`../spec/src/examples/fixtures/…`), or the fixtures the JSON names are copied next to the JSON — pick the
  one that keeps one copy of each fixture. The CLIs resolve a relative uri against the document file's folder by
  default; `--base` stays as an override. The in-memory loaders the tests use (by resource id) are unchanged.
- **Tests:** quick: every committed example's every relative `uri` resolves to an existing file from the document's
  folder; the CLIs compile each example with no `--base` and no `resource.unavailable`; the examples' regenerated JSON
  is stable (`MESO_UPDATE_EXAMPLES=1`, then `npx biome format --write packages/mesoscale/examples`).
- **Touches:** `packages/mesoscale/spec/src/examples/*.ts` (the uri strings), `packages/mesoscale/examples/*.json`
  (regenerated), `packages/mesoscale/spec/src/cli/` (the default base), `packages/mesoscale/spec/package.json` scripts
  (drop `--base spec/src` if no longer needed), the spec text. **Stays off:** `packages/mesoscale/molstar/`,
  `packages/extensions/`, `apps/prism-me/` (the `mvs-tree` lane's), except reading them.
- **Size:** ~60 production lines.
- **Lane model:** Sonnet.
- **Steps:** 1. the failing test (Sonnet) 2. uris and CLI default (Sonnet) 3. regenerate, checks (Sonnet) 4. the app
  check on a prism-me dev server, port 1357 (Sonnet) 5. gate (Opus agents).

## Built

- The exosome and beta-cell recipe uris are `../spec/src/examples/fixtures/<file>` (relative to
  `packages/mesoscale/examples`); the examples' JSON and `builder-oracles.json` regenerated. `fixture://x` was already
  `fixtures/x` beside the document (`examples/fixtures/` holds the meshes and tables).
- `resourceLoader` (CLIs): `--base` dirs first, then the document's folder; the cwd fallback is gone; the scripts drop
  `--base spec/src`. format.md (Resources, `uri`) and design.md §12.1 say it.
- Tests: `examples.test.ts` (every shipped-format relative uri of every committed example is a file from its folder),
  `cli.test.ts` (every example compiles with no `--base`, no `resource.unavailable`, exosome 90736 copies; the loader's
  order: `--base`, then the document, never the cwd), two molstar tests' expected recipe URL.
- App check on a prism-me dev server from this worktree, port 1357 (stopped after):
  `/apps/prism-me/build/?mesoviewspec=/packages/mesoscale/examples/exosome.mesoviewspec.json` draws 3 lists (picks 24,
  recipe 2,049, lipids ~88.6k: 90,736 copies), the recipe fetched from `/packages/mesoscale/spec/src/examples/fixtures/`
  with 200, no 404; the beta-cell draws its 5 lists, its recipe 200. Console: only `p.catalase: 354 of 506 placed` (the
  example's own).

## Decided

- One copy of each fixture (Sonnet): the JSON names `../spec/src/examples/fixtures/...`; the fixtures stay put.
- `--base` stays an override, tried before the document's folder (the brief's word; the first cut had it after, a
  reviewer found the test could not tell).
- The cwd fallback is dropped: the rule is the document's folder, as the app reads it.
- `packages/mesoscale/molstar/src/_test/{mesoviewspec,undo}.test.ts` edited (two lines: the recipe's expected URL),
  forced by the uri change, against the brief's "stays off" (that is about `mvs-tree`'s sources).
- Not shipped and not tested as files: the binary `tilts.mrc`, `tomo_01.mrc`, the yeast `pipeline/*.npz`.

## Learned

- The CLI already tried the document's folder; the bug was only the uris. The dev server serves the repo root, so
  `../spec/src/...` is reachable there; a deploy of `examples/` alone would lose the recipes.
- nucleoid and gallery exit 1 under `meso-compile` (unmet constraints) and yeast on `resolver.unknown`, with or without
  this change.

## Size

~25 production lines (examples 2, io.ts 5, scripts 2, spec text ~8) against ~60; tests ~60.

## Review

| Finding                                                              | Severity   | Verdict                  | Commit / open                              |
| -------------------------------------------------------------------- | ---------- | ------------------------ | ------------------------------------------ |
| No `.v6/changelogs/mvs-example-uris.md`                              | must-fix   | confirmed                | changelog commit                           |
| `--base` tried after the document, not an override; test cannot tell | should-fix | confirmed                | override-order commit (failing test first) |
| No test pins the dropped cwd fallback                                | nit        | confirmed                | same commit                                |
| "Every example compiles" test hard-coded, weak asserts               | nit        | confirmed                | same commit (readdir, exosome copies)      |
| Progress file empty; molstar test edits unrecorded                   | nit        | confirmed                | this file                                  |
| format.md claims "every host ... a script"                           | nit        | confirmed                | spec commit                                |
| App check may 404 on the recipe (skeptic)                            | should     | refuted by the app check | port 1357: 200                             |
