# Decorations under a list transform (lane `decorate-transform`)

Branch `me/decorate-transform` from `origin/prism-me` (after #28). Worktree `~/prism-me-lanes/decorate-transform`. Dev
port 1363.

## Why (Ludo, 2026-10-31)

Ludo loads `cryoet-ribosomes.ndjson`, fetches 2PLV (assembly 1), sets the list's Scale (Position) to 10 Å/unit, then
decorates Target 0 with 2PLV, from the pull-down or the PDB id field. Both fail with "Target does not apply to CryoET
Data Portal particles". Decorating first, then scaling, works, but then zooming in makes everything disappear.

## What is known (reproduced headless on 1343)

1. **Decorating after a scale.** `stage.scale` adds `ParticleListTransform`, a decorator, on the list
   (`packages/plugin/core/src/state/transforms/particles/ops.ts`). `cryoet.decorate` then inserts
   `ParticleListWithTargets` under it. `ParticleListTransform.update` returns Unchanged when its params and
   `b.data.sourceData === a.data.sourceData` are the same. Its output keeps the list without `targetMapping`, so
   `ensureTargetRepresentation` adds a `target` representation that is not applicable. Script:
   `~/prism-me-lanes/deco12.cjs` (`node deco12.cjs 1343`).
2. **Decorating, then scaling, then zooming in.** The camera's bounds are the scaled list's (radius 6,124 Å).
   - WebGPU: the decorations do not show at all after the scale; only the 2PLV structure shows, in a corner.
   - WebGL2: the decorations show scaled, then vanish once the camera moves in (0.3 of the distance).
   - Render objects after the scale (`clip2.cjs`): one at center (161, 179, 190), radius 309, which is likely stale
     bounds from before the scale.

   Not known: which object that is; whether #28's per-instance or cluster culling (instance spheres, cluster bounds,
   draw lists) also keeps old data; whether this happened before #28. Scripts: `~/prism-me-lanes/clip1.cjs` and
   `clip2.cjs` (`node clip1.cjs webgpu|webgl2`); edit their port.

## Do

1. A test that fails first for (1). Then the fix: `ParticleListTransform` updates whenever its input list changed (the
   same data or not), still Unchanged when neither its params nor its input changed. Check `ParticleListOffsets` and the
   other particle decorators for the same short cut.
2. Find why the decorations' bounds go stale after a list transform (target representation, its instances, bounding
   sphere, invariant bounding sphere; #28's per-instance spheres and cluster bounds; CPU culling). Write a test that
   fails first, then fix. Also cover a move or turn of the list (handles), not only the scale.
3. Ludo's exact steps headless, on WebGPU and WebGL2:
   - decorate after a scale;
   - scale after decorating;
   - zoom to 0.3, 0.1 and 0.03 toward a decorated particle;
   - move the list with the handles.

   Screenshots in this progress file; nothing may disappear.

4. Say whether each bug is in 5.x or upstream v6 too (library fixes go upstream later).

## Rules

- Never rebase; merge. Never push to upstream molstar/molstar.
- Commit messages say "Ludo" and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push after each
  commit.
- Tests with `--maxWorkers=2`, no parallel suites. Stop your dev server when done.
- Do not touch `current.md`.
- The gate before the PR:
  - `npx tsc -b`;
  - `npx tsc --noEmit -p apps/prism-me`;
  - lint and format:check;
  - `node scripts/workspace/assets.mjs`, then check:workspace;
  - the unit tests of the packages touched;
  - test:scaling;
  - styles:check and typecheck:storybook.

  Then the lane-reviewer, then the lane-skeptic.

- Then `gh pr create -R corredD/molstar-proto --base prism-me`. The PR body ends with
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Do not merge.
