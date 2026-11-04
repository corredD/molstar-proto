## The explorer's assistant starts

- The Assistant failed to start ("Tool "add_label" is registered twice", Ludo, 2026-11-03): the stage tools and Prism's
  Measurements skill both named `add_label`, `measure_distance`, `measure_angle` and `measure_dihedral`. The explorer
  keeps the stage tools' (atoms, particles, a mesh's triangle) and Prism's `list_measurements` and `remove_measurement`.
  A label now goes on an object or a point (the stage tools'), not on an atom or residue by selection.
