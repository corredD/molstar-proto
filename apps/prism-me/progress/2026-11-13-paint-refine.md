# Lane `paint-refine`: paint's pointer, camera, grow's undo and a grown fiber's rise and twist (2026-11-13)

Ludo, 2026-11-13: "before moving on here are some refinement to do on the current painting.
1. when clicking painting with the first time the target doesnt appear at the mouse.
2. the default mouse behaviour need to be inversed. we keep the standard mouse camera, except for the click to paint,
   and the wheel need alt to move on Z the target. By default the initial Z is at the clicked target Z.
3. Undo need to apply to the grow button.
4. The grow fiber need the same twist/rise parameters, and we should be able to change them interactively after the
   growth. OR use a update button next to grow."

Asked and answered (2026-11-13):
- A left drag in Paint **paints a stroke** (a left click one copy). The rest is the standard camera: the other buttons
  and modifiers as the viewer's default (rotate, pan), the wheel zooms; **Alt+wheel** moves the target's depth.
- A grown fiber's Rise and Twist: **live on the last grow** (the same path redrawn in place, one undo step a drag), not
  an Update button.

Branch `me/paint-refine` from `origin/prism-me` (eb77182ab). Local until Ludo signs off; then into `prism-me`.

## Brief

**What Ludo sees.**

1. **The copy under the pointer from the first moment.** Entering Paint (the button, a structure's Paint with, a
   right-click) shows the copy under the pointer at once, before any move or with the pointer already over the canvas.
   Today it does not appear at the mouse on the first click. Find the cause (likely: no pointer position until the first
   `pointermove`, or the brush/host not ready when the first event lands, or the first click consumed by the mode's
   start) and fix that; test it through the mode with a recorded first event.
2. **The standard camera in Paint.** Today Paint takes the mouse (camera on Alt; the wheel moves the depth:
   mesoscale/src/paint-mode.ts ~256–451). Inverted:
   - left click: one copy; left drag: a stroke (as now);
   - every other gesture is the viewer's camera as outside Paint (right/middle drag, modifiers, the wheel zooms);
   - **Alt+wheel**: the target's depth (the hint says so: "Alt+wheel: depth 812 Å");
   - **the initial depth** is the depth of what is under the pointer when it is over something (a particle, a structure,
     a mesh, a volume's surface: the pick's point), else the camera's focus as now. On a click that starts a stroke at
     a depth, the stroke keeps the depth of its first point.
   Check every place Paint's input is described (the hint, the spec's ui.md, the help, the assistant's tool text).
3. **Undo after Grow.** A Grow is one step (`mesoscale.grow` commits one `updatePainted`), but the Undo Ludo uses does
   not take it back. Find which Undo (the toolbar's, ⌘Z, the assistant's) and why (the step's label, the history it is
   written to, a gesture grouping, the Grow button running outside the step recorder): fix it so Undo after Grow
   removes exactly that grow's copies, and Redo puts them back. Test through the same path as the button.
4. **A grown fiber's Rise and Twist.**
   - Random walk's params gain **Rise** and **Twist** (and Jitter if cheap), defaulting to the entity's fiber settings
     (its rise, else touching; its twist) instead of reading them only from there.
   - After a walk is grown, changing Rise or Twist in the Grow section **redraws that last grown fiber in place**: the
     same walk path (stored), its units made again at the new rise and twist; a slider drag is one undo step (the
     gesture steps used elsewhere). Only the last grow of the session's Grow section is live; another Grow, another
     source or leaving the section ends it.
   - Decide and say in Decided whether the grown fiber keeps its own rise/twist (stored in its stroke, as a painted
     fiber's own) or writes the entity's (`mesoscale.fiber`, which rebuilds every painted fiber of the entity). The
     wanted behaviour: only the grown fiber changes.

## Tests (each first failing)

- The first event: a mode started with the pointer over the canvas shows the copy at that point before any move; the
  first click paints where it was shown.
- Input: a plain wheel in Paint is not taken (the camera's); Alt+wheel moves the depth; a left drag paints; a right
  drag is not taken; the depth starts at the picked point's depth when over something, else the focus.
- Undo: Grow, then the app's Undo (the path Ludo uses) removes exactly the grown copies; Redo restores them.
- A walk with Rise r and Twist t: its units r apart, each turned t; then Rise changed: the same path, units at the new
  rise, one undo step; other fibers of the entity unchanged.

## Check in the app

1CRN loaded; Paint entered with the pointer already over the scene: the copy shows at once. Rotate and zoom with the
mouse while in Paint; Alt+wheel moves the copy in depth; a click on a particle starts at its depth. Grow (Tiling), Undo:
gone, Redo: back. Grow a Random walk, drag Rise and Twist: the same fiber redraws.

## Size

About 250 production lines: the first event ~20, the input inverted and the picked depth ~70, undo ~30, the walk's rise
and twist and the live redraw ~130.

## Model

Opus: the input mode and the live redraw are design work.
