# The MesoViewSpec spec, Seq*-style (2026-11-08, lane `mvs-spec-reference`)

## Brief

- **Asked** (Ludo, 2026-11-08: "usable like Seq\*"; queued until streaming merged). `packages/mesoscale/_spec/` shaped
  like `packages/sequences/_spec/`: a README (what MesoViewSpec is, the packages and their entries, principles,
  glossary), the spec split by topic, and reference tables generated from the code with a check that fails when they are
  stale. **Check:** Ludo opens `packages/mesoscale/_spec/README.md` and finds, in the order Seq\*'s README has them,
  what it is, the packages, the principles and a glossary; each topic file links back;
  `pnpm -C packages/mesoscale/spec spec` passes, and fails after a MesoQL symbol or an issue code is added without
  regenerating.
- **Spec:** the new `_spec/README.md`; `design.md` split into topic files (`format.md` the document, `mesoql.md`,
  `ir.md`, `runtime.md` with resolvers and streaming, `views.md` session state and the camera) keeping design.md as the
  design record for David (rationale, measurements, §11 decisions, references) with links into the topic files; nothing
  said twice. `prism.md` and `renderer-recommendations.md` stay as they are (linked from the README).
- **Generated** into `_spec/reference/` (never edited by hand, a header saying so): the document's node kinds and their
  fields (from `format/doc.ts`: a small generator over the TypeScript types, or a table the code exports; choose what
  Seq\* does), issue codes (`format/issues.ts`), MesoQL's symbols (`format/mesoql.ts`), the built-in resolvers (id,
  version, arrangements, locations, formats, honours), the CLIs if `mvs-skill-cli` has merged by then. `mesoql-skill.md`
  belongs to `mvs-skill-cli`: link it, do not generate it here.
- **The check** (`packages/mesoscale/spec/scripts/spec.ts`, modelled on `packages/sequences/scripts/spec.ts`):
  regenerates the reference and fails on a diff; checks every source file under `packages/mesoscale` has Mol\*'s header;
  checks links between `_spec` files resolve. A `spec` script in `packages/mesoscale/spec/package.json`; a quick-lane
  test that runs the check.
- **Tests:** the check itself (quick): a stale table fails it (a test edits a copy), a missing header fails it, a broken
  link fails it.
- **Touches:** `packages/mesoscale/_spec/*` (new files, design.md trimmed to links where text moves),
  `packages/mesoscale/spec/scripts/` (new), `packages/mesoscale/spec/package.json` (a `spec` script only), a test.
  **Stays off:** `mvs-patch`'s files (`format/patch.ts`, doc.ts Look, sexpr.ts patch codec, the adapter) and
  `mvs-skill-cli`'s (`spec/src/cli/`, `_spec/reference/mesoql-skill.md`, the `bin` entries); code only read.
- **Size:** ~350 production lines (generator and check), plus the spec moved and written (~1,500 lines moved, ~300 new).
- **Lane model:** Sonnet; the README's principles and glossary and the split of design.md designed on Opus.
- **Steps and models:** 1. Opus: the README's principles and glossary, and the split plan (which section goes where,
  what stays in design.md) 2. Sonnet: move the text, links 3. Sonnet: the generators and the check, tests 4. Sonnet:
  checks 5. gate (Opus).

## Built

## Decided

## Learned

## Size

## Review

| Finding | Severity | Verdict | Commit / open |
| ------- | -------- | ------- | ------------- |
