## prism-me: Paint

- Paint copies of a mesoscale entity onto a surface (cellPAINT in the explorer): an entity's right-click › Paint with …,
  then a drag on the canvas paints a stroke, a copy every spacing, previewed as discs on the surface; the release is one
  undo step. A membrane protein stands upright in the membrane (its +z along the surface, on the membrane's mid-plane),
  anything else is turned at random; the principal axis or the view direction on request; the side and the spin. The
  entity's Paint section sets the brush.
- `mesoscale.paint` (a command and an agent tool, `paint_mesoscale_copies`): copies of an entity at points with their
  normals, one stroke a run; the strokes are a particle list decorator, `ParticleListPainted` (mesoscale extension),
  saved in sessions and carried by a later move of the list. On the exosome model (88k particles) a stroke of 8 CD9
  copies paints in about 0.1 s headless.
- While painting, Alt with the usual gestures moves the camera (Alt+drag turns, Alt+right drag pans, Alt+wheel zooms).
- A soluble entity paints at the pointer's tip, at a depth along its ray (from the camera's focus; the wheel moves it);
  a membrane protein stays on the surface. The Paint section's Place overrides either way.
- A copy of the brush follows the pointer, where a click puts it and turned as it will be; a click paints that copy.
- Paint a fiber: a stroke with an entity that has fibers (or Fiber on) becomes a new fiber of the list, its points the
  entity's fiber step apart, each turned along it as the entity's own fibers are (its axis and twist).
  `mesoscale.paint` takes `fiber`.
- Fibers by rise and twist (round 3): a painted fiber keeps its path, and its points are made from the entity's fiber
  settings, a point every Rise (Å) along the path, each turned by the Twist (°) from the one before plus a random turn
  within ±Jitter (°, seeded). The settings are in the entity's Fiber section (and the Paint section);
  `mesoscale.fiber` sets them, one step, and every painted fiber of the entity is made again (the file's fibers stay).
  Default: the entity's own fibers' step and twist. A DNA: 3.4 Å, 34.3°, 0; an RNA: its rise, Jitter 180.
- Fibers by an axis and an offset (round 4): the entity's Fiber settings choose the unit's own axis along the path
  (Auto, X, Y, Z; Auto: its fibers', else its principal axis) and an Offset (Å) off the path, along a perpendicular of
  that axis that turns with the unit (with a twist: a helix about the path). `mesoscale.fiber` takes `axis`, `offset`.
- The copy under the pointer is drawn in the scene (round 4), depth-tested: seen behind or inside what is in front of
  it, where a copy at a depth goes; the wheel keeps that depth inside the camera's near and far planes.
- A bank of units by sequence (round 5): an entity's Fiber settings choose a Bank, DNA (a base pair a letter: AT, TA,
  GC, CG) or RNA (a nucleotide a letter: A, U, G, C), cellPACK's 3DNA units stored forward +z; choosing one sets its
  helix (3.38 Å, 36°, axis z). A painted fiber's points switch unit by its Sequence (a Range of it, 1-based; a shorter
  one repeats), or at random (seeded) without one or for a letter not in the bank. A point's label names its letter.
  `mesoscale.fiber` takes `bank`; `mesoscale.paint` takes `sequence`, `start`, `end`.
