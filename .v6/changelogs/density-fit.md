## prism-me: Mesoscale

- Paint on a slice: a click on a volume's slice paints the copy's center on the slice, its normal the plane's.
- Paint › Fit to and Contrast: each painted copy fitted to a volume's density (a shift and a turn within a third of its
  radius and 15°, pulled back toward the click; its score the density inside the copy's envelope minus a shell about
  it, in σ, Dark or Bright). Auto fits to the volume whose slice is under the pointer. The copy under the pointer shows
  the fitted pose, the hint its fit ("fit 2.4σ, 3.1 Å, 8°"). `mesoscale.paint { fit, contrast }`.
- Grow › Fit to, Contrast and Threshold: every grown copy fitted (a sixth of its radius, 7.5°) and kept above Threshold
  × the source's score, in every mode; Count counts the copies kept. The poses are stored with their fit
  (`fit: { score, shift, angle }`), so a session keeps them without the volume. `mesoscale.grow { fit, contrast,
  threshold }`.
