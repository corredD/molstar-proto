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
- **In the vertex stage, not per pixel** (this lane, design): the level is taken at the sphere's center (or the mesh
  vertex), so no new varying (WebGL2's 15 and WebGPU's 16 are near full); an atom is a few pixels at the near levels,
  and a protein still spans levels atom by atom. Before overpaint, so Look's colors still paint over it.
- **The unit**: pixels an atom (3.4 Å) covers, CSS pixels as `lodPixelSize`; in one function per language
  (`ColorLevels.atomSize`, `colorLevelSize` in GLSL and WGSL): edges in Å would change these three and the labels.
- **Defaults** (this lane, from HIV in the browser): entity 3 px, chain 10, atom 30, a band of one octave, chain hues
  over 90°. On CellPack HIV (1000×800): the whole virion shows its compartments, at a fifth of the distance its
  entities, at a fiftieth atoms by element.
- **Off for a uniform theme or a palette** (no per-vertex color), and for shape and volume targets (no atoms); coarse
  elements take a carbon's color at the atom level.

## Learned

- The theme's factory is not the cost (0.3 ms, its index cached per list); the per-particle color function is 115 to 170
  ms over 2.1 M particles, and the commit and upload several times that.
- The shaders already have what pixel edges need: the projection and the drawing buffer's size are global uniforms
  (`uGlobal.uProjection`, `uDrawingBufferSize`), so a level's edge in pixels on screen becomes a depth in the shader as
  `LodView.depthScale` does on the CPU (`renderable.ts`), with no new view plumbing. A merged item's group data is one
  line in `BaseTexSpecs` (`merged.ts`): the segment offsets (`aSegment.z + group`) are already handled for group
  textures.
- No HCL, Oklab or LCh code in the shaders today; `@molstar/core/util/color/spaces/{lab,hcl}.ts` are CPU only.

## Size

**Built:** `graphics` production +437 −7 raw (with about 13 author lines and the doc comments; at the ~420 Ludo set), of
which the rule and data 150, the GLSL 67 and the WGSL 69, the visual and its near data 80, schema, layers, merged and
geometries 40, the theme's far color 11. Over the first estimate (360) by the TS rule (`ColorLevels`, the shaders' test
oracle and the story's colors), which the estimate had not counted. `mesoscale` +164 −8, prism-me +4 (the Look line and
the theme). Tests and the story: graphics +241, mesoscale +174, prism-me +250.

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

## Review
