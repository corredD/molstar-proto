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

| PR                     | kB   | Mostly                                                                        |
| ---------------------- | ---- | ----------------------------------------------------------------------------- |
| #28 instance-cull      | 18.2 | `cell-cull.wgsl.ts` 9.4, `merged-culler.ts` 5.0, `renderable.ts` 1.9          |
| #25 ui-scale           | 16.1 | Prism's generated CSS modules (about 0.3–1.3 kB each), `ui-scale.ts`          |
| #31 mesh-measure       | 11.9 | `triangle-pick.ts` 4.6, `triangle-marks.ts` 4.3, `shape.ts` 1.5               |
| #27 dynamic-color      | 8.7  | `color-levels.wgsl.ts` 3.0, `color-levels.glsl.ts` 2.7, `color-levels.ts` 2.6 |
| #20 + #24 cuts, ghosts | 7.5  | `common-clip.glsl.ts` 3.9, `clip.wgsl.ts` 3.6                                 |
| #20 (+ direct)         | 4.7  | particle `layers.ts` 4.2                                                      |
| #30 ghost-cull         | 4.6  | `outlines.frag.ts` 4.1, `outlines.wgsl.ts` 2.4                                |
| #20 + #8               | 4.4  | particles `look.ts`                                                           |
| others, each < 3 kB    | 25.6 | clipping operations, gizmos (#9, #10), `canvas3d.ts`, `draw.ts`, …            |

By folder: graphics/gl +37.1, prism/viewer +18.0, prism/ui +12.7, graphics/geo +10.4, graphics/repr +6.2, canvas3d +5.6,
plugin/core +4.6, model +2.3. **These put the stock viewer over its 5.6 MB** (master has 17 kB left): step 4's list.

### prism-me's own: +243 kB on the branch's stock viewer

| What                                                                                                                                                                  | kB    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `apps/prism-me/src/explorer` (`properties.tsx` 29.9, `operations.ts` 15.2, `rows.ts` 12.3, `clips.ts` 8.8, `menu.ts` 8.7, `ui.tsx` 8.2, `tree-view.tsx` 6.8, CSS 8.4) | 104.0 |
| stage-tools (`operations.ts` 27.9, `distance.ts` 5.5, `particle-handle.ts` 4.5)                                                                                       | 46.8  |
| cryoet (`operations.ts` 25.6, `controls.tsx` 7.7)                                                                                                                     | 40.2  |
| mesoscale (`operations.ts` 24.1, `prism-viewer.ts` 4.4, `controls.tsx` 2.3)                                                                                           | 34.5  |
| plugin/core particle `ops.ts` 11.8 and `particle-targets.ts` 3.9 (through `tomograms.ts` → `cryoet/operations`)                                                       | 15.8  |
| the app's page, spec, look, URL                                                                                                                                       | 4.8   |

The three extensions' views are lazy already (`ui: async () => import('./prism-viewer-ui.js')`); their operations and
the whole explorer (views included: "not lazy: its tab is the one open at start") are in the closure. The explorer's
views import the cryoet and mesoscale `controls`, so those are in it too.

## Step 2: what moved to lazy loading

**The explorer's properties** (`2aeae20a0`, with Loading… and Retry in `fbdd94ed0`): `properties.tsx` and what only it
imports (`distance-properties.tsx`, `properties-view.tsx`, its CSS, cryoet's and mesoscale's `controls.tsx` and their
CSS) are a chunk of their own, imported once the scene has an object or a row is picked (`loadProperties` in
`explorer/ui.tsx`). At start no row is picked: the panel shows "Pick a row to see its properties.", as before. The tab
itself stays in the start bundle: it is open at start, and `view.open` finds no tab that registers later. While the
chunk comes the pane says Loading…; if it fails, that it could not be loaded, with Retry (as Prism's lazy parts).

| Build                       | Start closure | Chunks at start |
| --------------------------- | ------------- | --------------- |
| prism-me before             | 5,928,443 B   | 106             |
| prism-me after              | 5,883,579 B   | 114             |
| prism-me's own share before | 243,256 B     |                 |
| prism-me's own share after  | 198,392 B     |                 |

**Deferred, not saved:** the chunk loads as soon as the scene has its first object, so a session that opens anything
fetches it while its data downloads. The budget counts the start closure only; the page's total JS is the same (about
6.2 MB once the properties are loaded). The 8 more chunks at start are esbuild's splitting of the modules the start and
the new chunk share.

Time to the first frame, headless Chrome (WebGPU flags), the production builds served side by side on 1366,
`?example=cellpack-hiv1` with the list and the BinaryCIF served from a local copy (no network noise); ms from
navigation, each cell the median of 5 fresh contexts (each column's median on its own), three interleaved rounds:

| Server, network                              | Build  | Viewer created         | First frame            | HIV drawn              |
| -------------------------------------------- | ------ | ---------------------- | ---------------------- | ---------------------- |
| HTTP/1.0 (`python -m http.server`), local    | before | 314, 300               | 347, 342               | 1435, 1423             |
|                                              | after  | 306, 309               | 354, 350               | 1436, 1473             |
| HTTP/1.0, 20 Mbit/s, 40 ms                   | before | 2832; 2828, 2832, 2839 | 2866; 2869, 2866, 2867 | 4135; 4155, 4141, 4119 |
|                                              | after  | 2890; 2880, 2895, 2890 | 2926; 2922, 2929, 2911 | 4208; 4168, 4179, 4174 |
| HTTP/2 (TLS, node `http2`), 20 Mbit/s, 40 ms | before | 2768, 2768, 2766       | 2797, 2799, 2799       | 3980, 3969, 3974       |
|                                              | after  | 2753, 2753, 2741       | 2783, 2793, 2775       | 3981, 4000, 3995       |

- Local: no difference beyond run to run.
- **HTTP/1.0 with a network: after is about 55 ms slower** to the viewer and the first frame, consistently (every run of
  three rounds): the 8 more start chunks are 8 more requests, a connection each, at 40 ms a round trip; more than the 18
  ms that 45 kB less saves at 20 Mbit/s.
- **HTTP/2 with the same network: after is 15–25 ms faster** to the viewer, 6–24 ms to the first frame (the 45 kB); HIV
  drawn 1–31 ms later (the deferred chunk shares the line with the data).
- So the gain depends on the server: the lab website's (HTTP/2 on GitHub Pages and most hosts) decides; on an HTTP/1
  server this split costs more than it saves. Not measured on the lab website itself.

The first screenshot (HIV drawn, the panel open) is identical pixel for pixel before and after. On first use (the real
app, the after build, again after the review fixes): the model's row picked shows its seven sections (Look,
Representation, Decoration, Position, Clips, Labels, Graphics) and By zoom; the canvas's right-click menu opens with its
items; `mesoscale.colorLevels` runs; no console error. Tests: `explorer/_test/lazy-properties.test.ts` reads esbuild's
graph of the app and fails on a static import of the properties or the controls (also after a comment, on a line with
other code, by package name) and on the dynamic import removed; `explorer/_test/properties-load.test.tsx` checks
Loading…, the failure with Retry, and Retry loading it, one import at a time.

### What did not move, and why

- **The three extensions' operations** (the folders' start bytes after step 2: stage-tools 46.8, cryoet 30.7, mesoscale
  31.4 kB, and plugin/core's particle `ops.ts` and `particle-targets.ts` 15.8 kB through `tomograms.ts` →
  `cryoet/operations`). Their views are lazy already; their areas are not, and cannot be as they are: the explorer's
  panel reads `api.mesoscale`, `api.cryoet` and `api.stage` synchronously at start (`sceneModel`, `ScenePanel`, the
  menus), and the stage subscribes to the canvas's right-click in its constructor. As `LazyViewerExtension`s (stubs as
  `LazyVideoExport`'s, every operation's flags declared, `StageLabel`/`StageDistance` in `owns.transformers`, the hidden
  tabs in `parts`) the explorer would have to follow areas that appear later, and the first right-click to load the
  stage. A lane of its own: about 0.12 MB.
