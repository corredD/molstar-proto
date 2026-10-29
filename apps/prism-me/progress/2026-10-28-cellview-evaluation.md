# cellVIEW evaluation: what prism-me can take (2026-10-28, lane `cellview-eval`)

- **Asked** (Ludo, 2026-10-28): from cellVIEW, the Unity viewer whose tree controls the visibility and the cut mapping
  of a cellPACK model, write an accurate spec, evaluate what is good to take with WebGPU in mind ("the most performant
  viewer that exists for the mesoscale"), and add possible features to the queue.
- **Built:** the spec, [../\_spec/cellview.md](../_spec/cellview.md) (cellVIEW at `1f0bbd67`, read from its code); this
  evaluation; the proposed items in [../TODO.md](../TODO.md), "Proposed (cellVIEW evaluation)".
- **How:** three readers in parallel: cellVIEW's tree and cuts, cellVIEW's renderer, prism-me today. The claims the spec
  rests on were then checked in the source: the parameters, the GPU packing, the fuzzy test, the hard-cut line, the
  toggle's values, the hidden-type skip, the aperture flags.

## Framing

- **The tree is a cut editor, not a visibility tree.** In cellVIEW the rows edit the selected cut's per-ingredient
  parameters (focus, + / 0 / −, the occluders' keep probability, fuzziness). Showing and hiding are in the ingredient
  panel, one flag per type. prism-me's tree already does both: the eye shows and hides, the scissors add a cut of only
  that part. What cellVIEW has and prism-me lacks is **graded** cuts per part: + / −, the band and fuzziness, the
  aperture.
- **No timings exist for cellVIEW.** Nothing in its code, comments or 218 commits measures a frame. Its default path on
  Metal, Vulkan and GL (`force_simple`) reads the draw count back to the CPU every frame, draws lipids and curves
  without culling, and runs a fixed 300 vertices a batch. The fast design is its D3D11 path: a compute pass per instance
  builds the batches, then tessellation and a geometry shader expand them. Mol\* has numbers: about 0.45 ns a sphere,
  PetWorld's opaque pass at 4.3 ms whole and 20.4 ms zoomed in (44 M spheres) on an RTX at 720p
  (`.v6/plans/gl/screen-space-lod.md`). So "the most performant" cannot be shown from the code: every performance idea
  below is a hypothesis, and its lane measures first.
- **Some ideas touch recorded decisions.** Particles for everything mesoscale, looks as layers (Ludo, 2026-10-18);
  per-entity LOD decided against ([architecture.md](../_spec/architecture.md) §7.2). And anything in `packages/graphics`
  is Alexander's area: a lane off `origin/master`, upstream only when Ludo says so.

## What prism-me has against cellVIEW

| cellVIEW                                                          | prism-me today                                                                                                                                       | Gap                                                                  |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Tree of paths (compartment, surface/interior, group, ingredient)  | The same tree, from the dotted entity names, or by function (`mesoscale/src/model.ts:86-130`); virtual rows, filter, counts, eyes, brushes, scissors | none; prism-me's is ahead (virtual, keyed, eye and color in the row) |
| Parent shows the mean of its leaves, no mixed state               | A parent's eye reads shown if any child is (`explorer/rows.ts:190, 276`)                                                                             | both lack a mixed state                                              |
| Visibility: one flag per type, skipped before the draw            | Hidden = a transparency layer at 1 (`plugin/core/.../particles/layers.ts:117-123`): no rebuild, but the instances probably still pay vertex work     | measure (item c)                                                     |
| Show only this / same group / compartment / partners; highlight   | not built                                                                                                                                            | item d                                                               |
| Cut shapes: plane, sphere, cube, cylinder, cone, capsule          | plane, sphere, cube, cylinder, infinite cone (`core/util/clip.ts:28-35`); no capsule                                                                 | small                                                                |
| Up to 100 cuts, each over every ingredient                        | 16 clip objects a representation, of which 6 can be per part (Mol\*'s clipping-group bits, `layers.ts:46-47`)                                        | the 6                                                                |
| Per (cut, ingredient): + / 0 / −, band, fuzziness, stable hash    | Per (cut, part): in the cut or ignoring it, binary (`clipping.add` `particles`)                                                                      | item b                                                               |
| Hard cut per atom                                                 | `clipPrimitive` (per sphere) and the `pixel` variant; "clip whole" picks proteins or atoms (`stage.clipWhole`)                                       | none                                                                 |
| Aperture cut in screen space (focus, occluders opened)            | not built                                                                                                                                            | item f (research)                                                    |
| Lock: freeze a cut's result, move the cut away                    | not built                                                                                                                                            | not proposed: one more state to explain; ask Ludo if he used it      |
| Ghosts: cut instances as outlines                                 | not built; Mol\* has an outline pass                                                                                                                 | item e                                                               |
| k-means proxy spheres per type, by distance                       | stride decimation, 4 levels, by size on screen (3 px) (`graphics/.../spheres/spheres.ts:199-317`)                                                    | item f (research)                                                    |
| Compute per instance → append batches → one indirect draw         | GPU cell culling (frustum, LOD, Hi-Z) → indirect draws per level and segment, WebGPU (`graphics/src/gl/compute/cell-cull.ts`, `merged-culler.ts`)    | per instance against per cell: measure before                        |
| Deferred shading from ID buffers (instance, atom), one color pass | forward-shaded impostors (lighting in the sphere fragment)                                                                                           | item f (research)                                                    |
| Fibers drawn from control points (spline, twist), no atoms stored | fibers read as ordered point lists (`model/src/formats/particles/mmcif.ts:331-397`); drawn as particles                                              | not measured; later                                                  |
| ID-edge contour, SSAO (third party), shadows                      | outline, multiscale SSAO, soft shadows, fog, illumination (`apps/prism-me/src/look.ts`)                                                              | prism-me ahead                                                       |

## What is worth taking

**For the user, the graded cut is the idea.** A cut that keeps a layer of the membrane on its face (+), cuts a part
further than the others (−), or thins out with distance (fuzziness) is what makes cellVIEW's cutaways read as
illustrations. On WebGPU it is cheap: the test is per instance, a signed distance, a table lookup and a hash. It fits
Mol\*'s instance clip (`clip-instance` in the vertex stage, both backends) or the GPU cull pass. Its table, per (cut,
part), would also lift the 6-part limit, which comes from the group bits.

**The stable per-instance hash is a primitive of its own.** cellVIEW uses `rand(id)` for the fuzzy band and for the
occluders' keep probability. The same hash gives "show 30 % of this part", which thins a crowded compartment without
choosing instances by hand, and stays the same from frame to frame.

**The aperture cut is the signature feature** (Le Muzic et al., the visibility equalizer), and the hardest. On WebGPU it
needs no fragment writes to storage: a compute pass can project each occluder's bounding sphere, read the focus's depth
and the flood-filled distance, and set its flag. It is research: measure the cost of the mask and the jump flood per
frame, and decide what the user sets (the focus, the aperture).

**For speed, measure first.** The ideas, in the order to test them:

1. Hidden instances skipped before the vertex stage. Today a hidden part is a transparency of 1, probably discarded per
   fragment. If a 90 % hidden scene costs about what a visible one does, the cull pass should read a visibility table.
2. Proxy spheres (k-means per target, the radius the cluster's bound) against stride decimation: the same number of
   spheres, a better silhouette far away (inferred). It reopens no decision if it stays per target, as the strides do.
3. Deferred shading from ID buffers: depth and ids in the raster pass, lighting once per pixel. It pays off when
   overdraw is high (crowded scenes); Mol\*'s postprocessing (SSAO, outline) already works from depth. A design talk
   with Alexander, not a lane.
4. Per-instance culling against per-cell: per instance cost more in Mol\*'s measurements
   (`.v6/plans/gl/merged-render-objects.md:79-81`), and occlusion gained at most about 15 % on PetWorld (`:160-171`).
   Not worth a lane without a new measurement.

**Not to take:** the per-frame readbacks and uploads, the cut table rebuilt every frame, the mapping wiped when a cut is
added, the export's own cut test that does not match the screen (prism-me has one cut evaluator, the renderer's: keep it
so), the parameters keyed by index (prism-me keys by node).

## Found on the way

- **A likely bug in prism-me's graphics modes:** `withMode` (`mesoscale/src/operations.ts:895-905`) writes the distance
  presets (`Spheres.LodLevelsPresets[mode]`), while the particle default is pixel LOD at 3 px
  (`graphics/.../particles/representation/target/common.ts:108-113`), which ignores distances (`spheres.ts:98-106`). So
  a mode probably changes the strides only, still at 3 px; the reading of the mode compares against the distance presets
  too (`operations.ts:921-924`). Read, not run: item a, its test fails first.
- **ui.md is stale on the per-part cuts:** it says "up to 8 per particle list"; the code allows 6
  (`MaxParticleCutIndex = 5`, `layers.ts:46-47`). To fix with item b, or alone.
- **Two specs disagree on the clip variant:** Prism's makes it scene-wide
  (`packages/prism/viewer/_spec/clipping.md:43-47`), `stage.clipWhole` writes it per representation
  (`stage-tools/src/operations.ts:381-388`). Not probed.

## The mock (Ludo, 2026-10-28: "everything proposed")

Storybook, prism-me › Explorer › Proposed (cellVIEW), stories in `apps/prism-me/src/_stories/proposed.stories.tsx`, the
controls in `proposed.tsx`. Apart from the decided mocks: a `proposed` switch on the mock panel, scene and menus, off in
every other story, so nothing proposed looks decided.

- **Clips are objects of their own** (Ludo, 2026-10-28, after the first mock): a Clips category after the others holds
  every clip of the scene; no clip row under an object. A clip maps to many objects and parts, each its own way:
  cellVIEW's cut × ingredient table, edited from either side (`clip-book.ts`, one table a story).
  - **A clip** (Clips Category, Graded cut): its shape, then What it cuts, each object or part with keeps a layer, cuts
    it or cuts it wider (a band in Å and fuzziness where it keeps or widens), × to take one off, Cut also to add one; a
    preview of the picked one, a 2D slice of dots drawn by cellVIEW's rule (`isCut`, full strength, its stable hash);
    Ghosts outlines what is removed (items b, e).
  - **An object or part** (Part clips, Object without clips): its Clips section lists the clips on it, each what it does
    to it; New clip makes one that cuts it, Use a clip gives it one of the scene's.
  - **The aperture cut** (item f), a clip of the category too: the parts it opens onto, the opening, the share kept near
    the edge, a preview of the screen.
- **Eyes** (Ludo, 2026-10-28): every row's eye in view, not only on hover, in a column of its own: a row's tools end
  eye, trash, ⋯ (the ⋯ always last), and a row without a trash or a ⋯ keeps their room, so the eye stays in one column
  (measured: eye, trash and ⋯ each at one x down the tree). A parent's eye sets every row under it, all the way down,
  each its own after: hide the model, then show one group alone. A parent's eye is its own state, open or closed, never
  "some shown".
- **Shown in part** (with item b): Look › Shown on a group, a model entity or a target.
- **Show only** (item d): on a part's right-click. **Add aperture**: Add clip… gains it. **Clip menu**: Outline what it
  cuts.

Checked: rendered headless (Playwright on Chrome) in light and dark, wide and narrow, no page error; driven: Cut also
1CRN takes the plane clip's row from 4 to 5 objects, New clip on 1CRN adds Sphere clip 2, Use a clip adds the plane
clip; `typecheck:storybook`, `styles:check`, `tsc`, lint, format, `check:workspace`.

## Size

The spec (about 200 lines), this file, the TODO block; the mock (about 450 lines of stories). No app code.
