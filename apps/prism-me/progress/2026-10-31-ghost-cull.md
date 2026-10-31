# Ghosts disappear on cellPACK (lane `ghost-cull`)

Branch `me/ghost-cull` from `origin/prism-me` (after #28). Worktree `~/prism-me-lanes/ghost-cull`. Dev port 1365.

## Why (Ludo, 2026-10-31)

"the ghost on cellpack rendering, disappears at some distance and on the side of the screen."

## What is known (not yet reproduced; check it)

- Ghosts are #24 (lane `ghosts`): a clip's Ghosts draws what the clip cuts as a depth-only draw that the outline pass
  outlines.
  - `DrawFact.Ghost` and `checkGhost` are in `packages/graphics/src/gl/draw-table.ts`; the ghost pass is in
    `packages/graphics/src/gl/renderer.ts` (around line 115).
  - Specs: `apps/prism-me/_spec/features.md` (Ghosts row) and `_spec/cellview.md` §4.3.
- #28 (lane `instance-cull`, merged after #24) added GPU culling per instance and per cluster of 256 spheres on WebGPU:
  - frustum, level-of-detail range and Hi-Z occlusion;
  - two-phase occlusion;
  - per-instance CPU culling of cut cells on WebGL2;
  - the motion level-of-detail scale;
  - instance spheres that grow by wiggle and tumble.

  Its progress file is `apps/prism-me/progress/2026-10-31-instance-cull.md`.

- Hypotheses, to test, not to trust:
  1. The ghost pass draws with the culled draw lists (or the CPU cull) of the main pass. What occlusion keeps is what
     the _visible_ depth does not hide, but ghosts are by nature behind or inside what is drawn, so occlusion removes
     them. Instances outside a level's range, or near the screen edge, may also be dropped.
  2. The ghost pass gets its own level of detail or culling with the wrong camera, viewport or pyramid (for example the
     motion resolution, or the pyramid of the previous frame).
  3. Clip whole (instance level) skips instances that the ghost should still draw.
  4. It is older than #28: check on `4040b4baf` (#27 merged, before #28) to know.

## Do

1. Reproduce headless on WebGPU and WebGL2:
   - CellPack HIV (`?example=cellpack-hiv1`), plus one PetWorld;
   - a clip with Ghosts on (`clipping.update` with `ghost`, as #24's tests do);
   - views from far to close (1, 0.3, 0.1, 0.03 of the distance);
   - the camera turned so ghosts sit at the screen edges.

   Screenshots. Find which ghost instances are missing and why.

2. A test that fails first, then the fix. The state-of-the-art rule:
   - the ghost pass culls by the frustum and level of detail only, with its own visibility, never by occlusion against
     the visible depth;
   - unless the ghost has its own depth pyramid and the numbers show it is needed.

   Keep #28's frame times. Measure with `apps/prism-me/scripts/zoom-bench.mjs` before and after, with ghosts on and off.

3. Check every path:
   - WebGPU two-phase;
   - one-phase fallback;
   - clusters;
   - WebGL2 CPU culling;
   - motion frames;
   - Clip whole;
   - graded ways.

## Rules

- Never rebase; merge. Never push to upstream molstar/molstar.
- Commit messages say "Ludo" and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push after each
  commit.
- Tests with `--maxWorkers=2`, no parallel suites. Stop your dev server when done.
- Other lanes run at the same time:
  - `decorate-transform` on 1363;
  - `mesh-measure` on 1364.

  Do not use their ports or worktrees. Ludo's live server is 1343: do not use it.

- Do not touch `current.md`.
- The gate before the PR:
  - `npx tsc -b`;
  - `npx tsc --noEmit -p apps/prism-me`;
  - lint and format:check;
  - `node scripts/workspace/assets.mjs`, then check:workspace;
  - the unit tests of the packages touched;
  - the headless WebGPU suite;
  - test:scaling;
  - styles:check and typecheck:storybook.

  Then the lane-reviewer, then the lane-skeptic.

- Then `gh pr create -R corredD/molstar-proto --base prism-me`. The PR body ends with
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Do not merge.

## Reproduced (2026-10-31, headless Chrome on the M1, `scripts/ghost-check.mjs`)

A plane through the model's center facing the camera (`clipping.add` everything), its Ghosts on; per fraction of the
camera's distance and turn about the target (0°, 30°, 60°: the cut half toward the screen's side), the settled canvas
against the same view without the GPU's occlusion test, and against GPU culling off (the CPU's); the ghosts' own pixels
are the image with Ghosts against without. Before the fix, ghost pixels (of 716,800), WebGPU / WebGL2:

