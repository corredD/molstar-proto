## prism-me: Mesoscale

- Paint: a stroke's copies drawn at once on a model of millions (cellpack-mg, 2.1 M particles: about 10 ms a stroke, was
  1.3–1.7 s). The copies are a list of their own (`ParticleListPaintLayer`, a child of the model's last decorator, with
  representations like the model's), so the model is not drawn again; they take its looks, move and scale with it, and
  are saved with it. A list moved particle by particle (offsets) is refused for now. A particle drag's preview leaves the
  copies' representations alone (`drawsList`).
