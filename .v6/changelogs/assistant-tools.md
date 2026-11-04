## The explorer's assistant starts

- The Assistant failed to start ("Tool "add_label" is registered twice", Ludo, 2026-11-03): the stage tools and Prism's
  Measurements skill both named `add_label` and `measure_distance`. The explorer leaves out Prism's `measure` skill; the
  stage tools' labels and measurements (atoms, particles, a mesh's triangle) are the ones the assistant has.