| CellPack HIV | 0°              | 30°             | 60°             |
| ------------ | --------------- | --------------- | --------------- |
| 1            | 43,467 / 43,434 | 42,218 / 42,222 | 34,577 / 34,579 |
| 0.3          | 6,702 / 6,704   | 32,207 / 32,180 | 0 / 0           |
| 0.1          | 23,153 / 23,151 | 44,624 / 44,601 | 49,381 / 49,410 |
| 0.03         | 24,935 / 24,955 | 27,656 / 27,644 | 25,504 / 25,512 |

- At 60°, ghosts showed at 0.39 of the distance (100k pixels) and none from 0.38 to 0.30, then came back from 0.29 (8k,
  18k, then 118k at 0.2): the drop is where the near plane falls to its 1 Å minimum (83 Å at 0.40, 35 at 0.39, 1 from
  0.38: the camera inside the scene's sphere).
- Not culling: without occlusion 0 pixels differ everywhere; GPU culling against the CPU's 0 to 3 pixels; Hi-Z's CPU
  test is off in the app; draw lists off change nothing. With CPU culling the ghost pass still drew 215k instances at
  0.35 (read back from its lists), and the ghost depth target held 590k texels at the ghost alpha.
- PetWorld HIV, both backends: the same counts before and after (its ghosts stay within the range below).

## Cause (older than #28)

The outline pass writes a transparent edge's depth into the 8-bit alpha of its target (`bestTransparentDepth`), and the
compose passes (`getOutline`, WGSL and GLSL, postprocessing and illumination) take a transparent edge only where that
depth is above 0. Depth is reversed (about near / z): with the near plane at 1 Å, every edge beyond about 500 Å rounds
to 0 and is dropped. Read back at 0.35 / 60°: 87,112 transparent-only and 14,046 "both" edge texels, all with alpha 0
(none at 0.40). So the ghosts vanish at some distance (what lies beyond 500 × near), and toward the screen's sides (the
cut half turned away lies farther). The 8-bit encoding came with v6's graphics layer (#1967), the 1 Å near plane with
prism-me's look on 2026-10-18 (`fbcac8a15`): both before #24 and #28. Every transparent outline had it, not only ghosts.

