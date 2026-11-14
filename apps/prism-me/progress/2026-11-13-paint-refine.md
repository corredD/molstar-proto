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
     a mesh, a volume's surface: the pick's point), else the camera's focus as now. On a click that starts a stroke at a
     depth, the stroke keeps the depth of its first point. Check every place Paint's input is described (the hint, the
     spec's ui.md, the help, the assistant's tool text).
3. **Undo after Grow.** A Grow is one step (`mesoscale.grow` commits one `updatePainted`), but the Undo Ludo uses does
   not take it back. Find which Undo (the toolbar's, ⌘Z, the assistant's) and why (the step's label, the history it is
   written to, a gesture grouping, the Grow button running outside the step recorder): fix it so Undo after Grow removes
   exactly that grow's copies, and Redo puts them back. Test through the same path as the button.
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
- Input: a plain wheel in Paint is not taken (the camera's); Alt+wheel moves the depth; a left drag paints; a right drag
  is not taken; the depth starts at the picked point's depth when over something, else the focus.
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

## Built

1. **The copy at the pointer from the first moment.** Cause (reproduced in the app and in a test): Mol*'s particles are
   a lazy feature; in a scene with no particle list yet the `target` representation is not registered, so a structure
   brush's copy (`pluginStructureCursor`) was a cursor that draws nothing. The first stroke loaded the feature
   (`mesoscale.paint`'s `ensureFor`), so the copy showed from the second Paint on: "the first time". The cursor loads it
   first now (dc2cfc047). Second gap: the mode knew the pointer only from its first move; the host follows the pointer's
   last place in the page and the mode shows the copy there at once (0e6b6dc95; what is under the point, not `:hover`,
   fd186ccb2).
2. **The standard camera in Paint** (701a1a10a). The layer lets the pointer through; a plain left press on the canvas
   paints (its default prevented: no mouse events reach Mol*'s input, no turn, no click); any other button, a modifier
   and the plain wheel are the camera's; Alt+left drag still turns (`withAltCamera`). **Alt+wheel** moves the depth
   (captured on the canvas's parent, kept from the canvas). Touch: one finger paints, its touch events kept from the
   canvas; two are the camera (8ea3ff012). Hint, ui.md, features.md, the Paint and Depth titles say so.
3. **Undo after Grow: not reproduced.** Tried in the app (port 1367, 1CRN painted, Tiling and Random walk from the Grow
   button): ⌘Z and ⌘⇧Z with the focus on the button, on the body, in the Seed box, in a slider's number box, with Paint
   still on and the pointer over the canvas, during a 2436-copy grow; History's Undo calls the same `history.undo`;
   Chrome and WebKit headless. Each time Undo removed exactly the grown copies and Redo put them back. No code change; a
   test pins the button's path (c2f36e792). See Open.
4. **A grown fiber's Rise and Twist.** A Random walk takes `rise`, `twist`, `jitter` (unset: the entity's); those given
   are the stroke's own (`PaintStroke.own`, over the entity's when its units are made); each grow has an `id` (in its
   value); `mesoscale.grown-fiber` sets a grown fiber's own values: the same stored path, its units made again, one step
   (bf5ca97ae). The Grow section has Rise, Twist and Jitter sliders, live on the last walk grown there through Prism's
   `gestureSteps` (one step a drag); the sliders show the drag's overlay, then the fiber's own as the state has it (an
   undo); another Grow, another source or the section closed ends it (705c8d1b3, 2a5ac99f9).

## Decided

- (Lane, per the brief's wanted behaviour) A grown fiber keeps **its own** rise, twist and jitter in its stroke; only it
  changes. `mesoscale.fiber` (the entity's) still changes every fiber of the entity that has no own value; a grown
  fiber's own values win over it. Values never set on the walk stay the entity's.
- (Lane) The depth: what is under the pointer (its pick) on hover and at the press; over nothing, where it was (the
  focus at the start), kept a radius inside the camera's drawn range as it zooms (Round 4's rule, which can move a
  picked depth near the camera too). Alt+wheel moves it and **holds it for the next stroke** (wherever it starts); after
  that stroke the pick leads again. A stroke keeps its first point's depth.
- (Lane) Alt+left drag still turns the camera in Paint: with the plain left drag painting, the default bindings leave no
  other turn. The hint says "Alt+drag to turn the camera".
- (Lane) The live fiber is the Grow section's alone (component state): no API state for it. Another source unsets Rise,
  Twist and Jitter as it unsets the lengths (review 4).
- (Lane) `mesoscale.grown-fiber` is a command, not an assistant tool (the assistant can pass the id from
  `mesoscale.grow`'s value through `run`).

## Learned

- Prism's particles feature is lazy: anything drawing a particle representation before a list exists must
  `ensureFor({ transformers: ['ms-plugin.particles-representation-3d'] })` first.
- `preventDefault` on `pointerdown` keeps Mol*'s mouse-based input out, but not its touch events; those must be stopped
  separately. Capture on the canvas's parent is the reliable way to get the wheel first.
- On WebGPU a pick is `'pending'` until the next frame: a per-frame reader must still draw with what it has.
- The Prism UI is in a shadow root: `document.querySelector` does not find the paint layer; `canvas.getRootNode()` does.

## Review (lane-reviewer, then lane-skeptic)

| Finding                                                      | Skeptic                         | Outcome                                                        |
| ------------------------------------------------------------ | ------------------------------- | -------------------------------------------------------------- |
| 1 no changelog (must)                                        | confirmed                       | fixed: .v6/changelogs/paint-refine.md (this commit)            |
| 2 progress file only the brief (must)                        | confirmed                       | fixed: this file                                               |
| 3 touch: one finger paints and turns (must)                  | confirmed                       | fixed 8ea3ff012                                                |
| 4 Rise/Twist/Jitter carried to the next source               | confirmed                       | fixed 0956a27ff (tested in 2a5ac99f9)                          |
| 5 a drag after the walk's undo runs a failing step           | confirmed                       | fixed 2a5ac99f9                                                |
| 6 the sliders jump during a drag (no overlay)                | confirmed                       | fixed 2a5ac99f9 (no timing test: checked in the app)           |
| 7 after undo, shown value and next Grow's differ             | confirmed                       | fixed 2a5ac99f9                                                |
| 8 a pending pick leaves no copy at a depth                   | confirmed (mechanism corrected) | fixed 9ca5a3cec                                                |
| 9 no cap on a grown fiber's units                            | confirmed                       | fixed 676ca3b74                                                |
| 10 item 3 untested; the undo budget unexamined (raised must) | confirmed                       | test c2f36e792; the budget: a question for Ludo (Open)         |
| 11 a menu over the canvas leaves `:hover` stale              | plausible                       | fixed fd186ccb2 (no canvas menu offers Paint with in prism-me) |
| 12 stale input text; features.md                             | confirmed                       | fixed 010a31326                                                |
| N2 the depth past the drawn range after a zoom               | plausible (new, skeptic)        | fixed 13897b708                                                |
| nit withAltCamera doc                                        | confirmed                       | fixed 010a31326                                                |
| nit Paint button title (skeptic N1)                          | confirmed                       | fixed 010a31326                                                |
| nit Alt+wheel mid-stroke moves the depth                     | confirmed (predates the lane)   | open                                                           |
| nit lone Alt on Windows (keydown guard removed)              | plausible                       | open                                                           |
| nit grown-fiber's id only in grow's value                    | partly refuted                  | kept (Decided)                                                 |
| nit hover highlight + paint's pick: two picks a frame        | plausible                       | open (not measured)                                            |
| N3 help / assistant text not checked in the record           | confirmed                       | checked: no Paint input wording outside ui.md, features.md and |
|                                                              |                                 | the mesoscale controls (grep apps/prism-me/src, mesoscale, ai) |

## Checked in the app (port 1367, headless Chrome, real pointer and wheel events)

Screenshots in
/private/tmp/claude-501/-Users-ludovicautin-molstar-proto-git/bc8a7dcf-b4ed-4027-911e-5f56df74a469/scratchpad/paint-refine/:

- First Paint: before, no copy over the canvas after Paint with 1CRN (`first-2-moved.png`); after, the copy follows the
  pointer before any stroke (`fixed1-2-moved.png`). Started under a still pointer: shown at once, the click paints there
  (`s1-started-still.png`, painted at the copy's place).
- Input: right drag pans, the wheel zooms, Alt+wheel moves the depth (camera still; hint 46 → 95 Å), Alt+left drag
  turns, a plain left drag paints with the camera still; a click on 1CRN puts the copy at the picked point
  (`i0a-zoomed-out.png`, `i1-clicked.png`, `i2-alt-wheel.png`, `i3-stroke.png`).
- Grow Tiling, ⌘Z: 37 → 1, ⌘⇧Z: 37 (`w0-tiling-undone.png`, `w1-tiling-redone.png`).
- Random walk (20 steps, 1CRN's rise 29.5 Å): Rise dragged to 24.5 Å, then Twist: the same path redrawn, one step each
  ("Set the grown fiber's rise and twist"); two ⌘Z: back to the walk as grown (`w2-walk.png`, `w3-rise.png`,
  `w4-twist.png`, `w5-undone.png`).

## Checks

`npx tsc -b` and `npx tsc --noEmit -p apps/prism-me`: clean. `pnpm lint`: clean. `pnpm format:check`: only
`progress/current.md` (fails on origin too). Tests: mesoscale and prism-me 424 passed (54 files).
`pnpm check:workspace`: fails on unbuilt lib/ exports in this worktree
(`@molstar/plugin-ui: Export pattern ./*.css has no matching files`), as expected. `graphics/gl/_test/backend-neutral`
not run (fails without this lane's change, per the brief).

## Size

About 315 production lines net (+434 / −118) against about 250. What took the room: item 4 (the operation, the own
settings, the live sliders and their read, ~190 against ~130) and the review fixes (touch, the units' cap, the sliders'
single source of truth, the pending pick, ~60); the host made with the area moved ~20 lines.

## Open

- **Item 3 (Ludo):** which Undo, which browser, which scene? Not reproduced on a small scene. One candidate: on a large
  scene Prism turns undo off ("This scene is large: undo is off", the checkpoint budget, sequence.md §7.4); painted
  strokes' positions count toward the checkpoint.
- Alt+wheel during a stroke still moves the depth mid-stroke (before this lane too).
- The lone Alt key on Windows may focus the browser's menu after an Alt+drag (the old keydown guard is gone).
- In Paint, Mol*'s own hover highlight runs beside paint's pick: two picks a frame (not measured).

# Round 2 (Ludo, 2026-11-13, via the coordinator): copies aligned to the surface

Ludo tried round 1 live: everything works. He wants the copies aligned to the surface's normal.

## Built (round 2)

1. **Paint on a surface** (b555fdaa6, f7c40658b, 7c880725d). A stroke read on a surface (Place Surface: a mesh's, a
   structure's or particles' pick) says so (`mesoscale.paint`'s new `surface`); with Turn Auto every copy of any brush
   then stands along that normal; at a depth or over nothing as before (random). **The axis rule:** the copy's own axis
   put along the normal is the entity's Fiber Axis when set, else +z; a membrane protein stays upright (+z) whatever its
   Fiber Axis (its mid-plane and grow's rule assume +z); the spin about the normal random by the stroke's seed; Side In
   flips it. The copy under the pointer turns the same (its Fiber Axis kept until the settings or the state change).
2. **Grow on a surface** (194acad89, 18ba62538). Tiling and Sphere on a mesh already put each copy's axis along its
   normal (grow-surface tests at the unit level: Tiling +z, Tiling from a tilted source's principal axis, Sphere).
   Random walk: its path followed the surface but its units only the least turn onto the path; it now keeps the
   surface's normal at each point (`PaintStroke.normals`, list frame, resampled with the path when its rise changes) and
   rolls each unit about the path so its up (the offset direction) lies along the normal, then the twist and jitter as
   before. It fits the fiber frame cleanly (one roll about the tangent a unit). The first normal faces the source's +z,
   not the mesh's winding. Crystal untouched.

## Decided (round 2)

- (Coordinator's rule) The axis along the normal: Fiber Axis when set, else +z. (Lane, review S1) not for a membrane
  protein: upright always.
- (Lane) "On a surface" is Place Surface (the stroke read on a pick); with Place Auto a non-membrane brush paints at a
  depth (the depth of what is under it, round 1) and turns at random, as the brief says. The Turn Auto title says so.

## Review (round 2: lane-reviewer, then lane-skeptic)

| Finding                                                        | Skeptic                         | Outcome                                  |
| -------------------------------------------------------------- | ------------------------------- | ---------------------------------------- |
| M1 no round-2 changelog or progress                            | confirmed                       | fixed (this commit)                      |
| S1 a membrane protein with a Fiber Axis lies on its side       | confirmed                       | fixed f7c40658b                          |
| S2 paint's +z vs grow's principal axis on a mesh (1CRN: 46.8°) | confirmed (partly pre-existing) | open: Ludo's decision                    |
| S3 Place Auto never reaches the new behaviour                  | confirmed, not a defect (nit)   | the Turn Auto title says Place Surface   |
| S4 the Fiber Axis read every frame                             | confirmed                       | fixed 7c880725d (no test: a perf rule)   |
| S5 no test of preview = painted through the real host closures | confirmed                       | open (checked in the app: painted dot 1) |
| S6 ui.md's walk paragraph                                      | confirmed                       | fixed (this commit)                      |
| S7 the walk's up from the mesh's winding, not the source       | confirmed                       | fixed 18ba62538                          |
| nit features.md; along for fiber strokes                       | confirmed                       | fixed (this commit; f7c40658b)           |
| nit a painted fiber on a surface keeps no normals              | confirmed                       | open                                     |
| nit spin frame under a rotated list (preview vs painted)       | plausible, pre-existing         | open                                     |
| nit fiberAxisVector returns shared constants                   | refuted as a defect             | kept                                     |
| N1 a made stroke keeps the path-length normals                 | confirmed, harmless             | kept                                     |

## Checked in the app (round 2, port 1367)

The HIV capsid (~/Downloads/HIV-Capsid/capsid_tiling.vtp) and 1CRN; Paint with 1CRN, Place Surface, Turn Auto: three
clicks on the capsid, each painted copy's +z · the picked normal = 1.00000 (the operation's calls read in the page,
`surface: true`); Grow from the last copy on the capsid: Tiling Count 60 (61 copies over it), Random walk 40 steps on
it. Screenshots in
/private/tmp/claude-501/-Users-ludovicautin-molstar-proto-git/bc8a7dcf-b4ed-4027-911e-5f56df74a469/scratchpad/paint-refine/:
`n-0-capsid.png`, `n-1-copy-on-surface.png`, `n-2-painted.png`, `n-3-tiling.png`, `n-4-walk.png`. Script:
~/prism-me-lanes/paint-refine-capsid.cjs. The dev server left running (the coordinator's).

## Checks (round 2)

`npx tsc -b` clean; `pnpm lint` clean; `pnpm format:check` only `progress/current.md` (as on origin); mesoscale and
prism-me tests 430 passed (54 files).

## Open (round 2)

- **S2 (Ludo):** paint on a surface puts +z (or the Fiber Axis) along the normal; Tiling and Sphere on a mesh put a
  non-membrane source's **principal axis** along it, so a tiling grown from a painted 1CRN copy is tilted ~47° against
  it. One rule: paint takes the principal axis, or grow takes +z / the Fiber Axis?
- A fiber painted on a surface (Fiber On) keeps no normals: its units' up does not follow the surface (a grown walk's
  does).
- No test through the real host that the copy shown equals the copy painted (S5).

# Round 3 (Ludo, 2026-11-13, via the coordinator)

## Built (round 3)

1. **Tiles not aligned to the surface** ("after placing an instance on a surface with painting, then grow tiling, the
   tiled instances are not aligned"). Cause 1 (reproduced in a test, 0.68 = cos 47°): on a mesh, Tiling and Sphere
   turned a non-membrane source's **principal axis** onto the normal, paint its +z (round 2's S2): 1CRN's principal axis
   is ~47° off +z, so every tile stood tilted against the copy it grew from. On a mesh Tiling, Sphere and the walk's
   first normal now take paint's axis (797eb3430); in space (On None) Tiling's plane is still the principal axis's.
   Cause 2, checked: Grow's On defaulted to the capsid after a paint (Place Surface and Place Auto alike) in the app;
   the one way it stayed wrong was a copy painted again at the same index after an undo (setGrowSource returned early):
   On now follows it, onto a mesh (29c09f799) or off it (17d3529fc); the same source picked by its right-click keeps the
   person's On.
2. **Paint on opens its Paint section** (d31cfc2bc, 3594173c9). The toggles: the Paint/Stop button in the Paint section
   (controls.tsx PaintBrush) and the row's right-click Paint with (menu.ts paintItems); no ⌘K command or assistant tool
   starts the mode (`mesoscale.paint` paints a stroke), a script through `paintMode.start` does. All set the mode's
   brush: the explorer follows it, picks the brush's row (an entity's `me:`, a structure's `o:`), opens its Paint
   section and brings it into view. Off leaves the panel. A brush with no row yet keeps the pick; pressed in the section
   itself it only scrolls.

## Review (round 3: lane-reviewer, then lane-skeptic)

| Finding                                                        | Skeptic                             | Outcome             |
| -------------------------------------------------------------- | ----------------------------------- | ------------------- |
| 1 ui.md 566/568, Paint-on not in the spec, no changelog (must) | confirmed                           | fixed (this commit) |
| 2 repainted in space at the same index: On stays the mesh      | confirmed                           | fixed 17d3529fc     |
| 3 a fiber unit as the source: its axis is tangent to the mesh  | confirmed, wider (every fiber unit) | open (below)        |
| 4 the pick cleared for a brush with no row                     | confirmed / plausible               | fixed 3594173c9     |
| 5 Paint pressed in its section remade the properties           | confirmed                           | fixed 3594173c9     |
| 6 a section not found stays asked for (raised should)          | confirmed                           | fixed 3594173c9     |
| 7 meshUnder computed then discarded                            | confirmed                           | fixed 17d3529fc     |
| 8 the scrollIntoView stub not in a finally                     | confirmed                           | fixed 3594173c9     |
| 9 the brush subscription never unsubscribed                    | plausible (a UI re-attach)          | open                |
| N1 a source painted with Turn Axis/View/Random is turned too   | plausible (since grow-mesh)         | open                |
| N2 a fiber unit's walk side should be its offset direction     | confirmed                           | open (with 3)       |

## Checked in the app (round 3, port 1367)

The HIV capsid VTP and 1CRN: Paint with 1CRN, Place Surface, three clicks on the capsid, then the Grow section's Tiling
and its Grow button: On showed capsid_tiling.vtp; 36 tiles; each tile's +z against its nearest triangle's normal ≥
0.9995, the source's 1.0000 (the VTP read in node). With Place Auto: On the capsid too. Screenshots in
/private/tmp/claude-501/-Users-ludovicautin-molstar-proto-git/bc8a7dcf-b4ed-4027-911e-5f56df74a469/scratchpad/paint-refine/:
`n-6-tiling-aligned.png`, `n-6-tiling-aligned-place-auto.png`. Paint on from a script with no row picked: the 1CRN row
picked, its Paint section open (`n-5-paint-panel.png`). Scripts: ~/prism-me-lanes/paint-refine-capsid6.cjs,
paint-refine-panel.cjs.

## Checks (round 3)

`npx tsc -b`, `npx tsc --noEmit -p apps/prism-me`: clean; `pnpm lint` clean; `format:check` only `progress/current.md`
(as on origin); mesoscale and prism-me tests 433 passed (54 files).

## Open (round 3)

- A fiber painted on a surface: its units' axis follows the path (tangent), so a Grow from its last unit turns the
  copies ~90° off it and the walk's side is the winding's (reviews 3, N2). One rule for a fiber unit as a source (its
  offset direction as its up?) is a decision.
- A source painted with Turn Axis, View or Random is turned onto the normal by grow on a mesh anyway (N1, since
  grow-mesh).
- The explorer's brush subscription lives as long as the viewer (a UI re-attach would add one).
