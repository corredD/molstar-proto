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

## Decided

## Learned

## Size

## Review
