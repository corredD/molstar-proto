## prism-me: Mesoscale

- Grow from a fiber's unit: its "up" (its offset direction) is put along a mesh's normal, so Tiling, Sphere, the walk,
  the helix and the spiral stand as the fiber's units do.
- Paint: Place Auto goes to Surface whenever the pointer is over a mesh (any brush), a depth elsewhere.
- A fiber painted on a surface keeps its units' up along the normal as a plain walk (Twist, Jitter 0, no Offset); with a
  Twist, a Jitter or an Offset it keeps those settings.
- Grow › Helix and Spiral: Count and Turns both editable, each setting the other; Helix ends at Count copies
  (`mesoscale.grow { count }`), Spiral takes Turns (`turns`); Turns win when both are given. The grow's record keeps
  `by`, `count`, `turns` and `copies`.
- Grow › Tiling: Count in space too, filled ring by ring; Rings are gone (a session's Rings read as their count).
- Color… on a VTP colored by an array of its file leaves it alone, and says so.
