# Current

What is in flight, one line a lane, linking to its progress file once written. Only the coordinating session (the main
checkout) edits this file ([../AGENTS.md](../AGENTS.md), How we work). What was built is the dated files beside it; what
is not built is [../TODO.md](../TODO.md).

## In flight

- **UI scale** (`me/ui-scale`, `~/prism-me-lanes/ui-scale`, port 1344, [brief](2026-10-30-ui-scale.md)): Ludo,
  2026-10-30, "really important": Settings › Appearance › UI scale, − and +, the UI larger and the 3D untouched; Prism's
  size tokens scaled by one variable, its commits upstreamable. PR #25, reviewed (no must-fix stood; 7 findings fixed or
  to TODO; the drift test found a virtual-list bug, fixed); not yet seen in a browser; served on 1344; waits on Ludo.
- **8. Dynamic coloring by distance** (cellVIEW's Chameleon; Ludo, 2026-10-30, "add to the queue"; brief in TODO.md
  `Next` and cellview.md §7, PR #26, docs only, waits on Ludo). Levels like the LOD (far: compartment or entity; closer:
  chain; closest: residue or atom), blended so a zoom never pops. Step 1 a measurement: re-running `particle-hierarchy`
  over CellPack MG on WebGPU and WebGL2, which chooses (a) a theme's current level moved on camera change (David's) or
  (b) a shader blend by view depth (cellVIEW's, library, with Alexander). Open for Ludo: edges in screen pixels or in Å
  (the lane builds pixels by default, the unit in one place). Started 2026-10-30 (Ludo: "go"): lane `dynamic-color`
  (`me/dynamic-color`, port 1359), step 1 first. Step 1 measured: recoloring CellPack MG (2.1 M) costs ~1 s (WebGPU) to
  ~1.8 s (WebGL2) a step, 20+ frames at best, so a theme moved on zoom cannot be smooth: way (b), the shader blend by
  view depth. Stopped at the size check: (b) is ~360 graphics lines against ~250. Waits on Ludo: full (b), three levels
  (~290) or WebGPU first (~280); atom or residue as the nearest level; edges in pixels or Å. Ludo, 2026-10-30: full (b),
  four levels, atom nearest, edges in pixels on screen; the limit lifted to ~420. PR #27, reviewed (2 must-fix, 7
  should-fix fixed or stated; skeptic confirmed all), real GL on both backends, 0 frames at rest. Waits on Ludo: the
  blend per atom (vertex stage), not per pixel, changed by the lane without asking (per pixel costs two varyings, both
  backends near their limit); graphics +449 against ~420 (the TS rule not counted in the estimate). Served on 1344.
  Ludo's test, 2026-10-30: Firefox (WebGL) does not work; Safari draws only the outline and flickers; Chrome draws
  normally only once By zoom is on (the levels-off path likely broken too), the coloring then "works great"; zoomed in
  on spacefill the frame rate drops a lot. Ludo: fix 1 in the lane, a plan for 2 (measured, not built). Done on #27: 1
  was a WebGPU draw-list bug already in prism-me (and master: a recording replayed a released quad index buffer;
  PetWorld HIV blank on WebGPU), fixed with tests, to go upstream from master as its own lane; By zoom on a model
  without compartments colors by entity. Open, on prism-me too: WebKit draws only CellPack HIV's RNA; Safari's flicker
  not reproduced headless. 2 measured: levels off cost what prism-me costs, on up to +14 %; zoomed in is 1.5-4× the
  whole view on prism-me already. Plan, not built: skip the blend where a level is whole (~10 lines), then Oklab stored
  (~25). Waits on Ludo: retest on 1344, merge #27, go for the plan.
