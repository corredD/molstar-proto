# Current

What is in flight, one line a lane, linking to its progress file once written. Only the coordinating session (the main
checkout) edits this file ([../AGENTS.md](../AGENTS.md), How we work). What was built is the dated files beside it; what
is not built is [../TODO.md](../TODO.md).

## In flight

- **One owner for the particle looks** (`me/looks-owner`, `~/prism-me-lanes/looks-owner`,
  [brief](2026-10-25-looks-owner.md)): `particles.look` in Prism, mesoscale, cryo-ET and the cuts call it; PR #8, built
  and reviewed, waits on Ludovic.
- **Measuring outside selection mode says so** (`me/measure-hint`, `~/prism-me-lanes/measure-hint`,
  [brief](2026-10-25-measure-hint.md)): the status-line hint; PR #7, built and reviewed, waits on Ludovic. The distance
  following its objects waits (below).
- **Library fix: a whole particle list's bounding sphere** (`me/particle-bounds` off `origin/master`, pushed, no PR):
  built (`0927c892b`), merged with PR #5; waits on Ludovic for upstream.
- **Not prism-me: ChimeraX commands** (`chimerax-commands` off `origin/master`, `~/prism-me-lanes/chimerax-commands`,
  run by another session): a third dialect for the command-language extension, as #2052 built PyMOL and VMD; one PR to
  the fork's `master`, nothing upstream until Ludovic says so. Brief with Ludovic, no code until his OK; the volume
  commands a follow-up lane.

## Waiting on Ludovic

- The library fixes ready for upstream ([../TODO.md](../TODO.md)): which go, and when (he asks the maintainer).
- A distance following its objects' moves: a Mol\* core change (`state.ts`, a dependency sees the decorators under its
  object), to talk over with the maintainer; then it follows live during a drag (Ludovic, 2026-10-25).
