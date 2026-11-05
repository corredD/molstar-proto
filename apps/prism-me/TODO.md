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

- **The views on the mocks**: built (the tree, lane `tree-view`; the properties, lane `properties-view`). The
  right-click's lane, `menu.ts` on its mock, is dropped (Ludo, 2026-10-28).

### From the cellVIEW evaluation (Ludo, 2026-10-28: all of it, a testable version by 2026-10-29)

Lanes in parallel where they do not overlap. The design is the mock: Storybook prism-me › Explorer › Proposed
(cellVIEW), `apps/prism-me/src/_stories/proposed*.tsx`, `clip-book.ts`; the reasons in
[progress/2026-10-28-cellview-evaluation.md](progress/2026-10-28-cellview-evaluation.md), cellVIEW's behaviour in
[_spec/cellview.md](_spec/cellview.md). A library part is built on prism-me for tomorrow, in commits of its own that
name no extension (upstreamable later, when Ludo says so).

- **3. Clips in a category of their own**: built (lane `clips-category`): a Clips category, a clip's What it cuts, a
  node's Clips, Add clip… with the scene's clips.
- **4. Graded cuts per part, and a part shown in part**: built (library: lane `graded-cuts`; app: lane
  `graded-cuts-ui`): a clip's What it cuts and a node's Clips give each object or part of particles its way (keeps a
  layer, cuts it, cuts it wider, band, fuzziness); a graded way switches the cuts to instance; Look › Shown on a group,
  an entity or a target. Left: the aperture cut, the cut's 2D preview, graded ways on structures (pixel only),
  precompiling the `dClipTable` programs.
- **6. Measure: do hidden particles cost a frame?** (library, a measurement; now). On WebGPU, CellPack MG with 90 %
  hidden against none: if close, the GPU cull skips hidden instances (a visibility table). Check: the numbers in the
  lane's progress file; if built, hiding most of a model makes it faster.
