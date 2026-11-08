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
