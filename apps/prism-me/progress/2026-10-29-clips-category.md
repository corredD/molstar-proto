# Clips in a category of their own (2026-10-29, lane `clips-category`)

## Brief

- **Asked** (Ludo, TODO.md `Next` › From the cellVIEW evaluation, item 3, 2026-10-28; testable by 2026-10-29): a Clips
  category after Structures, Particles, Volumes and Meshes holds every clip of the scene; no clip row under an object. A
  clip's properties: its shape, then What it cuts (every object or part it is given, × to take one off, Cut also… to add
  one); the editor of PR #14 kept (handles, numbers, On top, invert, remove). An object's or part's Clips: the clips on
  it, New clip (a shape; it cuts this), Use a clip (one of the scene's). Add clip… in the ⋯ and the right-click lists a
  new clip of each shape and every clip of the scene. One clip is one Prism cut (its tag) over the representations it is
  given; each add or remove one undo step. **Check:** the ClipsCategory, GradedCut (its list only), PartClips and
  ObjectWithoutClips stories and the app behave the same; make a plane from the membrane's Clips, use it on the capsid,
  see both cut and both listed under the clip.
- **Spec:** [../\_spec/ui.md](../_spec/ui.md) §2, §3, §4, §5; [../\_spec/features.md](../_spec/features.md); the mock
  (`src/_stories/proposed*.tsx`, `clip-book.ts`); the reasons in
  [2026-10-28-cellview-evaluation.md](2026-10-28-cellview-evaluation.md); Prism's clipping
  (`packages/prism/viewer/_spec/clipping.md`).
- **Touches:** `src/explorer/rows.ts` (the category and the clip rows only), `properties.tsx` (a clip's What it cuts, a
  node's Clips), `menu.ts` (only what Add clip… lists), `operations.ts` (what a clip cuts, its add and drop), `ui.tsx`;
  ui.md, features.md, a changelog. **Stays off:** the row's columns, eyes and ⋯ (lane `tree-eyes`, in parallel; it merges
  first), `current.md`.
- **Tests, failing first:** the Clips category lists every clip; no clip row under an object; Cut also and × each one
  undo step and change what is cut; Use a clip on a second object; Add clip… lists the existing clips.
- **Size:** stop and report over about +700 net production lines, or a Prism clipping change that is large.
- **Gate:** tsc (both), lint, format:check, check:workspace; the unit tests of the app, stage-tools, cryoet, mesoscale;
  `test:scaling`; `styles:check` and `typecheck:storybook` (Prism and the app). Review: lane-reviewer, then
  lane-skeptic. Real GL: Playwright, headless Chrome, port 1353 (Storybook 6103), WebGPU and WebGL2.

## Built

## Decided

## Learned

## Size

## Review
