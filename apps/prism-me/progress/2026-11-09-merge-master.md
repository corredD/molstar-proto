# Lane merge-master (2026-11-09)

Branch `me/merge-master` from `origin/prism-me` (worktree `~/prism-me-lanes/merge-master`).

## Brief

**Asked (Ludo, 2026-11-09).** "merge master from repo that has lot of change and resolve conflict in prism-me, favor
master."

**What.** `origin/master` (= `upstream/master`, dabbf29f9, v6 #2069 "gl-gizmos-clip-ghosts-mesoscale" and #2068, #2064)
is 59 commits ahead of `origin/prism-me` (prism-me 1,375 ahead); 474 files, +24.6 k −4.2 k, mostly `packages/graphics`
(WebGPU passes, uniforms, bind groups, culling, clip objects on mesoscale, buffer reclaim), the test harness moved to a
private package `@molstar/test-harness`, deps updated.

**How (How we work: "Master comes in").** One merge commit `Merge origin/master (v6 #2069) into prism-me`. Conflicts
resolved **favoring master** (Ludo): take master's side of each conflicting hunk; keep prism-me's side only where master
has no equivalent and dropping it would remove a prism-me feature (record each such hunk, file:line and why, in this
file). Then adaptation commits of their own (one cause each): prism-me code that called APIs master changed.

**Done when.** `pnpm install`; `npx tsc -b`, `npx tsc --noEmit -p apps/prism-me`, `pnpm lint`, `pnpm format:check`,
`pnpm check:workspace`; the quick lane of `packages/graphics`, `packages/prism`, the three extensions and
`apps/prism-me` (with Dawn where the lanes ran it); `styles:check`, `typecheck:storybook`. The app runs (`node
scripts/esbuild/app.mjs apps/prism-me --dev --port 1355`): loads a cellPACK example and a mesh, no console errors.
Gate on the adaptation commits (`git diff <merge>..HEAD`) and on the merge's conflict resolutions.

**Ludo checks.** prism-me on 1355: the explorer, a mesoscale model, clipping, gizmos (master's new overlay layers).

**Not here.** The lipid-procedural lane's graphics commits (pool, patch texture) touch the same culler as master:
they rebase on this merge after it lands. Paint stays on hold.

**Size and model.** Conflict resolution and adaptation: Opus (judgment over graphics); running checks: Sonnet.
