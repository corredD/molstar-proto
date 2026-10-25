## Particles: a whole list's bounding sphere

- A whole particle list's bounding sphere (`Particle.getBoundingSphere` given a sphere to fill) fills that sphere; it
  copied the other way, returning the caller's stale sphere and overwriting the list's cached boundary (a distance to a
  one-particle list read 21.68 Å instead of 15.19 Å)