- **7. Ghosts of what is cut**: built (lane `ghosts`): a clip's Ghosts, Outline what it cuts.
- **Not by tomorrow: research, with Alexander, measured before any lane** (library): the aperture cut (the visibility
  equalizer, the mock's ApertureCut story); proxy spheres per target (k-means) against stride decimation; deferred
  shading from ID buffers. Each starts as a measurement or a design note.

### Left from colors that follow the zoom (brief 8, built in lane `dynamic-color`)

- Cuttlefish's coverage-driven hues (cellview.md §7.3, dead in cellVIEW too); a residue level; the edges in Å instead of
  pixels if Ludo wants it (`colorLevelSize` and `ColorLevels.atomSize`, `color-levels.md`); the levels on structures
  (not particles) and on volume or shape targets; a WGSL compile with `dColorLevels` on Dawn and a shader-against-rule
  test in the repo (review S4; the GLSL mesh program compiles natively, the sphere program where the backend has frag
  depth); per pixel instead of per atom if Ludo wants it. The on-cost zoomed in (up to 14 %): skip the blend where it is
  whole, then Oklab stored (progress/2026-10-30-dynamic-color.md, After Ludo's test, plan for 2). WebKit (Safari) draws
  only the RNA of CellPack HIV on WebGPU, on `prism-me` too.

## Library fixes ready for upstream

Each its own lane from `origin/master` (AGENTS.md, How we work), upstream only when Ludovic says so: he asks the
maintainer first (2026-10-25). All are v6 (master); the MRC reader and the particle bounds are in v5 too (upstream's
`v5` branch).

- Periodic volume slices drawn half a box away (`5affa6d17`).
- Plane slice sized in voxels used as Å (`ea7dc5d3e`).
- Gizmo: `rotate` axes option, `poseOfFrame`/`frameOfPose` (`ded144e8d`).
- MRC reader: mode 6, mode 12 (float16), `.rec`/`.st`/`.mrcs`/`.ali` (`33dbca0c5`, `59ef5aa38`).
- A whole particle list's bounding sphere filled the wrong way (`me/particle-bounds`, `0927c892b`; in 5.x too).
- WebGPU: a draw list recorded while the shared quad indices grew replayed the released buffer, nothing drawn until a
  change; and an earlier chunk's recording after a later chunk grew it (`8a159bd86`, `d42241bbb`, tests in
  `webgpu-draw-lists.test.ts`, lane `dynamic-color`; master has the same code). Its test runs only with
  `pnpm native:install -- --webgpu` (CI installs no Dawn).

- Meshes picked, highlighted and selected by triangle, and `Ray3D.intersectTriangle` (lane `mesh-measure`, built on
  prism-me in commits that name no extension: `ae323fe5a` core, `ebe4913d0` model, `f078afd6e`, `772faf324`,
  `8af312ac4`, `104e24625` graphics; .v6/plans/gl/triangle-picking.md).
- Sphere impostors: a sphere a pass discards whole leaves in the vertex stage, an unmarked one in the marking mask and
  one the opaque or transparent pass discards by its transparency (lane `marking-cost`, PR #33; spheres only: a mesh
  triangle or a bond can mix markers; x-ray, alpha thickness, opaque back faces and a per-vertex transparency stay on
  the fragment discard). Commits that touch only `packages/` and `.v6/`: `1b1b7fe72` (Grok's, both skips in one commit),
  `94ae9dcef`, `5ac8652d6`, `8782d0952` (Grok's), `a341b7560` (the varyings read back, the cutoff's margin,
  `dNoVertexSkip`, the native GL test), `f53bdab16` (the Dawn test), `74c2bb29c`, `1527fa1b4`, `e7ec993a0` (the tests),
  `270ccd791` (the changelog `.v6/changelogs/marking-cost.md`, first added in `459d33398` with app files, and the plan).
  The GLSL half applies to 5.x: a lane from master also needs a root `CHANGELOG.md` line. Upstream when Ludo says so.

- cellPACK entity descriptions (`_entity.pdbx_parent_entity_id`, not a compartment path or the name:
  `ParticleEntityInfo.description`) and a particle's loci label showing its entity's (lane `descriptions`, built on
  prism-me in commits that name no extension: `dac4930de`, `78c0b8514`, `43de664ef`).

## Backlog

- **Automatic transfer-function preset** (Ludo, 2026-11-03; to decide): "a great preset automatically" for a direct
  volume, an Auto entry in the transfer editor's Presets. Pointer: Barthel, "Automatic Generation of Volumetric Transfer
  Functions" (ImageJ Volume Viewer; files.visual-computing.com/research/AutomaticTransferFunctions.pdf), a 4-page note
  with no algorithm detail; its methods are in Sereda et al., LH histograms (IEEE TVCG 12(2), 2006) and Praßni,
  Ropinski, Hinrichs, efficient boundary detection (VMV 2009). Candidates: an EMDB map, its recommended contour level,
  or the threshold that encloses the volume of its mass; a tomogram, a ramp above the noise peak (mean + k·σ); several
  materials, boundary peaks from an LH histogram on the extinction pyramid's smoothed level.

- **Volume lighting, later** (built 2026-11-02/03, lanes `volume-lighting`, `volume-neural`, merged through #41;
  `progress/2026-11-02-volume-lighting.md`, `progress/2026-11-02-volume-neural.md`; plan
  [plans/2026-11-02-volume-lighting.md](plans/2026-11-02-volume-lighting.md)): `volumetric` on WebGL (falls back to
  `local`); the Quadro measurements; part D3; the network in f16 (neural is +60-70 % a frame over volumetric, past the
  +50 % bar); `neural` still labelled experimental (Ludo to decide); `emd_1181` volumetric loses some gradient detail.
  Clips (2026-11-03): the pyramid takes the first instance's clip, `uModel` (camera scale, XR) as the identity; with
  `ignoreLight` a clip change still rebuilds; the level-0 clip read costs 3-7 % a frame with a clip (Ludo may trade it).
  Library branches kept on the fork for upstream: `me/ome-zarr`, `me/glb-reader`, `me/volume-lighting`,
  `me/volume-neural`; `omeZarrLevelNeeds` and prism-viewer's `api/volume` export were added on the integration only.

- **Direct volume's transfer function on a volume's new data** (review of the Direct volume section, 2026-11-03):
  Prism's `createVolumeTransfer` reads the map's stats and `logMin` once. prism-me makes its editor again on the
  volume's new data (Data's Level, `cryoet.level`; `ExplorerApi.volumeData`). Prism's own inspector refreshes on the
  volume's sync, but its stats stay as read: a fix in Prism is still open.

- **CryoET Data Portal, later** (built 2026-11-02, lane `cryoet-portal`: index, load, card, URL; plan part E left): ask
  CZI to add molstar.org and the lab site to the GraphQL allow-list (then search the whole portal live); copick picks
  JSON as a particle format; alignments (a tilt series' images are raw, not in the tomogram's frame). A tilt series'
  placement (lane `portal-polish`): beside raw, beside turned or overlay turned, a switch; overlay the default (Ludo,
  2026-11-04); its turn, −(tilt axis + 180°), was measured on 10003 TS_08 only (another dataset's reconstruction
  convention may differ: check one of 10453 or 10518). Left by the review: a point's hover is still not the annotation
  (the properties have it; a list with `entityInfo` becomes a model); after `cryoet.level` on the tilt series the
  Placement buttons read none (the box moves a few Å, under a voxel); with two tomograms of one run in the scene,
  overlay uses the first. EMD-13412 (and 7PHB fitted in it) is of the other hand than 10003's tomograms
  (extensions/cryoet/_spec/portal.md §3): the decorations' positions are right, their orientations at chance against the
  density, and no rotation fixes a mirror. Ludo to decide: mirror the tomogram and its points in world x, or a mirrored
  structure as the target, or leave it said. Plan:
  [plans/2026-11-02-cryoet-portal.md](plans/2026-11-02-cryoet-portal.md). Open from Ludo's test (2026-11-03): the index
  holds 10003, 10453, 10524, 10518 of the portal's 392 datasets (all of them, rebuilt on a schedule, proposed); a load
  takes the portal's default tomogram (lane `portal-tomograms`), which for 10453 tomogram_003 is 56411 (IsoNet, 10 Å):
  it shows 4 automated (Octopi) V-ATPase picks, not the 3 manual ground truth at 13.44 Å (Ludo to decide: the
  ground-truth spacing's annotations by default, proposed); curated PDBs for common objects (V-ATPase, clathrin), by
  Delphine; a level read already sent is not cancelled (`cryoet.level`, review X2). An unbounded interval's ends cannot
  cross (v5's can, reversing a colour scale: Ludo may want that back).

- **EMPIAR by id**: steps A and B built (lane `empiar`, `?empiar=12534`; extensions/cryoet/_spec/empiar.md). Open,
  Ludo's call: step C, a tomogram too big to load whole (EBI serves about 150 KB/s a connection: the 834 MB tomogram
  takes over an hour; loaded, it peaks at 2.3 GB in the tab, 4.8 GB with its mask's surface): binned on the fly, slices
  by range, or converted once; the 3.3 GB tilt series wait for it. Step D: `.hff` surfaces (HDF5), other entries'
  layouts. A parsed MRC's file bytes stay in the tree (the `Download` cell's `Data.Response` body holds them beside the
  parsed grid: an 834 MB tomogram holds about twice; night review P2): needs a release on `Data.ResponseBody` (a library
  lane from `origin/master`), or step C's own parse. Each run's load fetches the condition's shared STAR again (review
  P3). The default files hold both STARs, and 12534's co-translation picks are a subset of its 80S picks (drawn twice).
  A second run of a condition with its EMDB average: `load.entry` says the average already loaded, so the run's
  particles are 50 Å spheres with a warning ("EMD-48752: not loaded (… already loaded.)"), not decorated by the average
  in the scene (review F5): `loadAverage` would need to find the volume of an entry already loaded.

- **Undo of a load that made a volume and a particle list in one step** throws in the scene's sync (prism-viewer
  `sources/scene.ts` `particleListData` → `getDecoratorRoot` on a list no longer in the tree: the particle hierarchy is
  stale when the sync runs; an unhandled TypeError, the scene otherwise right). Reproduced by `cryoetPortal.load`
  (`as: 'slices'`, `annotations: '5'`) then `history.undo` in `cryoet/_test/portal.test.ts`'s setup, and by
  `empiar.load`. A library fix, a lane from `origin/master`: a test that fails first, then a guard on the ref.

