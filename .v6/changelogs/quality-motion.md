## prism-me: Mesoscale

- Graphics quality and motion on every object: `mesoscale.graphics` and `mesoscale.motion` take an `object` (a
  structure, a particle list or a volume, by label or ref) and change that object alone, one step each; without one, the
  graphics mode sets every object (structures' and volumes' quality too, not only particles' levels of detail) and the
  canvas resolution, as before. A volume does not wiggle or tumble.
- The explorer's properties: Graphics & Motion (quality; wiggle and tumble, a toggle and an amplitude, where the object
  moves) on a structure, a model, a particle list and a volume, in place of the model-only Graphics section.
