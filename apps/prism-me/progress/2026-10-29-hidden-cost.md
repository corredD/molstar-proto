# Do hidden particles cost a frame? (2026-10-29, lane `hidden-cost`)

## Brief

- **Asked** (Ludo, [../TODO.md](../TODO.md) Next, "From the cellVIEW evaluation", item 6; wants it testable by
  2026-10-29): on WebGPU, CellPack MG with 90 % of the particles hidden against none hidden. If the two are close, the
  GPU cull does not skip hidden instances and a visibility table would help. **Check:** the numbers in this file; if a
  table is built, hiding most of a model makes it faster.
- **Why:** cellVIEW skips a hidden ingredient before its draw batch is built
  ([../\_spec/cellview.md](../_spec/cellview.md) §1); prism-me's hidden part is a transparency of 1 on its entities
  (`particleLayerState`, `packages/plugin/core/src/state/transforms/particles/layers.ts:111-123`), which
  [the evaluation](2026-10-28-cellview-evaluation.md) (speed idea 1) guessed is still drawn.
- **Measure:** the frame time with about 90 % of the particles hidden (the app's eye, `mesoscale.style visible:false`),
  none hidden, and the same 90 % removed (never in the list). WebGPU first, WebGL2 for comparison; several runs, a fixed
  camera, a steady state.
- **Not in scope:** building the cull change. If it is worth it, this lane says so and estimates it; Ludo decides.
- **Gate:** `pnpm format:check`. A measurement-only PR: no reviewer or skeptic; the method is written so it can be
  repeated.
