# AGENTS.md — Virus on the Rock

Local rules for `src/apps/virus-on-the-rock/` and the VotR work on branch `virus-on-the-rock`, in addition to the root
[AGENTS.md](../../../AGENTS.md). The app's spec is [_spec/](_spec/README.md); read its README before any change, and
[_spec/architecture.md §7](_spec/architecture.md#7-decisions-ludo-2026-11-26) before designing one.

## How we work (Ludo, 2026-11-26)

Many small lanes in parallel, each one task, one branch, one PR; the checks and the review gate are the reviewer,
Ludo reads PR bodies and tries the result. Why: one long session serializes the work and loses detail at each
context compaction; written state and small PRs do not.

- **`virus-on-the-rock` is main.** PRs go to `corredD/molstar-proto` base `virus-on-the-rock`:
  `gh pr create -R corredD/molstar-proto --base virus-on-the-rock` (the repo also has molstar/molstar as `upstream`;
  never let `gh` pick the target). Ludo merges. Nothing goes upstream (Ludo, 2026-11-26, D12): no PR or branch to
  molstar/molstar, no generic-API rework to make a VotR change upstreamable.
- **A lane is a worktree beside the repo**, never inside it: `git worktree add ~/molstar-votr-lanes/<slug> -b
  votr/<slug> origin/virus-on-the-rock`, then `npm ci`. Its dev server takes a port of its own, 1350 and up
  (`node ./scripts/build.mjs -a virus-on-the-rock -p 1350`, open `http://localhost:1350/build/virus-on-the-rock/`);
  1338 and `~/molstar-votr` are Ludo's: a lane never edits or rebuilds there, since each rebuild reloads his page and
  stops the song (spec README, decision 4).
- **The queue** is [TODO.md](TODO.md) `## Next`: Ludo's items, in order, in his words (what he wants to see, how he
  checks it). A lane takes one item and removes it when built.
- **Written state, not memory.** A session starts by reading [progress/current.md](progress/current.md) (one line per
  lane in flight; only the coordinating session, the main checkout `~/molstar-votr`, edits it) and its lane's
  `progress/<yyyy-mm-dd>-<slug>.md`; it ends by writing what was built, what was decided (and by whom), what was
  learned, the size against the brief's. Dated, not numbered: parallel lanes would take the same number.
- **A brief before code**: the spec section it changes, the tests that prove it, what Ludo checks, a size in
  production lines, the model of each step. Over the size: record it and what took the room, keep going; stop and
  report when the work turns out different from the brief.
- **Models by step**: mechanical work (copying, renames, running checks and tests, measuring) to Sonnet subagents;
  design, hot-path authoring and every review to Opus.
- **A lane is done** when: it works as the brief's check says; it has tests (failing first for a fix); these pass:
  `npm run lint`, `npx tsc --noEmit -p tsconfig.json`, `npx jest src/apps/virus-on-the-rock src/mol-plugin-state
  src/mol-repr/structure` (plus the `_spec` folders of any other code it touches), and
  `node ./scripts/build.mjs -a virus-on-the-rock --prd`; no CHANGELOG.md entry (that file is upstream's and shared
  by every lane): the `_spec` pages it moves are its record, updated in the same PR (`features.md` status,
  `ui.md` for labels and layout, `audio-routing-spec.md` for routing); every change outside this folder is listed in
  [_spec/core-changes.md](_spec/core-changes.md), as commits of its own with no app hunks.
- **The routing contract holds**: [_spec/audio-routing-spec.md](_spec/audio-routing-spec.md) wins on routing. A lane
  that touches the signal path, the route math or the frame loop re-runs its measured expectations
  (`node scripts/votr-sync/clicksync.mjs --port <lane port>`, its click track is generated; the offline baseline is `src/mol-plugin-state/manager/_spec/audio-pipeline.spec.ts`) and reports the numbers in the PR.
  Drums & Bass Burst stays possible (spec README, decision 5).
- **No accidental quadratic, few allocations**: over many items, index once and never scan or rebuild per item; one
  commit per operation; nothing allocated per pointer event or frame. A bulk path lands with a scaling guard (n and 4n,
  with a quadratic control). The per-frame path (`AudioReactiveAnimationManager` tick → routing → Who →
  `canvas3d.setAudioFrame`, and the app's CPU channels) allocates nothing per frame and costs O(routes), not
  O(instances); no scaling guard exists yet, the first lane that loops over instances or mesoscale parts adds one.
- **Mol\*'s architecture principles** (Ludo, 2026-11-26): code follows molstar's
  `.scaffolds/principles/architecture/bootstrap-patterns/` `api-surfaces`, `hot-loop-allocations` and
  `ports-and-adapters` (`typescript.md` and the README's invariants; read with `git show upstream/master:<path>`), in
  Mol\*'s own terms (rxjs, `useBehavior`): app logic takes narrow ports as parameters and `VirusOnTheRockApp.create`
  wires them, no module-level singleton; a steady frame allocates nothing and a frame at rest does nothing; state has
  one write path that emits only on change, streams are returned observables, never callback parameters. The gate's
  reviewer holds every diff to them.
- **UI from the foundations**: views use Mol\*'s plugin UI controls (`mol-plugin-ui/controls/*`, `ParameterControls`),
  the app's [style.scss](style.scss), and the layout and labels of [_spec/ui.md](_spec/ui.md); labels say what the
  code does (D14). A principle of our own is written down with its story or example.
- **The review gate before the PR**: an Opus reviewer, read-only, lists findings on the lane's diff (must-fix,
  should-fix, nit; file:line and a failure scenario); a skeptic re-runs or re-reads each and tries to refute it; each
  confirmed must-fix and should-fix gets a failing test, then its fix, one commit each. The PR body's `Review` section
  lists them (refuted, fixed by commit, or left open to the queue).
- **The PR body**: What, Changes, Notes for review (defaults, public API, what is left open), Testing (what ran, what
  was checked by hand, with what data), Review.
- **Small commits, one cause each**, the cause in the message; only your own hunks; a wrong commit is fixed forward,
  never amended once pushed.
- **Until `app.tsx` is split by card (D15), one lane at a time touches it.** The split runs alone; lanes in parallel
  start after it merges.
- **Corrections become rules**: when Ludo corrects a choice that should hold, add it to this file as "(Ludo, date)
  rule, because …", with a test that guards it where one can.
