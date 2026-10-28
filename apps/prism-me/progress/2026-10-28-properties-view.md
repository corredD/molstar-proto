# The properties on their mock (2026-10-28, lane `properties-view`)

## Brief

- **Asked** (Ludo, TODO.md `Next`, 2026-10-25; started 2026-10-28, the last item of the queue, before a full review):
  the properties rebuilt on their mock, `properties.tsx`: `SectionList`, `ParamsForm`, a category's Look and Clips,
  Position with its Handles. **Check:** the app's properties and their stories (Storybook, prism-me › Explorer ›
  Properties, one per kind) look and behave the same, light and dark, wide and narrow.
- **Spec:** [../\_spec/ui.md](../_spec/ui.md) §4 (and §3 for what a category and a clip row are); the mocks' table and
  Decided in [2026-10-25-explorer-mocks.md](2026-10-25-explorer-mocks.md) (rows §4 sections that fold to §4 the header);
  what the tree lane left to this one in [2026-10-27-tree-view.md](2026-10-27-tree-view.md) (a clip row's properties,
  the category's Look); Prism's styling rules (`packages/prism/ui/_spec/styling.md`).
- **What changes:**
  - the sections on Prism's `SectionList` (open per slot, reveal, a folded section paused), not the app's `Section`
    (`properties.tsx`, a module-global open set);
  - every row on Prism's tokens and `--msp-label-width`: no inline off-scale styles (59 `style=` in `properties.tsx`
    today; the 28 and 64 px `Line`/`Label`), and the same in the extensions' controls the sections use (cryoet's
    `controls.tsx`, ~38; mesoscale's `ObjectGraphics`, `ImportColors`);
  - every color by Prism's `ColorPicker` (the app's swatch and picker, and a mesh's native `<input type="color">` in
    cryoet's `MeshControls`);
  - the header names the kind (Structure, Model, Particle list…), not the raw kind string;
  - a category's properties (a category is picked since PR #13): Look (visible, a color theme for all under it, by
    `mesoscale.theme`, the same themes as its brush) and Clips (the cuts made at it, which cut all under it);
  - a clip row's properties (a clip is a row since PR #13): its Handles, its fields (shape, invert, position, rotation,
    size: Ludo, 2026-10-25, ui.md §4; the numbers of PR #12), On top, remove;
  - a Labels section on every node: its labels, each text, size, remove (the mocks' "missing" row);
  - kept as they are, restyled only: Representation, Decoration, Slice, Position with its Handles, Graphics & Motion,
    Group by.
- **Defaults taken by the coordinator** (Ludo said "do that lane" without choosing; say so in the PR):
  - a clip's shape and invert are fields in its properties, as ui.md §4 and Ludo's 2026-10-25 decision say; shape
    changes through Prism's clipping operation (one step);
  - a category's Clips lists the cuts its scissors made (PR #13: one cut per object under it, each in the same step),
    each editable as a clip row's; removing one there is one step;
  - stop and report over ~+800 net production lines (the restyle replaces more than it adds), or if a change needs Prism
    beyond a small export.
- **Tests:** the existing properties tests keep passing or change where the behavior changes on purpose; new: a
  category's Look theme (one step), a clip row's properties (shape and invert one step each), the Labels section (edit,
  remove), `SectionList` keeps a section open per kind across picks; behavior tests written to fail first.
- **Touches:** `apps/prism-me/src/explorer/properties.tsx` (and `distance-properties.tsx`), the extensions' controls the
  sections use (cryoet `controls.tsx`, mesoscale's), maybe `src/_stories/properties.tsx` (share with the story as the
  tree did), ui.md §4, features.md, a changelog. **Stays off:** `menu.ts` (its lane is dropped), the tree
  (`tree-view.tsx`), Prism (but a small export, said in the PR).
- **Size:** ~+800 net stop (above).
- **Steps and models:** 1. read ui.md §4, the mock, the table, `properties.tsx` and the controls (Opus) 2. SectionList
  and the header (Opus) 3. the category's and the clip row's properties, the Labels section (Opus) 4. restyle and
  ColorPicker (Sonnet for mechanical edits) 5. checks (Sonnet) 6. the gate (Opus reviewer, skeptic) 7. real GL and
  Storybook side by side: every kind, light and dark, 360 and 260 px.

## Built

The explorer's properties are the mock's frame (`src/explorer/properties-view.tsx`, `properties.module.css`): Prism UI
only, no viewer, so the Storybook mock (`_stories/properties.tsx`) draws its fake sections in the same frame, as the
tree lane shared the tree.

- The header: the row's name (a label's text, a clip's shape, as they change) and its kind in words (Structure,
  Mesoscale model, Particle list, Clip…), not the raw kind string.
