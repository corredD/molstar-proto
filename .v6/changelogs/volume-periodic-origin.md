## Volumes: slices of a whole unit cell drawn where the map is

- Fix: a slice of a map that covers a whole unit cell (periodic, e.g. an EMDB map centered on its origin) kept the
  grid's size but not its origin, so it was drawn half a box away from the isosurface and the volume's bounds; it is
  drawn in the grid now (`createPeriodicVolume`).
- Fix: `Volume.getPeriodicRange` and `Volume.getPeriodicMapping` count a periodic volume's copies in cells with the
  cell's size, not its far corner: with a grid not starting at 0, copies were counted at the wrong cells.
