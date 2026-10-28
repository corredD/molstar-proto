# Current

What is in flight, one line a lane, linking to its progress file once written. Only the coordinating session (the main
checkout) edits this file ([../AGENTS.md](../AGENTS.md), How we work). What was built is the dated files beside it; what
is not built is [../TODO.md](../TODO.md).

## In flight

- **The tree on its mock** (`me/tree-view`, `~/prism-me-lanes/tree-view`, [brief](2026-10-27-tree-view.md)): `ui.tsx`,
  `rows.ts` on `VirtualList` and `TreeNavigation`, the row's tools at the end on hover, categories picked, clips as
  rows; the first of the three views. Built and reviewed; over its size stop (+536 net, the mock's tree moved into the
  app; Ludo accepts it). Ludo, 2026-10-27: the trash back on the row and the category's brush built, then the PR.
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
