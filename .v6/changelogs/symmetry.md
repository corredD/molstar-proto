## prism-me: Mesoscale

- Grow › Symmetry: copies of the Grow source by a point group, Cn, Dn, T, O or I, about a center a Radius from the
  source along its axis (Side: inside or outside; unset Radius: the copies touching), the group's principal axis Auto
  (the source at the group's general position, turning with it), View, X, Y or Z; each copy the source's pose turned
  about the center. On a mesh, Snap projects each copy onto the surface and turns it to the normal. Live on the last
  grow, Clear, Undo, sessions. `mesoscale.grow { mode: 'symmetry', group, n, symmetryRadius, side, symmetryAxis, snap }`.
