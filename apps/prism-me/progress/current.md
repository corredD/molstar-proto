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
  (`me/dynamic-color`, port 1359), step 1 first.
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
