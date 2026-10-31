# Colors that follow the zoom (2026-10-30, lane `dynamic-color`)

## Brief

- **Asked** (Ludo, TODO.md Next, brief 8, 2026-10-30; "go" the same day): a color theme with levels, as the LOD has:
  far, a particle colored by its compartment or entity; closer by chain; closest by residue or atom; the levels blend so
  a zoom never pops. **Check:** on HIV, zoom from the whole virion to one capsid protein; the colors go compartment →
  entity → chain → atom with no jump, the same at the same distance both ways; at rest the viewer asks for no frame; the
  setting is in Look (and the category's color theme), the levels' edges adjustable.
- **Spec:** TODO.md brief 8; `_spec/cellview.md` §7 (the ladder, the HCL path, what not to port); the library's spec in
  the graphics package for the theme or shader; `_spec/ui.md` §4 Look; `features.md`.
- **Step 1, a measurement before code:** re-running `particle-hierarchy` over CellPack MG, ms on WebGPU and WebGL2
  (`scripts/hidden-cost-bench.mjs` shows how to drive the page). It chooses (a) a theme with a current level moved on
  camera change, or (b) the blend in the shader by view depth (cellVIEW's), written here with the numbers before code.
- **Edges:** pixels on screen or Å is open for Ludo; build pixels on screen by default (as `lodPixelSize`), the unit
  kept in one place so Å is a small change, and say so.
- **Tests:** the level and blend at a given distance (both ways the same); no frame asked at rest; perceptual blend (HCL
  or Oklab), not RGB; the setting one step. Testable before the viewer: a Storybook story with a manual level slider
  over a few proteins' colors.
- **Touches:** graphics themes or shaders (library commits naming no extension, upstreamable later when Ludo says so),
  the mesoscale extension's themes, `properties.tsx` Look; **stays off:** #25's CSS tokens.
- **Size:** decided after step 1, written here. If the library part is larger than ~250 lines, stop and report with the
  options before building it.
- **Steps and models:** 1. measure (Sonnet) 2. design (Opus) 3. library (Opus) 4. app (Opus) 5. checks (Sonnet) 6.
  browser on WebGPU and WebGL2 (Sonnet) 7. gate (Opus).

## Step 1: the measurement (2026-10-30)

**Recoloring is about 1 s on CellPack MG, 60 times a frame: way (a) cannot be smooth. Chosen: way (b), the blend in the
shader by the fragment's view depth.**

`particle-hierarchy` re-run over CellPack MG (2,124,843 particles), its `shift` changed in one state commit per round
(10, 15, 20, …: every round really changes the colors), 20 rounds per backend. Apple M1 Pro, headless Chrome (Metal
through ANGLE), 1280×800. Script: `apps/prism-me/scripts/recolor-bench.mjs` (run as its header says, MG read from a
local copy with `--data`). Times in ms, median / p90.

| Backend | Frame at rest | `theme.color` over every particle | Commit      | First frame after | Commit + frame |
| ------- | ------------- | --------------------------------- | ----------- | ----------------- | -------------- |
| WebGPU  | 32.1          | 115 / 249                         | 866 / 2351  | 130 / 828         | 996 / 2812     |
| WebGL2  | 181           | 170 / 326                         | 1010 / 8897 | 532 / 6831        | 1816 / 13436   |

- **The floor alone is 7 to 10 frames:** the theme's color function over the 2.1 M particles (a CPU loop with one reused
  location, nothing else) is 115 ms (WebGPU page) and 170 ms (WebGL2 page), before the state machinery, the instance
  color array and its upload. The theme's factory itself is 0.3 ms (its index is cached per list).
- **The best rounds are still about 20 frames:** commit 363 ms (WebGPU), 321 ms (WebGL2).
- **Colors only:** the render objects, their ids, draw and instance counts are the same after every commit (an update,
  not a rebuild).
- **The machine was loaded** (shared with other sessions): the frames at rest, 32 and 181 ms, were 21 and 51 ms in the
  hidden-cost lane on the same machine and data, and one WebGL2 commit took 30 s (garbage collection, most likely). With
  a margin of 20 to 60 times, a quiet machine would not change the choice; the WebGL2 numbers are not a regression.
- **Why (b) besides speed:** the blend by depth is a function of the view alone, so "the same colors at the same
  distance both ways" and "no frame asked at rest" hold by construction; one object can span two levels (cellVIEW's
  per-pixel level, §7); nothing is recolored while zooming. Way (a) is one level for the whole scene and a re-upload at
  every zoom step.
