# prism-me

The Mesoscale Explorer on Prism. The repository's rules ([../../AGENTS.md](../../AGENTS.md)) and Prism's
([../../packages/prism/AGENTS.md](../../packages/prism/AGENTS.md)) apply; these are the app's own.

- **Read first:** [_spec/README.md](_spec/README.md) (the parts and the decisions) and
  [_spec/features.md](_spec/features.md) (every feature, its status, its operation). A change that moves a feature's
  status updates `features.md` in the same commit; what is missing goes to [TODO.md](TODO.md).
- **The app adds, Prism stays.** The app is a spec and three extensions (`packages/extensions/mesoscale`,
  `packages/extensions/cryoet`, `packages/extensions/stage-tools`); a change Prism itself needs is its own commit,
  upstreamable, with its test.
- **Operations only.** Views, commands and the agent change the scene through the extensions' operations (one history
  step each). An extension uses another's operations by id (`api.run`), never by import.
- **Particles for everything mesoscale** (Ludovic, 2026-10-18): cellPACK and PetWorld are particle lists; per-entity
  looks are particle layers (`ParticleRepresentation3DLayers`), never one representation per entity.
- **Tests:** each extension's `_test/` on a headless viewer (`createPrismViewerHeadless`); data made in memory or from
  `data/examples`, never the network.
- **The explorer's four places** (Ludovic, 2026-10-24): Mesoscale and Cryo-ET UI goes in the explorer's four places, the
  scene tree, its properties, its right-click menu and + Open ([_spec/ui.md](_spec/ui.md)), never in an extension's tab,
  because prism-me hides those tabs (`HiddenParts` in src/spec.ts) and one panel is the layout.
  `src/_test/hidden-parts.test.ts` checks only this much: no tab of the app's extensions is visible but the Scene, and
  their hidden ids are real parts (it fails on a lazy extension, whose parts it cannot read). It cannot see UI added
  inside a tab already hidden: that is the review's.

## How we work (Ludovic, 2026-10-24)

Many small lanes in parallel, each one task, one branch, one PR; the checks are the reviewer, Ludovic reads PR bodies
and tries the app. Why: one long session serializes everything and buries upstreamable fixes in a feature branch.

- **`prism-me` is main.** On the fork only (`origin`, corredD/molstar-proto). A lane is a worktree beside the repo,
  never inside it (lint and tests would scan it):
  `git worktree add ~/prism-me-lanes/<slug> -b me/<slug> origin/prism-me`, then `pnpm install` there. Its dev server
  takes a port of its own (1344 and up; 1343 is the main checkout's).
- **The queue is [TODO.md](TODO.md).** Its `Next` section holds Ludovic's briefs, in order: what he wants to see and how
  he checks it in the app. A lane takes one brief, writes or updates the `_spec` it needs (`_spec/ui.md`, `features.md`)
  in the same PR, and removes the item when built.
- **A lane is done** when: the feature works in the app; it has tests (failing first for a fix); `npx tsc -b`,
  `npx tsc --noEmit -p apps/prism-me`, `pnpm lint`, `pnpm format:check`, `pnpm check:workspace` and the quick lane of
  the packages touched pass (Prism packages touched: `styles:check`, `typecheck:storybook`); its changelog is its own
  `.v6/changelogs/<slug>.md` (never a shared file); `features.md` shows the new status.
- **The PR** goes to the fork's `prism-me`, never upstream: `gh pr create -R corredD/molstar-proto --base prism-me`
  (without `-R`, `gh` targets molstar/molstar, the fork's parent). Its body as David's: What, Changes, Notes for review
  (defaults, public API, what is left open), Testing (what ran, what was checked in the app, with what data). Ludovic
  merges.
- **A library fix** (anything under `packages/` outside the three extensions that upstream would want) is its own lane
  from `origin/master`, not from `prism-me`, with a failing test first and a `CHANGELOG.md` line if it applies to 5.x;
  it goes upstream only when Ludovic says so. `prism-me` gets it by the next master merge (or a cherry-pick if a lane
  needs it now).
- **Master comes in** about once a week, one merge commit on `prism-me` (`Merge origin/master (v6 #…) into prism-me`),
  adapted in a commit of its own, gate run before the push.
- **Corrections become rules:** when Ludovic corrects a choice that should hold, add it above as "(Ludovic, date) rule,
  because …", with a test that guards it where one can.

### As David runs Seq\* (stories-untold `seq-view-spec-proto`, read 2026-10-24)

- **Written state, not memory.** A session starts by reading [progress/current.md](progress/current.md) (one line per
  lane in flight) and ends by writing its lane's `progress/<yyyy-mm-dd>-<slug>.md`: what was built, what was decided
  (and by whom), what was learned, the size against the brief's. A dated slug, not a number: parallel lanes would take
  the same number. Only the coordinating session (the main checkout) edits `current.md`: it adds a lane when it starts
  one and removes it when Ludovic merges.
- **A brief before code.** The coordinator turns Ludovic's item into a brief: the spec section it changes, the tests
  that prove it, what Ludovic checks in the app, a size in production lines, and the model of each step. Over the size:
  record it and what took the room in the progress file and keep going; stop and report when the work turns out
  different from the brief.
- **Models by step** (David's rule): mechanical work (copying, renames, running checks and tests, measuring) to Sonnet
  subagents; design, the author step on hot paths, and every review to Opus.
- **The review gate before the PR.** A lane's last steps: an Opus reviewer, read-only, reads the lane's diff against its
  brief and the specs and lists findings (must-fix, should-fix, nit; each with file:line and a failure scenario); a
  second, a skeptic, re-runs or re-reads each and tries to refute it; each confirmed must-fix and should-fix gets a test
  that fails first, then its fix in a commit of its own. The PR body gains a `Review` section: the findings, refuted or
  fixed (by commit), or left open (to TODO.md). Why: the review is what lets Ludovic merge on the body.
- **Small commits, one cause each**, the cause in the message; a wrong commit is fixed forward, never amended once
  pushed. A lane commits only its own files (`git diff -- <file>` shows only its hunks before `git add`).

## Commands

`pnpm test:unit packages/extensions/mesoscale packages/extensions/cryoet packages/extensions/stage-tools`;
`npx tsc -b apps/prism-me`; `node scripts/esbuild/app.mjs apps/prism-me --dev --port 1343`.