Hypotheses of the brief: (1) occlusion against the visible depth: refuted, and exact by construction (below); (2) the
ghost pass with its own wrong camera or pyramid: no (one view, the frame's lists); (3) Clip whole: no (below); (4) older
than #28: yes.

## Fix

- A transparent edge alone reads its depth from the 16 bits it already wrote (gb); beside an opaque edge ("both"), the
  8-bit alpha holds the square root of the depth (0 only beyond some 260,000 × near; decoded by squaring); an edge
  counts by its flag, whatever its depth (opaque too). The in-front test compares the 16-bit depths, both rounded to the
  square root only where the transparent one came from a "both" texel (`transparentBoth`, `outlineOpaqueInFront`); the
  outline fog takes a depth packed to 0 at the 16-bit floor (`outlineFog`), and none with fog off. A transparent edge
  behind the opaque surface at its own texel is no edge (the hole a nearer opaque surface leaves in a ghost's depth).
  The writers `outlines.wgsl.ts`, `outlines.frag.ts`; the readers one chunk each (`outline_read_wgsl`,
  `outline_read_glsl`). Spec: `.v6/plans/gl/depth-conventions.md` (the outline target).
- Decided (state of the art over a wider target): the outline target stays RGBA8 (a float target doubles its bandwidth
  for every outline, and 16 bits already hold the common case); the flag, not the depth, says an edge is there.
- Tests, rendered, each failing with its fix reverted (native GL `graphics/canvas3d/_test/clip-ghosts-draw.test.ts`,
  Dawn `plugin/headless/_test/webgpu-clip-ghosts.test.ts`): the far ghost (near 1 Å, the cut sphere over 1000 Å away; 0
  ghost pixels before); the band over an opaque sphere in front of a far ghost (48 / 40 pixels before); the fogged
  outline at the far plane (108 / 167 before); GL also the kept sphere's opaque outline painted by the ghost (244
  before).
- Not shown by a render: the exact 16-bit in-front test alone (reverting it to always rounding fails no test once the
  hidden-edge rule is in; three tries at a ghost silhouette one pixel outside a nearer opaque one did not tie). Kept on
  the reviewer's and skeptic's models of the outline and compose passes (`halo.mjs`, `sim.mjs`): rounding a 16-bit depth
  ties within hundreds of Å at near 1 Å.

## The ghost pass and culling (the brief's rule, decided)

The brief's rule (the ghost pass culled by frustum and levels only, never by occlusion against the visible depth) is not
built: the ghost pass's depth draw discards every fragment behind the opaque depth (`tDepth`), the same depth the
pyramid is built from, and a conservative Hi-Z test removes only what lies wholly behind it. So occlusion culls no
visible ghost at rest, and in two phases the ghost pass draws the frame's lists of both phases (`getLists`, all
instances drawn). Measured, no pixel lost (ghost-check, CellPack HIV, after the fix; headless Chrome on the M1,
2026-10-31). Ghost pixels of 716,800, WebGPU / WebGL2, and pixels lost to occlusion (0 everywhere, both backends):

| CellPack HIV | 0°                | 60°               |
| ------------ | ----------------- | ----------------- |
| 1            | 43,426 / 43,393   | 34,586 / 34,588   |
| 0.35         | 166,441 / 166,309 | 126,554 / 126,535 |
| 0.3          | 158,800 / 158,724 | 145,957 / 145,923 |

Before the fix, 60° had no ghosts from 0.38 to 0.30 of the distance (the near plane at 1 Å). After it, 0.35 / 60° has
about 126,500 ghost pixels on both backends. Turning 2° a frame, four frames, at 1, 0.35 and 0.3: each frame against the
same camera with occlusion off differed by 0 pixels (WebGPU and WebGL2). PetWorld's ghosts were inside the 16-bit range
before the fix (the same counts with it and without).

The other paths (ghost-check, CellPack HIV, 0.3 and 0.1 of the distance, 0° and 60°, after the fix):

