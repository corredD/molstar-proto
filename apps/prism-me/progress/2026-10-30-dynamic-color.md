# Colors that follow the zoom (2026-10-30, lane `dynamic-color`)

## Brief

- **Asked** (Ludo, TODO.md Next, brief 8, 2026-10-30; "go" the same day): a color theme with levels, as the LOD has:
  far, a particle colored by its compartment or entity; closer by chain; closest by residue or atom; the levels blend so
  a zoom never pops. **Check:** on HIV, zoom from the whole virion to one capsid protein; the colors go compartment →
  entity → chain → atom with no jump, the same at the same distance both ways; at rest the viewer asks for no frame;
  the setting is in Look (and the category's color theme), the levels' edges adjustable.
- **Spec:** TODO.md brief 8; `_spec/cellview.md` §7 (the ladder, the HCL path, what not to port); the library's spec in
  the graphics package for the theme or shader; `_spec/ui.md` §4 Look; `features.md`.
- **Step 1, a measurement before code:** re-running `particle-hierarchy` over CellPack MG, ms on WebGPU and WebGL2
  (`scripts/hidden-cost-bench.mjs` shows how to drive the page). It chooses (a) a theme with a current level moved on
  camera change, or (b) the blend in the shader by view depth (cellVIEW's), written here with the numbers before code.
- **Edges:** pixels on screen or Å is open for Ludo; build pixels on screen by default (as `lodPixelSize`), the unit
  kept in one place so Å is a small change, and say so.
- **Tests:** the level and blend at a given distance (both ways the same); no frame asked at rest; perceptual blend
  (HCL or Oklab), not RGB; the setting one step. Testable before the viewer: a Storybook story with a manual level
  slider over a few proteins' colors.
- **Touches:** graphics themes or shaders (library commits naming no extension, upstreamable later when Ludo says so),
  the mesoscale extension's themes, `properties.tsx` Look; **stays off:** #25's CSS tokens.
- **Size:** decided after step 1, written here. If the library part is larger than ~250 lines, stop and report with
  the options before building it.
- **Steps and models:** 1. measure (Sonnet) 2. design (Opus) 3. library (Opus) 4. app (Opus) 5. checks (Sonnet)
  6. browser on WebGPU and WebGL2 (Sonnet) 7. gate (Opus).

## Built

## Decided

## Learned

## Size

## Review
