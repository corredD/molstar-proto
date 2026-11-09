# Current

What is in flight, one line a lane, linking to its progress file once written. Only the coordinating session (the main
checkout) edits this file ([../AGENTS.md](../AGENTS.md), How we work). What was built is the dated files beside it; what
is not built is [../TODO.md](../TODO.md).

## In flight

- **MesoViewSpec** (Ludo, 2026-11-06 → ; worktree `~/prism-me-lanes/mesoviewspec`, branch `me/mesoviewspec`, local only,
  [progress](2026-11-08-mesoviewspec.md) on its branch). A declarative format for mesoscale scenes, its IR and runtime,
  Storybook stories, a design doc for David and renderer recommendations for Alex. v0.1-v0.3 built (the semantic camera,
  instances). Ran as one session, not as lanes, until 2026-11-08: the review gate runs now, then streaming as its own
  lane. Review gate run 2026-11-08: 14 must-fix and 23 should-fix confirmed, fixed in four `me/mvs-gate-*` branches
  merged back (progress file, Review). Not pushed: Ludo signs off first.
  - `mesoviewspec-streaming`: done, merged into `me/mesoviewspec` (56335890c): design.md §6.8, manifest, provider,
    planner, budget, levels as a runtime concept; R5 measured (keep resident lists ≤ ~100). Gate: 13 findings, 9 fixed.
  - `mvs-spec-reference`: done, merged into `me/mesoviewspec`: `_spec/README.md` and topic files, reference generated,
    `spec` check (stale tables, headers, links, unregistered issue codes). Gate: 1 must-fix, 8 should-fix fixed.
  - `mvs-prism-design`: done, merged into `me/mesoviewspec` (c49e6a236): `packages/mesoscale/_spec/prism.md`, the app
    lanes 0-8 (~3,500 lines) and the questions for Ludo and David (its §11).
  - `mvs-patch`: done, merged into `me/mesoviewspec`: patches (applyPatch with inverses, diff, S-expression spelling),
    look `id` and `emissive`; story MesoViewSpec › Patches. Gate: 18 confirmed, fixed but `diff` on mass reorders (S5).
  - `mvs-skill-cli`: done, merged into `me/mesoviewspec`: `meso-validate`, `-compile`, `-print`, `-trace`, `-query`;
    `_spec/reference/mesoql-skill.md` generated (10/10 on a blind eval before the review rework). Gate: all must- and
    should-fix fixed.
  - `mvs-builder`: done, merged into `me/mesoviewspec`: a typed builder (branded refs, `q.*` MesoQL helpers, `build()`
    never throws); the five examples rebuilt, unchanged byte for byte. Gate: 19 confirmed, open items in its progress.
  - Ludo, 2026-11-08: the app lanes' base is a PR of `me/mesoviewspec` to `prism-me`; the body drafted, not opened yet.
  - `mvs-entries`: done, merged into `me/mesoviewspec`: seven entries for `@molstar/meso-spec` (format, builder, ir,
    runtime, resolvers, examples, cli), one for `@molstar/meso-molstar`; the folder graph and its layers test.
  - The library side of "usable like Seq\*" is done; the PR of `me/mesoviewspec` awaits Ludo's word on its body.
  - App lanes, stacked on `me/mesoviewspec` (Ludo, 2026-11-08: "just start the work and make it usable"), in the order
    of prism.md §12.2: `checkpoint-owned-cells` (lane 0, Sonnet, Prism's checkpoint port only, for a later cherry-pick
    onto master) and `mvs-open` (lane 2, Opus, dev port 1354) running; then `mvs-tree`, `mvs-drive`, `mvs-views` with
    `mvs-model-edits`, `mvs-agent`, `mvs-streaming-app`.
  - **#60** (GPU culling past 65,535 workgroups) and **#61** (cellPACK fibres as tubes) merged by Ludo 2026-11-08; lanes
    closed, worktrees removed (and `meso-showcase`'s). Master ports kept as local branches only
    (`fix/cull-dispatch-rows` a3d8c396d, `fix/fibers-targeted` bb2dbced6); Ludo: the fixes go to prism-me, not upstream.
  - `lipid-tiles` (`me/lipid-tiles`, port 1353, [brief](2026-11-08-lipid-tiles.md) on its branch): procedural lipid
    membranes on the GPU (Ludo, 2026-11-08: "just do the gpu"), matched-edge triangle tiles, design in
    `~/prism-me-lanes/mesobuild/docs/lipids.md`. WebGL2 shows no membrane in this lane. Round 1 built and gated (26
    commits). Ludo's first try (the cow ×100): patchy, repetitive; fixed (suited tile edge, CHARMM-GUI patch, mesh
    hidden), gate skipped. Mesh Scale to 1000 (Ludo). Second try: uncovered triangles, no LOD, "cellpackgpu is still
    more efficient and looks better". Round 2 in progress (Ludo, 2026-11-08: "both, compared side by side"): close the
    tiles' holes, LOD for both, cellPACKgpu's cutter in WGSL as a second method, the comparison on the cow. Round 2 done
    and gated (93dbe21db; 1 must-fix, 4 should-fix fixed; S3 the library commit to its own lane from master): tiles 100
    % covered (the lost legs cut), LOD 247 → 33 ms whole cow; recommendation tiles default, cutter by command. Round 3
    done and gated (1727ae414: the holes were the round patch's empty corners; region cutter; levels in the Look;
    progress and Cancel; device-limit guard); waits on Ludo's try on 1353 (mesh still drawn: not reproduced). Server on
    1353 stays up for Ludo.
  - `lipid-procedural` (`me/lipid-procedural` from `me/lipid-tiles` at 1727ae414, port 1354,
    [brief](2026-11-08-lipid-procedural.md) on its branch): round 4, started 2026-11-08 (Ludo: "run round 4 when round 3
    is ready"). Procedural, view-dependent membranes (the region cutter as generator, lipids only where ≥ 2 px), far
    look spheres and bump texture both, switchable; the membrane as a particle system. Built and gated at bbe875df3
    (option A: fixed pool, 2 M budget; library culler ~95 lines; 5 must + 6 should fixed, S2/S4 open in TODO; ~1,100
    lines vs ~950). Round 4b (Ludo's teddy notes) built and gated at 1859f56ea: far surfaces per leaflet at the heads,
    coloured by species; cutter cells ~108 Å with own spin/offset (the 154 Å patch repeated); tiles get species rows and
    far surfaces; Clip on a membrane. Open for Ludo: M2 seams at cell borders. Round 4c (smooth switch, colouring as a
    particle list) built and gated at e3ee04308: surface coloured as the switch's spheres show the patch, at their
    tops, dithered in over a px band; a membrane coloured through mesoscale.style/colors/colorLevels. Waits on Ludo's
    try on 1354; open for Ludo: M2 seams, a sphere dither (graphics change). Library commits need their own lane.
    Round 5 started 2026-11-09 (brief 8ad314736): model_vertexcolor ×600 (~1 G lipids) at interactive rate, scale-free
    far texture, colour by zoom object → species → atoms, tiles texture. Built and gated at 3b71b9e84 (×600: wrap 1.4 s, whole
    18 ms, middle 21 ms; close 130–240 ms open, M5, Ludo’s call). Waits on Ludo’s try on 1354.
  - `paint` (`me/paint`, port 1352, [brief](2026-11-08-paint.md) on its branch): Paint v1, approved 2026-11-08 (the
    mesoscale extension, random orientation, no collisions in v1). On hold until the lipids (Ludo, 2026-11-08).

- **Fast particle drag** (Ludo, 2026-11-05, on the workstation: MG lags on a handle's drag, the release blocks): **PR
  #59 merged 2026-11-06** ([progress](2026-11-05-fast-particle-drag.md)). The handle previews by writing the moved
  instances; the merged object and the WebGPU culler write only what moved; a release keeps the unmoved targets (MG ~1.5
  s headless, the thread held ≤24 ms). No review gate run. Open: the whole model's drag (lane 2), the release in a
  browser, graphics commits for upstream (Ludo).

- **Bug fixes from the night review** (Ludo, 2026-11-05): **merged 2026-11-05**, #58 (undo after a portal or EMPIAR
  load; [progress](2026-11-05-scene-sync-undo.md)), #56 (EMPIAR A, B and its fix round;
  [progress](2026-11-04-empiar.md)) and #57 (14 night-review findings; [progress](2026-11-05-night-fixes.md)). Lanes
  closed, worktrees removed; `me/scene-sync-undo` (from master) kept on the fork for upstream. Left in TODO.md: the
  tomogram held twice, a second run's average, the findings not taken (A2, A5, B1, D1-D8, E1-E3), the clip design
  points. Next: Ludo's own review from the workstation.

- **Started 2026-11-04** (Ludo: "start two lanes, fast-slice and empiar"; "start by full resolution, and we will
  optimize after"):
  - `fast-slice`: **PR #55 merged** by Ludo (2026-11-04). A level-0 step on TS_08 273 → 87 ms, pixels identical
    ([progress](2026-11-04-fast-slice.md)). Lane closed; `me/fast-slice` (from master) kept on the fork for upstream.
- **Merged 2026-11-04:** #50 (tree row tooltips), #51 (colors by zoom on at load for cellPACK and PetWorld, edges 0.27 /
  2.2 / 28.8 px, kept over Look colors), #52 (a label on a selection), #53 (the forms follow a drag, one checkpoint per
  gesture; level 0 measured: `createGridImage` 89 %, proposal in TODO), #54 (portal names, the tilt series under its
  tomogram turned, annotations' description, method and GO link). Lanes closed. The level-0 slice speed-up: #55.