- **Not an escape for (a):** a hand-written fill that skips the theme (the per-particle index into a few colors) might
  come near a frame, but it still uploads about 6 MB per zoom step and gives no chain, residue or atom level: those need
  per-atom data in the shader whichever way, so the shader work is needed anyway.

## Built

- Step 1 (the measurement, `recolor-bench.mjs`), then a stop at the size check (Size below); Ludo picked option 1 the
  same day.
- **Library** (`graphics`, commits naming no extension; plan `.v6/plans/gl/color-levels.md`): `ColorLevels`, the rule
  (an atom's size on screen in CSS pixels, three edges blended over octaves, Oklab; the chain's hue turned from the
  entity's) and its data; `ColorLevelsSchema` on spheres and meshes (`tColorFar` per instance, `tColorNear` per group,
  two data layers, merged as instance and group textures); the vertex stage blends `vColor` in GLSL and WGSL, before
  overpaint; `ColorTheme.farColor` (`particle-hierarchy`: the compartment's base color); the particle target visual
  fills a target's near data once (its atoms' element colors, its chains' offsets) and its particles' far colors when
  the colors change (`structure.colorLevels` param).
- **Extension** (`mesoscale`): `mesoscale.colorLevels` (on, off, edges; one step; command and agent tool),
  `mesoscale.theme` by zoom (Particle Hierarchy with the levels on), `graphicsState().colorLevels`, `ZoomColors`
  control; a scaling guard over N lists.
- **App** (prism-me): a model's Look › By zoom and, when on, its entity, chain and atom edges (log sliders, px); the
  particles' category theme By zoom; the story Explorer › Colors by zoom › Level Slider; ui.md §3, §4, features.md,
  TODO.md (brief 8 out of Next, what is left kept).

## Decided

- **Option 1, (b) in full** (Ludo, 2026-10-30): both backends, per pixel, four levels compartment → entity → chain →
  atom, blended in Oklab; the size limit lifted to ~420 graphics lines for this lane (stop and report past it).
- **The nearest level is the atom, by element** (Ludo, 2026-10-30).
- **The edges in pixels on screen** (Ludo, 2026-10-30), the unit kept in one place.
- **Way (b), the blend in the shader by the fragment's view depth** (this lane, from step 1's numbers; the brief's
  rule).
