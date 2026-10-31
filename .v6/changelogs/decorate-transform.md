## Particles: decorations under a list transform

- `ParticleListTransform` and `ParticleListOffsets` take a decoration inserted above them: they compared the input's
  `sourceData`, which a decoration keeps, and kept a list without its targets ("Target does not apply to …" when a list
  is decorated after it was scaled).
- The instanced objects of particle targets are bounded where their particles are once the list is scaled or moved in
  place (their bounding sphere was kept): the camera's planes and the culling dropped them when zooming in.
- A merged render object kept by a representation update is synced with its members then, not only when its
  renderable updates: a scene that adds it after that update drew it as it was merged (WebGPU, a list decorated then
  scaled at once).
- Stage tools: `stage.scale`, `stage.move` and an object's placement find a list's transform under a decoration made
  after it (a second transform was added: a scale of 10 again made 100, a move was scaled).
