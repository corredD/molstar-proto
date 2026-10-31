# Plan: Colors by size on screen (color levels)

## Status

- **Current**: building (lane `dynamic-color`, 2026-10-30). Step 1 measured (below); the design is this file.

## Why

- **A particle's colors should follow the zoom**, as its levels of detail do ([screen-space-lod.md](screen-space-lod.md)):
  far away its compartment's color, closer its entity's, closer its chain's, closest its atoms' (by element), blended so
  that a zoom never pops. cellVIEW does it (Chameleon, Waldin et al. 2016) per pixel in a screen-space pass.
- **Not by recoloring** (measured, CellPack MG, 2.1 M particles, M1 Pro): one re-run of a particle color theme is 115 to
  170 ms for the color function alone and about 1 s (WebGPU) to 1.8 s (WebGL2) with its commit and the next frame.
  Recoloring on every camera change cannot be smooth, and no theme has a color below the particle (chain, atom) that
  could be stored per instance and atom (millions × hundreds).

## Design

- **The level is a function of the view only**: where a sphere (or mesh vertex) is, its atom's size on screen, in CSS
  pixels: `S = 3.4 / p(d)`, `p(d)` the Å a pixel covers at view depth `d` (as `screen-space-lod.md`: `2 / P[1][1]` over
  the viewport's height in CSS pixels, times `d` in perspective). 3.4 Å is an atom's diameter (`ColorLevels.AtomSize`).
  Why: the same colors at the same distance whichever way the camera came, nothing asked of the CPU at rest or while
  zooming, the same look at any resolution and field of view.
- **The unit in one place per language**: `ColorLevels.atomSize` (TS), `colorLevelSize` (GLSL, WGSL). Edges in Å of
  distance instead would change these three functions and the params' labels, nothing else.
- **Four levels, three edges** (`entity`, `chain`, `atom`, in pixels an atom covers, `entity < chain < atom`): below
  `entity` the far color, then the entity's, the chain's, the atom's. Each edge blends over `band` octaves around it:
  `t = smoothstep(-band / 2, band / 2, log2(S / edge))`, the colors mixed in that order. Why the log: a zoom is a
  scaling; the blend takes the same share of a zoom at every edge.
- **Blended in Oklab** (Ottosson 2020), never RGB: a mix keeps the perceived lightness (cellVIEW's ladder mixed RGB,
  its HCL path did not; `cellview.md` §7.3).
- **The chain's color is the entity's, its hue turned** by the chain's offset in the target (`o` from -1 to 1, its index
  among the target's chains spread evenly; 0 for one chain) times half of `chainHue` (radians in the shader, degrees in
  the params), its lightness by `0.05 o`: cellVIEW's chain wedge (§7.2), so a chain still reads as its entity.
- **The data** (`ColorLevelsSchema`, spheres and mesh, `dColorLevels`):
  - `tColorFar` (`rgba8`, per instance): the far color, the theme's `farColor` (`particle-hierarchy`: the compartment's
    base color), else its color.
  - `tColorNear` (`rgba8`, per group): the atom's element color in `rgb`, the chain offset in `a` (`(o + 1) / 2`).
  - `uColorLevelEdges` (`log2` of the edges), `uColorLevelBand`, `uColorLevelChainHue` (material uniforms).
  - The entity color is the theme's own (`tColor`, `vColor`).
- **Applied in the vertex stage**, on `vColor`, before overpaint (a Look color painted over a part still wins): at the
  sphere's center or the mesh vertex. Why not per pixel: no new varying (WebGL2's 15 and WebGPU's 16 are near full),
  and an atom is a few pixels at the near levels; a protein still spans levels, atom by atom.
- **Who fills it**: the particle target visual for structure targets (`colorLevels` in its structure params), the near
  data once per target structure (cached), the far data when the theme changes. Off for a uniform theme or a palette
  (no `vColor`), and for shape and volume targets (no atoms).
- **Merged items**: `tColorFar` an instance texture, `tColorNear` a group texture (`BaseTexSpecs`); `dColorLevels` in the
  merge key as every define.
- **The TS rule** (`ColorLevels.blend`) is what the shaders run, for the tests and for the story's swatches.

## Steps

1. Measure a theme re-run (done; `apps/prism-me/scripts/recolor-bench.mjs`).
2. The rule, the data, the shaders (GLSL, WGSL), the particle visual (this lane).
3. The Mesoscale Explorer: Look, the category's color theme (prism-me).
