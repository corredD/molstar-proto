# The start-up bundle and its budget (lane `startup-budget`)

Branch `me/startup-budget` from `origin/prism-me` (after #31). Worktree `~/prism-me-lanes/startup-budget`. Dev
port 1366.

## Why (Ludo, 2026-10-31)

prism-me's production build (`node scripts/esbuild/app.mjs apps/prism-me`) fails its size budget: `index.js` 5.93 MB >
3.40 MB (`apps/prism-me/package.json` `molstar.budgets`). The files are written, so the publish to the lab website
works. But a guard that always fails means nothing. Ludo approved this lane after the proposal below.

## What is known (measured by the coordinator, nothing changed)

- The budget counts what loads at start: the entry and every chunk it imports statically (`scripts/esbuild/app.mjs`
  around line 309; `--metafile` writes `build/index.meta.json`).
- **prism-me's budget is stale.** It was set to 3.4 MB on 2026-10-18 (`d4c29101b`), when prism-viewer's was 3.2 MB.
  Upstream #2026 (`217376451`, David, "v6 perf audit 2: … Prism start code") raised prism-viewer's to 5.5 MB, now 5.6
  MB. prism-me's was never followed.
- **The stock prism-viewer is over its own budget on this branch:** 5.69 MB > 5.6 MB. It is not known whether upstream
  master is over too, or whether prism-me's graphics merges put it over: #27 color levels, #28 culling, #30 ghost
  shaders, #31 triangle picking.
- **prism-me's own share is about 0.24 MB** (5.93 against 5.69).
- The start-up bundle by folder (kB):

  | Folder                     | kB  |
  | -------------------------- | --- |
  | graphics/gl                | 925 |
  | prism/viewer               | 781 |
  | plugin/core                | 481 |
  | prism/ui                   | 457 |
  | model/model                | 337 |
  | canvas3d                   | 323 |
  | graphics/repr              | 312 |
  | geo                        | 198 |
  | command-language           | 127 |
  | apps/prism-me/src/explorer | 104 |
  | stage-tools                | 47  |
  | cryoet                     | 40  |
  | kinemage                   | 37  |
  | mesoscale                  | 35  |
  | model-archive              | 29  |

## Do

1. **Measure, nothing changed.**
   - Build prism-viewer and prism-me with `--metafile` on `origin/master` (a detached worktree of your own) and on this
     branch.
   - Report the start-up bytes per module, and the difference by commit range: what prism-me's library commits added to
     the start of the stock viewer, and prism-me's own share, module by module.
   - Write it in this file.
2. **Move to lazy loading what the first frame does not need.**
   - Candidates:
     - prism-me's extensions' panels and UI: the explorer, cryoet, stage-tools and mesoscale;
     - prism-me's graphics additions that only matter once used: the triangle pick lookup, color levels, the ghost pass;
     - extensions the app adds that are not needed at start, where prism-me chooses them.
   - Follow how Prism already lazy-loads (`packages/prism/viewer/src/features/lazy/`).
   - Measure before and after:
     - the start-up bytes;
     - the time to the first frame, headless, on CellPack HIV;
     - nothing visible changes;
     - every moved feature works on first use (unit tests plus a headless run: open the panel, hover a mesh, a ghost, a
       color level).
3. **Propose the budget, do not set it alone.**
   - Write the number: the stock viewer's budget plus prism-me's measured share after step 2, with its reason.
   - Stop and report. Ludo approves the number before it is committed.
   - Never raise a budget to make a build pass without his yes.
4. **Upstream.** If step 1 shows that prism-me's library commits put the stock viewer over 5.6 MB, list them (an
   upstream lane later; Ludo decides).

## Rules

- Never rebase; merge. Never push to upstream molstar/molstar.
- Commit messages say "Ludo" and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push after each
  commit.
- Tests with `--maxWorkers=2`, no parallel suites. Stop your dev server when done.
- Another lane runs at the same time: `marking-cost` on port 1367. Do not use its port or worktree. Ludo's live server
  is 1343: do not use it.
- Do not touch `current.md`.
- Say who did each commit, if anyone but you works on this lane.
- The gate before the PR:
  - `npx tsc -b`;
  - `npx tsc --noEmit -p apps/prism-me`;
  - lint and format:check;
  - `node scripts/workspace/assets.mjs`, then check:workspace;
  - the unit tests of the packages touched;
  - test:scaling;
  - styles:check and typecheck:storybook (it fails on prism-me in `packages/prism/viewer/src/api/styles.ts` from #24:
    say so, do not fix it here).

  Then the lane-reviewer, then the lane-skeptic.

