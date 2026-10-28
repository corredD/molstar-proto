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
