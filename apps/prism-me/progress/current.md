# Current

What is in flight, one line a lane, linking to its progress file once written. Only the coordinating session (the main
checkout) edits this file ([../AGENTS.md](../AGENTS.md), How we work). What was built is the dated files beside it; what
is not built is [../TODO.md](../TODO.md).

## In flight

- **Measure a distance, structures and particles** (`me/measure-distance`, `~/prism-me-lanes/measure-distance`, port
  1344): ⌘/Ctrl+click two points in selection mode, a distance row under the first pick. PR #5; adding volume points
  (the volumes brief folded in, Ludovic 2026-10-25).
- **Library fix: a whole particle list's bounding sphere** (`me/particle-bounds` off `origin/master`,
  `~/prism-me-lanes/particle-bounds`): `Particle.getBoundingSphere` copies the wrong way; cherry-picked into PR #5.

## Waiting on Ludovic

- The library fixes ready for upstream ([../TODO.md](../TODO.md)): which go, and when.
