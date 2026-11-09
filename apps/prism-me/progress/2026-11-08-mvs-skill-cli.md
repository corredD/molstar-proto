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

### Step 1 (Opus): CLI surface and skill structure

**All five commands**

- Input: a path or `-` (stdin), read with `JSON.parse` first and `readData` as the fallback (a leading `[` decides
  nothing: S-expression vectors start with it). One document per invocation, so stdout is one form that reads back.
- stdout carries only the product: an S-expression (`printData`) by default, `JSON.stringify(v, null, 2)` with `--json`,
  a file with `-o <file>` (pnpm prints its banner on stdout: use `pnpm -s` or `-o`). stderr carries one line per issue,
  in svs-validate's format `<where>#<path>: <severity> <code>: <message>`, then
  `<file>: N error(s), N warning(s), N note(s)`.
- Exit codes: 0 no error issues; 1 error issues (the product is still written); 2 a usage error, an unreadable file, or
  text that is neither JSON nor an S-expression (it has no paths to report issues at).
- Resources (compile and query): a relative uri is tried against each `--base` (repeatable), then the document's
  directory, then cwd. `fixture://x` is `fixtures/x` under the same bases; `file://` is a path; `http(s)` is never
  fetched (the runtime reports `resource.unavailable`). `.json` files are parsed, other files read as utf8: the content
  hash goes into the IR keys (`m.isg@…`), and the examples test loads parsed objects.
- **Learned:** the recipe uris of the β-cell and the exosome resolve under `packages/mesoscale/spec/src`, not under
  `packages/mesoscale` as the brief says; the `fixture://` files are in `packages/mesoscale/examples/fixtures`. The
  scripts pass `--base spec/src`, and the examples are not edited. **Commands**
- `meso-validate <doc> [--json] [-o f]`: runs `validate(doc)`, the static check, MesoQL slots included. stdout is the
  issue list (`[]` when clean; a test checks `printData([])` round-trips). Load and resolve issues are meso-compile's.
- `meso-compile <doc> [--json] [-o f] [--base d]...`: runs `compile` with `DefaultResolvers`. stdout is
  `irToJson(ir, issues)` with `IRCodec`, or `{issues}` when there is no IR (the shape of `examples/*.ir.json`). stderr
  adds `N copies in K sets, R resolver runs`, with no ms, so stdout is deterministic.
- `meso-print <file> [--json] [-o f]`: prints an S-expression unless `--json`, with no automatic flip: one rule for all
  five, and S→S re-lays the text out canonically. The codec is `DocumentCodec` when `format === 'meso_view_spec'` or the
  head is `meso_view_spec`, `IRCodec` otherwise (IR, issue lists, traces). It does not validate.
- `meso-trace <doc> <id> [--json] [-o f]`: prints `traceToSexprData(trace(doc, id))` with `IRCodec`, or the same tree as
  JSON. An empty trace prints `<id> names nothing traceable` and exits 1.
- `meso-query <doc> <address|-> [--json] [-o f] [--limit n=20] [--check] [--want selection|site|residues] [--base d]...`
  1. Runs `parseMesoQL(q, {kinds: indexDoc(doc).kinds, sites}, 'query', want)`, with the head's own type when there is
     no `--want`. `sites` is rebuilt in the CLI from the entities and the superstructures' entities (`validate.ts` is
     off limits). Errors go to stderr (`query: error mesoql.…`), then exit 1.
  2. A `site` or `residues` address, or `--check`, stops there: it prints `(:address … :type site)` and exits 0
     (`evaluateMesoQL` materializes only selections, and residues need Mol*).
  3. A selection is compiled and evaluated with `evaluateMesoQL`. It prints
     `{address: printMesoQL(e), type, copies: lociSize, populations: {id: n}, ids: lociToIds(l, ir, limit)}`. The counts
     map a virtual key `<set>@<i>><template>` to its template set, as `lociToIds` does; `mesoql.empty` goes to stderr.
  - Step 5 checks that a quoted address survives pnpm's forwarding through `sh`; if it does not, `-` is the documented
    form. **package.json** (only `bin` and `scripts`)
- `bin`: `meso-<cmd>` → `./lib/cli/meso-<cmd>.js` (each file starts with `#!/usr/bin/env node`). `scripts`:
  `"meso-<cmd>": "tsc -b && cd .. && node spec/lib/cli/meso-<cmd>.js"`, with `--base spec/src` for compile and query.
  The build comes first because lib may be stale (an up-to-date `tsc -b` takes about 1 s). `cd ..` because the check's
  path `examples/betacell…` is relative to `packages/mesoscale`; pnpm appends the extra arguments to the last command.
  So the scripts' paths are relative to `packages/mesoscale`; the bins use the real cwd. **`src/cli/io.ts`** (the only
  CLI file that imports `node:`)
- `CliIO { cwd; out(s); err(s); read(path): string; write(path, s) }` and `nodeIO`; `read('-')` is stdin.
- `CliSpec { usage; positionals: number; flags?: string[]; options?: string[] }` (options repeatable);
  `CliArgs { pos: string[]; flag(n): boolean; opt(n): string | undefined; opts(n): string[] }`.
