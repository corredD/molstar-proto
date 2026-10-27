# A clip's numbers (2026-10-27)

Lane `me/clip-params` (`~/prism-me-lanes/clip-params`), from Ludovic's request: "a small icon on a clip's line that
toggles its parameters (position, rotation, scale), next to the visibility and On top buttons".

## Built

- Prism (its own commit): `CutPreview` (`sources/clipping/preview.ts`) on the clip gizmos' binding, exposed as
  `clipping.previewCut` / `endPreview`, with `boundsOf(cut)` and `cone`; clipping.md §4. Test:
  `features/clipping/_test/preview.test.ts`.
- prism-me: a `sliders-horizontal` toggle in each clip's line (between its handles and On top), view state per row (no
  operation, no step); open, `ClipSliders`: X, Y, Z (Å, around what it cuts), Turn X, Y, Z (°), the shape's size. A
  slider previews, its release or a typed value is one `clipping.update` by the clip's tag. Test:
  `explorer/_test/clip-numbers.test.tsx`.

## Decided

- The same pattern as Position's numbers (its `sliders-horizontal` toggle and `PoseSliders`), not Prism's Clipping tab
  `CutForm` (a ParamsForm of position, a direction and a size): the request named position, rotation and scale, and the
  form's sliders set the cut at every frame of a drag (a step a frame), against "a gesture previews and commits once".
- Turn as Euler angles X, then Y, then Z, through the stage tools' `poseOf` and `placementWith` (Position's own), so the
  two read alike by construction; a test checks two turns against Ry·Rx made by hand. Read back from the cut's axis and
  angle: Y reads in −90…90, a turn typed past it reads as its equal with X and Z flipped (as Position's).
- A plane has no size (its scale is not used); a cone's size is its half-angle (1–89°).
- The X, Y, Z reach is fixed when opened (what it cuts, 1.5 × its radius, at least 10 Å), as Position's; typed values go
  past it (`clamp={false}`).

## Learned

- An icon-only `Button` puts its title into `aria-label`, not `title`.
- A new plane faces the viewer: its turn is not zero.
- `Euler.set` in `@molstar/core` writes the first angle three times (`out[0] = x; out[0] = y; out[0] = z`): a library
  fix of its own, from master, with a test (to TODO). Not used here.
- A typed box shows what was typed at once: a test waits for the state, not the box.

## Review

| Finding                                                                           | Severity   | Verdict   | Fixed by                                          |
| --------------------------------------------------------------------------------- | ---------- | --------- | ------------------------------------------------- |
| S1 no preview end when the sliders go; stale captured params after a state change | should-fix | confirmed | the view's cleanup; `CutPreview` ends on a change |
| S2 an `endPreview` after an awaited commit ends a newer gesture's preview         | should-fix | confirmed | tokens; the commit in `try/finally`               |
| S3 the preview's races untested (burst, switch, end during flight)                | should-fix | confirmed | `preview.test.ts` (a mutant without it fails)     |
| S4 the app's drag test never previewed                                            | should-fix | confirmed | waits for the live representation, then releases  |
| S5 the turn test did not pin the order                                            | should-fix | confirmed | two turns against Ry·Rx; the order now Position's |
| N6 Turn Y past ±90 reads back flipped                                             | nit        | confirmed | documented (as Position's)                        |
| N7 allocations per frame in the turn's conversion                                 | nit        | confirmed | module scratch (poseOf still allocates its pose)  |
| N8 the cone's label                                                               | nit        | confirmed | "Half-angle", as Prism's form                     |
| N9 the gizmo lags the preview                                                     | nit        | confirmed | clipping.md §4 says so                            |

Reviewer (Opus, read-only): 0 must-fix, 5 should-fix, 4 nits. No separate skeptic: each should-fix was checked by its
test (S3 by a mutant). S5: the two-turn check first failed by timing (it read the cut before the commit landed); the
turn now goes through the stage tools' functions, so whether Mol*'s Euler `'ZYX'` path agreed was not settled.

## Size

Production ~250 lines (Prism ~95, explorer ~155) against a ~150 estimate: the per-shape sizes and the Euler conversion
took the room. Tests ~230.
