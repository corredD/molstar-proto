# Graded cuts per part, and a part shown in part: the library half (2026-10-29, lane `graded-cuts`)

## Brief

- **Asked** (Ludo, TODO.md `Next` item 4, from the cellVIEW evaluation; wanted testable by 2026-10-29): per (clip, part)
  a cut keeps a layer (cellVIEW's +), cuts, or cuts wider (−), with a band in Å and a fuzziness that thins it toward the
  band's edge, the same instances every frame and from every view (a stable hash of the instance); with the same hash, a
  part shown in part (Shown %). The per-part mapping becomes a table (clip × part) in Mol\*'s instance clip, which lifts
  the 6 per-part cuts. **This lane is the library half**; the app half (the GradedCut and ShownInPart stories' controls)
  comes after the clips-category lane.
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
  (its shape and place), the same for every part; the per-part mapping already lives in the particle look (`cuts`, tag
  and selector), and Shown is a look of a part. So the app lane writes both through one existing operation.
- **Tests (fail first):** the rule and the hash in TS (each mode at known distances, at full strength and at the band's
  edge; the hash bit-exact with the mock's); the GLSL and WGSL hash constants match; a layers cell with more than 6 (8)
  per-part cuts gives rows and a table, none dropped; a render object with a table renders twice with the camera moved
  without re-uploading the table or the rows (the gl shim): stable across frames; Shown hides the same particles at
  every share (a lower share hides a superset). A scaling guard for the loops over particles (rows, Shown).
- **Real GL:** `?example=cellpack-hiv1` on port 1354, WebGPU and WebGL2, driven by `window.molstar.api`: the variant set
  to instance, a part keeping a layer, fuzziness raised, the camera turned (the same instances), Shown 30 %.
- **Size:** stop and report over ~600 production lines, or if the instance clip needs more than a table texture.
- **Stays off:** structures' keep-whole bits (Prism's `keep`, still 6 groups); the app's UI; `current.md`.

## Built

- **graphics** (`3c0ed1d34`): a clipping table, `Clipping.table` (rows of `Clipping.Cell`: mode `cut`, `ignore`, `keep`,
  `wider`, a band in Å, a fuzziness), a data layer `tClipTable` (`rgba32f`, 16 cells a row) with `dClipTable`; with it a
  layer's `row` is written into `tClipping` (its byte the instance's row) instead of its groups. The instance clip
  (vertex stage, `clip_instance`) runs `clipTableTest`: per clip object the row's mode, cellVIEW's rule at full
  strength, a Wang hash of `aInstance` (`clipRandom`, its top 24 bits, exact in f32); the clipping varying becomes the
  row's ignored objects (`clipTableIgnored`), so the pixel clip and caps read a 16-bit flag. WGSL and GLSL; WebGL1 a
  float hash. `Clipping.random` and `Clipping.isCut` are the same rule in TS (tested against the mock's). The table is
  re-uploaded only when its cells change (`setClippingTable`).
- **graphics** (`c3e191f1c`, found on the way): the empty layer data of eight layers was one module-level array each,
  reused by `createDataArray`: every visual of four elements or fewer wrote into the same bytes (particle targets of a
  few copies). It was the failing `paints and fades` test of the particle layers on `prism-me`.
- **plugin** (`5e0144056`): `ParticleRepresentation3DLayers.cuts` records gain `mode`, `band`, `fuzziness`, several a
  cut; `particleCutClipping` builds the rows (per object with cuts, a `(row, way)` lookup per particle; row 0 the
  particles in no cut). `MaxParticleCutIndex` is 15. A layer's `shown` hides the particles with `Clipping.random(index)`
  at or over the share, over every layer. Scaling guard: `prism/viewer/.../particles/_test/cuts.scaling.ts`.
- **prism** (`c54f0986b`): `particles.look` `cuts.add` with `mode`, `band`, `fuzziness`, parts keyed by tag and
  selector; `cuts.remove` by tag or part; `layers[].shown`; a cut reads back the union of its parts; `clipping.add`'s
  six-object refusal for particle cuts gone (the full representation is the bound). `clipping.md` §5.

**The API the app lane uses** (all through `particles.look`, one step each, undoable):

```js
const api = window.molstar.api;
await api.run('clipping.settings', { variant: 'instance' }); // graded ways are the instance clip's
const cut = await api.run('clipping.add', { shape: 'plane', node: '#<list ref>', particles: { compartments: [0, 1] } });
const tag = cut.value.object.tag;
// a part keeps a layer (+), another cuts wider (−), each with its band (Å) and fuzziness
await api.run('particles.look', { cuts: { add: [{ tag, compartments: [0], mode: 'keep', band: 60, fuzziness: 0.3 }] } });
await api.run('particles.look', { cuts: { add: [{ tag, compartments: [1], mode: 'wider', band: 80 }] } });
await api.run('particles.look', { cuts: { remove: [{ tag, compartments: [1] }] } }); // one part; [tag]: all
// a part shown in part
await api.run('particles.look', { layers: [{ selector: { compartments: [1] }, shown: 0.3 }] });
```

## Decided

- **Exposure through `particles.look`**, not `clipping.update` (the brief's narrowest option): `update` edits a clip
  object, the same for every part it cuts; the per-part mapping already lived in the particle look (`cuts`, by tag and
  selector), and Shown is a look of a part. No new operation.
- **A cut reads back** its first part as `selector` (the one `clipping.add` made, which the app's rows match), every
  part as `parts`, and the count of their union (review finding 2).
- **A cut has a record a part** (tag × selector): the mock gives one plane a membrane that keeps a layer and a capsid
  cut wider. `add` replaces the record of the same tag and selector (it replaced the tag's record before: only
  `clipping.add` wrote one, once); `remove` takes a tag or a part. A later part wins where parts overlap.
- **Band and fuzziness for `keep` and `wider` only**, as the mock and cellVIEW (mode 0 is the plain cut). Defaults: band
  60 Å, fuzziness 0.
- **The hash is of the instance's place** in the shaders (the bits of its transform's translation, `Clipping.randomAt`;
  review finding 4: `aInstance` was offset by merging) and of the particle's index for Shown (on the CPU, a
  transparency-1 layer: the existing hide, every backend and both clip variants). The same Wang hash, not the same ids:
  a part's Shown and its fuzzy band are not correlated by design.
- **Pixel variant:** the table's ignored objects become the flag (16 bits, WebGL1 too since `2b6c73ccc`), so per-part
  plain cuts work there too, past six; `keep` and `wider` cut plainly (graded is per instance by nature). Prism's
  default variant is pixel: the app lane sets `instance` where it shows graded ways (or asks Ludo for a per-cut
  variant).
- **Structures keep the groups** (Prism's `keep`, six): out of the lane.
- **Past 256 distinct rows** the layers cell fails loudly (an error in the state), not silently.
- **The empty-array fix is its own commit**, so it can go to a master lane alone (Ludo says when).

## Learned

- The renderer's image at a camera view depends on the views before it (progressive passes, Hi-Z from earlier frames):
  turning and coming back gives a different image even without cuts (a control run: ~9600 px). The stable-instance check
  isolates the graded part: the membrane alone, kept with fuzziness 0.9, turned 30°, 90°, 200° and back: 0 px.
- The particle `hidden` and Shown share the transparency layer at 1, and `transparency-data`'s shared empty array broke
  them on small targets (fixed above).
- The scratchpad is shared between sessions' agents: a lane keeps its scripts in a directory of its own.

## Size

Production +617 −140, a little over the brief's ~600: the lane +523 (graphics ~+300 with the empty-array fix's +15,
plugin +90, prism +130), then the review's fixes +78 and 16 author lines. Tests +857 −29; specs, progress and changelog
+151.

## Checked in the app (real GL)

Playwright, headless Chrome, port 1354, `?example=cellpack-hiv1` (230,158 particles), WebGPU and WebGL2
(`?graphics-backend=webgl2`), driven by `window.molstar.api`, after the review's fixes; screenshots in the session's
scratchpad (`graded-cuts-gl/`). Both backends alike, no page or shader error:

- `clipping.settings` `instance`; the blood (compartment 5) hidden; a plane cut of the virus's compartments: the inside
  shows.
- The membrane (compartment 0) `keep`, band 250 Å: a layer of membrane kept on the cut's face (24k px changed);
  fuzziness 0.9: the layer thins toward the band's edge (15k px); the capsid's surface `wider`, band 200 Å: cut further
  (11k px).
- The same instances from every view: the membrane alone, kept with fuzziness 0.9, turned 30°, 90°, 200° and back: 0 px
  changed on both backends. (The full scene turned and back changes ~9k px even without cuts, on WebGPU: progressive
  passes and Hi-Z from earlier frames; a control run showed it.)
- Shown 30 % on the capsid's surface (compartment 1): thinned (9k px); 60 %: fewer hidden; 30 % again: 0 px from the
  first 30 %.

## Review

Lane-reviewer (Opus) then lane-skeptic (Opus; a first run stopped at the spend limit, run again): 7 findings, 7
confirmed, none refuted. Every must-fix and should-fix fixed, test first, one commit each.

| Finding                                                                                                    | Severity (skeptic)    | Commit                       |
| ---------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------- |
| 1 WebGL1's 8-bit `bitwiseAnd`: a flag ≥ 256 ignored every object (objects 8–15 never tested)               | should-fix (was must) | `2b6c73ccc`                  |
| 2 `particleCutOf` joined parts into one selector, which intersects its kinds: wrong count, label           | must-fix              | `21692a1e8`                  |
| 3 author lines missing on 16 modified files                                                                | must-fix (house rule) | `e8a753b55`                  |
| 4 the hash of `aInstance` changed with merging and was shared by instance k of every target                | should-fix            | `529645fe0` (keyed by place) |
| 5 the table encoded per render object per update                                                           | nit (was should-fix)  | `5434a0da6`                  |
| N1 a part given again moved last (could change what is cut)                                                | nit+                  | `9c2683199`                  |
| N2 `shown: 1` kept as a layer                                                                              | nit                   | `9c2683199`                  |
| Open: `dClipTable` programs are not precompiled (`repr/signatures.ts`), a compile on the first graded cut  | nit                   | open (TODO for the app lane) |
| Open: the 256-row error is not tested; `empty-layer-data` leaves out size data; shader runs are by reading | nit                   | open                         |