- A sphere a clip plane misses entirely (its center is past the plane by more than its radius): skip it in the color
  pass, and skip one the plane misses in the ghost pass (lane `marking-cost`, not built;
  `progress/2026-10-31-marking-cost.md`). A cone or a scaled sphere is not a safe radius test. It needs a rendered pixel
  test of the kind in `clip-ghosts-draw.test.ts` before it ships. That test draws mesh Shape spheres, not impostors.

- Meshes by triangle (lane `mesh-measure`, what is left; `progress/2026-10-31-mesh-measure.md`): a measurement follows a
  mesh's move on release, not live during the drag (the preview is the representation's transform, outside the state;
  the item "A distance follows its objects" below), and a pick during that preview finds the triangle where the mesh
  was; overpaint, transparency and a camera focus by a triangle apply to its group; a mesh's selected triangles are
  marks only (not in Prism's Selection tab, not saved in a session); a vertex-colored mesh's marked triangle is in its
  first vertex's color; the explorer's angle and dihedral are from the latest points only (no picking of the vertex by
  hand).

- Smooth close up (lane `instance-cull`, what is left; `progress/2026-10-31-instance-cull.md`): full detail always
  (Ludo); WebGPU turning frames over 16.7 ms at dpr 2 (CellPack 0.1, PetWorld) and PetWorld's still frames; WebGL2 close
  up over 33 ms (CPU culling, no occlusion while moving); the impostor's fragment depth (no early depth tests, no
  hidden-surface removal on the M1); Firefox not measured. The reviews' open items: second-phase instances get their
  solid-interior caps a frame late; the 'two-phase occlusion' test reaches no clusters and the one-phase path lost its
  canvas image test (the canvas tests now run two phases); pyramids built for multi-sample sub-renders with nothing to
  cull; the motion test does not check that the resize back is no motion (the headless context resizes nothing); CPU
  culling by instance skips the object's own distance range (draws more, not less); the look reads the display density
  once; no tests of the motion's no-resize fallback and of an image pass ending a motion (they need a DOM canvas).