- The sections on Prism's `SectionList`, in ui.md §4's order, each `when` its row applies: Look, Representation,
  Isosurface, Decoration, Slice, Oblique slice, Position, Clips, Labels, Graphics & Motion; a clip's, a label's and a
  distance's own section. One `ShellModel` kept with the tree's state (`SceneModel.sections`): every section starts
  folded, one opened (or folded) stays so from row to row this session; a folded section is paused. The module-global
  `Section` is gone; a volume's Slice X/Y/Z and its oblique slices are blocks in one Slice section.
- No inline style left in `properties.tsx` (59), `distance-properties.tsx` (9), cryoet's `controls.tsx` (38) and
  mesoscale's (5): lines are a label in `--msp-label-width` and a control, on tokens. cryoet and mesoscale have a CSS
  module each, with `styles` and `styles:check` scripts (as command-language).
- Every color on Prism's color row (`ParamsForm`'s, its `ColorPicker`): the app's swatch is gone, and so is a mesh's
  `<input type=color>`; a run of picks is one step, its pending write made at once if the row is left (`lastWrite`;
  cryoet's Slice and ObliqueSlice keep their raw timers, untouched). A color with none of its own (a theme's, mixed)
  says so in words, a button to pick one (a white swatch read 255, 255, 255: seen in Chrome).
- A category's Look: Visible (`state.visibility` of every object under it, one step) and its color themes as Choices,
  the same as its row's brush (`mesoscale.theme`, one step; Uniform in Prism's `ColorPicker`, applied once); the brush
  and the Look share `categoryTheme` (rows.ts). Its Clips: the cuts its scissors made (the tree's clip rows under it),
  each editable.
- One `ClipEditor` wherever a clip shows (an object's Clips, a category's, a clip row's own Clip section): its handles,
  its numbers' toggle, On top, remove, then its shape (Prism's five) and invert, one `clipping.update` each; the numbers
  made again for another shape. The clip row stays picked through a reshape (its tag is kept).
- A Labels section on every node but a category and what was made at a node: each label made at it (by its row's key,
  indexed by ref once a change), its text (as typed; Enter at once), size, Remove, one `stage.editLabel` each.
- `Picked` carries a clip row's tag (it was dropped); a category's Look reads its objects from the scene.
- Tests: `src/explorer/_test/properties.test.tsx` (8, each failed first), cryoet's `mesh-controls.test.tsx` (2, fake
  timers, each failed first).

## Decided

- The coordinator's defaults (not Ludo's; in the PR): a clip's shape and invert are fields in its properties (ui.md §4,
  Ludo 2026-10-25), shape by Prism's `clipping.update` (one step); a category's Clips list the cuts its scissors made,
  each editable as a clip row's, removed in one step.
- One slot for every kind, so a section stays open from row to row whatever the kind (ui.md Status, 2026-10-23: "one
  opened stays open from row to row"). The brief's "open per kind across picks" read this way; a slot per kind would
  change Ludo's rule, which is his call.
- The shell model lives with the tree's state (the viewer's life), not in the properties view: picking nothing (or
  closing the panel) keeps what is open.