- `command(argv, io, spec, body: (a) => Promise<number>)`: a usage error returns 2; a thrown `CliError(code, msg)`, or
  any other throw (code 2), is reported in one line.
- `readValue(io, path): {value; sexprHead?}`, `readDoc(io, path): MesoViewSpecDoc`, `emit(io, a, value, codec?)`,
  `reportIssues(io, where, issues): 0 | 1`, `resourceLoader(io, docPath, doc, bases): (id) => unknown`.
- `runMain(url, run)` runs only when `pathToFileURL(realpathSync(argv[1])).href === url`, so the bin symlinks work. It
  sets `process.exitCode`, never `process.exit`, so piped output is not truncated.
- Each command exports `run(argv, io = nodeIO)` (one `command(...)` call) and ends with `runMain(import.meta.url, run)`.
  **Skill: `src/format/mesoql-skill.ts`** (no `node:` imports: the viewer loads it through the existing `./*` export)
- `mesoQLSkill(opts: { ids?: string } = {}): string`, where `ids` is the host's line naming the scene's ids (Seq*'s
  `refs`). Also exported: `mesoQLSignature(s: QSymbol)`, `MesoQLComposed: {text, says}[]`,
  `MesoQLIssueCodes: {code, says}[]`.
- Signatures, derived from the table: an `id` positional is its `ref`'s initial (p, i, e, c, m, s); a selection is `Q`;
  an `int` or `word` is the argument's name; `rest` is `x x...`; optional is `name?`. A keyword's value is `Q`, `b`, `n`
  or `d`; word and range keywords take their own initial in upper case: `(in c c... :nested b :location L)`,
  `(copies p start count?)`.
- Sections, in Seq*'s compact text (96 columns):
  1. `MESOSCALE ADDRESSES (MesoQL)`: an address picks copies; one S-expression with the document's ids; `;` comments.
  2. Tags: `[MesoQL]…[/MesoQL]`, one address per block, none as a tool's argument. 3. `{ids}`.
  3. The slot sets the type: a selection in a look's `select`, a view's `selection` and `cutaway`, a camera's `focus`,
     an annotation's `target`; a site in a relation's `entry` and `exit`; residues in a site's `at`, a contact's `a`,
     `b`.
  4. Copy ids are `<population>#<ordinal>` and, in a part, `<instance copy>/<population>#<ordinal>`. `copies` holds for
     one resolution; `instance` names the same copy every time.
  5. PATTERNS, hand-written: narrow with `and`; remove with `(not Q :in U)`; `:nested false`; `:location membrane`;
     `within` measures centre to centre in the document's unit; `(part Q p.inner)`; site and residues only in their
     slots.
  6. Tables derived from the symbols, each line `signature  description`: SELECT (returns a selection, takes none),
     COMBINE (returns a selection, takes one), SITES AND RESIDUES (the rest).
  7. EXAMPLES: "Ids in the examples are illustrative.", every symbol's `example` in table order, then about 6
     `MesoQLComposed` lines.
  8. RESULTS AND ERRORS: what a query reports (canonical address, copies, per-population counts, first ids; check them
     against the question); one line per code: `mesoql.` `syntax`, `form`, `symbol.unknown`, `type`, `keyword`, `range`,
     `arity`, `argument`, `ref.missing`, `ref.kind`, `site`, `empty` (a warning); then "resend the corrected address".
- The committed file uses Seq*'s wrapper verbatim (`# MesoQL skill` / `Generated from the symbol table; do not edit.` /
  a fenced `text` block) at `_spec/reference/mesoql-skill.md`. **Tests (quick lane, in-process; no spawn)**
- `_test/mesoql-skill.test.ts`: `toMatchFileSnapshot('../../../_spec/reference/mesoql-skill.md')`, updated with
  `pnpm test:unit packages/mesoscale/spec -u` (Seq*'s mechanism). Every signature appears in the skill; every example
  and composed text parses clean; an `EMITTED` table gives one bad address per code, and its codes equal
  `MesoQLIssueCodes` (a source regex would miss `err(\n'form'`).
- `_test/cli.test.ts` calls `run(argv, memoryIO)`: captured out and err, cwd `packages/mesoscale`, an overlay of virtual
  files. No build is needed and it is fast; step 5's `pnpm -C` check covers the bins.
- Cases, on the β-cell: validate exits 0, its stdout reads back, and `--json` gives the same value; a bad document exits
  1 with `mesoql.ref.missing` at its path; compile `--json --base spec/src` equals `examples/betacell.ir.json` by value;
  print JSON→S→JSON is the identity; trace's S-expression equals `--json`; query `(part …)` equals `evaluateMesoQL` plus
  `lociToIds`; a site address exits 0; usage errors exit 2. **Budget (~400)**: `io.ts` 110; validate 20, print 30, trace
  25, compile 35, query 70; `mesoql-skill.ts` 110.

## Learned

## Size

## Review

| Finding | Severity | Verdict | Commit / open |
| ------- | -------- | ------- | ------------- |