- The properties (lane `properties-view`, its review's open items): a Visible line in a node's Look (ui.md §4 lists it;
  the app has the row's eye, a category its switch); a model's or group's color says Mixed when no entity has a color of
  its own (`common` cannot tell none from mixed); the Labels section lists the labels made at the row's key, not the
  tree's fallbacks (a label under its object's row when its own row is gone); each clip editor finds its cut among all
  (a Map by tag would do; a few at a node, at most 16 cuts a representation); icons beside words carried over (Remove
  the label, Add a clip, On top: styling.md §4); a viewer test waits on the real clock (300 ms) to show a run of picks
  makes one step; the extensions' `styles:check` is not in CI (`.github/workflows/node.yml` runs Prism's).

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
  one is picked: `auto` quality, a list's spacefill at no levels). A list drawn by fibers alone answers "already" to a
  mode and lights none: no levels of detail to set (a failure, as for an object with nothing drawn).
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
- A label by selection (lane `label-selection`, 2026-11-04) keeps its place, not its selection: `stage.move` moves it
  with its structure as any label, but a change outside the stage (a model's frame, a structure rebuilt) leaves it where
  it was; following its atoms is the distances' core issue above.
- Labels by selection, left open by the review (lane `label-selection`): ⌘K's "label A:10" lands first on Prism's
  Measure › Label an atom or residue… (Prism's measurement commands stay in ⌘K; the agent's tools are the stage's),
  while "add label A:10" is the stage's: hide Prism's in prism-me? (Ludo); "residue A:10" is not a target (PyMOL reads
  it), "A:10" is; no test that the canvas's right-click (`ui.tsx`) gives its loci to the menu (it needs a right-click
  with a page point and the context menu's DOM); at an instance granularity (residue instances) the pick is every copy,
  labelled at their centre.
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
  listeners, no `pointercancel` or lost capture: a lost release leaves its layer up; Prism's `drag()` would end it); a
  particle's preview copies every coordinate of its list (`offsetParticles`, architecture §5); a structure's preview
  allocates about 200 KB a pointer event (its representations' `setState` and update); the hosts' tests cover one step
  and an undo during a drag, not a refused commit's restore per host (only `GizmoHandles`' own test does).
- Live sliders, left open by `live-slice` (2026-11-03) and `live-forms` (2026-11-04): a key press or a typed value on a
  live slider holds the history for the 600 ms quiet (keys in a row are one step; other runs wait), as Prism's own
  sliders; the forms do the same after each change. A drag held still over 600 ms (or a 1 s main-thread stall) is two
  undo steps (`gestureSteps`' quiet; the form has no release). A form's history label is the representation's when the
  form was made (a slice's axis changed in its form: still "Slice X"). The jsdom fakes of `api.group` do not model the
  history's lock (the headless tests do).
- A slice step at level 0 (lane `live-forms`, item 7, measured 2026-11-04; Ludo: "Measure first"): on TS_08 level 0
  (928×928×450, WebGPU) one Z step takes about 435 ms (366–526), 89 % of it the image build on the main thread
  (`createGridImage`, `packages/graphics/src/repr/volume/slice.ts`, 387 ms a step), the texture upload about 12 ms, the
  render about 3 ms, the GC 23 ms. The build's loop does, for each of the 861k pixels, a theme `color()` call and a
  `Vec3.transformMat4` (even for a uniform theme), and a `mapping.index.set(o, [i])` (a Map of 861k entries, an array
  each). Proposal, in this order: (1) a library lane from `origin/master` (upstream candidate): the pixel→cell index
  made lazily or as a typed array (it is for picking), the color computed once for a uniform theme and the position
  stepped instead of transformed; expected 3–5× (about 80–130 ms at level 0, a few slices more a second), the same for
  every Mol* slice. (2) If still over a few frames: a coarser level while dragging (level 1, about 50 ms a step, only if
  loaded already), the full level at the release. (3) A GPU-side slice (a 3D texture sampled in the shader) would make a
  step a few ms but is a new representation: not before (1) is measured.
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
- The eyes, left open by lane `tree-eyes` (2026-10-29): a structure's entity and chain have no eye (Prism hides whole
  representations; one per part would be a transparency layer at 1, read back, or a component each: a Prism change); a
  parent's eye leaves the labels and clips under it with their own eyes (the coordinator's default: Ludo may want them
  set too; the distances follow it since 2026-11-02).
- Turning a cut of some particles off on one representation and on again (`clipping` on/off per representation) loses
  its particles: it comes back as a cut of the whole representation (lane `looks-owner`'s review; not probed).

- **Descriptions, left** (lane `descriptions`, 2026-11-04; the tree row's tooltip built on `me/tree-tooltips`):
  PetWorld's entities have no description in their files (only `pdbx_description`, the name); a portal annotation's
  description, method and GO term are in its properties (lane `portal-polish`), not on hover: the hover's description is
  an entity's (`entityInfo`), and a portal list given one becomes a mesoscale model in the tree (`operations.ts`'s
  `model`), so the points' hover needs a loci label provider in the cryoet extension or a label on the ndjson transform
  (Ludo's call); the classic Mesoscale Explorer shows MG's and HIV's compartment path as the description (its
  `model.ts`), not fixed there.
