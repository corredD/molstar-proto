# MesoLocation as a union, `copy` built (2026-11-09, lane `mvs-location`)

## Brief

From `packages/mesoscale/_spec/mesoql.md`, "MesoLocation as a union" (proposed by David, answered by Ludo 2026-11-09).
Stacked on `me/mesoviewspec` at `07910b50e` (lane 4 merged). No dev port: no UI change. Runs before lanes 5 and 6, which
touch the same files (`runtime.ts`, the adapter, `document-model.ts`).

- **Check (Ludo):** none in the app beyond "nothing changed": the exosome opens, eyes, Show only and a look edit draw as
  before; the medium lane is green.
- **Spec:** mesoql.md "MesoLocation as a union" (the types, "Copies stay runs", "Only `copy` would be built at first").
- **Build:**
  - `MesoLocation` becomes a discriminated union. Only `{ kind: 'copy'; set; index }` is produced; the other kinds
    (`label`, `voxel`, `point`, `face`, `arc`) are declared as types, never produced, and documented as such.
  - `MesoLoci` becomes `{ copies: ReadonlyMap<string, readonly number[]>; labels?; voxels?; faces? }`, `VoxelBox`
    declared beside it. Only `copies` is ever filled.
  - Every consumer reads `.copies`: `ir/loci.ts` (`evaluateMesoQL`, `perInstance`, `within`, `lociSize`, `lociToIds`,
    `lociSphere`, the run combiners, `EmptyLoci`), `runtime/runtime.ts` (`materialize`), `molstar/src/prism-adapter.ts`
    (`drawnRuns`, `runsOn`), `molstar/src/document-model.ts` (`mesoLoci`), and any other caller `tsc -b` finds.
  - No new MesoQL symbols, no change to `Annotation.target` (both wait for the region and point work).
- **Tests:** a unit test that every location `evaluateMesoQL` or a pick yields has `kind: 'copy'`; a test that
  `MesoLoci` from an address has only `copies`; the existing loci, runtime, adapter and drive tests pass unchanged in
  behaviour (only their reads of `.copies` change).
- **Touches:** `packages/mesoscale/spec/src/ir/{loci,index}.ts`, `runtime/runtime.ts`, `packages/mesoscale/molstar/src/`
  (adapter, document model, the tree's pick-to-row if it builds a location); `reference/*.md` regenerated if a test says
  so; mesoql.md: "built: `copy`".
- **Size:** ~150 production lines (mostly mechanical).
- **Lane model:** Sonnet; Opus gate.
- **Steps:** 1. the types and `ir/loci.ts` (Sonnet) 2. the consumers (Sonnet) 3. checks 4. the gate (Opus).

## Built

- `ir/loci.ts`: `MesoLocation` is the discriminated union (`copy` produced; `label`, `voxel`, `point`, `face`, `arc`
  declared, documented as never produced); `MesoLoci` is `{ copies, labels?, voxels?, faces? }` with only `copies`
  filled; `VoxelBox`, `CopyRuns` (the run map, internal to the run combiners, `perInstance` and `within`),
  `lociOfCopies` and `lociToLocations` (the copy locations of a MesoLoci, what the first test reads) are new.
  `lociSize`, `lociToIds` and `lociSphere` take a MesoLoci and read `.copies`; `evaluateMesoQL` wraps its result with
  `lociOfCopies`. `ir/index.ts` re-exports them.
- Consumers read `.copies`: `runtime/runtime.ts` (`materialize`'s looks, selection, cutaway, the camera's whole-scene
  sphere; a failed parse gives `EmptyLoci`), `cli/meso-query.ts`, `molstar/src/prism-adapter.ts` (`runsOn`),
  `molstar/src/document-model.ts` (the cleared-look reads), plus the story and two test helpers. `tsc -b` found only
  these; no pick builds a MesoLocation (nothing in the tree takes one), so none changed.
- `mesoql.md`: "Built: `copy` only". Changelog `.v6/changelogs/mvs-location.md`. No `reference/*.md` change (no MesoQL
  symbol or issue code changed).
- Commits: `mesoscale: tests for MesoLocation as a union and MesoLoci with copies (failing)` (the two tests, both red),
  `mesoscale: MesoLocation is a union, MesoLoci is { copies, labels?, voxels?, faces? }` (types and consumers, green),
  then the docs commit (spec, changelog, this file).
- Checks: `npx tsc -b` clean; `vitest run packages/mesoscale packages/extensions/mesoscale` 458 pass, 22 fail, the same
  22 as on the base (cli.test.ts 8, spec.test.ts 13, examples.test.ts 1: Windows CRLF and path separators); the medium
  lane 68 pass, 8 skipped; biome lint and format clean on the touched files (checked on LF text: the worktree is CRLF).

## Size

Brief: ~150 production lines. Built: 92 insertions and 39 deletions in the six production files (about 130 changed
lines, of which ~55 are the union's and MesoLoci's declarations and comments); the rest is mechanical `.copies` reads.
Plus about 40 lines of tests and test-helper edits.
