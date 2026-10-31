## Graphics: colors by size on screen

- Color levels on spheres and meshes (`ColorLevels`, `color-levels.md`): the vertex stage blends a far color (per
  instance, `tColorFar`), the theme's color, a chain's hue turned from it and the atom's element color (per group,
  `tColorNear`) by the atom's size on screen in CSS pixels, in Oklab; edges in pixels an atom covers, a blend band in
  octaves. Nothing is recolored while zooming. `ColorTheme.farColor` (optional; `particle-hierarchy`: the compartment's
  base color). Particle target representations: `structure.colorLevels`. The Mesoscale Explorer on Prism:
  `mesoscale.colorLevels`, a model's Look › By zoom, the particles' category theme By zoom.
