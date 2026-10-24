# The first build, one session (2026-10-18 to 2026-10-24)

prism-me built in one long serial session on `prism-me` (97 commits, about 15.7k lines), before the lanes.

## Built

- The app on Prism and three extensions (`mesoscale`, `cryoet`, `stage-tools`); every format of the plan loads by drop
  ([../_spec/features.md](../_spec/features.md) has the status of each feature).
- One Scene panel (tree, properties, right-click menu; [../_spec/ui.md](../_spec/ui.md)); Prism's clipping and gizmos
  used where upstream has them (Ludovic, 2026-10-21: upstream first).
- Volumes move as one (slices and isosurfaces have no position of their own); an oblique slice placed by its handle in
  the volume's frame.
- Library fixes, one commit each, listed in [../TODO.md](../TODO.md) as ready for upstream.

## Decided

- Particles for everything mesoscale (Ludovic, 2026-10-18).
- Upstream main and v6 Prism before prism-me's own code (Ludovic, 2026-10-21).
- Work as parallel lanes with PRs to the fork (Ludovic, 2026-10-24; [../AGENTS.md](../AGENTS.md), How we work).

## Learned

- One session for everything serializes the work and loses detail at each context compaction; written state (this
  folder) is what a next session reads instead.
- A master merge can break the app silently through a type-safe change (#2039: files as Response Data hid every file's
  name); the explorer's tests caught it. Run the app's tests after every master merge.
- Fixes found in the library while building a feature stay upstreamable only if committed alone, with their failing
  test, from the start.
