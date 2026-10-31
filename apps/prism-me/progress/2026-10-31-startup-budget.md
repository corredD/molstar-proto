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
