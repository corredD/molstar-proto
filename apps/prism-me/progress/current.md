# Current

What is in flight, one line a lane, linking to its progress file once written. Only the coordinating session (the main
checkout) edits this file ([../AGENTS.md](../AGENTS.md), How we work). What was built is the dated files beside it; what
is not built is [../TODO.md](../TODO.md).

## In flight

- **The properties on their mock** (`me/properties-view`, `~/prism-me-lanes/properties-view`,
  [brief](2026-10-28-properties-view.md)): `properties.tsx` on `SectionList`, Prism's tokens and `ColorPicker`; a
  category's and a clip row's properties, a Labels section; the last of the queue (Ludo, 2026-10-28). PR #14, reviewed
  (3 must-fix, 4 should-fix fixed), checked with real GL on WebGPU and WebGL2 and against Storybook; waits on Ludo.
- **Not a lane of this queue: cellVIEW's tree and cuts, a spec and an evaluation** (`me/cellview-eval`,
  `~/prism-me-lanes/cellview-eval`, run by the session molstar-prism-me-30, 2026-10-28): `_spec/cellview.md`, its
  progress file, a TODO section "Proposed (cellVIEW evaluation)" (not in `Next`); 2 commits, not pushed; waits on Ludo.
  Its item (a), likely an app bug (read, not run): `mesoscale.graphics` writes `Spheres.LodLevelsPresets` (distances,
  `operations.ts:901`) while particles draw by `lodPixelSize` (distances then ignored), so a mode only changes strides;
  `Spheres.LodPixelPresets` is the mode's pair.
- **Library fix: a whole particle list's bounding sphere** (`me/particle-bounds` off `origin/master`, pushed, no PR):
  built (`0927c892b`), merged with PR #5; waits on Ludovic for upstream.
- **Not prism-me: ChimeraX commands** (`chimerax-commands` off `origin/master`, `~/prism-me-lanes/chimerax-commands`,
  run by another session): built, reviewed, pushed, no PR; waits on Ludo (he opens the PR, perhaps upstream). The volume
  commands are the next lane.

## Waiting on Ludo

- The library fixes ready for upstream ([../TODO.md](../TODO.md)): which go, and when (he asks the maintainer).
- A distance following its objects' moves: a Mol\* core change (`state.ts`, a dependency sees the decorators under its
  object), to talk over with the maintainer; then it follows live during a drag (Ludovic, 2026-10-25).
- Hover highlight not drawn on merged render objects (a cellPACK model's targets): a Mol\* v6 graphics bug (Alexander's
  `3039ea342`, on master; the draw table does not watch a merged object's members), not ours. Ludo tells Alexander
  (write-up in `~/prism-me-drafts/alexander-merged-highlight.md`); no lane until then.