- Then `gh pr create -R corredD/molstar-proto --base prism-me`. The PR body ends with
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Do not merge.

## Step 1: the measurement (nothing changed)

Production builds with `--metafile`, the start closure as `scripts/esbuild/start-closure.mjs` counts it (the entry and
every chunk it imports statically), per input module from the metafile's `bytesInOutput`. `origin/master` at `fb8772a88`
(a detached worktree, `~/prism-me-lanes/startup-budget-master`); this branch at `f5e46c55b` (master is merged in: the
merge base is `fb8772a88`). prism-me does not exist on master: its own share is measured against this branch's stock
viewer.

| Build                         | Start closure | Chunks | Budget  |                    |
| ----------------------------- | ------------- | ------ | ------- | ------------------ |
| prism-viewer, `origin/master` | 5,582,977 B   | 100    | 5.60 MB | passes, 17 kB left |
| prism-viewer, this branch     | 5,685,187 B   | 100    | 5.60 MB | fails by 85 kB     |
| prism-me, this branch         | 5,928,443 B   | 106    | 3.40 MB | fails              |

So the 5.93 MB is three parts: **upstream 5.583 MB**, **prism-me's library commits +102 kB** (the stock viewer on this
branch), **prism-me's own +243 kB** (the app and its three extensions).

### prism-me's library commits: +102 kB on the stock viewer

By the prism-me PR that touched each file (first-parent history `origin/master..HEAD`, the master merges left out; a
file touched by several PRs is counted under all of them together):

| PR                    | kB   | Mostly                                                                 |
| --------------------- | ---- | ---------------------------------------------------------------------- |
| #28 instance-cull     | 18.2 | `cell-cull.wgsl.ts` 9.4, `merged-culler.ts` 5.0, `renderable.ts` 1.9   |
| #25 ui-scale          | 16.1 | Prism's generated CSS modules (about 0.3–1.3 kB each), `ui-scale.ts`   |
| #31 mesh-measure      | 11.9 | `triangle-pick.ts` 4.6, `triangle-marks.ts` 4.3, `shape.ts` 1.5        |
| #27 dynamic-color     | 8.7  | `color-levels.wgsl.ts` 3.0, `color-levels.glsl.ts` 2.7, `color-levels.ts` 2.6 |
| #20 + #24 cuts, ghosts| 7.5  | `common-clip.glsl.ts` 3.9, `clip.wgsl.ts` 3.6                          |
| #20 (+ direct)        | 4.7  | particle `layers.ts` 4.2                                               |
| #30 ghost-cull        | 4.6  | `outlines.frag.ts` 4.1, `outlines.wgsl.ts` 2.4                         |
| #20 + #8              | 4.4  | particles `look.ts`                                                    |
| others, each < 3 kB   | 25.6 | clipping operations, gizmos (#9, #10), `canvas3d.ts`, `draw.ts`, …     |

By folder: graphics/gl +37.1, prism/viewer +18.0, prism/ui +12.7, graphics/geo +10.4, graphics/repr +6.2,
canvas3d +5.6, plugin/core +4.6, model +2.3. **These put the stock viewer over its 5.6 MB** (master has 17 kB left):
step 4's list.

### prism-me's own: +243 kB on the branch's stock viewer

| What                                                                  | kB    |
| --------------------------------------------------------------------- | ----- |
| `apps/prism-me/src/explorer` (`properties.tsx` 29.9, `operations.ts` 15.2, `rows.ts` 12.3, `clips.ts` 8.8, `menu.ts` 8.7, `ui.tsx` 8.2, `tree-view.tsx` 6.8, CSS 8.4) | 104.0 |
| stage-tools (`operations.ts` 27.9, `distance.ts` 5.5, `particle-handle.ts` 4.5)                                                   | 46.8  |
| cryoet (`operations.ts` 25.6, `controls.tsx` 7.7)                                                                                  | 40.2  |
| mesoscale (`operations.ts` 24.1, `prism-viewer.ts` 4.4, `controls.tsx` 2.3)                                                        | 34.5  |
| plugin/core particle `ops.ts` 11.8 and `particle-targets.ts` 3.9 (through `tomograms.ts` → `cryoet/operations`)                  | 15.8  |
| the app's page, spec, look, URL                                                                                                    | 4.8   |

The three extensions' views are lazy already (`ui: async () => import('./prism-viewer-ui.js')`); their operations and
the whole explorer (views included: "not lazy: its tab is the one open at start") are in the closure. The explorer's
views import the cryoet and mesoscale `controls`, so those are in it too.
