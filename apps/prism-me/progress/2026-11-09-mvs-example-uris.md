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

## Decided

## Learned

## Size

## Review

| Finding | Severity | Verdict | Commit / open |
| ------- | -------- | ------- | ------------- |
