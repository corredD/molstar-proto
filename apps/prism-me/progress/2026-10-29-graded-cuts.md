# Graded cuts per part, and a part shown in part: the library half (2026-10-29, lane `graded-cuts`)

## Brief

- **Asked** (Ludo, TODO.md `Next` item 4, from the cellVIEW evaluation; wanted testable by 2026-10-29): per (clip,
  part) a cut keeps a layer (cellVIEW's +), cuts, or cuts wider (−), with a band in Å and a fuzziness that thins it
  toward the band's edge, the same instances every frame and from every view (a stable hash of the instance); with the
  same hash, a part shown in part (Shown %). The per-part mapping becomes a table (clip × part) in Mol\*'s instance
  clip, which lifts the 6 per-part cuts. **This lane is the library half**; the app half (the GradedCut and ShownInPart
  stories' controls) comes after the clips-category lane.
- **Spec:** [../\_spec/cellview.md](../_spec/cellview.md) §4.1 (cellVIEW's object-space cut, its `T(p)` test and Wang
  hash); the mock's rule, `isCut` and `stableRandom` in `src/_stories/proposed.tsx`; Prism's clipping spec
  (`packages/prism/viewer/_spec/clipping.md` §5, cuts of some particles).
- **What changes:**
  - **graphics:** a clipping table, per (row, clip object) a mode (cut, ignore, keep a layer, cut wider), a band (Å) and
    a fuzziness, as a data layer (`tClipTable`) beside `tClipping`; with it (`dClipTable`), an instance's clipping value
    is its row, not a bit mask of the objects it ignores. The instance clip (vertex stage) tests each object by the
    row's mode, cellVIEW's rule at full strength, with a Wang hash of the instance; the pixel clip reads the row's
    ignored objects (16, not 6), its graded modes cutting plainly. Both WebGPU (WGSL) and WebGL2 (GLSL); WebGL1 keeps
    the plain cut.
  - **plugin:** the particle layers' cuts (`ParticleRepresentation3DLayers.cuts`) gain `mode`, `band` and `fuzziness`
    (`cut` by default: old records read unchanged), several parts a cut; they become rows of the table (distinct
    combinations, deduplicated), up to the 16 clip objects a representation has. A layer gains `shown` (0–1): the
    particles whose stable random is at or over it are hidden, over every layer.
  - **prism:** `particles.look` carries them (`cuts.add` with `mode`, `band`, `fuzziness`; a layer's `shown`); a cut's
    parts keyed by tag and selector; the per-part cut limit is the clip objects' 16.
- **Exposure, the narrowest option:** `particles.look`, not `clipping.update`. `clipping.update` edits a clip object
  (its shape and place), the same for every part; the per-part mapping already lives in the particle look (`cuts`,
  tag and selector), and Shown is a look of a part. So the app lane writes both through one existing operation.
- **Tests (fail first):** the rule and the hash in TS (each mode at known distances, at full strength and at the band's
  edge; the hash bit-exact with the mock's); the GLSL and WGSL hash constants match; a layers cell with more than 6 (8)
  per-part cuts gives rows and a table, none dropped; a render object with a table renders twice with the camera moved
  without re-uploading the table or the rows (the gl shim): stable across frames; Shown hides the same particles at
  every share (a lower share hides a superset). A scaling guard for the loops over particles (rows, Shown).
- **Real GL:** `?example=cellpack-hiv1` on port 1354, WebGPU and WebGL2, driven by `window.molstar.api`: the variant
  set to instance, a part keeping a layer, fuzziness raised, the camera turned (the same instances), Shown 30 %.
- **Size:** stop and report over ~600 production lines, or if the instance clip needs more than a table texture.
- **Stays off:** structures' keep-whole bits (Prism's `keep`, still 6 groups); the app's UI; `current.md`.

## Built

## Decided

## Learned

## Size

## Review