- **Colors by zoom** (PR #27, with the WebGPU draw-list fix): merged by Ludo, 2026-10-31. #28 has prism-me merged in.
- **Smooth when zoomed in**: PR #28 merged by Ludo, 2026-10-31; worktree removed. What is left is below.
- **Smooth when zoomed in** (lane `instance-cull`, `me/instance-cull` from #27's branch, port 1362; brief
  [2026-10-31-instance-cull.md](2026-10-31-instance-cull.md)): Ludo, 2026-10-31: zooming in on any cellPACK or PetWorld
  model drops the frame rate, by zoom or not; not in cellVIEW. Measured (`scripts/zoom-test.js`): the cost is the
  spheres drawn, not the fragments (pixels change nothing, the LOD halves it). cellVIEW culls per protein and uses
  k-means proxy levels; Mol* culls per 200 Å cell and uses strides. Ludo: "dont stop until performance is smooth" (≤16.7
  ms WebGPU, ≤33 ms WebGL2 zoomed, on the M1) and "if in doubt or need answer, use state of the art decision": per
  particle frustum culling first, then what the numbers show (moving quality, proxy levels). Merge #27 first.
  - Round 1: **PR #28** (merge #27 first). Per-particle frustum, LOD-range and Hi-Z tests on the GPU; PetWorld moved to
    GPU culling (`gpuCulling: 'auto'` from 10 M indices and ≥30 instances); a stale-occlusion bug fixed (a still camera
    tested occlusion once against a pyramid with holes: the main win); LODs 4x coarser while moving, full detail 250 ms
    after it stops. WebGPU at 0.1, dpr 1, still/turning: CellPack 83 → 12/20 ms, PetWorld 119 → 22/31 ms. Not yet met:
    dpr 2 (CellPack 36/59, PetWorld 67/94), WebGL2 (CellPack 88/37, PetWorld dpr 2 342/251), Firefox not measured.
    Settled images identical; while turning, up to ~1.4k pixels late a frame at 0.02 (one-phase occlusion).
  - Round 2 (on PR #28): lower resolution while moving (`motion.pixelScale`, prism-me 0.5, on dpr 2 0.35 and 6x levels;
    the trackball compensates), level 0 of large members drawn per cluster of 256 spheres in space order, culled per
    instance on the GPU; no occlusion while moving or in the resting frame, then occlusion against its own view (exact,
    no popping with `motion`); WebGL2 culls each instance of a cut cell on the CPU; culled spheres grow by
    wiggle/tumble. Turning now ≤16.7 ms on WebGPU everywhere but PetWorld 0.02 dpr 2 (19.7), ≤33 ms on WebGL2
    everywhere. Still frames over budget: PetWorld close up (WebGPU dpr 1 21-41, dpr 2 63-127), CellPack dpr 2 (28-34),
    WebGL2 (40-192). Look at rest unchanged. Open for Ludo: k-means proxy levels instead of every n-th atom (images in
    `2026-10-31-instance-cull/`: 15 % / 23 % pixels differ, a bit more compact, streaks on PetWorld's membrane).
  - Ludo, 2026-10-31, on round 2: "doesnt look good, we dont need the kmeans proxy, and we dont want lower res when
    turning and zooming". Then, asked: the problem is the coarser detail while moving; "you can keep the resolution
    trick". Decided: no k-means proxies; no coarser levels while moving (prism-me's motion LOD scale 1); lower
    resolution while moving stays. Lane resumed for round 3 within these.
  - Round 3 (on PR #28): full detail while moving; two-phase occlusion (exact, no popping). Full detail, still / turning
    ms: WebGPU dpr 1 CellPack 0.1 11/12.5, PetWorld 0.02 45/17.6; dpr 2 CellPack 0.1 30/18, PetWorld 0.02 136/25; WebGL2
    dpr 2 close up 97-196 / 36-66. Turning met on WebGPU dpr 1 (but PetWorld 0.02), not at dpr 2 nor on WebGL2.
  - Round 4 (stopped, context full; continue in a fresh lane session from the brief's "Round 4 (in progress)"): round
    3's gate closed (skeptic: stereo was not gated, now fixed; S1 caps a frame late, S3-S5, N4 open). Measured on
    PetWorld still: the cost is the shading of every overlapping fragment (a shader depth write disables early depth
    tests), not the write: shading reduced 22/43 → 13/27 ms (dpr 1, 0.1/0.02). Next, designed: a depth pre-pass, then
    shading only the fragment equal to it (about 40 % off still frames); then per-sphere occlusion, WebGL2 close up.
    Goal not met. Ludo, 2026-10-31: no depth pre-pass.
- **Decorating particles fails** (Ludo, 2026-10-31): "Target does not apply to CryoET Data Portal particles" after the
  list's Scale was changed. Cause, reproduced headless: `stage.scale` adds `ParticleListTransform` (a decorator) on the
  list; decorating then inserts `ParticleListWithTargets` under it, and `ParticleListTransform.update`
  (`plugin/core/src/state/transforms/particles/ops.ts:465`) returns Unchanged when its params and `sourceData` are the
  same, so its output keeps the list without targets. Workaround: decorate first, then scale. Fix proposed: update
  whenever its input list changed (a failing test first); likely an upstream fix too.
- **Scaled and decorated, zooming in clips everything** (Ludo, 2026-10-31, after decorating then scaling to 10):
  reproduced headless (CryoET ribosomes decorated with 2PLV, `stage.scale` 10). The camera's bounds are the scaled
  list's (radius 6,124 Å), but the decorations are drawn wrong: on WebGPU they do not show at all (only the 2PLV
  structure in a corner), on WebGL2 they show scaled and vanish as soon as the camera moves in (0.3 of the distance).
  Likely the decorations' render objects keep bounds from before the scale (one at center 161,179,190, radius 309). Not
  yet known if #28 made it worse. Proposed with the decorate fix: one lane, decorations under a list transform.
- **Lane `decorate-transform`**: **PR #29** merged by Ludo (2026-10-31), both bugs fixed, gate and review passed.
  Causes: `ParticleListTransform`/`ParticleListOffsets` short-cut on `sourceData`; stage-tools' `decoratorUnder` looked
  only under the list (a second scale gave 10 → 100); the target visual's update kept its old bounding sphere (a "too
  slow" TODO, upstream and 5.x too); a merged render object kept its first values on WebGPU (upstream v6);
  `applyTransform` set merged objects' transform (radius 0 in a handle preview). Ludo's steps headless, both backends,
  both orders: nothing disappears. Open: a list's drag preview does not redraw headless (Ludo to check in the app);
  `scaleByRadius` targets' bounds; upstreaming the two graphics fixes waits for Ludo.

- **Lane `mesh-measure`**: **PR #31**, gate and review passed. OBJ/PLY/VTP picked by triangle (the GPU's group narrowed
  on the CPU by the pointer's ray; a counting-sort grid, 6 B a triangle, 26 ms to build at 1 M, a pick 29 µs); marks
  drawn as copies of the triangles (colors and segment looks unchanged). The point measured: the picked surface point
  (barycentric, follows moves and scales, saved). Distance/angle/dihedral between triangles, atoms, particles, voxels
  via stage-tools (`stage.angle`, `stage.dihedral` new). For Ludo: an angle or dihedral from clicks keeps the clicks'
  distances (default). Open: follows a move on release only; selected triangles not in the Selection tab nor sessions;
  overpaint/transparency per triangle; marks' z-fighting unchecked on GPU.

- **Lane `ghost-cull`** (Ludo, 2026-10-31): "the ghost on cellpack rendering, disappears at some distance and on the
  side of the screen." Suspected: #28's culling (occlusion, LOD range, edges) applied to #24's ghost pass.
  `me/ghost-cull`, port 1365; brief [2026-10-31-ghost-cull.md](2026-10-31-ghost-cull.md) on its branch. The cause is
  transparent-outline depth in 8 bits, older than #28. **PR #30**, not merged. The in-front test and outline fog are
  fixed. Occlusion of the ghost pass is unchanged on purpose. Alexander's marking note stays the next item.
- **Grok took over `mesh-measure` and `ghost-cull`** (Ludo, 2026-10-31) while the lanes were stopped on the spend limit
  (about 11:15 to 13:40): mesh 12:34-13:19, ghost 12:50-13:42, and it opened #30 and #31 at 13:27. Its commits carry
  Ludo's name and the Claude trailer, so the history does not show it. Independent reviews:
  - #31 (mesh): good, careful work; 5 should-fix, all fixed by the lane (wide triangles in size grades, no 64 limit; the
    dead fallback dropped; tests failing first; ui.md §7), then a fourth review (1 must-fix: a vertex at 1e20 hung the
    build, fixed). Gate, heavy scaling and the browser recheck pass. **Merged** by Ludo (2026-10-31). Build now 44 ms at
    1 M triangles (was 26), a pick 30 µs. The PR body says which commits were Grok's.
  - #30 (ghost): Grok's 2 must-fix are fixed and its grep tests replaced by rendered tests (GL and Dawn) that fail
    without each fix. Cause, older than #28: a transparent edge's depth in 8 bits, 0 beyond about 500 Å at the 1 Å near
    plane, so far ghosts and the farther sides vanished; not culling (0 pixels lost on every culling path). Also fixed:
    a band of ghost color over a nearer particle (#24). Screen edges at 0.3: 0-6,920 → 22-32k ghost pixels. Frame times
    unchanged. **Merged** by Ludo (2026-10-31). Open: ghosts black with illumination on (#24); the graphics commits as
    an upstream lane (Ludo decides). `typecheck:storybook` fails on prism-me itself (`src/api/styles.ts`,
    `transparentColor` from #24): a separate fix.
  - Both sent back to their lanes to fix, re-gate and re-review; PR bodies to say which commits were Grok's. Do not
    merge until then.
- **Publish to the lab website** (Ludo, 2026-10-31): on his word, `~/prism-me-lanes/publish-web.sh` builds
  `origin/prism-me`, mirrors it into `labwebsite/web/public/playground/molstar-dev/mesoscale-explorer` (replace) and
  asks the herdr `web` session to commit and push. The production build is over prism-me's budget (5.93 MB > 3.40 MB):
  the budget is stale (set 2026-10-18 from the viewer's 3.2 MB; upstream #2026 raised the viewer's to 5.5-5.6 MB); the
  stock viewer is 5.69 MB > 5.6 on this branch. Lane `startup-budget` (Ludo, 2026-10-31: go; `me/startup-budget`): PR
  #32. The properties load as their own chunk; the start bundle is 45 kB smaller (5.93 → 5.88 MB). The budget is not
  set. Proposed 5.90 MB (5.60 stock + 0.102 library + 0.198 prism-me, rounded down; 5.80 would fail by the library).
  Every commit on that branch is Claude's; Grok opened the PR. Waits on Ludo. The server on 1366 is stopped.
- **Grok finished `startup-budget` (#32) and `marking-cost` (#33)** while the lanes were stopped on the spend limit
  (2026-10-31, about 16:00-19:04); its commits again carry the Claude trailer. Independent reviews:
  - #32: figures reproduced exactly (viewer master 5.58 MB, branch 5.69; prism-me 5.93 → 5.88); the explorer's
    properties lazy-loaded (-45 kB at start, deferred not saved, about +55 ms over HTTP/1.0); budget proposed 5.90 MB,
    not set. 1 must-fix (who wrote it, unverifiable review record), 3 should-fix (the real Retry reset untested; ui.md
    §4 states; Storybook check), 5 nits.
  - #33: the sphere-shader skip (unmarked spheres leave the marking mask; fully transparent ones the color pass) traced
    correct on both backends. 2 must-fix (a library change on a prism-me lane, against AGENTS.md; a test that greps the
    shader and stays green with the skip deleted), 4 should-fix (no before/after pixel proof; one fraction of three
    measured; a wrong comment and a cheaper varying read; two causes in one commit), 3 nits.
  - Ludo, 2026-10-31: the start-up improvement is not worth it for now (#32 parked). Asked: did #33 improve performance,
    does it answer Alexander? Still waits on Ludo: where #33's shader change goes (prism-me or a master lane).
- **After the 3 lanes** (Ludo, 2026-10-31, from Alexander): "also you generally want to switch marking off or at least
  set ghost edge strength to 1 - otherwise you render everything at least twice... the transparent stuff is not cheap
  either...". Lane `marking-cost` (Ludo, 2026-10-31: go; `me/marking-cost`): PR #33. `ghostEdgeStrength` is already 1,
  and with nothing marked the mask is not drawn, so idle marking is within about 1 ms of marking off. A hover with
  marking off redraws the whole frame and is slower, so the look was not changed. What was built, image unchanged: an
  unmarked sphere leaves the marking mask before the projection, and a sphere the color pass would discard whole leaves
  that pass. CellPack hover at a tenth of the distance, still: WebGPU dpr 1 16.7 → 11.6 ms (an unmarked frame is 11.2),
  WebGL2 dpr 2 213 → 171 (unmarked 168). Clip and ghosts still dominate and were not changed. The skip is a library
  change, an upstream candidate. Waits on Ludo. The server on 1367 is stopped.
- **Exosome example** (Ludo, 2026-10-31: does not load on Chrome): its file is on `mesoscope.scripps.edu`, which refuses
  connections (curl: connection refused on 443). Not prism-me.

- **From the cellVIEW evaluation** (Ludo, 2026-10-28: all of it, testable by 2026-10-29; briefs in
  [../TODO.md](../TODO.md) `Next`; PR #15 merged with the spec, the evaluation and the mock). Started 2026-10-29, in
  parallel; merged in this order (each merges `origin/prism-me` before its PR):
  - 1. Graphics modes change the LOD: merged (PR #16).
  - **6. Do hidden particles cost a frame?** (`me/hidden-cost`, a measurement): PR #17. Yes: CellPack MG 89 % hidden is
    slower than none hidden, 8-13× the same removed (a hidden instance is transparency 1, still drawn and blended). Two
    steps proposed: hidden left out of the transparency averages, then a hidden bit in the GPU cull. Ludo, 2026-10-29:
    step 1 and the bench helper on the same PR, step 2 later. Step 1 built and reviewed (all-hidden objects drawn by no
    pass; hidden counted only for per-instance layers at strength 1), `scripts/hidden-cost-bench.mjs` added, ready to
    merge. 90 % hidden now: WebGPU whole 26 ms (was 58), close 46 (107); WebGL2 whole 42 (76), close 65 (132); pixels
    identical. What is left (WebGPU whole, 1.2× none hidden) is the vertex stage, step 2's job. `layers.test.ts` "paints
    and fades..." fails on prism-me too, not from this lane.
  - **4. Graded cuts, the library half** (`me/graded-cuts`): PR #20, reviewed (2 must-fix, 2 should-fix fixed), checked
    with real GL on WebGPU and WebGL2 through the API; a clipping table per part (16 clip objects), keep / cut / wider
    with band and fuzziness, Shown; a shared-empty-array bug fixed on the way; graded ways need the instance clip (Ludo,
    2026-10-29: the app switches a cut to instance when a part gets a graded way); waits on Ludo. The app half after 3.
  - 2 + 5. The tree's eye and ⋯, and Show only: merged (PR #19). The fork's older `me/tree-eyes` (2026-10-27): to delete
    (Ludo); he runs the push.
  - **3. Clips in a category of their own** (`me/clips-category`): PR #18, reviewed, checked with real GL on WebGPU and
    WebGL2; over its size stop (~+780 against ~700, review fixes; the coordinator let it open); a Prism commit
    (`clipping.release` takes a target); merges after 2 + 5; waits on Ludo.
  - #18, #20, #17, then #21-#24 merged (Ludo, 2026-10-29/30): the #18/#20 records fix, Clip whole in a clip's section,
    graded cuts and Shown % in the app, ghosts. Every cellVIEW brief by tomorrow is built; the app live on 1343. Open
    for Ludo: a graded way switches the whole scene to instance (per cut needs a library change); ghosts' limits
    (Prism's clipping.md §6). Next: Ludo's full review of the app, on his workstation (2026-10-30).
- **Library fix: a whole particle list's bounding sphere** (`me/particle-bounds` off `origin/master`, pushed, no PR):
  built (`0927c892b`), merged with PR #5; waits on Ludovic for upstream.
- **Not prism-me: ChimeraX commands** (`chimerax-commands` off `origin/master`, `~/prism-me-lanes/chimerax-commands`,
  run by another session): built, reviewed, pushed, no PR; waits on Ludo (he opens the PR, perhaps upstream). The volume
  commands are the next lane.

## Waiting on Ludo

- The library fixes ready for upstream ([../TODO.md](../TODO.md)): which go, and when (he asks the maintainer).
- A distance following its objects' moves: a Mol\* core change (`state.ts`, a dependency sees the decorators under its
  object), to talk over with the maintainer; then it follows live during a drag (Ludovic, 2026-10-25).
- Hover highlight not drawn on merged render objects (a cellPACK model's targets): a Mol\* v6 graphics bug (Alexander's
  `3039ea342`, on master; the draw table does not watch a merged object's members), not ours. Ludo tells Alexander
  (write-up in `~/prism-me-drafts/alexander-merged-highlight.md`); no lane until then.
