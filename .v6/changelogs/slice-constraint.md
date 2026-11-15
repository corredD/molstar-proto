## prism-me: Mesoscale

- Fit and Grow on a slice: a copy painted on a volume's slice is turned like on a surface (its axis along the plane's
  normal) and, with Fit to, fitted on the plane (a shift along it, a spin, a tilt of 5° at most). Grow from it grows on
  the slice (Grow › On: "Slice of …"): Tiling, Sphere, Random walk, Spiral and Symmetry's Snap lay their copies on the
  plane, ending at the volume's box, fitted on it with Fit to; Crystal grows in space; a Helix winds about a line through
  the source, along the plane or its normal (Grow › Axis).
  `mesoscale.paint { …, slice, slicePoint, sliceNormal }`, `mesoscale.grow { …, slice, slicePoint, sliceNormal, sliceAxis }`.
