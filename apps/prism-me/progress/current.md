# Current

What is in flight, one line a lane, linking to its progress file once written. Only the coordinating session (the main
checkout) edits this file ([../AGENTS.md](../AGENTS.md), How we work). What was built is the dated files beside it; what
is not built is [../TODO.md](../TODO.md).

## In flight

- **Handles drawn on top** (`me/handles-on-top`, `~/prism-me-lanes/handles-on-top`,
  [brief](2026-10-26-handles-on-top.md)): a viewer-wide toggle, every part of a gizmo drawn on top and its handles
  grabbed through the scene; before the other `Next` items (Ludo). PR #10, reviewed (2 must-fix, 4 should-fix fixed),
  checked with real GL on WebGPU and WebGL2 (Move and turn on 1CRN); waits on Ludo.
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
