# Storybook mocks of the explorer (2026-10-25, lane `explorer-mocks`)

## Brief

- **Asked** (Ludovic, 2026-10-24, Stage 2 of the architecture work): mocks of the explorer in Storybook, the reference
  the app is held to, as David works (architecture first, Storybook mocks as the reference). They decide refactor in
  place or prism-me-v2 ([../\_spec/architecture.md](../_spec/architecture.md) §7.6). **Check:** open Storybook at
  `prism-me/Explorer/…`, see each place of [../\_spec/ui.md](../_spec/ui.md) mocked in light and dark, wide and narrow;
  read the comparison table below and decide.
- **Spec:** [../\_spec/ui.md](../_spec/ui.md), every section (layout, opening, tree, properties, right-click,
  distances); a mock that shows a gap or a contradiction in ui.md notes it below (Decided), it does not change ui.md.
- **What a mock is:** pure. Prism's UI primitives (`packages/prism/ui`: virtual list, params, select, color,
  action-footer, scroll-area, context-menu, choices, tooltip, icon) with rows and params made in memory; no viewer, no
  plugin, no import from `apps/prism-me/src/explorer/*` (types only), so the mocks show the target, not today's code. A
  primitive Prism lacks for the design is a finding (the table's notes), not a home-made control.
- **Stories:** one per ui.md section: Layout (the panel beside a canvas placeholder), Opening (+ Open, the empty tree),
  Tree (loaded; a model with thousands of entities, virtualized; group by compartment and by function; clips, labels and
  distances as rows), Properties (one per row kind: structure, entity, model, group, particle list, target, volume and
  its slice/isosurface, mesh, clip, label, distance), Right-click (one per pick kind), Distances. Each in light and
  dark, wide and narrow; a row's hover actions and `@media (hover: none)`.
- **Wiring:** register `apps/prism-me` in `storybook/packages.ts` (group `prism-me`, the CSS modules plugin as
  `packages/prism/viewer`'s if the mocks have CSS); stories in `apps/prism-me/src/_stories/`. Prism's tokens and styling
  rules (styling.md §4, §5); `styles:check`-clean values.
- **Tests:** the stories build (`storybook` build or its typecheck), `npx tsc -b`, `npx tsc --noEmit -p apps/prism-me`,
  `pnpm lint`, `pnpm format:check`, `pnpm check:workspace`. No unit tests: mocks only.
- **The deliverable** beside the stories: the table under Built, ui.md section → story → the app today at :1343 (same /
  differs / missing) with a note each, and a closing paragraph: what the gap says for refactor vs v2.
- **Touches:** `apps/prism-me/src/_stories/*`, `storybook/packages.ts`, `apps/prism-me/package.json` if Storybook needs
  it, this file, a changelog `.v6/changelogs/explorer-mocks.md`. **Stays off:** `apps/prism-me/src/explorer/*`, the
  extensions, Prism.
- **Size:** ~900 production lines (stories and fake data).
- **Steps and models:** 1. read ui.md, styling.md, the foundations story and the primitives' stories (Opus) 2. fake data
  and the Storybook wiring (Sonnet) 3. the stories (Opus) 4. the app at :1343 against them, the table (Opus, browser) 5.
  checks (Sonnet) 6. the gate (Opus reviewer, skeptic; the UI-foundations check).

## Built

Storybook, prism-me › Explorer (`pnpm -C storybook storybook`, port 6006), stories in `apps/prism-me/src/_stories/`:
`fake-scene.ts` (the scene in memory: 1CRN, a cellPACK model of 2,400 entities by compartment or function, a RELION list
by class, a tomogram with its slices and an isosurface, a mesh; a clip, a label and a distance as rows), `fake-menus.ts`
(+ Open, the right-click per kind, Add clip's shapes), `explorer-panel.tsx` (+ Open, filter, the tree, the split, the
properties), `properties.tsx` (the sections of ui.md §4 per kind), `frames.tsx` (every story in light and dark, wide 360
and narrow 260 px side by side; the layout of §1), `explorer.module.css`. Prism UI only: `VirtualList` + `flattenTree` +
`keepRows`, `TreeNavigation`, `SectionList` on a `ShellModel` slot, `ParamsForm`, `Choices`, `Select`, `Slider`,
`TextInput`, `Button`, `Icon`, `openContextMenu`, `StatusPill`, `CanvasPlaceholder`, `drag()` and `frameState` for the
split, `installTooltips`. No import from `src/explorer/*`.

| ui.md                           | Story                                                      | The app today (`src/explorer/*`, at 26ee6cacf) | Note                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------- | ---------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §1 Layout                       | Layout › Layout                                            | same (layout), differs (split)                 | One panel, tree over properties, as the mock. The split is raw `onPointerDown/Move/Up` with `setPointerCapture` (`ui.tsx:406-416`, `612-628`): not `drag()` (no lost-release path, Prism's gesture rule), no keyboard; the mock uses `drag()` + `frameState`. Prism's own `Splitter` is private to `dock-view.tsx`: **finding**, no exported split primitive.                             |
| §2 + Open                       | Opening › Open                                             | same                                           | Same four items (`ui.tsx:657-672`); the app's have an icon each (styling.md §4: no icons on menu items).                                                                                                                                                                                                                                                                                  |
| §2 the tree empty               | Opening › Empty                                            | same                                           | Same line and formats (`ui.tsx:378-381`).                                                                                                                                                                                                                                                                                                                                                 |
| §2 drag and drop                | —                                                          | same (Prism's)                                 | The shell's drop, not mocked; Prism's `file-drop` view is not exported from prism-ui.                                                                                                                                                                                                                                                                                                     |
| §3 four categories, rows, count | Tree › Loaded                                              | differs                                        | Same rows and keys. The app's rows are inline styles with off-scale px (26, 20, 10, `calc(depth * --msp-space-3)`, `ui.tsx:486`, `514`, `545`) and a token that does not exist (`--msp-color-selected` with an rgba fallback, `ui.tsx:486`: 0 hits in `theme.css`); the picked row is not the accent. Cut-off names end in an ellipsis (`ui.tsx:549`, `properties.tsx:97`), not the fade. |
| §3 thousands of entities        | Tree › Thousands of entities                               | differs                                        | The app's tree is `For` over every shown row in a plain `overflow: auto` div (`ui.tsx:368-405`): not virtualized; each change flattens all rows and compares each by `JSON.stringify` (`rows.ts:386-400`). The mock: `VirtualList` over `flattenTree`, a group's 480 rows cost a screenful.                                                                                               |
| §3 Group by in the tree         | Tree › Grouped by function                                 | same                                           | A view state per model, `Choices` above the sections (`properties.tsx:290-314`).                                                                                                                                                                                                                                                                                                          |
| §3 clips, labels, distances     | Tree › Made at nodes                                       | differs                                        | Labels and distances are rows (`rows.ts:70-89`); clips are not (Prism's cuts listed in the properties' Clips only), where ui.md §3 says clips are rows too.                                                                                                                                                                                                                               |
| §3 a row's actions              | Tree › Touch (and hover in every tree story)               | differs                                        | The app's eye, brush, scissors and trash are always shown (`ui.tsx:516-599`), no hover reveal, no `@media (hover: none)`; the eye comes first. Prism's tree (and the mock) put the eye and ⋯ at the row's end, shown on hover, the eye kept while hidden. See Decided (ui.md says the eye first).                                                                                         |
| §3 keys, follow a 3D pick       | every tree story (arrows)                                  | differs                                        | The app's keys are its own (`treeKey`, `rows.ts:409`; `ui.tsx:299-310`), its scroll into view a raw `requestAnimationFrame` and a subscription per row (`ui.tsx:465-482`); the eye's flip is `requestAnimationFrame` + `setTimeout` (`ui.tsx:533`). Prism has `TreeNavigation` (prism-ui) and scoped `frame()`/`timeout()`.                                                               |
| §4 sections that fold           | Properties › every kind                                    | differs                                        | The app's `Section` (`properties.tsx:317-336`) is its own: a module-global open set, `Show` with no `reveal`, no `activity` pause. Prism's `SectionList` (the mock) remembers what is open per slot, reveals, and pauses a folded section.                                                                                                                                                |
| §4 Look                         | Properties › Structure, Entity, Model, Group, Mesh         | differs                                        | Content the same (color, opacity, glow; Generate colors). The app's color is its own swatch button + `ColorPicker` under it, debounced 150 ms (`properties.tsx:340-383`); its rows are inline styles with a 64 px label (`properties.tsx:65`) where Prism has `--msp-label-width`. No visible toggle in Look (the eye only).                                                              |
| §4 Representation               | Properties › Structure, Model, Particle list, Volume, Mesh | same                                           | A list's and a volume's: `ParamsForm` over the transform (`properties.tsx:593-674`), as the mock. A structure's is a preset `Select` (`properties.tsx:478`).                                                                                                                                                                                                                              |
| §4 Decoration                   | Properties › Particle list, Target, Model                  | same                                           | `@molstar/cryoet-extension/controls` `Decorations`: Prism's `Select`, `Choices`, `Slider` (controls.tsx); 24 inline styles there.                                                                                                                                                                                                                                                         |
| §4 Slice                        | Properties › Volume, Slice                                 | same                                           | cryoet's `Slice` control, Prism's `Slider`.                                                                                                                                                                                                                                                                                                                                               |
| §4 Position                     | Properties › Structure, Volume, Mesh                       | same, more                                     | Numbers, reset; the app also has handles, scale, handle size (Status, 2026-10-23), beyond ui.md §4's table.                                                                                                                                                                                                                                                                               |
| §4 Clips                        | Properties › Model (one clip), others (none)               | differs                                        | Prism's cuts, each its handles and remove; shape and side are Prism's handles', "not repeated here" (Status 2026-10-22), where ui.md §4 lists shape, invert, position, rotation, size per clip. ui.md and its own Status disagree.                                                                                                                                                        |
| §4 Labels                       | Properties › Model (one label), Label                      | missing                                        | No Labels section on a node (`NodeProperties`, `properties.tsx:85-116`); a label is edited on its own row (`LabelProps`).                                                                                                                                                                                                                                                                 |
| §4 Graphics & Motion            | Properties › Structure, Model, Particle list, Volume       | same                                           | mesoscale's `ObjectGraphics` (`properties.tsx:274-287`).                                                                                                                                                                                                                                                                                                                                  |
| §4 the header                   | Properties › every kind                                    | differs                                        | The app shows the raw kind string ("mesoscale model", "particle list", `properties.tsx:101`).                                                                                                                                                                                                                                                                                             |
| §5 Right-click, objects         | Right-click › Whole object                                 | differs                                        | The app's menu adds Hide, Color…, Remove, Ask the assistant (`menu.ts:419-472`); one "Move and turn (handles)" where ui.md has Move and Rotate; an icon on every item.                                                                                                                                                                                                                    |
| §5 Right-click, parts           | Right-click › Group, Model entity, Chain, Target           | same                                           | Move greyed with why (`menu.ts:109-117`), as the mock's "[to decide]".                                                                                                                                                                                                                                                                                                                    |
| §5 Add clip                     | Right-click › Add clip                                     | differs                                        | Five shapes (plane, sphere, box, cylinder, cone, `menu.ts:296-309`) vs ui.md's three. `openContextMenu` has no sub-menu: both open a second menu at the same place (**finding**).                                                                                                                                                                                                         |
| §5 clip, label menus            | Right-click › Clip, Label                                  | differs                                        | A clip has no menu of its own in the app (no clip row); a label's: Edit the text…, Move, Focus, Hide, Remove (no Rotate, which ui.md lists).                                                                                                                                                                                                                                              |
| §7 first point, status line     | Distances › First point                                    | same                                           | The app's picker posts to Prism's notifications (`ui.tsx:84-91`); the mock shows Prism's `StatusPill`.                                                                                                                                                                                                                                                                                    |
| §7 its row, properties, menu    | Distances › Made, Menu; Properties › Distance              | same                                           | Row "Distance 10.67 Å" under its first point's; value, from/to, text size and line width 0.1–100 log, opacity (`distance-properties.tsx`); Focus, Hide, Remove (`menu.ts:363-381`).                                                                                                                                                                                                       |

Prism findings (primitives the design wants that prism-ui does not export): the scene tree (`SceneTree`, grouped and
virtualized since #2043, with swatch, eye, ⋯, search and `TreeNavigation`) is the viewer's, private and bound to its
`SceneModel`; `SceneRow` (exported) fits only a nested tree, not a flat virtual one (no swatch, no ⋯). So the mock
repeats the tree's row rules in its own CSS (`explorer.module.css`, cited). Also: no exported splitter (the dock's), no
context menu with sub-menus, `installTooltips` not in the package index. The context menu's surface is the glass panel
tone: opened over the tree (a row's ⋯), the rows show through it (Right-click stories).

**Refactor in place or prism-me-v2.** The mocks measure the view layer only. There, the gap is in the containers and
their rules, not in what is shown: every ui.md place maps one to one onto today's rows, sections and menus (12 of the
table's 26 rows the same, one missing; most of the rest differ in how, not what), and the controls inside the sections
are already Prism's (`ParamsForm`, `Select`, `Choices`, `Slider`, `ColorPicker`, in `properties.tsx` and the extensions'
controls). What differs is the tree (not virtualized, rows rebuilt and compared as JSON, inline off-scale styles,
always-shown actions, its own keys and frame calls), the folding sections, the split, and three spec gaps (clips as
rows, a Labels section, the menu's extra items). That is a rewrite of `ui.tsx` (673 lines) and of `properties.tsx`'s
shell (its `Section`, `ColorField`, the header), not of the app: `rows.ts` keeps its flattening (moved onto
`flattenTree`, keyed), `menu.ts` its items, the extensions' controls stay. So refactor in place, view file by view file,
each against its story; v2 buys nothing the data layer needs, since architecture.md §7 decisions 1–5 hold either way.
What costs on either path: Prism's tree is not exported. Either Prism exports `SceneTree` over a `SceneModel` the
explorer can implement (an upstream change, the better end: the explorer's nodes in Prism's own tree, search and
selection filter included), or the explorer keeps its own rows on `VirtualList` as the mock does, repeating the tree's
CSS.

## Decided

- The mocks follow Prism where ui.md and Prism differ, and flag it here (ui.md unchanged, per the brief): the eye sits
  at the row's end with the ⋯, shown on hover and kept while hidden (Prism's tree, styling.md §4), where ui.md §3 lists
  the eye first. To confirm (Ludovic).
- A row's ⋯ opens the same menu as its right-click (Prism's tree has one); ui.md §3 does not list a ⋯. The app's brush
  and scissors on the row are not mocked: Color… and Add clip are in the menu (§5).
- ui.md §4's Clips (shape, invert, position, rotation, size per clip) is mocked as written; the app's Status
  (2026-10-22) says shape and side are Prism's handles' and not repeated. One of the two should change (Ludovic).
- Properties stories open every section to show it; Layout keeps them folded, as the app starts.
- Only `Look` has a visible toggle besides the eye; ui.md §4 lists "visible" under Look.

## Learned

- prism-ui's `SectionList` works outside the shell: a `new ShellModel()`, `registerSections` with `when` on the subject,
  `subject` the picked node. It gives the folding, the reveal, the pause and the open state per slot for free.
- `TreeNavigation` and `VirtualList` + `flattenTree` + `keepRows` make a keyboard tree in ~150 lines; Prism's
  `SceneTree` is the same over its `SceneModel`.
- A context menu opened inside a `contain: paint` panel is clipped (its `position: fixed` is relative to the container):
  open it at the app's root, as the app does.
- `apps/prism-me/tsconfig.json` excludes `_stories`: the stories are checked by `typecheck:storybook` only, which CI
  does not run for apps (`.github/workflows/node.yml` runs it for `packages/prism/*`).

## Size

~1,600 lines of stories, fake data and CSS (`apps/prism-me/src/_stories`, without `_generated`), against ~900. What took
the room: the tree panel (~330, the rows' CSS repeated because Prism's tree is not exported), the properties (~330, a
section per ui.md §4 row), one file per ui.md section (~240).

## Review

| Finding | Severity | Verdict | Commit / open |
| ------- | -------- | ------- | ------------- |
