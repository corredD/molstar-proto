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

- **The Clips category** (`rows.ts`, `ui.tsx`): after the four object categories, shown when the scene has a clip; a row
  per Prism cut (`k:<tag>`), named by its shape and number (Plane 1), its count (how many objects or parts it cuts), its
  eye (drawn in the scene) and its trash; open by default. No clip row under a node: the old placement (`clipsAt`, a
  group's by its entities, an atoms cut by its entity or chain) is gone. `ancestorKeys` and `revealRow` know a clip's
  row (under Clips).
- **What a clip cuts** (`clips.ts`, `ExplorerApi.cutOf`, `rows.ts whatItCuts`): object by object, all of it, some
  particles (read from each particle representation's layers cell, by the tag: not `Cut.particles`, which reads the first
  representation only), or some atoms (`Cut.atoms` on that structure's root). Shown as rows: a model's largest groups it
  cuts all of, in the model's grouping, then entities; a list's targets; a structure's entities, else their chains.
- **`explorer.clipUse`** `{ tag, nodes, on }`: one step that gives a clip objects or parts, or takes them off, through
  Prism's operations: `clipping.apply` (an object's representations), `particles.look` `cuts` (the union or the
  difference of the ids), `clipping.keep` / `release` (a structure's part: the rest kept whole). Limits checked first
  (16 clips a representation; a part's clip among the first six); a run that fails fails the step (restored).
- **A clip's properties** (Clip section): the editor of PR #14 unchanged (handles, numbers, On top, remove, shape,
  invert), then What it cuts (each name picks its row; × one step), Cut also… (each object, a structure's entities, a
  model's groups, a list's targets it does not cut all of).
- **A node's Clips**: the clips that cut all of it (an object's: any on it), each with ×; New clip (Prism's five
  shapes); Use a clip (the scene's others); Clip whole and the handle size kept. A category's Clips: New clip and Use a
  clip for every object in it; the Clips category's: a hint.
- **Add clip…** (`menu.ts clipItems`, the category's scissors in `ui.tsx`): New plane… New cone, then Use Plane 1… for
  every clip of the scene, greyed where it cuts the node already.
- **The mock**: the last use's × greyed in the Proposed stories too.
- **Specs**: ui.md §1 (the layout), §2 (where a clip lands), §3 (the category, no clip row under a node), §4 (Clips,
  Clip, what a clip cuts), §5 (Add clip…); features.md; TODO.md item 3 built; `.v6/changelogs/clips-category.md`.
- **Tests**: `clips-category.test.tsx` (4, each failed first: the category lists every clip and no clip row under an
  object; Cut also and × one step each and change what is cut, both parts of one model listed under one clip; New clip
  on the membrane, Use a clip on 1CRN; Add clip… lists the scene's clips, greyed when on). Changed on purpose:
  `rows.test` (the category; what a clip cuts of a model), `tree-view.test` (the clip rows; New plane), `properties.test`
  (a category's Clips), `clip-numbers` and `handles-on-top` (the editor in the clip's own section), `operations.test`
  (a target's clips include its list's), `rows.scaling.ts` (with What it cuts).

## Decided

- **The last thing a clip cuts has no ×** (lane default; Ludo's call if he wants otherwise): Prism's `clipping.apply`
  refuses to take a cut off its last representation and a Prism clip cannot cut nothing (the state is the record). The ×
  is greyed, its tip says to remove the clip instead; the mock does the same.
- **What it cuts is split into the largest rows** (lane default): one model's record is one id set per tag, so the
  membrane and the capsid given separately are listed separately, but two siblings that make up their whole parent are
  listed as the parent (the same cut). The test model keeps an entity in `envelope` itself so membrane ∪ capsid is not
  the envelope.
- **A node's Clips lists the clips that cut all of it**; an object's lists every clip on any of it. × always means
  "no longer cut by it" (`explorer.clipUse` off), never `clipping.remove` (the clip's own editor has that).
- **Cut also… does not list a model's entities** (thousands): a model's groups, a list's targets, a structure's
  entities; an entity is given a clip from its own Clips (Use a clip).
- **Names**: a part as `parent › name` (envelope › membrane, 1CRN › CRAMBIN), an object by its name; Add clip… says New
  plane and Use Plane 1 (Prism's shape names; the mock's say "plane clip").
- **The Clips category has no eye, brush or scissors** of its own here; its ⋯ (New clip…) is the tree-eyes lane's.

## Learned

- Prism's `clipping.cuts` does not see a change of what a cut cuts of some particles: `sameCuts` compares the objects,
  the drawing, kept atoms and targets, not the layers' record. The views of what a clip cuts also follow
  `ExplorerApi.particleLayersState()` (the layers cells' versions). A Prism fix (compare `particles` too) would not be
  enough on its own: `Cut.particles` is read from the first particle representation only.
- A nested `ctx.api.run` inside an operation joins its step, and a failed result restores the checkpoint
  (`api/run.ts`, `failed: (r) => !r.ok`): a composed operation is one undo step and all-or-nothing.
- A model's group paths keep the compartment's full dotted name (`root.envelope.membrane`), so their keys do.

## Size

+662 net production lines (858 added, 196 removed) under `apps/prism-me/src` without tests, against the brief's ~700:
`clips.ts` (251, new), `properties.tsx` (+195), `rows.ts` (+88), `operations.ts` (+47), `menu.ts` (+29), `ui.tsx`
(+23), CSS (+24 with its generated module), the mock (+5). No Prism change.

## Review
