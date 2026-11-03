# Lane `unbounded-interval` (prism-me): an interval without bounds is two number fields (2026-11-03)

Worked on the integration branch `me/cryoet-volume` (PR #41), port 1346.

## Brief

Ludo, 2026-11-03: "the coloring of the volume (slice) domain slider doesn't go in negative values, only positive."
`IntervalControl` took a missing `min`/`max` as 0 and 1; the volume-value theme's custom domain is
`PD.Interval([-1, 1], { step: 0.001 })`, no bounds.

## Built

- `IntervalControl`: both bounds, the two-knob track as before; otherwise `IntervalFields`, from and to as number fields
  (any value, a comma as the decimal point), the ends never crossing. As v5's `ParameterControls` dispatch.
- `NumberField` (slider.tsx): the text number field out of `NumberControl`, shared by both.
- `setEnd` / `endLabel`: one end rule for the knobs and the fields; an end that does not move sets nothing.
- Spec: styling.md (Shared controls); story: `Domain (interval, no bounds)`; changelog `unbounded-interval.md`.

## Decided

- Step 2 of the brief (the theme's domain bounded by the data's range) skipped: with `isRelative` the domain is in σ, so
  the bounds depend on another param; `getVolumeValueColorThemeParams` returns the shared object; and it is a
  `packages/graphics` change (a library lane from master).
- The ends cannot cross (the brief), unlike v5's fields, where a crossed domain reverses the color scale (review X1).
  Ludo's call if he wants reversal back.

## Learned

- TS_08's slices start with a custom domain of about ±0.034: under the old control it was a 0..1 slider whose low knob
  sat at 0. In the app, [-3, 3] and [-0.1, 0.02] apply (screenshots in the session scratchpad `interval/`).
- Prism's UI is in a shadow root: `document.querySelectorAll` finds no inputs; Playwright locators do.

## Review gate

| Finding                                                                       | Skeptic                    | Fixed by                                        |
| ----------------------------------------------------------------------------- | -------------------------- | ----------------------------------------------- |
| M1 `@author` line missing in four modified files                              | confirmed                  | 0f851d9db                                       |
| S2 an end set to the value it has fires `onChange` (both paths, slider older) | confirmed (probe)          | c4d8c144d                                       |
| S3 the end label and the no-crossing rule repeated                            | confirmed                  | c4d8c144d                                       |
| N4 the watch count and axe form only had a bounded interval                   | confirmed (lowered to nit) | b4725e558                                       |
| N5 the fallback is `defaultValue`, not `[min, max]`                           | refuted                    | —                                               |
| N6 the shown value rounded to the step, the stored one not                    | nit, pre-existing          | open                                            |
| X1 (skeptic) the ends cannot cross, unlike v5's; docs said "as v5's"          | confirmed                  | 7c5815a2d (docs; the clamp kept, per the brief) |
