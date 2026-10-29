# prism-me: what is not built

The deferred and partial features of [_spec/features.md](_spec/features.md), as work items (an entry leaves in the
commit that builds it). How a lane takes one: [AGENTS.md](AGENTS.md), How we work.

## Next

Ludovic's briefs, in the order to build them: one item a lane. Each says what he wants to see and how he checks it in
the app, in his words; the lane turns it into spec and tests.

<!-- - **Title**: what I want to see. Check: what I do in the app and what I expect. -->

In this order (Ludo, 2026-10-25), one at a time; the looks' owner (PR #8), the measure hint (PR #7) and the app as a
spec (lane `app-spec`) are built. From the architecture's decisions ([_spec/architecture.md](_spec/architecture.md) §7:
refactor in place) and the review of the distances (PR #5):

- **The views on the mocks**, one lane each, checked against its story in Storybook (prism-me › Explorer), light and
  dark, wide and narrow (the tree: built, lane `tree-view`): the properties (`properties.tsx`: `SectionList`,
  `ParamsForm`, a category's Look and Clips, Position with its Handles). Check: the app and the story look and behave
  the same. (The right-click's lane, `menu.ts` on its mock, is dropped: Ludo, 2026-10-28.)

## Proposed (cellVIEW evaluation, 2026-10-28): order to decide

From [progress/2026-10-28-cellview-evaluation.md](progress/2026-10-28-cellview-evaluation.md) and the reference
[_spec/cellview.md](_spec/cellview.md). Not briefs yet: Ludo picks, orders and moves them to Next. Each: its layer, its
evidence (read, inferred, measured), the decision it touches.

- **a. The graphics modes change the levels of detail** (app; read, not run). Performance, Balanced, Quality, Ultra
  write the pixel presets (`LodPixelPresets[mode]`: the strides and the pixel size), not the distance presets the
  particles ignore at 3 px. Check: on CellPack MG, Performance draws visibly fewer spheres far away than Ultra, and the
  mode picked stays lit. Test first: a mode's `lodPixelSize` is the preset's.
- **b. Graded cuts per part** (library and app; read, cellVIEW `ObjectSpaceCutAways.compute`). A part's cut row gets
  cellVIEW's + / 0 / − (+ keeps a layer of the part on the cut's face, − cuts it further), the band's width, and
  fuzziness (the band thins out at random, the same instances every frame). The per-part mapping becomes a table (cut ×
  part), which also lifts the 6 per-part cuts. Check: cut a cellPACK model with a plane, set the membrane to + and see a
  layer of it kept on the face; raise fuzziness and see it thin out; move the camera and see the same instances. A
  library change (Mol\*'s instance clip): its own lane off master, upstream when Ludo says so.
- **c. Measure: do hidden particles cost a frame?** (library; inferred). A hidden part is a transparency of 1, probably
  still drawn and discarded per fragment. Measure the frame on WebGPU with 90 % of CellPack MG hidden against none
  hidden; if close, the GPU cull reads a visibility table and skips them. Check: hiding most of a model makes it faster.
- **d. Show only** (app; cellVIEW's ingredient panel). On a part's right-click: show only this, only its group, only its
  compartment; and show all again. One step each, through `particles.look`. Check: right-click a ribosome, Show only,
  and only ribosomes stay; Undo brings back the rest.
- **e. Ghosts of what is cut** (library and app; cellVIEW `DrawGhosts`). A cut's removed instances drawn as outlines
  only, a switch on the cut. Check: cut a model in half and see the cut half's outline faintly, as context.
- **f. Research, with Alexander, measured before any lane** (library): proxy spheres per target (k-means, the radius the
  cluster's bound) against stride decimation, at the same sphere count; deferred shading from ID buffers; the aperture
  cut (the visibility equalizer: what is in front of a focus part is opened). Each starts as a measurement or a design
  note, not code. Proxy LOD stays per target, so it reopens no decision (architecture §7.2 is about per entity).

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

- The production build is over its size budget (`node scripts/esbuild/app.mjs apps/prism-me --prd`: index.js 5.78 MB
  against 3.40 MB), on prism-me before PR #9 too.
- Two fakes of the gizmo canvas: Prism's `@molstar/prism-viewer/testing/gizmo-canvas` (PR #9) and the gizmo library's
  own `fakeCanvas` (`packages/graphics/src/util/gizmo/_test/controller.test.ts:32`); one, in graphics' testing folder,
  when the gizmo library goes upstream (Ludo, 2026-10-26: kept for now).
- The Mesoscale Explorer's generic zip (`manifest.json`) and Martini `instanced_structure.json`, read to a particle
  list.
- Lightness, pattern, illustrative and cel shading per entity (particle layers beyond color, transparency, emissive);
  the explorer's quick styles for particles.
- Level of detail per entity; tumble except membranes.
- Graphics & Motion: a structure's own Representation preset (`structure.preset`) and a representation added later bring
  their defaults (the object reads mixed). The scene-wide `component.options` keep one structure's own since v6 #2057
  (guarded in `mesoscale/src/_test/object-graphics.test.ts`); the quick styles and `animation.wiggle` unchecked.
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
- A distance follows its objects: moving a structure, a list or a volume (or a particle with its handle) moves the
  distance's line and value with it, live during a drag, not on release (Ludovic, 2026-10-25). Waits for Ludovic's talk
  with the maintainer (2026-10-25): it needs a Mol\* core change, a dependency on an object being one on the object as
  decorated (`packages/core/src/state/state.ts`, `initCells` and the delete loop; review K1: the move is a decorator
  under the object, which the distance's dependency does not see).
- Distances, left open by the review: a test for the explorer's click routing on a label (`ui.tsx`: a Ctrl+click on a
  label is refused), which needs canvas clicks with a position and `labelAt`; a volume point keeps one instance (a
  volume of several, from MVS, would be measured from its first).
- Upstream (Prism): Home counts particles as loaded; `particles.representation` on decorated lists; shapes in the scene
  tree.
- Storybook stories for the Entities tab, the Decorations and Slice rows, the Segmentations tab and the stage menu,
  checked in the light and dark themes (Prism's AGENTS.md asks one for each view a user sees).
- Deploy: a `prism-me/` prefix in `scripts/deploy.js` (and the distribution, if it ships there).
- The classic Mesoscale Explorer's sessions (`.molx` with its own transforms): a reader that maps them to prism-me's.
- Before upstream PRs: squash `Particles: targets that reference objects in the state` with its fix
  (`a target ref is any cell`), and check each library commit builds and passes its tests on its own (`git rebase -x`).
- Handles, left open by `gizmo-handles` (2026-10-26): the label Move's own drag (`stage-tools/src/drag.ts`, raw DOM
  listeners, no `pointercancel` or lost capture: a lost release leaves its layer up; Prism's `drag()` would end it); the
  oblique slice's sliders leave several undo steps (`cryoet/src/controls.tsx`, a run 60 ms after each pause); a
  particle's preview copies every coordinate of its list (`offsetParticles`, architecture §5); a structure's preview
  allocates about 200 KB a pointer event (its representations' `setState` and update); the hosts' tests cover one step
  and an undo during a drag, not a refused commit's restore per host (only `GizmoHandles`' own test does).
- The explorer mocks' checks in CI: `pnpm -C apps/prism-me styles:check` and `typecheck:storybook` run nowhere
  (`.github/workflows/node.yml` runs them for `packages/prism/*` only), so a stale `_generated` module or a story's type
  error stays green.
- The explorer mocks group by `o:hiv` only (`_stories/explorer-panel.tsx`): a second mock model would share its Group
  by.
- `mesoscale.theme` on some structures, not all (an agent's few; the category brush always gives every one): one
  `representation.reset` each, in its one transaction (1+k tree updates). One for all needs Prism's
  `representation.reset` to take several structures (a Prism change; Ludo's call). Also open from the third review (lane
  `tree-view`): the category brush stays faded while its Uniform popover is open (only its menu keeps it shown); the
  picker opens at white, not the category's color; a tree update that errs inside the transaction is reverted while the
  run says ok (Mol*'s `State.transaction`); a part's failure is logged by Mol* as a transaction error.
- Prism's `SceneTree` over a model the explorer implements (an upstream export): the explorer's tree would be Prism's
  own (search, selection filter), not its rows repeated on `VirtualList` with the scene tree's CSS
  (`src/explorer/tree-view.tsx`, `tree.module.css`; the coordinator's default for lane `tree-view`).
- A list's class (target row) can be hidden (right-click › Hide) but not shown again but by undo: its row has no eye
  (lane `looks-owner`'s review, 2026-10-25).
- Turning a cut of some particles off on one representation and on again (`clipping` on/off per representation) loses
  its particles: it comes back as a cut of the whole representation (lane `looks-owner`'s review; not probed).