- The mock moved onto the shared frame in the first commit (a clip's line and fields, a category's Choices and Uniform,
  a label's Text line); a Category story added. After the review (S5) it shows the sections the app shows, kind by kind
  (the app's were kept as they were); ui.md §4's For column says which. The mock's Position keeps a Reset the app's has
  not.
- Labels lists the labels whose `node` is the row's key; the tree's fallback (a label under its object's row when its
  own row is gone, a group's under its model while grouped otherwise) is not followed there.
- A distance's first line reads Value (the mock's), under its Distance section.
- No icons on the Add a representation menu's items (styling.md §4).

## Learned

- The brief said a category's scissors make "one cut per object under it"; the code (and the tree lane's Learned) make
  one cut of all of them (`clipping.add` `node: '#a, #b'`). The Clips follow the code.
- `SectionList` mounts every section's body at the pick, folded or not (`activity` pauses its bindings, nothing else): a
  `For` or `Show` under it fills in on the first open, but what a component does at its top runs at every pick.
- ParamsForm's color row cannot show "none", and its number sliders set the field once a frame while dragged: a field on
  it debounces (here `restartable`).
- A CSS grid's column is as wide as its widest item (`min-width: auto`): at 260 px a long button pushed the Look 26 px
  past the panel, cutting the sliders' boxes. `grid-template-columns: minmax(0, 1fr)`.
- 1CRN is colored by chain when it opens: a test of the category's theme picks By object.

## Size

Production (without tests, stories, generated files, docs): +1,228 −669, net +559 after the review's fixes (+523
before), under the brief's ~+800 stop. The app +404 (`properties.tsx` +631 −475: the frame, the category's Look and
Clips, the clip editor, the Labels section; `properties-view.tsx` 96, `properties.module.css` ~105), cryoet +80 (its CSS
module 72), mesoscale +39 (its CSS module 35). The stories +17 net.

## Review

Reviewer (Opus, read-only) on `origin/prism-me...HEAD` at 324cf93e4: 3 must-fix, 4 should-fix, 4 nits. Skeptic: none
refuted outright; S5 (the mock and the app) raised to must-fix, M3 lowered to should-fix, S6 lowered to a nit, the
Labels part of S5 refuted; 2 new (N1 the stale swatch after an undo, N2 the progress file overstated). Each confirmed
must-fix and should-fix fixed in a commit of its own, with a test that failed first where it is behaviour.

| Finding                                                                        | Severity      | Verdict                       | Commit / open                                                                                       |
| ------------------------------------------------------------------------------ | ------------- | ----------------------------- | --------------------------------------------------------------------------------------------------- |
| M1 a category's Look acts on the objects of its pick (one loaded later missed) | must-fix      | confirmed                     | fc0a0cc9b                                                                                           |
| M2 + N1 a color back to none (reset, undo) keeps the last swatch               | must-fix      | confirmed (undo too)          | 30dff0423                                                                                           |
| S5 the mock and the app show different sections; ui.md §4 says otherwise       | should → must | partly refuted (Labels match) | 0b3e245a2 (a node's Visible line: open, TODO)                                                       |
| M3 TODO.md's Next item left                                                    | must → should | confirmed                     | 33709d073                                                                                           |
| S4 a pending edit (label text, color, form) dropped when the row is left       | should-fix    | confirmed (pre-existing)      | 1183e840a (app), 465d1e3eb (a mesh's)                                                               |
| S7 real-clock waits; M1, M2 and the typing path untested                       | should-fix    | confirmed                     | tests with each fix; mesh tests on fake timers (465d1e3eb); a viewer test's 300 ms wait open (TODO) |
| S6 each clip editor finds its cut among all                                    | should → nit  | refuted as should (n tiny)    | open (TODO)                                                                                         |
| Nit: two debounces in MeshControls                                             | nit           | confirmed                     | 465d1e3eb                                                                                           |
| Nit: Mixed when no entity has a color                                          | nit           | confirmed                     | open (TODO)                                                                                         |
| Nit: icons beside words, carried over                                          | nit           | confirmed (pre-existing)      | open (TODO)                                                                                         |
| Nit: the extensions' styles:check not in CI                                    | nit           | confirmed                     | open (TODO)                                                                                         |
| N2 the progress file overstated (no raw timer; sections as the app's)          | nit           | confirmed                     | this file                                                                                           |
