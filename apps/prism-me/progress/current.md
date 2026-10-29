# Current

What is in flight, one line a lane, linking to its progress file once written. Only the coordinating session (the main
checkout) edits this file ([../AGENTS.md](../AGENTS.md), How we work). What was built is the dated files beside it; what
is not built is [../TODO.md](../TODO.md).

## In flight

- **From the cellVIEW evaluation** (Ludo, 2026-10-28: all of it, testable by 2026-10-29; briefs in
  [../TODO.md](../TODO.md) `Next`; PR #15 merged with the spec, the evaluation and the mock). Started 2026-10-29, in
  parallel; merged in this order (each merges `origin/prism-me` before its PR):
  - **1. Graphics modes change the LOD** (`me/lod-modes`, `~/prism-me-lanes/lod-modes`); started.
  - **6. Do hidden particles cost a frame?** (`me/hidden-cost`, a measurement); started.
  - **4. Graded cuts, the library half** (`me/graded-cuts`); started. The app half after 3.
  - **2 + 5. The tree's eye and ⋯, and Show only** (`me/tree-eyes`, one lane: both change the ⋯); started.
  - **3. Clips in a category of their own** (`me/clips-category`); started; merges after 2 + 5.
  - 7. Ghosts, and 4's app half: after 3 and 4.
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
