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
  8-bit alpha holds the square root of the depth (0 only beyond some 260,000 × near; decoded by squaring, so the compose
  passes compare and fog as before); an edge counts by its flag, whatever its depth (opaque too). Four shaders, a line
  or a few each: `outlines.wgsl.ts`, `outlines.frag.ts`, `postprocessing.frag.ts`, `illumination/compose.frag.ts`.
- Decided (state of the art over a wider target): the outline target stays RGBA8 (a float target doubles its bandwidth
  for every outline, and 16 bits already hold the common case); the flag, not the depth, says an edge is there.
- Tests, failing first (0 ghost pixels before): `graphics/canvas3d/_test/clip-ghosts-draw.test.ts` (native GL, a
  perspective view, the near plane at 1 Å, the cut sphere over 1000 Å away) and its WebGPU twin
  `plugin/headless/_test/webgpu-clip-ghosts.test.ts` (Dawn); each fails with its backend's shader reverted.

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

## Graded way

WebGPU, the same 0.35 / 60° view, after `clipping.settings` instance and `explorer.clipWay` wider (band 90 Å, fuzziness
0.4) on the model's particle representation: the call succeeded, 126,939 ghost pixels, 0 lost to occlusion. The plain
cut at that view was 126,554. A graded way does not bring the drop back.

## Frame time

`zoom-bench.mjs`, WebGPU, CellPack HIV, quality, dpr 1, 0.35 of the distance, 3 batches (the view where ghosts used to
vanish). Ghosts off / on (a plane through the center, Ghosts on): still 41 / 86.7 ms, turning 30.1 / 62.6 ms. The same
instances and spheres are drawn; the extra time is the outline pass. #28's times are the ghosts-off column. Drawing
every cut particle as a ghost is the expensive case Alexander named (marking off, or ghost edge strength 1); that is the
next item, not a change to this fix.

## Left

- The outline target stays RGBA8. A transparent edge beside an opaque one still loses its depth beyond about 260,000
  times the near plane (the square root in 8 bits). Not a cellPACK view.
- Occlusion of the ghost pass is unchanged, on purpose (above). Alexander's note (marking off, or ghost edge strength 1)
  is the next item, not this lane.
