# MesoQL skill and the meso-* CLIs (2026-11-08, lane `mvs-skill-cli`)

## Brief

- **Asked** (Ludo, 2026-11-08: "usable like Seq\*", app first). What an agent and a terminal need to use MesoViewSpec,
  as Seq\* has `seqql-skill.md` and the `svs-*` CLIs. **Check:** (1)
  `pnpm -C packages/mesoscale/spec meso-validate examples/betacell.mesoviewspec.json` prints its issues (S-expression by
  default, `--json`), exit 1 on an error; `meso-compile` writes the IR, `meso-print` turns JSON into the S-expression
  spelling and back (`--json`), `meso-trace <doc> <id>` prints a provenance trace, `meso-query <doc> '<MesoQL>'` prints
  the copies an address picks; (2) `packages/mesoscale/_spec/reference/mesoql-skill.md` reads like
  `packages/sequences/_spec/reference/seqql-skill.md` and an agent given only it writes valid addresses for 10 written
  questions about the β-cell (an eval in the quick lane checks the answers' validity with `parseMesoQL`, the questions
  and expected addresses fixed in the test).
- **Spec:** design.md §3.8 (MesoQL: the skill is generated from `MesoQLSymbols`, never edited by hand), a new short
  "CLIs" section (§12 Packaging, or a new §12.1).
- **Tests:** quick: each CLI on the examples (exit codes, output parses back: `readData` for S-expression output, JSON
  for `--json`), a bad document's issues, `meso-query` against `evaluateMesoQL`; the skill file is up to date with the
  symbol table (regenerated text equals the committed file, as Seq\*'s spec check does); the 10-question eval.
- **Touches:** new `packages/mesoscale/spec/src/cli/` (one file a command, a shared arg parser), a skill generator in
  `format/mesoql.ts` or `scripts/` (reads `MesoQLSymbols`; exports the skill text so the viewer's agent can load it),
  `packages/mesoscale/spec/package.json` (`bin` entries and scripts), `_spec/reference/mesoql-skill.md` (generated).
  **Stays off:** the streaming lane's files (`format/doc.ts`, `validate.ts`, `runtime/streaming.ts`,
  `molstar/src/session.ts`, stories; reads them only); `package.json` `exports` beyond the `bin` entries.
- **Size:** ~400 production lines (tests apart).
- **Lane model:** Sonnet, with the CLI surface (commands, flags, output formats, exit codes) and the skill's wording
  designed on Opus first.
- **Steps and models:** 1. Opus: the CLI surface and the skill's structure, modelled on `packages/sequences/core`'s
  `svs-*` CLIs (`format/`) and the SeqQL skill generator 2. Sonnet: the CLIs and their tests 3. Sonnet: the skill
  generator, the generated file, its up-to-date test 4. Opus: the eval's questions and expected addresses 5. Sonnet:
  checks 6. gate (Opus).

## Built

## Decided

## Learned

## Size

## Review

| Finding | Severity | Verdict | Commit / open |
| ------- | -------- | ------- | ------------- |