- **In the vertex stage, not per pixel: a change to Ludo's choice, for him to confirm** (this lane, design, not asked
  before building). Ludo chose (b) "per pixel"; the level is taken at the sphere's center (or the mesh vertex), so no
  new varying (WebGL2's 15 and WebGPU's 16 are near full). An atom is a few pixels at the near levels, and a protein
  still spans levels atom by atom (not option 4's per particle). Per pixel would add two varyings (far and near colors)
  and move the blend to the fragment stage. Before overpaint, so Look's colors still paint over it.
- **By zoom is a theme's** (this lane, from the review): another category theme turns the levels off in the same step;
  Look's colors paint over them, and `mesoscale.colorLevels` says so.
- **The unit**: pixels an atom (3.4 Å) covers, CSS pixels as `lodPixelSize`; in one function per language
  (`ColorLevels.atomSize`, `colorLevelSize` in GLSL and WGSL): edges in Å would change these three and the labels.
- **Defaults** (this lane, from HIV in the browser): entity 3 px, chain 10, atom 30, a band of one octave, chain hues
  over 90°. On CellPack HIV (1000×800): the whole virion shows its compartments, at a fifth of the distance its
  entities, at a fiftieth atoms by element.
- **Off for a uniform theme or a palette** (no per-vertex color), and for shape and volume targets (no atoms); coarse
  elements take a carbon's color at the atom level.

## Learned

- **Checked in the app** (Playwright, headless Chrome, CellPack HIV, 1000×800, WebGPU and WebGL2, a Sonnet agent; the
  category theme By zoom through `mesoscale.theme`): compartments at the whole virion, entities at 0.3 of the distance,
  chains' hues at 0.1, elements from 0.04; no jump, no artifact, no console error. WebGL2: zooming in and out, the
  images at each distance pixel-identical. WebGPU: identical from 0.04 in; at 0.3 and 0.1 they differ (23 % and 4 % of
  pixels), and differ the same with the feature off: WebGPU's culling, not the colors. 0 frames drawn at rest, on or
  off. The two backends alike. Flat grey discs at close zoom are there with the feature off too (not this lane's).
- **The story** (Explorer › Colors by zoom › Level Slider): compartment, entity, chain hues, elements as the slider
  goes; light and dark; wraps at 400 px (fixed in the lane).
- The theme's factory is not the cost (0.3 ms, its index cached per list); the per-particle color function is 115 to 170
  ms over 2.1 M particles, and the commit and upload several times that.
- The shaders already have what pixel edges need: the projection and the drawing buffer's size are global uniforms
  (`uGlobal.uProjection`, `uDrawingBufferSize`), so a level's edge in pixels on screen becomes a depth in the shader as
  `LodView.depthScale` does on the CPU (`renderable.ts`), with no new view plumbing. A merged item's group data is one
  line in `BaseTexSpecs` (`merged.ts`): the segment offsets (`aSegment.z + group`) are already handled for group
  textures.
- No HCL, Oklab or LCh code in the shaders today; `@molstar/core/util/color/spaces/{lab,hcl}.ts` are CPU only.

## Size

**Built: over the limit.** `graphics` production +449 −9 raw (with about 13 author lines and the doc comments), past the
~420 Ludo set: +437 when the feature was built, +12 with the review's fixes. Reported here after building, not before,
as the rule asked: the overrun is the TS rule (`ColorLevels`, the shaders' test oracle and the story's colors, about 150
lines), which the first estimate (360) had not counted. Of it: the rule and data 150, the GLSL 67 and the WGSL 69, the
visual and its near data 80, schema, layers, merged and geometries 40, the theme's far color 16. `mesoscale` +170 −8,
prism-me +4 (the Look line and the theme). Tests and the story: graphics +300, mesoscale +195, prism-me +250.

**At the size check (before Ludo's choice):**

**Way (b) as briefed is about 360 production lines in `graphics` (300 to 420), over the ~250 limit: stopped here, before
the library.** The yardstick: the graded-cuts table (`3c0ed1d34`, one per-instance table and its rule in both backends)
was about 316 production lines.

| Part (graphics)                                                                                              | Lines |
| ------------------------------------------------------------------------------------------------------------ | ----- |
| Per-target level data (new file): per atom its chain's index and count, its element's color; the compartment | 60    |
| The particle target visual fills it (structure targets), keeps it on a theme change                          | 60    |
| Props: levels on or off, their edges in pixels on screen (the unit in one place), values update              | 40    |
| Schema (texture, edges, define), WebGPU bindings and uniform layout, `merged.ts` texture spec                | 20    |
| GLSL: params, varyings, Oklab and LCh, the ladder and its blend by depth                                     | 80    |
| WGSL: the same                                                                                               | 80    |
| The hierarchy theme gives a target's compartment color (the far level)                                       | 20    |

Tests (not counted): the level and blend at a given depth both ways, the Oklab blend against RGB, no frame asked at
rest, WGSL/GLSL compile, merged items. The app after it (Look, the category's theme, the story with a level slider):
about 150 lines in prism-me and the mesoscale extension.

**Options for Ludo:**

1. **(b) in full** (recommended): about 360 lines, both backends, per pixel, four levels (compartment → entity → chain →
   atom), chains' hues derived from the entity's in LCh, blended in Oklab. All of the brief's check. A Mol\* graphics
   change, with Alexander, as the brief says.
2. **(b) with three levels**: entity → chain → atom, the far level the theme's own color (with `particle-hierarchy`
   already the compartment's hue family). About 290 lines. Drops the compartment level of the check.
3. **(b) on WebGPU first**: about 280 lines now (the shared parts and WGSL), GLSL in a follow-up lane (about 80). The
   check fails on WebGL2 until then: it shows the far colors only.
4. **(b) per instance, not per pixel** (the level by the particle's depth in the vertex stage): saves about 10 lines; a
   large object no longer spans two levels. Not worth it.

Not an option: way (a), by step 1.

## After Ludo's test (2026-10-30)

Ludo, on PR #27: "in firefox it doesn't work i think it because it run webgl. In safari nothing draw only the outline
and everything is flickering. On chrome after enable by Zoom then things start to draw normally and the coloring works
great." And: "when zoomed in looking at spacefill performance decreased largely."

### 1. Not drawn until a change: a WebGPU draw-list bug of `prism-me`, fixed here

- **Reproduced** with Playwright (Chrome on WebGPU and WebGL2, Firefox on WebGL2, WebKit on WebGPU), `prism-me`
  (`origin/prism-me`, port 1361) against this branch (port 1360), levels off at load:
  - **PetWorld HIV (the first example) on WebGPU: blank on both**, every frame
    `[Buffer "quad indices"] used in submit while destroyed` (Chrome, 3 runs of 3 each); WebKit:
    `Invalid CommandEncoder`, blank. WebGL2 (Chrome, Firefox) draws it. CellPack HIV draws everywhere but in WebKit
    (below).
  - So not this lane's: `prism-me` has it. Turning By zoom on changed the draws, which recorded them again: hence "after
    enable by Zoom things start to draw normally".
- **Cause** (`gl/webgpu/context.ts` `recordRenderBundle`, `gl/renderer.ts` the draw lists): a recording's first draws
  bound the shared quad index buffer, a later draw of the same recording (a larger object) grew it, the old one released
  after the submit; the snapshot taken after the recording read the new `drawResourcesVersion`, so the recording was
  current and replayed every frame with the released buffer, its submit failing. The fix: a recording during which a
  shared draw resource is replaced fails (as for a uniform arena growing), and the next frame records with the grown
  buffer (`8a159bd86`; test `c424c0bdf`, failing first, on Dawn in Node: `pnpm native:install -- --webgpu`).
- **After the fix:** PetWorld HIV draws on Chrome WebGPU (3 of 3, no error) and on WebKit; CellPack HIV unchanged.
- **Firefox (WebGL2):** no failure found headless: both examples draw, the levels work on CellPack HIV (compartments,
  entities, chains, elements as zoomed). On PetWorld HIV, By zoom was refused ("cannot be colored by zoom": no
  compartments; its entities are per particle): likely what "doesn't work" was. By zoom now colors such a model by
  entity, then chains and atoms (`f4e83e40d`, test first; a model with entities by target only is refused, Particle
  Entity reading them per particle: the fix review's M1); checked on Chrome, Firefox and WebKit.
- **WebKit (Safari): CellPack HIV draws only its RNA**, levels off, on `prism-me` and here alike, no console error: not
  this lane's, left open (TODO.md). Not reproduced: Safari's flicker (headless shows no motion).
- **Guards added:** the sphere and mesh programs with the levels off hold none of their code (GLSL and WGSL), and
  compile on the native GL backend off and on (`a8f757b25`).
- **Seen, not this lane's:** flat grey discs at close zoom (spheres cut by the near plane, their interior caps) on
  `prism-me` too.

### 2. Zoomed-in frames: measured, a plan (not built)

Frame time in ms (median of 60, after 40), Chrome headless, M1 Pro, 1280×800, at the distance after load (1) and at a
tenth and a fiftieth of it (0.02: close to one capsid protein). `prism-me` | this branch levels off | on:

| Model, backend       | 1                      | 0.1                     | 0.02                  |
| -------------------- | ---------------------- | ----------------------- | --------------------- |
| CellPack HIV, WebGPU | 18.6 \| 15.9 \| 16.7   | 73.1 \| 68.7 \| 78.0    | 44.3 \| 44.5 \| 45.9  |
| CellPack HIV, WebGL2 | 32.4 \| 39.3 \| 34.0   | 99.1 \| 106.6 \| 106.1  | 63.3 \| 75.1 \| 71.6  |
| PetWorld HIV, WebGPU | 19.0\* \| 41.1 \| 38.3 | 88.6 \| 86.1 \| 87.6    | 63.6 \| 65.3 \| 66.4  |
| PetWorld HIV, WebGL2 | 62.9 \| 66.6 \| 66.4   | 116.9 \| 122.8 \| 129.8 | 92.4 \| 96.3 \| 103.5 |

\* `prism-me` draws nothing there (item 1). Two more runs of CellPack HIV on WebGL2 (`prism-me` | off): 28.8 | 29.6,
100.9 | 97.4, 68.6 | 65.5 and 32.2 | 34.1, 110.3 | 101.6, 65.8 | 70.3: run to run ±10 %, the machine shared.

- **Levels off cost what `prism-me` costs**, within the noise (±10 % run to run; PetWorld HIV WebGL2 off is 4 to 6 %
  above in its three cells, CellPack HIV WebGL2 8 to 21 % above in one run and below in the reruns): the off programs
  are those of before (the guard above), and the lane's data is empty there.
- **Levels on cost −13 to +14 % against off, within the noise but for the largest** zoomed in (largest: CellPack HIV
  WebGPU at 0.1, +9 ms; PetWorld HIV WebGL2 at 0.02, +7 ms): the vertex stage's two fetches and four Oklab conversions
  per vertex (four per sphere quad), whatever the level.
- **Zoomed in is 1.5 to 4 times the whole view on `prism-me` already** (CellPack HIV WebGPU 18.6 → 73.1 ms; PetWorld HIV
  WebGL2 62.9 → 116.9): more spheres at level 0 and fill (`screen-space-lod.md`: zoomed in is vertex-bound). Most likely
  what Ludo saw; and on WebGPU PetWorld HIV, `prism-me` drew nothing at all, so anything drawn is slower.

**Plan (options, not built):**

1. **Skip the blend where it is whole** (both stages saturated: below the entity band, the far color; beyond the atom
   band, the element's): one branch in `colorLevels`, GLSL and WGSL, about 10 lines; zoomed in most spheres are past the
   atom band. Saves most of the on-cost there, none in between.
2. **Oklab stored, not computed:** the far and element colors written in Oklab (bytes, scaled) by the visual, so the
   shader converts only the entity color and the result: about 25 lines (TS encode, both shaders), the near data's cache
   unchanged. Saves about half the per-vertex math everywhere.
3. **Per instance, not per vertex, on WebGPU:** the level and the far/entity/chain blend in the instance-copy compute
   (one per sphere, not four), the element blend kept per vertex: larger (about 80 lines, WebGPU only), and it changes
   the cell-cull path. Not worth it before 1 and 2 are measured.
4. **The zoomed-in base cost** (not this lane's): the LOD preset (`balanced` or `performance` in Graphics & Motion
   halves it, `screen-space-lod.md`) and the near-plane caps; for the graphics lanes.

Recommended: 1, then 2 if the on-cost still shows (both under 40 lines), measured with `recolor-bench.mjs`'s method.

## Review

PR #27 (https://github.com/corredD/molstar-proto/pull/27), to `prism-me`; Ludo merges.

Reviewer (Opus) then skeptic (Opus) over `origin/prism-me...a5ca3b936`: 2 must-fix, 7 should-fix, 6 nits; the skeptic
confirmed all 15, none refuted (S3 down to a nit, M1 to low-medium). Each fixed test first, a commit each:

| Finding                                                                                                     | Severity              | Outcome                                                                         |
| ----------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------- |
| M1 atom size NaN behind the camera (a mesh crossing its plane)                                              | must-fix (low-medium) | fixed `e6ff852e8` (test `0ac7a4be8`)                                            |
| M2 an item off left the shared material uniforms at zero                                                    | must-fix              | fixed `ce9897229` (test `06bbc6fde`)                                            |
| S3 no test that no frame is asked at rest                                                                   | nit                   | open: nothing in the diff asks a frame; 0 draws measured at rest in the browser |
| S4 no GLSL/WGSL compile nor shader-against-rule test in the repo                                            | should-fix (low)      | partly: `a8f757b25`, `af89b2d0c` (GLSL); WGSL on Dawn and against the rule open |
| S5 refill paths untested                                                                                    | should-fix (low)      | test `7a9527c58` (no bug)                                                       |
| S6 another theme left the levels on                                                                         | should-fix            | fixed `98720d0ce` (test `2f40f9ec2`), ui.md `4b13f61c2`                         |
| S7 By zoom over Look's colors silently hidden                                                               | should-fix            | said so `98720d0ce` (test `2f40f9ec2`)                                          |
| S8 far color a Map lookup per particle                                                                      | should-fix (low)      | fixed `565a6fc7f` (test `eea74ac5e`)                                            |
| S9 per pixel changed without asking; size reported as at the limit                                          | should-fix (process)  | said plainly above (Decided, Size), for Ludo                                    |
| Nits: slider range, plan status, blob surfaces and chains in the plan                                       | nit                   | fixed `afe4b72db`, `0e5f9135e`                                                  |
| Nits: chains keyed by asym id with ligands and waters; story inline styles; `tColorNear` re-sent per update | nit                   | open                                                                            |

**Fix review** (after Ludo's test; reviewer over `55fc4a5e6..1cfe7cdd5`): 1 must-fix, 3 should-fix, 5 nits.

| Finding                                                                                      | Outcome                                                                |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| M1 by zoom took a model with entities by target only, drawn grey; the PetWorld fixture wrong | fixed `366035f5a` (test first `2c347cc66`)                             |
| S1 the WebGPU fix is a library fix master needs: its own lane                                | listed in TODO.md Library fixes; the changelog says it                 |
| S2 the draw-list test would pass if recordings failed every frame                            | replays asserted `e23163f53`                                           |
| S3 the native compile skipped here (no frag depth)                                           | per object, the mesh's runs, shown to catch a broken chunk `af89b2d0c` |
| N1 the version sum in two places                                                             | `fa6437a44`                                                            |
| N2 another target's recording of the same frame could hold the old buffer                    | open (implausible: the same draws)                                     |
| N3 "drawn by its structures" is any target representation                                    | comment `366035f5a`                                                    |
| N4 specs: far level under Particle Entity, features.md                                       | plan, features.md, ui.md §3                                            |
| N5 S4's status, the progress numbers                                                         | TODO.md and the numbers above                                          |

**Fix review's skeptic** (over the fixes up to `9ef364ced`): every finding confirmed (N2 plausible), none refuted; a new
must-fix, NEW-1: a list of more than 64 objects records by chunks, and an earlier chunk's recording (the first quad
index buffer) replayed after a later chunk grew it. Fixed: each recording keeps the draw resources' version and does not
replay past it (`d42241bbb`, its test failing first just before it), which also closes N2. Left: S1 (the library fix's
own lane from master, TODO.md), the spheres' native compile where the backend has no frag depth, the PetWorld test's
colors (it checks the theme and the levels, not the drawn colors).
