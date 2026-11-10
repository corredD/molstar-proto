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
