# What marking and transparency cost (lane `marking-cost`)

Branch `me/marking-cost` from `origin/prism-me` (after #31). Worktree `~/prism-me-lanes/marking-cost`. Dev port 1367.

## Why (Ludo, 2026-10-31, from Alexander)

"also you generally want to switch marking off or at least set ghost edge strength to 1 - otherwise you render
everything at least twice... the transparent stuff is not cheap either..."

## What is known (check it)

- prism-me's look (`apps/prism-me/src/look.ts`, `MesoscaleCanvasLook`) has these marking settings:
  - `enabled: true`, `ghostEdgeStrength: 1` (already);
  - `highlightEdgeStrength 1`, `selectEdgeStrength 1`;
  - `innerEdgeFactor 2.5`, `edgeScale 2`.
- The marking pass is `packages/graphics/src/canvas3d/passes/marking.ts`.
  - `depthTest = ghostEdgeStrength < 1 || dim` is around line 397.
  - With marking off, highlight and select are drawn by `colorMarker` in the shaders (around line 67), as a tint, not as
    edges.
- Transparency in prism-me's look:
  - the outline's `transparentColor` for ghosts;
  - clips' ghosts (#24, a depth draw);
  - #17's hidden layers (hidden instances still drawn at transparency 1 until #17 step 1);
  - Look › Shown layers;
  - the `includeTransparent` outline (off).
- Benches:
  - `apps/prism-me/scripts/zoom-bench.mjs` gives still and turning frames at 1 / 0.1 / 0.02, WebGPU and WebGL2, dpr 1
    and 2;
  - `scripts/hidden-cost-bench.mjs`;
  - `scripts/cull-check.mjs`.

## Do

1. **Measure, nothing changed.** On CellPack HIV and PetWorld HIV, WebGPU and WebGL2, dpr 1 and 2, at 1, 0.1 and 0.02 of
   the distance, still and turning, take frame times with:
   - marking as now;
   - marking off;
   - nothing hovered or selected;
   - something hovered;
   - a selection;
   - a clip with Ghosts;
   - a layer shown in part;
   - a Look with transparency.

   Find what is drawn twice:
   - Does the marking pass redraw every object even when nothing is marked?
   - What does each transparent case cost?

   Write the tables in this file.

2. **Changes that keep the image, without asking.**
   - For example, the marking pass draws nothing, or skips objects with no mark, when nothing is hovered or selected.
   - A transparent draw is skipped where the object has no transparent part.
   - Pick by state of the art.
   - Each change gets a test that fails first, plus before/after numbers, and pixel-identical images with
     `cull-check.mjs` or the same method.
3. **Changes that alter the look: images, then stop.** For example:
   - marking off, so hover and select become a tint instead of edges;
   - a cheaper ghost;
   - a different transparency mode.

   Put side-by-side images (now / proposed) and numbers in this file. Stop and report. Ludo decides; do not change the
   look on your own.

4. Say which changes are library changes (upstream candidates, Ludo decides) and which are prism-me's look.

## Rules

- Never rebase; merge. Never push to upstream molstar/molstar.
- Commit messages say "Ludo" and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push after each
  commit.
- Tests with `--maxWorkers=2`, no parallel suites. Stop your dev server when done.
- Another lane runs at the same time: `startup-budget` on port 1366. Do not use its port or worktree. Ludo's live server
  is 1343: do not use it.
- Do not touch `current.md`.
- Say who did each commit, if anyone but you works on this lane.
- The gate before the PR:
  - `npx tsc -b`;
  - `npx tsc --noEmit -p apps/prism-me`;
  - lint and format:check;
  - `node scripts/workspace/assets.mjs`, then check:workspace;
  - the unit tests of the packages touched;
  - the headless WebGPU suite;
  - test:scaling;
  - styles:check and typecheck:storybook (it fails on prism-me in `packages/prism/viewer/src/api/styles.ts` from #24:
    say so, do not fix it here).

  Then the lane-reviewer, then the lane-skeptic.

- Then `gh pr create -R corredD/molstar-proto --base prism-me` for the changes that keep the image. The PR body ends
  with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Do not merge.