- **The explorer's menus** (`menu.ts` 8.7 kB and stage-tools' `drag.ts`): every menu path opens synchronously; small.
- **prism-me's graphics additions** (color levels 8.7 kB, culling 18.2, ghost outlines 4.6, the clip shaders 7.5, the
  triangle pick 11.9): shader sources are assembled synchronously when a program is built, and the triangle pick is on
  the hover path. Making them load later is a change to the renderer in library code, for an upstream lane (step 4).
- **Mol\*'s extensions in `FullPrismViewerSpec`**: command-language 127 kB with the query language 133 kB, the MVS
  runtime and builder 188 kB, kinemage 37, model-archive 29, dnatco 28, rcsb 25, anvil 24, assembly-symmetry 24 are
  eager in the stock viewer. As lazy stubs they would save more than prism-me's whole share, but the list is upstream's
  (`apps/prism-viewer/src/extensions.ts`): an upstream lane, Ludo decides.

## Step 3: the budget proposed (not set: Ludo approves it first)

**5,900,000 bytes (5.90 MB)** for prism-me's `index.js`, from the measurement after step 2:

- the stock viewer's budget, 5.60 MB, which master meets with 17 kB left;
- plus prism-me's library commits, 0.102 MB, until they go upstream or leave the start (step 4);
- plus prism-me's own share after step 2, 0.198 MB (198,392 B);
- = 5,900,602 B, rounded down to 5.90 MB, against 5,883,579 B measured: 16 kB left, about the headroom upstream keeps
  (17 kB).

