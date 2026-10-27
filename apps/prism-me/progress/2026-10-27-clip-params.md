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
- Turn as Euler angles X, then Y, then Z (`'ZYX'` in Mol*'s `Euler`), as Position's Turn. Read back from the cut's axis
  and angle, so a turn near ±90° on Y may read in another, equal, decomposition.
- A plane has no size (its scale is not used); a cone's size is its half-angle (1–89°).
- The X, Y, Z reach is fixed when opened (what it cuts, 1.5 × its radius, at least 10 Å), as Position's; typed values go
  past it (`clamp={false}`).

## Learned

- An icon-only `Button` puts its title into `aria-label`, not `title`.
- A new plane faces the viewer: its turn is not zero.

## Size

Production ~250 lines (Prism ~95, explorer ~155) against a ~150 estimate: the per-shape sizes and the Euler conversion
took the room. Tests ~230.
