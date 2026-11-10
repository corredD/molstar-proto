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
- cellPACK fibres drawn as tubes when their points have a target (lane `fibers-targeted`, made on a prism-me lane:
  master has the same `hasUntargeted` guard in `complexVisuals`; port when Ludo says).
- Plane slice sized in voxels used as Å (`ea7dc5d3e`).
- Gizmo: `rotate` axes option, `poseOfFrame`/`frameOfPose` (`ded144e8d`).
- Grid slice image 3× faster, pixels identical (`me/fast-slice` from master: `3c92cb7ff`..`ad8665a13`; in prism-me by
  #55; a `CHANGELOG.md` line, 5.x too).
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

- **Lipid membranes made per view, left from lane `lipid-procedural`** (2026-11-08;
  progress/2026-11-08-lipid-procedural.md):
  - Round 6, a cell's membranes as one (Wrap all): the wrap of the yeast cell took about 7-10 s in round 6 (cutters,
    pools, four patch surfaces over 1.08 M triangles), not measured again since round 7's pools a part and leaflet (wrap
    time and RSS); under a clip every part's surfaces draw (~45 ms at the whole cell); a part's enclosure is one bit for
    all its components (the eye in one mitochondrion shows every IM).
  - **The budget's ceiling (Ludo, 2026-11-09: keep fixed shares; round 7 review S2).** The budget is water-filled over
    every leaflet of the membrane at the wrap (`poolCapacities`), not over those in view: a leaflet's pool is about 1.1
    × budget / L whatever the view. The skeptic's table, the PM's outer leaflet at 2 M: 122 k lipids with P = 9 parts
    (yeast), 37 k at 30, 11 k at 100, 1.1 k at 1,000. A close view takes about 73 k a leaflet (round 6), so about 15
    membranes (L ≤ 30) is the ceiling for a close view; a middle view of the PM wants about 2 M (round 5), so it is
    already about 15× short at yeast (far parts empty). About 1,700 member objects on yeast (a pool a member a leaflet
    and part) against 200 before. A share by the leaflets in view (re-sized per view) is the lever, Ludo's call.
  - A part row picked shows empty properties (round 7 review N5): its Look (eye, colour) is in its row only.
  - `mesoscale.theme` over particles and a membrane at once, the membrane's redraw failing: rolled back as one (round 7
    review S4), tested on a membrane alone.
  - A part's cut copies the cells' table (64 KB) three times a leaflet (cutter, near and far patch tables; review X1
    removed the regions' copies: 688 → 105 MB on a synthetic cell of nine membranes).
  - A row per species in the tree (eye and colour): the membrane's Look holds them this round.
  - Picking a lipid: a pick's slot maps to (triangle, lipid) through the selection (its units and bases; `lipidAt` went
    with round 5's cells), but the membrane's `getLoci` is still empty; per-lipid layers stay per species (a slot is not
    a lipid).
  - Ghosts, outlines, transparency and glow per species: not mapped onto the membrane yet (colours by zoom are, round
    4c: far its colour, then its species'; round 5: then its atoms by element). A colour change writes the colours in
    place since round 9 (`recolor`), but a change of a member's granularity (one colour or by species: `colorBy`, a part
    colour with By zoom off) still builds. A dither of the spheres themselves at the switch: a graphics library change
    (the object fade is off with levels), Ludo's call.
  - Round 9, colours from meshes: a part's Reset and `mesoscale.colors { scheme: theme }` on parts clear round 7's part
    colours only, the mesh's colour left (its default grey again? Ludo's call); without cryoet in a spec the dot writes
    part colours that the switch on leaves out (prism-me always has cryoet); a saturated mesh colour times a saturated
    species colour goes dark (a red mesh on a green species: black); the recoloured patch raster is checked by count
    (only the changed leaflets'), not by its texels (no readback of the texture on Dawn yet); `tint` is local (Mol*'s
    `Color` has no multiply): a candidate for `@molstar/core/util/color`.
  - Round 9 gate, left open: a recolour paints every member and surface again, not only the parts whose tint changed
    (N1); a partial theme multiplies the membrane's own colour by the tint (N2); a membrane depends on a shape's first
    representation only (N3); two tests named "mesh representation" (the explorer's and `meshColorCell`'s, N4); the
    "lacks a species" warning not checked on the explorer's fixture (N7); one round-7 part colour left 48 spheres
    unmerged (X2: may be gone with S1's group colours, not measured); a session's Wrap all made before round 9 lacks the
    representations in `dependsOn` (a mesh recoloured does not reach it until wrapped again, S4c); a session saved with
    the `Mesh` or `Shape` part names (rounds 6 to 8) loses its parts' eyes and colours on reload, and its parts take the
    mixes of their new names (S4b, recorded in the changelog).
  - Spheres far look past the budget: far parts empty. Thinning lipids at generation needs each sphere grown by its
    instance's scale (the spheres shader takes the model scale only): a library change.
  - The far texture is flat colour (the heads' heights shaded into it), no normal from the head bumps; it switches from
    the spheres at 2 px by default (round 5): the tube's silhouette is the mesh's there, not lipids'.
  - Round 8's shells (the heads as N instanced shells over a per-view band): the shader (`dPatchMiddle` shells, beneath)
    and the band (`shell-band.ts`) are built and tested, the band objects are not: their writes happen in the culler's
    view hook, mid-frame, and whether they reach the GPU that frame (and a frame after them at rest) is open
    (`updateGPUData`, the draw order of the objects). Then the band's clip, tests 3-6 for shells; `membraneDetail`
    refuses `middle: shells` and a shells count until then. The shell band's stack and cap (256 nodes, 65,536 triangles;
    the design's 256 k) drop past them silently (gate N6). Parallax is the default middle look (Ludo, 2026-11-10).
  - Parallax with a clip (round 8 gate, measured): every cut member keeps its sphere levels while a clip exists (the cut
    band needs them), so away from the cut the lipids the hysteresis keeps under 8.8 px show the stride-8 level again: a
    zoom with a clip far from the path pops by 0.041 at 6.7 px (0.023 without the clip, same probe). A fix: the band's
    lipids in members of their own (levels on), the rest atoms-only; or the selection keeping no unit below the stride-1
    px outside the band.
  - Parallax (round 8 gate): the near surface takes the flat raster under a relief but not the profile normal (X2); a
    face-on cut (k ≈ 1) shows a sliver between the leaflets past the cut band (the middle look has nothing between them
    there); no grazing scale of the gradients (N1); test 6 asserts no frame at rest only through the selection (N2). A
    middle switch without a clip, coarse ↔ parallax, still builds (the cut lipids' levels change; the cutters kept); the
    fast path re-culls through a new version of the merged objects' transform, as the culler has no hook for a pool's
    params (a library lane could add one).
  - Close views at x600 and x20 alike: about 170-240 ms a frame on the M1 under Dawn (lipids of 8-16 px at atom detail,
    their spheres writing depth: no early-z); not the scale. A lighter close level (fewer, larger spheres from 8 px) is
    the next lever, Ludo's call after Chrome.
  - Bands where a cell or region seam meets the coarser levels (round 5 moved the near surface to the mid-plane: it
    stood over them at the lowest head); the cause of the bands is not pinned.
  - The tiles are not made per view (built whole, as before), and refused past 50 M lipids (round 5).
  - Export as Blob chunks (the browser holds the file before it saves it); streaming to disk through the File System
    Access API where there is one.
  - Library: `segmentScale` reads a GPU-written member's CPU placeholder (zeros): with the sphere raster on,
    `predictRecords` may send its levels to the raster (unseen on the M1, which has none). The pool's library commits
    (`f99c9e0b1`, `a6d265ce8`) to their own lane from `origin/master`.
  - A view's selection is O(triangles in view) + O(cells in reach) (round 5): linear in the mesh's triangles, 2-9 ms at
    x600 for both leaflets; past the brief's 4 ms on wide close views.
  - Object graphics on a membrane does not show its active Quality (review S4: `graphicsState` knows no membranes).
  - Pool capacities sum to about 1.1 × the budget, and a hidden species keeps its share (review nits).
  - Round 5's gate, open (progress file, round 5 gate table): `farSurface` and `cutterBases` are test-only since the
    patch texture (N4: remove them with their tests, or keep them as the references); a failed build destroys textures
    the last build's objects may still draw (X4); the texture's v stretched under 0.6 Å (X5); the reviewer's N1-N9.
  - A view's selection measures 15.6 B (`lipid-selection.quick.ts`; round 7 sorts its keys by `sortKeys`, a heap sort,
    not core's `sortArrayRange`, whose partition pair a call a module-level pair would remove: a core change, its own
    lane, then `sortKeys` could go; the heap sort's time against a quicksort not measured). The upload makes a view of
    each array a changed selection (a storage buffer's `write` takes no length: a graphics change), and the culler's
    `setLiveCount` and `writeSegmentRow` a typed-array view each where a pool's live count moves (round 7 review S2: one
    `Uint32Array` over the segment copy and a preallocated row would make them 0).
  - The cutter refuses meshes past 2^21 triangles (a unit's key in a double): decimate first; a wider key if a mesh
    needs it.

- **Lipid membranes, left from lane `lipid-tiles`** (2026-11-08; progress/2026-11-08-lipid-tiles.md, Numbers):
  - Round 3, parked by Ludo (2026-11-08: the membrane goes view-dependent and procedural in round 4: lipids only for
    visible triangles above a size on screen, the far view a surface, the full build only at export), superseded by
    round 4, no code: the tiles' own hole fill (their holes were mostly the round patch's empty corners, fixed in round
    3; what is left, the bake's pinholes, unmeasured since); the levels' radius growth tuned and a far surface (the
    library now scales a GPU-written member's spheres at its levels, `4ac0c0de8`; Ludo tunes custom levels in Look); the
    full numbers at 27.7 M lipids (wrap time, GPU bytes, frame times by distance). The cutter's regions
    (`cutterRegions`) are round 4's unit.
  - Round 3, open: the mesh Ludo saw drawn after a wrap of `model_vertexcolor.obj` ×100 is not reproduced headless
    (jsdom, Dawn); the Look's eye lagging the tree's is fixed. A wrap's main-thread stretches: under 100 ms on the cow
    ×100, up to 550 ms at 35 M lipids (a tile variant's bake does not yield: about 430 ms at 188 Å tiles; the patch's
    first read about 80 ms; a worker for the bake and the parse, round 4). The cutter's buffers: past about 22 M
    instances on the M1 (4 GB) it fails with a message, not a lost device; a split of the work is not built.
    `checkInstances` copies the culler's largest allocation by hand; only a Dawn test pins it (review S4: a quick test
    against a fake compute). A wrap whose apply is in flight across a context change hands its old-context objects to
    the new canvas (review X2, plausible: `setGraphics` reaches only representations already added). Points exactly on a
    shared vertex may be cut by none or several triangles (N1, measure zero). Real-timer waits in two quick tests (N6).
  - Round 2 (Holes, LOD and the cutter): pick the default method after Ludo compares (both in the right-click since
    round 3); the cutter's clashes at region borders (no removal, as cellPACKgpu); the cut lost parts meet the tiles
    near the remesh (about 400 k atom pairs under 2 Å on the cow); pinholes at the middle level of detail; the cutter's
    4 B a member and triangle. From the review: the cutter's write guards only its member's end (a float difference
    between its two passes could spill a hit into the next triangle's slots); on WebGL2 the description counts no cut
    lipids; the library commits `bde208175` and `4ac0c0de8` (round 3, review S7) to their own lane from `origin/master`.
  - The tile sets are baked on the main thread when a membrane is first made: the CHARMM-GUI patch about 5 s (16
    variants a leaflet), 42 s with two vertex colours (128). The brief's worker is not built.
  - Corner discs are off: the transform makes one vertex colour (`vertexColors: 1`), the brief had two. To decide (two
    colours give eight times the variants and the bake).
  - The patch: the right-click wraps with CHARMM-GUI's step4 patch (`src/lipid-patch-charmm-gui.dat`, 5 MB in git: Ludo
    to say whether it moves out of the repo); another only by command (`patchPdb`, `patchUrl`). Open a bilayer PDB
    from + Open, and keep a named patch in a session (the registry is the module's: a session with one does not
    restore).
  - From Ludo's cow (2026-11-08): parts thinner than the 40 Å minimum edge (the legs below the knee) are lost in the
    remesh; the bands are one strip an edge type, so the tile scale still repeats along edges (Durrant's random
    per-triangle offset into the patch is the alternative, Ludo's call); heads and tails share their species' colour
    (per-atom colour needs per-atom groups); a 3 Å seam slack trades the flat-seam guarantee for no vertex gaps; the
    membrane does not follow a mesh scaled after the wrap.
  - Bytes a lipid: the spheres' markers are per group and instance (1 B a lipid, CPU and GPU), and the CPU keeps a
    zeroed 64 B transform a tile (twice, in the member and the merged arrays). Markers per instance would pick a tile,
    not a lipid.
  - No membrane on WebGL2 (no compute): a CPU fallback if wanted. A per-lipid hide mask (protein exclusion) is the next
    lane.
  - On WebGL2 the right-click still offers Wrap with lipids and the bake runs before the status line says nothing is
    drawn (review S5, X2). To decide: fail first (changes the brief's §6) or keep.
  - A membrane is removed with its mesh, but does not follow it when the mesh is moved (review S6): a mesh membrane
    should read the mesh again on its dependency's update. A compartment's sphere is a snapshot. Not probed: whether an
    update of the mesh's cell (a recolor) re-applies the membrane and rebuilds its objects and kernels.
  - Seams on curved surfaces: 2–3% of lipids have an atom pair under 2 Å across a seam at R 300 Å (0 on a flat plane);
    bounded in `lipid-tiles.test.ts` (medium). Bending the bands to the surface would remove it.
  - Not built from the brief: picking a lipid (tile and group; `getLoci` is empty), color by residue name through Mol*'s
    themes (the representation's own param now).
  - Levels of detail: the membrane's members are gridless, and the culler draws gridless members at full detail
    (`merged-culler.ts` `writeSegmentRow`); the culler's raster prediction reads the writer member's zeroed CPU
    transforms (`segmentScale`, review N1: a tight-bounded writer could lose near spheres with `sphereRaster` on).

- **Fibre points drawn twice** (lane `fibers-targeted`, 2026-11-08; to decide): a cellPACK fibre's points keep their
  one-atom target under the new tubes (the yeast slab: 2.3M extra instances). Leave fibre points untargeted in the
  reader (lighter, tubes only), or keep both (a cellPACK fibre whose points carry an ingredient)?

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
  P3). The fetch-ahead (B2) copies the fetched bytes into a `File` asset that `Download` reads again: the tomogram is
  held about three times during the build, and `empiar.md` §3's 2.3 and 4.8 GB peaks were measured before it (review
  F4): measure again with `vmmap`. The default files hold both STARs, and 12534's co-translation picks are a subset of
  its 80S picks (drawn twice). A second run of a condition with its EMDB average: `load.entry` says the average already
  loaded, so the run's particles are 50 Å spheres with a warning ("EMD-48752: not loaded (… already loaded.)"), not
  decorated by the average in the scene (review F5): `loadAverage` would need to find the volume of an entry already
  loaded.

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
  the label, Add a clip: styling.md §4); a viewer test waits on the real clock (300 ms) to show a run of picks makes one
  step; the extensions' `styles:check` is not in CI (`.github/workflows/node.yml` runs Prism's).

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
- A slice step at level 0: (1) built, #55 (2026-11-04): TS_08 level 0 273 → 87 ms a Z step (the pixel→cell index
  computed, not a Map; the position transform inlined; a uniform theme's colour once). Left, if a drag still lags: (2) a
  coarser level while dragging, the full one at the release; (3) a GPU-side slice (a new representation).
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
- From the master merge (lane `merge-master`, 2026-11-09):
  - `VisualSet.update` settling when its representation is removed meanwhile (6ffbdee19) is a library fix: its own lane
    from `origin/master`, upstream on Ludo's word (master's `GizmoController#front` does not await its update).
  - `webgpu-device-listener.test.ts` (master's) crashes Dawn (SIGSEGV) on prism-me, passes on master; master's test
    copied onto pre-merge prism-me crashes too: some prism-me GPU work still pending when an owned device is destroyed.
  - A size-only change of a non-element target (volume dots' `sizeFactor`) does not refresh its bounds (the merge took
    master's `updateTransform`; e91553839 did it under `updateSize` too): small, as master's `Spheres`.
  - `ghostSphere` (cell-cull.wgsl) is tested without the wiggle allowance; `moveLayout` leaves `splitGridVersions` stale
    (one re-split of the moved members at the next member's drag).
  - The Ghosts switch is canvas-wide but shown in every clip's section: once, in the Clips category, if Ludo prefers.