The brief's formula alone (5.60 + 0.198 = 5.80 MB) fails today by 85 kB, the library commits that put the stock viewer
over its own budget on this branch; a budget that fails on the day it is set guards nothing. If the library commits go
upstream and upstream's budget follows them, prism-me's becomes upstream's plus 0.20 MB.

prism-viewer's own budget (5.6 MB) fails on this branch (5.69 MB): left as it is, as upstream's file (a change here
would conflict with every master merge). Ludo decides.

## Step 4: the library commits that put the stock viewer over 5.6 MB

#28 instance-cull 18.2 kB; #25 ui-scale 16.1; #31 mesh-measure 11.9; #27 dynamic-color 8.7; #20 + #24 cuts and ghosts
7.5 (+ #20 particle layers 4.7, #20 + #8 particle look 4.4); #30 ghost-cull 4.6; #10 and #28 `canvas3d.ts` 2.8; the rest
under 2.5 each (#9, #10, #12, #17, #18, #5). Upstream has 17,023 B of room: #28 alone puts it over; #25, #31 and #27
each fit, any two do not.

## The gate

`npx tsc -b`, `npx tsc --noEmit -p apps/prism-me`, `pnpm lint`, `pnpm format:check`, `node scripts/workspace/assets.mjs`
(no change) and `pnpm check:workspace` pass; `pnpm test:unit apps/prism-me` 24 files, 141 tests pass; the app's
`test:scaling` (2 files, 5 tests), `styles:check` and `typecheck:storybook` pass. Prism viewer's `typecheck:storybook`
fails in `packages/prism/viewer/src/api/styles.ts:114` (from #24, as the brief says): not fixed here.

## Review

Lane-reviewer (10 findings), then lane-skeptic (7 confirmed, 3 refuted, 4 of its own):

- 1, 2, N1–N3 (confirmed): the source-scan guard missed the dynamic import's removal (`typeof import` matched), the
  controls imported by package name, an import after a comment or after code on its line. Fixed in `175db5883`: the
  guard reads esbuild's graph of the app (other packages external, about 1 s); each of those mutants fails it.
- 3, 10 (confirmed): a pending or failed chunk left a blank pane (a `console.error` only), and each scene change while
  it loaded asked again. Fixed in `fbdd94ed0`: Loading…, "could not be loaded" with Retry, one import at a time; its
  test fails on the code before.
- 4 (confirmed): the first timing table could not say "unchanged" (one throttled pair, slower), and "HTTP/2" was not
  what the server spoke (HTTP/1.0). Measured again: three interleaved rounds, HTTP/1.0 and HTTP/2 (Step 2's table):
  slower on HTTP/1.0, faster on HTTP/2. The bytes are deferred, not saved: said.
- 5 (confirmed): Step 4's "any one of the first four" was wrong; corrected.
- 6 (confirmed): TODO.md's budget item was stale; updated with what this lane leaves open.
- 7 (no change): the sum is 5,900,602 B, the proposal rounds down; said.
- 8, 9 (refuted): the extensions' figures count their CSS too; both chunk counts are start-closure counts.
- N4: the static server on 1366 is stopped at the end of the lane.
