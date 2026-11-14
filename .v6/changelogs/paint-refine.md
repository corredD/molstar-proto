## prism-me: Paint refined

- The copy under the pointer shows from the first Paint: a structure brush in a scene without particles drew no copy
  until its first stroke (Mol*'s particles are loaded first now), and a mode started under a still pointer shows its
  copy there at once.
- Paint keeps the viewer's camera: a plain left click paints one copy, a left drag a stroke; right drag, the wheel and
  the modifiers are the camera as outside Paint, Alt+left drag turns. **Alt+wheel** moves the depth. A copy at a depth
  goes at the depth of what is under the pointer (else where it was, kept in the camera's drawn range); a stroke keeps
  its first point's depth. One finger paints on a touch screen; two are the camera.
- A Random walk grows with its own **Rise**, **Twist** and **Jitter** (unset: the entity's Fiber settings), kept in its
  stroke. After a walk is grown, the Grow section's sliders redraw that fiber in place (the same path, its units made
  again), one undo step a drag: `mesoscale.grown-fiber` (a command), at most as many units as a grow makes.
- Round 2: painted on a surface (Place Surface: a mesh such as a VTP, a structure, particles), any brush's copies
  stand along the surface's normal with Turn Auto, their +z or the entity's Fiber Axis when set (a membrane protein
  stays upright), spun at random about it; at a depth as before. `mesoscale.paint` takes `surface`. A Random walk grown
  on a mesh keeps the surface's normal at each point: its units' up (their offset) follows it, on the source's side,
  turned from there by the twist.
