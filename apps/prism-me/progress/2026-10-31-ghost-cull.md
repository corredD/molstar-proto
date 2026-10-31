# Ghosts disappear on cellPACK (lane `ghost-cull`)

Branch `me/ghost-cull` from `origin/prism-me` (after #28). Worktree `~/prism-me-lanes/ghost-cull`. Dev port 1365.

## Why (Ludo, 2026-10-31)

"the ghost on cellpack rendering, disappears at some distance and on the side of the screen."

## What is known (not yet reproduced; check it)

- Ghosts are #24 (lane `ghosts`): a clip's Ghosts draws what the clip cuts as a depth-only draw that the outline pass
  outlines.
  - `DrawFact.Ghost` and `checkGhost` are in `packages/graphics/src/gl/draw-table.ts`; the ghost pass is in
    `packages/graphics/src/gl/renderer.ts` (around line 115).
  - Specs: `apps/prism-me/_spec/features.md` (Ghosts row) and `_spec/cellview.md` §4.3.
- #28 (lane `instance-cull`, merged after #24) added GPU culling per instance and per cluster of 256 spheres on WebGPU:
  - frustum, level-of-detail range and Hi-Z occlusion;
  - two-phase occlusion;
  - per-instance CPU culling of cut cells on WebGL2;
  - the motion level-of-detail scale;
  - instance spheres that grow by wiggle and tumble.

  Its progress file is `apps/prism-me/progress/2026-10-31-instance-cull.md`.

- Hypotheses, to test, not to trust:
  1. The ghost pass draws with the culled draw lists (or the CPU cull) of the main pass. What occlusion keeps is what
     the _visible_ depth does not hide, but ghosts are by nature behind or inside what is drawn, so occlusion removes
     them. Instances outside a level's range, or near the screen edge, may also be dropped.
  2. The ghost pass gets its own level of detail or culling with the wrong camera, viewport or pyramid (for example the
     motion resolution, or the pyramid of the previous frame).
  3. Clip whole (instance level) skips instances that the ghost should still draw.
  4. It is older than #28: check on `4040b4baf` (#27 merged, before #28) to know.

## Do

1. Reproduce headless on WebGPU and WebGL2:
   - CellPack HIV (`?example=cellpack-hiv1`), plus one PetWorld;
   - a clip with Ghosts on (`clipping.update` with `ghost`, as #24's tests do);
   - views from far to close (1, 0.3, 0.1, 0.03 of the distance);
   - the camera turned so ghosts sit at the screen edges.

   Screenshots. Find which ghost instances are missing and why.

2. A test that fails first, then the fix. The state-of-the-art rule:
   - the ghost pass culls by the frustum and level of detail only, with its own visibility, never by occlusion against
     the visible depth;
   - unless the ghost has its own depth pyramid and the numbers show it is needed.

   Keep #28's frame times. Measure with `apps/prism-me/scripts/zoom-bench.mjs` before and after, with ghosts on and off.

3. Check every path:
   - WebGPU two-phase;
   - one-phase fallback;
   - clusters;
   - WebGL2 CPU culling;
   - motion frames;
   - Clip whole;
   - graded ways.

## Rules

- Never rebase; merge. Never push to upstream molstar/molstar.
- Commit messages say "Ludo" and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push after each
  commit.
- Tests with `--maxWorkers=2`, no parallel suites. Stop your dev server when done.
- Other lanes run at the same time:
  - `decorate-transform` on 1363;
  - `mesh-measure` on 1364.

  Do not use their ports or worktrees. Ludo's live server is 1343: do not use it.

- Do not touch `current.md`.
- The gate before the PR:
  - `npx tsc -b`;
  - `npx tsc --noEmit -p apps/prism-me`;
  - lint and format:check;
  - `node scripts/workspace/assets.mjs`, then check:workspace;
  - the unit tests of the packages touched;
  - the headless WebGPU suite;
  - test:scaling;
  - styles:check and typecheck:storybook.

  Then the lane-reviewer, then the lane-skeptic.

- Then `gh pr create -R corredD/molstar-proto --base prism-me`. The PR body ends with
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Do not merge.
