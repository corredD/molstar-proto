## prism-me: Mesoscale

- Grow › Helix: a new fiber from the Grow source winding as a helix of Pitch, Turns, Hand and Direction. In space it
  winds about the source's Fiber Axis a Radius away; on a mesh about an Axis through the mesh's center (Auto, its
  longest; View; X, Y, Z), each point on the surface along its line from the axis, so it follows a tube's or a cone's
  radius and spirals to a closed mesh's pole, ending where the surface ends. Its Rise, Twist and Jitter are live on the
  last helix as on a walk. `mesoscale.grow { mode: 'helix', pitch, turns, hand, direction, axis, helixRadius }`.
- The last grow live: after a Grow, every setting of the Grow section (each mode's, Seed, On and Mode) makes that grow
  again in place, one undo step a drag; more Steps, Turns, Rings or Count continue it (every copy kept where it was),
  fewer cut it. Clear removes every grow from the source instance. `mesoscale.grow { replace }`,
  `mesoscale.clear-grown`.
- Grow › Spiral: a new fiber winding flat outward from the source, an Archimedean spiral of Spacing between its arms,
  Turns and Hand; in the source's plane in space, rolled over the surface on a mesh (ending at its edge or where its
  arms would cross). `mesoscale.grow { mode: 'spiral', spacing, turns, hand }`.
