## prism-me: Mesoscale

- Paint with a structure: after loading a PDB id or a file, its right-click and its Paint section paint copies of it,
  into a particle list of the scene (a new entity of the structure's id) or into the Painting list, made by the first
  stroke (an empty scene paints into it). `mesoscale.paint { structure, particles }`.
- Painted copies are their list's particles: a copy moved alone (Move this instance) or with its kind (Offset all like
  it) as the file's are (cryoet's offsets read the deepest decorator's particles); a list's row counts them.
- Fiber, not fibre, in paint's labels, messages and docs.
- A structure paints as the scene built it: an assembly (2PLV assembly 1) or a symmetry, not the asymmetric unit.
- A structure paints fibers: Fiber in its Paint section, its Rise and Twist after its first stroke; its units touch by
  default (its length along its principal axis a point).
