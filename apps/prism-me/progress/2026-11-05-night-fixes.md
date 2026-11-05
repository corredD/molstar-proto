# Lane night-fixes (2026-11-05), PR #57

## Built

One commit per finding of the night reviews (`2026-11-05-night/review-app.md`, `review-mesoscale-stage.md`), the finding
id in each message, a failing test first (a `*.scaling.ts` guard for A7 and A8's `wayOf` (with the quadratic control), a
model test for F6 and an identity test for A9):

- Bugs: F1 (handle release through `stage.move`), A1 (Remove with its labels, one step), F2 (a mesh's clip moves with
  it), F16 (`stage.scale` carries labels and clips), A3 (a picked row whose cell is gone is unpicked), A4 (right-click
  on a label keeps Move), A6 (Clip whole Objects clears `clipPrimitive`), F5 (By zoom on a uniform list keeps its
  colour), F7 (examples list refetched after an HTTP error), F13 (one colour parser: Prism's `parseColor`, moved to the
  DOM-free `parse-color.ts` in its own commit).
- Perf: A7 (`Particle.selectLoci` merges in pairs: x15.8 at 4n before, linear after; `loci.scaling.ts`), A8 (`wayOf`,
  `shownState`, `entitiesOf` by Set; `ways.scaling.ts`), A9 (one `objectsState` and `particleLayersState` per area), F6
  (`mesoEntities` keyed on the arrays a move keeps).

## Decided

- Ludo (brief): the clip design points (clip logic in the app, shared clip splitting, two writers of the clip variant)
  are left as they are. A6 is the minimal part only (clear the hidden flag); the one owner of `clip.variant` stays open.
- Agent: A7's library fix is in this PR (the review suggested its own commit; it is one), though AGENTS says a library
  fix is a lane from `origin/master`: Ludo decides whether to cherry-pick it there.
- Agent: F13 changes colour parsing for the three extensions to the picker's (adds `rgb()`, `hsl()`, `#rgb`; a bare
  three-digit string is hex, as in the picker).
- Agent: F5 reuses `mesoscale.theme` (nested run inside `colorLevels`) rather than copying its plan.

## Learned

- `clipping.settings {variant}` only touches representations that carry cuts: a test of A6 sets the variant on the
  target representation directly.
- pnpm's corepack shim is broken here: `~/.cache/node/corepack/v1/pnpm/12.15.0/pnpm`.
- `pnpm check:workspace` fails in a fresh worktree on `@molstar/plugin-ui: Export pattern ./*.css has no matching files`
  (a build artefact; not from this lane).

## Left open

- A8's `shownState` and `entitiesOf` have no guard of their own (`entitiesOf` is private; `shownState` is a watched
  state).
- F5 runs one nested `mesoscale.theme` per uniform list (one history step, k+1 commits); the run restores all on a
  failure.
- The review gate: A3's group-row case refuted (Group by is shown only with the model picked, which replaces the pick);
  the misplaced-doc and distance-in-`particleBehind` findings refuted.
- Library-side commits for Ludo's call: A7 (`packages/model`) and the `parse-color.ts` move (`packages/prism/ui`).

- A2, A5, A9's wider debt (JSON compare per change), D1-D8, E1-E3, B1: not bugs of this lane's list; design or
  duplication, to TODO.md by Ludo's call.
- A7's app half (keep the picked node's loci rather than recompute on leave): the library fix removes the cost.

## Size

About 650 lines added, 150 removed, 25 files, tests and guards about half.