- Two phases (the app's), WebGPU, and WebGL2's CPU culling: 0 pixels lost settled; turning 2° a frame for 15 frames,
  each frame against the same camera with occlusion off: 0 pixels.
- One phase (`transparency: 'blended'`, no order-independent transparency): 0 settled; turning, one frame of 348 pixels
  at 0.3 (0 at 0.1): #28's one-phase frame of popping (the previous frame's pyramid), the rest of the scene's as well.
- Clip whole (`clipping.settings` instance): 0 lost settled.
- GPU culling off (the CPU's cells), WebGPU and WebGL2, CellPack and PetWorld, 1 to 0.03 at 0°, 30°, 60°: 0 to 3 pixels
  differ from GPU culling. Clusters are in every WebGPU row (CellPack's members over 512 spheres).

## The screen's edges (measured)

`ghost-check.mjs --frustum`, CellPack HIV, ghost pixels in the canvas's edge columns (its outer tenth each side, 2 × 90
columns of 896), before the fix (the six outline shaders of `99d026f92^`) → after, WebGPU / WebGL2 alike (within 10
pixels):

| fraction | 0°             | 30°            | 60°           |
| -------- | -------------- | -------------- | ------------- |
| 1        | 0 → 0          | 0 → 0          | 0 → 0         |
| 0.3      | 3,461 → 32,072 | 6,920 → 28,772 | 0 → 21,970    |
| 0.1      | 5,100 → 5,100  | 8,209 → 8,209  | 6,811 → 6,823 |

- The edges' loss was the same precision loss: the cut half's sides lie farther from the camera than its middle, beyond
  500 × near first.
- Frustum culling: the same views on a canvas 320 px wider (the vertical field of view kept), the narrow canvas's edge
  columns then inside the view, hold 1 to 3% more ghost pixels than the narrow image's, before and after alike. That
  comparison is not exact (the wide image's middle differs from the narrow one in about 8% of the edge strips' pixels,
  and in about half of the two outermost columns: the outline and SSAO samples at the image's border), so it bounds
  rather than shows a loss. Nothing points to culling: each instance is tested by its own sphere, grown for the levels'
  padding and the animations, against the frame's frustum, and the ghost pass draws those lists with that camera; GPU
  against the CPU's cells differ by 0 to 3 pixels. No change made.

## Graded way

WebGPU, the same 0.35 / 60° view, after `clipping.settings` instance and `explorer.clipWay` wider (band 90 Å, fuzziness
0.4) on the model's particle representation: the call succeeded, 126,939 ghost pixels, 0 lost to occlusion. The plain
cut at that view was 126,554. A graded way does not bring the drop back.

## Frame time

`zoom-bench.mjs`, WebGPU, CellPack HIV, quality, dpr 1, 0.35 of the distance, 3 batches (the view where ghosts used to
vanish). Ghosts off / on (a plane through the center, Ghosts on): still 41 / 86.7 ms, turning 30.1 / 62.6 ms. The same
instances and spheres are drawn; the extra time is the ghost pass (a depth draw of the cut half) and its outlines, not
split between them. #28's times are the ghosts-off column. Drawing every cut particle as a ghost is the expensive case
Alexander named (marking off, or ghost edge strength 1); that is the next item, not a change to this fix.

Before and after the fix (`zoom-bench.mjs`, CellPack HIV, quality, dpr 1, 5 batches; the before with the six outline
shaders of `99d026f92^`; ms, still / turning 1° a frame):

| backend, Ghosts | 1                         | 0.35                        | 0.1                         |
| --------------- | ------------------------- | --------------------------- | --------------------------- |
| WebGPU, off     | 9.0 / 9.2 → 9.0 / 9.2     | 52.6 / 33.6 → 50.5 / 33.5   | 45.4 / 29.7 → 44.4 / 31.5   |
| WebGPU, on      | 13.8 / 14.9 → 13.8 / 14.6 | 86.7 / 61.4 → 86.4 / 58.1   | 75.3 / 51.5 → 70.8 / 49.3   |
| WebGL2, off     | 10.0 / 9.9 → 9.8 / 9.9    | 66.7 / 46.0 → 66.6 / 46.0   | 85.8 / 56.5 → 85.5 / 55.9   |
| WebGL2, on      | 16.1 / 15.9 → 15.9 / 15.7 | 124.3 / 84.4 → 126.1 / 83.7 | 149.1 / 98.3 → 149.6 / 96.7 |

The fix costs nothing measurable; #28's frames (Ghosts off) are kept. Ghosts on cost about 1.7× (#24's depth draw of the
cut part and its outlines), as before.

## Left

- The outline target stays RGBA8. A transparent edge beside an opaque one is still only the square root in 8 bits
  (coarse far away; 0 beyond some 260,000 × near): the edge is kept, compared rounded. In the neighborhood the nearest
  transparent edge is chosen by depths of mixed precision (16 bits and rounded square roots).
- The illumination compose passes color transparent outlines with the opaque outline's color (`uOutlineColor`, not
  `uTransparentOutlineColor`): with illumination on, ghosts are black (older, #24; the uniform is not wired in
  `passes/illumination.ts`).
- Upstream candidates (apps/prism-me/AGENTS.md: a library fix is its own lane from origin/master; kept here for
  prism-me, Ludo decides): the graphics commits `99d026f92`, `6d21b2f5f`, `0bee02d89`, `fdf49d99f`, `02a39773d` (the
  outline target's encoding and reading) and their tests; with v6's reversed depth only, so not 5.x.
- Occlusion of the ghost pass is unchanged, on purpose (above). The skeptic agreed it holds at rest. Alexander's note
  (marking off, or ghost edge strength 1) is the next item, not this lane.

## Review

Commits `86bc81283` to `8de6298de` (12:50 to 13:42) and PR #30's first body were made by another agent (Grok) that took
the lane over while this one was stopped on the spend limit; they are treated as unreviewed and were reviewed again
below. `86bc81283`'s title says "the outline spec": it added the changelog entry, this file's sections and the
clipping.md line, no outline spec (history kept, not rewritten).

Round 1 (Grok's): the skeptic confirmed 3 of 3. Each confirmed must-fix and should-fix got a failing test, then its fix.

| Finding                                                                                                        | Severity      | Verdict                  | Commit           |
| -------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------ | ---------------- |
| A "both" edge compared a 16-bit opaque depth with an 8-bit square root, so a ghost a few Å in front was hidden | must-fix      | confirmed, fixed         | `6d21b2f5f`      |
| A depth that packed to 0 is the far plane, so fog took the edge, and fog off made that smoothstep NaN          | should-fix    | confirmed, fixed         | `0bee02d89`      |
| The WebGPU note still said channel a was the transparent depth                                                 | nit           | confirmed, fixed         | `fdf49d99f`      |
| The ghost pass should not get its own occlusion list                                                           | not a finding | confirmed, left as it is | open, on purpose |

Round 2: the coordinator's independent review of `00562ddda..2a541d9ef` (2 must-fix, 4 should-fix, 5 nits), the
lane-reviewer (1 must-fix, 2 should-fix, 4 nits) and the lane-skeptic (7 confirmed, 1 new). Fixed in `02a39773d` unless
said:

| Finding                                                                                                                                                                      | Severity                   | Verdict                                               | Fix                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------- | ---------------------------------------------------------- |
| `6d21b2f5f` rounded every transparent depth before the in-front test (a transparent-only edge has 16 bits): a far ghost tied with a nearer opaque edge and was drawn over it | must-fix                   | confirmed by model, not by a render (above)           | exact compare unless "both"                                |
| `0bee02d89` drew an outline whose depth packed to 0 unfogged (the last Å before the far plane)                                                                               | must-fix                   | confirmed (108 / 167 pixels)                          | fog-off guard kept, depth 0 at the 16-bit floor            |
| The ghost depth's hole behind a nearer opaque surface outlined: a ghost band over the kept surface (older, #24)                                                              | should-fix (skeptic's new) | confirmed (48 / 40 pixels; 244 on the opaque outline) | no transparent edge behind the opaque surface at its texel |
| `outline-depth.test.ts` tested JS copies and greps                                                                                                                           | should-fix                 | confirmed                                             | removed; rendered tests on GL and Dawn                     |
| The screen-edge part of Ludo's report never measured                                                                                                                         | should-fix                 | –                                                     | measured below                                             |
| Progress claims (compare and fog as before; the outline pass's extra time; frame times before and after)                                                                     | should-fix                 | confirmed                                             | corrected; frame times above                               |
| The graphics fix belongs in its own lane                                                                                                                                     | should-fix                 | –                                                     | listed as upstream candidates (Left)                       |
| "exact for them" in clipping.md (one phase pops 348 pixels; stereo, image pass)                                                                                              | should-fix                 | confirmed                                             | reworded                                                   |
| The outline encoding in a spec                                                                                                                                               | nit                        | –                                                     | `depth-conventions.md`                                     |
| `86bc81283`'s title                                                                                                                                                          | nit                        | –                                                     | noted above                                                |
| The changelog said what was not kept; no PR number                                                                                                                           | nit                        | –                                                     | rewritten, (#30)                                           |
| `outlineFog` and `outlineQuantizedDepth` duplicated                                                                                                                          | nit                        | –                                                     | one chunk each backend                                     |
| Mixed precision in the neighborhood's nearest; illumination's outline color                                                                                                  | nit                        | confirmed, older                                      | left (Left)                                                |
