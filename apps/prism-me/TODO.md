# prism-me: what is not built

The deferred and partial features of [_spec/features.md](_spec/features.md), as work items (an entry leaves in the
commit that builds it). How a lane takes one: [AGENTS.md](AGENTS.md), How we work.

## Next

Ludovic's briefs, in the order to build them: one item a lane. Each says what he wants to see and how he checks it in
the app, in his words; the lane turns it into spec and tests.

<!-- - **Title**: what I want to see. Check: what I do in the app and what I expect. -->

In this order (Ludovic, 2026-10-25): the first two in parallel, then one at a time. From the architecture's decisions
([_spec/architecture.md](_spec/architecture.md) §7: refactor in place) and the review of the distances (PR #5):

- **A distance follows its objects**: moving a structure, a list or a volume (or a particle with its handle) moves the
  distance's line and value with it; measuring outside selection mode says so (a hint) instead of nothing. Check:
  measure between two structures, move one: the line and the value follow; ⌘/Ctrl+click with selection mode off: a hint
  says to turn it on. (Review K1: the move is a decorator under the object, which the distance's dependency does not
  see.)
- **One handle class in Prism's gizmo library** for the oblique slice, the object move and the particle move: preview
  outside the state, one commit on release. Check: drag each handle, then undo once: it goes back to before the drag.
- **The app is only a spec**: `explorer.clipWhole`, the picks, the label sizing and the direct extension calls move into
  the extensions as operations. Check: the app behaves as before; `apps/prism-me/src` has no `as any` and calls no
  extension method directly.
- **The views on the mocks**, one lane each, checked against its story in Storybook (prism-me › Explorer), light and
  dark, wide and narrow: the tree (`ui.tsx`, `rows.ts`: `VirtualList`, `TreeNavigation`, the row's tools on hover, the
  eye at the end, categories picked); the properties (`properties.tsx`: `SectionList`, `ParamsForm`, a category's Look
  and Clips, Position with its Handles); the right-click (`menu.ts`: one Move and turn, no icons on items). Check: the
  app and the story look and behave the same.

## Library fixes ready for upstream

Each its own lane from `origin/master` (AGENTS.md, How we work), upstream only when Ludovic says so: he asks the
maintainer first (2026-10-25). All are v6 (master); the MRC reader and the particle bounds are in v5 too (upstream's
`v5` branch).

- Periodic volume slices drawn half a box away (`5affa6d17`).
- Plane slice sized in voxels used as Å (`ea7dc5d3e`).
- Gizmo: `rotate` axes option, `poseOfFrame`/`frameOfPose` (`ded144e8d`).
- MRC reader: mode 6, mode 12 (float16), `.rec`/`.st`/`.mrcs`/`.ali` (`33dbca0c5`, `59ef5aa38`).
- A whole particle list's bounding sphere filled the wrong way (`me/particle-bounds`, `0927c892b`; in 5.x too).

## Backlog

- The Mesoscale Explorer's generic zip (`manifest.json`) and Martini `instanced_structure.json`, read to a particle
  list.
- Lightness, pattern, illustrative and cel shading per entity (particle layers beyond color, transparency, emissive);
  the explorer's quick styles for particles.
- Level of detail per entity; tumble except membranes.
- Graphics & Motion: the scene-wide structure options (Prism's quick styles, `component.options`, `animation.wiggle`)
  put their quality and motion back on every structure, losing one structure's own; so do the structure's own
  Representation preset (`structure.preset`) and a representation added later (its defaults: the object reads mixed). A
  plugin-core change, a lane of its own; pinned in `mesoscale/src/_test/object-graphics.test.ts`.
- Graphics & Motion on parts (entities, chains, groups, targets) and meshes; the starting state shown (no mode lit until
  one is picked: `auto` quality, a list's default levels of detail).
- The canvas resolution (pixel scale, sharpening) on screen: only ⌘K, `?graphics-mode=` and the agent set it now.
- A volume's quality: Mol\*'s `quality` barely changes a slice or an isosurface; a stronger setting per volume
  (resolution, a smoother surface).
- Color import per compartment (v5 parity): one entity per name across compartments; per-compartment layers
  (`ParticleLayerProps.compartments`) would restore it.
- Snapshot descriptions' links: `#key`, `i<names>`, `g<group>.<names>`.
- Tilt angles (`.tlt`, `.rawtlt`) with the images of a tilt series; binning large tomograms.
- Decorating by a string column (a tomogram name).
- Keys on cuts (animation).
- Distances, left open by the review: tests for the explorer's click routing (`ui.tsx`: a modifier click outside
  selection mode reveals its row; a Ctrl+click on a label is refused), which need `explorerUI` mounted with canvas
  clicks and `labelAt`; a volume point keeps one instance (a volume of several, from MVS, would be measured from its
  first).
- Upstream (Prism): Home counts particles as loaded; `particles.representation` on decorated lists; shapes in the scene
  tree.
- Storybook stories for the Entities tab, the Decorations and Slice rows, the Segmentations tab and the stage menu,
  checked in the light and dark themes (Prism's AGENTS.md asks one for each view a user sees).
- Deploy: a `prism-me/` prefix in `scripts/deploy.js` (and the distribution, if it ships there).
- The classic Mesoscale Explorer's sessions (`.molx` with its own transforms): a reader that maps them to prism-me's.
- Before upstream PRs: squash `Particles: targets that reference objects in the state` with its fix
  (`a target ref is any cell`), and check each library commit builds and passes its tests on its own (`git rebase -x`).
- The explorer mocks' checks in CI: `pnpm -C apps/prism-me styles:check` and `typecheck:storybook` run nowhere
  (`.github/workflows/node.yml` runs them for `packages/prism/*` only), so a stale `_generated` module or a story's type
  error stays green.
- The explorer mocks group by `o:hiv` only (`_stories/explorer-panel.tsx`): a second mock model would share its Group
  by.
- A list's class (target row) can be hidden (right-click › Hide) but not shown again but by undo: its row has no eye
  (lane `looks-owner`'s review, 2026-10-25).
- Turning a cut of some particles off on one representation and on again (`clipping` on/off per representation) loses
  its particles: it comes back as a cut of the whole representation (lane `looks-owner`'s review; not probed).