- **The small items left by #46-#49** (Ludo, 2026-11-04, interviewed one by one; started 2026-11-04). Claude hit the
  5-hour limit at 09:29 (resets 12:20). Grok took the two that were still open:
  - `label-selection` (port 1348, [brief](2026-11-04-label-selection.md)): **PR #52**, ready. A label on a selection.
    Ludo's answers recorded: follow the pick's granularity; keep both label commands in ⌘K.
  - `tree-tooltips` (port not separate; branch `me/tree-tooltips`): **PR #50**, an entity's description as its tree
    row's tooltip. No progress file of its own (the PR is the record).
  - `live-forms` (port 1350, [brief](2026-11-04-live-forms.md)): **PR #53**, ready. One checkpoint per drag, the forms
    follow it, level 0 measured (a library lane proposed, not started).
  - `portal-polish` (port 1349, [brief](2026-11-04-portal-polish.md)): **PR #54**. Names, the placement switch (default
    beside raw, pending Ludo's comparison), descriptions in the properties. Hover of a ribosome is not the description
    (said, not built). Grok's commits: `1cc10f5da` (overlay follows a moved tomogram; real-stage test), `fa8696ac9`
    (progress). Claude's before that.
- **Merged 2026-11-03:** #48 (live slice sliders: the slice, oblique, contrast and mesh opacity follow a drag, one undo
  step; `2026-11-03-live-slice.md`; open: a full checkpoint per step, the other forms' 150 ms wait), #46 (the Assistant
  starts: one name per tool) and #47 (portal tilt series: index, card, Z slice with each image's tilt angle). Their
  progress files: `2026-11-03-assistant-tools.md`, `2026-11-03-portal-tiltseries.md`. Open from them: label an atom or
  residue by selection (lost with Prism's `add_label`); the tilt series aligned to the tomogram.
- **CryoET portal + volume lighting**: **PR #41 merged** by Ludo (2026-11-03, 416c00f0a), with #37-#40 (merged through
  it) and #42 (closed, in #41). Built: OME-Zarr and GLB readers, the portal index and loader (10003, 10453, 10524,
  10518), lighting `local | volumetric | neural` with clips honored, a volume's Data (Level slider) and Direct volume
  (Lighting, Prism's histogram editor, ×½ / ×2) sections, unbounded intervals as number fields, portal points without a
  decoration at 50 Å. Lanes closed, worktrees removed; library branches `me/ome-zarr`, `me/glb-reader`,
  `me/volume-lighting`, `me/volume-neural` kept on the fork for upstream (Ludo); their briefs in `2026-11-02-<slug>.md`.
  What is left: [../TODO.md](../TODO.md) (Volume lighting, later; CryoET Data Portal, later).

- **Merged 2026-10-31:** #25 (UI scale, Settings › Appearance, − and +) and #26 (dynamic coloring by distance, queued;
  built as #27, colors by zoom). Lanes closed.
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
  - Ludo, 2026-10-31: the start-up improvement is not worth it for now; #32 closed (Ludo), the branch
    `me/startup-budget` kept with the measurement. Asked: did #33 improve performance, does it answer Alexander? #33:
    Ludo, 2026-10-31: keep it on prism-me, marked so it can be isolated into a master lane later (library commits apart,
    listed by SHA in TODO.md's upstream list). Lane resumed on the review's findings (a rendered test, pixel proof, all
    distances, the varying read, who did what).
- **After the 3 lanes** (Ludo, 2026-10-31, from Alexander): "also you generally want to switch marking off or at least
  set ghost edge strength to 1 - otherwise you render everything at least twice... the transparent stuff is not cheap
  either...". Lane `marking-cost` (Ludo, 2026-10-31: go; `me/marking-cost`): PR #33. `ghostEdgeStrength` is already 1,
  and with nothing marked the mask is not drawn, so idle marking is within about 1 ms of marking off. A hover with
  marking off redraws the whole frame and is slower, so the look was not changed. What was built, image unchanged: an
  unmarked sphere leaves the marking mask before the projection, and a sphere the color pass would discard whole leaves
  that pass. CellPack hover at a tenth of the distance, still: WebGPU dpr 1 16.7 → 11.6 ms (an unmarked frame is 11.2),
  WebGL2 dpr 2 213 → 171 (unmarked 168). Clip and ghosts still dominate and were not changed. The skip is a library
  change, an upstream candidate. Waits on Ludo. The server on 1367 is stopped. Review round done (2026-11-01,
  `656b623c1`): the GLSL reads its varyings back, 1e-5 clear of the 0.09 cutoff, `dNoVertexSkip` turns it off; a
  rendered Dawn test (10 cases, each image equal to the unskipped one, each broken skip fails it); bench skip on/off in
  one page: 0 pixels differ on WebGL2 (78 images), WebGPU only within its own frame-to-frame OIT noise. Median of 3:
  CellPack hover 0.1 WebGPU dpr 1 14.8 → 11.9, dpr 2 41.5 → 32.9, WebGL2 dpr 2 237 → 190; PetWorld hover 0.02 dpr 1 78.7
  → 54.3, dpr 2 245 → 157. One regression left open: PetWorld WebGL2 whole view with a transparency, +3 / +8 ms. Library
  commits listed by SHA in TODO.md. Reviewer 1 must-fix (x-ray test drew no x-ray) fixed; skeptic 0 refuted.
  Look-changing options (marking off, dpoit, blended, cheaper ghost) not built: recommendation keep marking on and
  wboit. Waits on Ludo's merge.
- **Upstream #2061 (Alexander, v6 graphics) reviewed and measured** (2026-11-01; not posted; review in
  `~/molstar_pr_review/PR2061-review.md`). Review: 1 must-fix (WebGL1 Gaussian volume lit by group ids), 4 should-fix
  (clip class under a non-uniform clip transform, raster chunk rows overlap, raster kernel cache leak, per-vertex
  colours vs `lodLevels`); David's review covers none of them but the headers. Against prism-me: #2061 replaces #28's
  two-phase core; #28's clusters, Morton order, edge cap and motion props to rebuild on its API; #29/#30/#31 kept; #33
  complementary (its WGSL reads `vMarker`/`vTransparency`, renamed in #2061). Zoom bench (M1 Pro, Chrome 156, dpr 1,
  CellPack HIV still, 1 / 0.1 / 0.02, ms): WebGPU classic master 4.8 / 47.5 / 47.9, classic+#2061 4.3 / 35.1 / 19.9,
  prism-me 9.9 / 13.6 / 15.9, prism-me before #28 8.9 / 83.0 / 70.5; WebGL2 59.9 / 54.9 (classic), 42.2 / 24.2 (+#2061),
  prism-me 83.5 / 46.6 at 0.1 / 0.02. The sphere raster never runs on the M1 (no `atomic-vec2u-min-max`); #2061's gain
  here is its per-instance culling, not two-phase. Classic culls in 200 Å cells too, yet beat prism-me before #28 by
  25–35 ms (cause unverified). Open: prism-me's WebGL2 zoomed in (no GPU path) and its whole view (2x classic). Scripts
  and runs: session scratchpad `zoomcmp/` (not in the repo).
- **Review posted on upstream #2061** (Ludo, 2026-11-01: "post it"):
  https://github.com/molstar/molstar/pull/2061#pullrequestreview-5730198026 at 7427374b7, 3 must-fix, 3 should-fix
  (inline), nits and the raster numbers with the eligibility question in the body. Waiting on Alexander's answer.
- **Master merged** (#36, Ludo, 2026-11-02; with #33, #34, #35). Lanes closed and their worktrees removed: merge-master,
  no-raster-auto, webgpu-zoom-regression, marking-cost, plus the scratch worktrees pr2061, master-base,
  startup-budget-master, marking-merge-check. Kept: `publish` (publish-web.sh), `chimerax-commands` and
  `particle-bounds` (branches from master, not in prism-me, not upstreamed). Proposed, not started: the WebGPU turning
  cost close up (CellPack 12.9 → 21.6 ms at 0.1). Upstream candidates on Ludo's word: #35's occlusion edge clamp; WebGL
  images ignoring a clipping layer (`image.vert`). Parked: volume lighting
  ([../plans/2026-11-02-volume-lighting.md](../plans/2026-11-02-volume-lighting.md)).
- **Upstream #2061 merged** (Alexander, 2026-11-02 00:37 UTC, merge c1b8ecb82; giagitom approved). Before merging he
  pushed one fix commit per finding: 1e91e2a62 (WebGL1 Gaussian volume), 885192691 (clip spectral norm), 123f2935e
  (raster rows), 5182289b0 (raster releases items), 879496397 (colours/sizes vs LOD order), bf755a4ce (two-phase after a
  jump), bde10162c (pre-integration table), 58de77e82 (changelog); the #1962 line now says it often doesn't apply with
  default SSAO. Also new: d65fc4bfd, GPU culling on by default from 100,000 spheres where the device has the raster. On
  the eligibility question he answered "@corredD will look into this": it is ours (ties in with hidden-cost step 2). Not
  decided: when to merge master (with #2061) into prism-me, and the #28 rebuild that comes with it.
- **#2061's sphere raster measured** (Ludo's workstation, Quadro RTX 8000, 2026-11-01; the M1 Pro has no
  `atomic-vec2u-min-max`, Apple 9 GPUs only): Alexander's bench, merged GPU-culled particles, zoomed 2.5–3.6× faster
  (PetWorld 9.61 → 2.68 ms at 0.03, MG_1184 6.69 → 2.73), whole view no gain, rotating whole slightly slower. Not used
  by the classic Mesoscale Explorer. For prism-me: `isSphereRasterEligible` (`sphere-raster-pass.ts:35`) refuses a whole
  object with a transparency layer, x-ray, wiggle/tumble, an LOD fade or a clipping layer it can't apply, so
  hiding/ghosting one particle or a graded cut would send the merged model back to impostors; ties in with hidden-cost
  step 2. A test merge of 7427374b7 into prism-me: ~85 conflict regions in 25 files (merged-culler 21).
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
