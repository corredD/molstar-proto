# MesoViewSpec: Views

What one document restores besides its data: view state, the session, and the semantic camera. The concepts and terms
are in [README.md](README.md); the reasons and the numbers are in [design.md](design.md).

## Session state: what one document restores

| Category            | Where                                   | Examples                                                                                                                                               | Persisted?                                                               |
| ------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| **Authored**        | the document, outside `views`/`session` | biology, evidence, models and their params, frames                                                                                                     | yes (the document)                                                       |
| **Derived**         | the IR, the runtime's cache             | placements, counts, issues, frame matrices                                                                                                             | no; recomputed, keyed; optionally saved as a precomputed resource (§4.5) |
| **Persistent view** | `views[]`, `session.view`               | camera, looks (color, visible, transparency) by population, entity or compartment, the selection (by population or copy id), annotations with evidence | yes (the document)                                                       |
| **Transient UI**    | the viewer                              | hover, open panels, the undo stack, the scroll position                                                                                                | never (as in SeqViewSpec: "interaction is the viewer's")                 |

`classifyEdit(prev, next)` (`runtime/runtime.ts`) returns `view` when only `views`, `session` or `metadata` differ. A
`view` edit takes the fast path, `updateView(doc, ir)`: the IR tree is reused as is, and the work is O(types).

**What the prototype restores:**

- **Restored, into the viewer** (the Prism adapter applies them):
  - the scene hierarchy (compartments, populations, models);
  - visibility, colors and transparency;
  - the camera.
- **Derived into the IR, not yet applied by the Prism adapter:**
  - the selection (by semantic id, or by copy id within one resolution): `IRView.selection`;
  - annotations: `IRView.annotations`.

  A quick test checks that switching `session.view` derives them, the looks and the camera; drawing them is adapter
  work.

- **Representations, as hints.** A look can carry `representation: spheres | structure | surface`. It is a hint with a
  fallback, in SeqViewSpec's "what, not how" sense:
  - the IR carries it (`IRLook.representation`);
  - the Prism adapter draws spheres and reports a `render`-phase issue (`representation.fallback`) for the others
    (medium-lane test, the exosome's _Lumen only_ view).

  [Open decision 4](design.md#11-what-held-what-the-prototypes-exposed-what-is-open) is which hints beyond spheres an
  adapter must honour.

- **Not restored:** clipping (decided for the document, not built:
  [Clipping](#clipping-decided-ludo-2026-11-11-after-davids-review-not-built)), and annotations drawn in the viewer.
- **Copy ids are only as stable as the resolution.** A copy id (`p.catalase#12`) is valid only for one resolution key: a
  model edit can renumber copies. Selections that must survive edits should use semantic selectors, or name the copy as
  an instance ([format.md](format.md#instances-copies-stated-one-by-one-instance)).

### The semantic camera (`Camera`, `Tour`)

David: "now we just need the semantic layer for it to control the camera". A camera can say what to look at instead of
where to stand:

```lisp
(view v.docked
  :camera (:focus (instance i.granule-docked)
           :framing context        ; close | fit | context
           :from outside           ; or a direction [x y z]
           :transition 1500)       ; ms
  :cutaway (within (population p.ribosomes) :of (instance i.granule-docked) :distance 250))

(tour t.granule
  :steps [(:view v.cell :duration 3000 :caption "A slice of a β-cell")
          (:view v.docked :duration 4000 :caption "A granule named in the document")])
```

- **`focus`** is any MesoQL address. The runtime materializes it over the resolved copies (through superstructure
  instances) into a bounding sphere (`lociSphere`, `ir/loci.ts`) and places the camera at radius / sin(fov / 2) × 0.6,
  1.1 or 2.5 for `close`, `fit`, `context`. Because it is an address, the camera follows the scene when it is
  re-resolved. An address that picks a superstructure's contents (`(population p.Vamp2)`) is read where those copies sit
  in the world, through every instance: the template is bounded once and its ball moved by each instance pose, so the
  centre is exact and the radius an upper bound (within 5 % on the β-cell); `within` reads them the same way.
- **`from outside`** looks in from beyond the scene's centre through the focus: the natural way into a cell.
- **`cutaway`** is an address for the copies to hide so the focus shows. It is materialized into the IR; Prism clips by
  planes, not by copies, so the adapter reports it ([renderer-recommendations.md](renderer-recommendations.md), R8).
- **A numeric camera** (`position`, `target`) is read in its view's `frame`: a camera written in a tomogram's voxels
  lands where the tomogram is. Directions turn with the frame too (`up`, a `from` vector); a numeric annotation is a
  point in the view's frame.
- **`up`** written in the view turns with its frame; unstated, it is the world's y. Either way the runtime makes it
  perpendicular to the view direction, so a camera looking along y (a granule docked below the cell's centre) still has
  a defined roll.
- **Tours** step through views with durations and captions; `session.tour` names one to play. Decided (2026-11-11, not
  built): tours become stories, whose steps may also patch the scene ([stories.md](stories.md)).

The _Semantic camera_ story switches views (no resolver reruns; about 10 ms) and plays the tour.

## Semantic levels (proposed, v0.5; for David and Ludo)

Decided 2026-11-11, after David's review: see
[Named bands](#named-bands-decided-ludo-2026-11-11-after-davids-review-not-built).

David (2026-11-09), on [format.md](format.md#not-in-the-document) leaving "renderer settings: representation types, LOD,
quality" out of the document: "this not being in the document might be a mistake. we want to be able to define 'semantic
LOD' at the document level", "different rules/data sources for different levels", and "it needs to be part of both Mol\*
and the document format".

**Not built.** This section was a proposal; after David's review (2026-11-11) it is decided, with the rules keyed on
named bands ([below](#named-bands-decided-ludo-2026-11-11-after-davids-review-not-built)). No type in `format/doc.ts`
changes until a lane builds it. It reopens decisions 4, 8 and 12
([design.md](design.md#11-what-held-what-the-prototypes-exposed-what-is-open)), which turn out to be one question asked
three times.

### Two kinds of level of detail

| Kind         | Says                                                                                   | Where                                          |
| ------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **Semantic** | what a thing _is_ at a scale: which representation, which detail, which data or recipe | the document (a rule), and the viewer draws it |
| **Pixel**    | how well it is drawn: quality, impostors, `lodLevels`, pixel presets, point fallback   | the viewer only (session settings)             |

Lipids drawn as the membrane's surface from afar and as molecules close up is semantic. A sphere impostor that becomes a
point below a pixel is pixel LOD ([renderer R4](renderer-recommendations.md)). Only the first is authored.

### What the document already has

Semantic LOD is not new vocabulary. Three pieces of it exist, each fixed at one value:

- **`Look.representation`** (`spheres | structure | surface`): how a look is drawn, a hint with a fallback to spheres
  and a `render` issue. One value a look, at every scale.
- **`detail`** (`parts | entity`) on a population or an instance: a superstructure's copy resolved into its contents or
  drawn as one body. One value a population, in every view (decision 8 asks whether the view should choose).
- **Streaming levels** ([streaming.md](streaming.md#streaming)): 0 statistical (counts and envelopes), 1 copies, 2
  atoms. A runtime concept, chosen by the camera and a budget, never by the document (decision 12).

### Proposal: scale rules

A scale rule says, for an address, what to show over a range of scale. Rules are ordered and the later wins, as looks
do: field by field, so one rule can set `representation` and a later one `detail` for the same copies, and where two
`size` ranges overlap the later rule's fields win. The document holds the default rules (`scales[]`, next to `views`;
not `levels`, a name streaming already uses for `TileManifest.levels`); a view may add its own, which come after.

```lisp
(scales
  (scale s.lipids-far  :select (population p.lipids)   :size (< 2)   :show (:representation surface))
  (scale s.granule-in  :select (population p.granules) :size (> 150) :show (:detail parts))
  (scale s.ribosome-at :select (entity e.ribosome)     :size (> 40)  :show (:representation structure
                                                                             :source r.ribosome-4v6x)))
```

- **`select`** is a MesoQL address, so a rule can name a population, an entity, a compartment's contents or one
  instance.
- **`size`** is the range of scale over which the rule holds, measured as the projected diameter of one copy in CSS
  pixels (device pixels divided by the pixel ratio, so a 4K screen and a laptop agree). The renderer has that measure
  every frame, it does not depend on the camera's units, and it is what R4 needs. A switch has hysteresis: a rule starts
  to hold past its threshold and stops only some margin back (the margin is the viewer's, not the document's), so a copy
  at a threshold does not flicker. A rule decides per target (a population), not per copy, until the renderer can choose
  per copy (R7, R8). (Ludo, 2026-11-09.)
- **`show`** reuses the vocabulary above:
  - `representation`: a hint, as on looks, or a fallback chain tried in order, such as `[structure surface spheres]`;
    the adapter draws the first it can and reports a `render` issue when that is not the first. Hints gain `envelope`:
    the population drawn as its level-0 envelope (a membrane as one surface). This answers decision 4; a look's
    `representation` takes a chain too. (Ludo, 2026-11-09.)
  - `detail`: `parts` or `entity`, so a granule is one body from afar and its contents close up. This answers decision 8
    per scale rather than per view.
  - `source`: another structure for the same copies over that range, a resource (a coarse model far, the atomic one
    near). It replaces the entity's structure only, never the copies: copy ids (`<population>#<ordinal>`), picks,
    selections and patches mean the same at every scale. A different recipe per scale (other copies) is not a scale
    rule. Absent, the entity's own structure. (Ludo, 2026-11-09.)
- **Copies no rule matches** keep today's behaviour: their look's representation and their population's `detail`.
- **A view's look wins over a scale rule.** A rule is a default; a view's `Look.representation` on the same copies is
  the more specific statement and is drawn. (Ludo, 2026-11-09.)

### What it changes

- **The runtime.** A rule with a `source` or a `detail` needs the other realization too, resolved up front or on demand
  as the camera crosses the threshold (decision 8's open point). Looks and the camera live in `IRView`, not the tree
  ([ir.md](ir.md)); the rules do too. The alternatives come from the document's rules only and are resolved at compile,
  keyed and cached: a view's rules choose among them (other ranges, other order) but never add one, so switching views
  still reruns no resolver (above). (Ludo, 2026-11-09.)
- **Streaming.** Semantic levels say _what_ to show; streaming levels say _what is loaded_. A rule that asks for
  `structure` close up is what makes level 2 worth loading; a rule that shows an envelope far away is level 0 drawn.
  Decision 12's "the document's sections do not move" still holds: `scales` is a new section, not a restructuring.
- **The adapter and Mol\*.** The particle representation has one set of `lodLevels` per representation. A rule needs the
  representation, detail and source chosen per target by projected size ([renderer R9](renderer-recommendations.md)).
  Until Mol\* has that, the adapter can draw each rule's alternatives as separate lists and switch their visibility with
  the camera, or report the rule (`scales.unsupported`) and draw the default.
- **Prism's graphics.** [prism.md](prism.md) §5.1 keeps representation and LOD viewer-only (`mesoscale.graphics`) and
  proposes that a remade list take its type, quality and LOD from the list it replaces. Rules would make the type
  authored where a rule applies. That section is edited after lane 4 (`mvs-drive`), which writes §5, merges.
- **Patches.** A scale rule has an `id`, as a look does, so the viewer can propose edits to it ([prism.md](prism.md)
  §2).

### Decided (Ludo, 2026-11-09), for David's review

1. `size` in projected CSS pixels, with hysteresis; per target until the renderer can choose per copy.
2. Rules in the document (`scales[]`) with view overrides that come after.
3. `source` replaces the entity's structure only; copy identity holds at every scale.
4. `envelope` is a hint, and a representation may be a fallback chain.
5. A view's look wins over a scale rule.
6. A view's rules choose among the document's alternatives; they never add one.

### Named bands (decided, Ludo 2026-11-11, after David's review; not built)

David (2026-11-11): "this should be a generic concept, that branches representation kinds depending on 'lod level' … the
lod level itself should likely be a declarative thing that is part of the 'view spec' and parametrizable". A rule above
carries its own `size` range, so two rules about the same distance repeat the numbers and a view cannot move the
threshold for all of them at once. Bands name the ranges once. (Not `levels`: that word is streaming's levels 0, 1 and
2, and `TileManifest.levels`, above.)

```lisp
(bands
  (band far  :size [0 2])
  (band mid  :size [2 40])
  (band near :size [40 inf]))

(scales
  (scale s.lipids-far  :select (population p.lipids)   :at far  :show (:representation envelope))
  (scale s.granule-in  :select (population p.granules) :at near :show (:detail parts))
  (scale s.ribosome-at :select (entity e.ribosome)     :at near :show (:representation [structure surface spheres]
                                                                       :source r.ribosome-4v6x)))

; this view switches to near later; between 40 and 120 no band holds, so the rules' defaults apply
(view v.overview :bands [(band near :size [120 inf])])
```

- **`bands[]`** is a views-part section ([stories.md](stories.md#three-parts-connected-by-ids)): ordered, ids unique,
  each `{id, size: [lo, hi)}`, half-open, in the measure above (projected CSS pixels of one copy; `inf` for no upper
  bound). Bands may not overlap (`bands.overlap`), checked in the document and again in each view after its overrides; a
  gap is allowed and no band holds there. The viewer's hysteresis applies at each bound, as for a rule's `size`.
- **A rule names a band with `:at`** (one id or a list) instead of a `size`. A rule with `size` stays valid: an unnamed
  band of its own. A rule with both is refused (`scales.shape`).
- **Parametrizable:** a view's `bands` redefine the bounds of named bands for that view (same ids, new `size`); they
  cannot add or remove one, so every rule's `:at` means something in every view.
- **Generic:** any field of `show` branches on the band: `representation`, `detail`, `source`, and any later field. A
  representation kind is chosen per band, not built into a kind.
- **Defaults:** a document without `bands` behaves as today.
- **Touches:** `format/doc.ts` (`Band`, `bands`, `View.bands`, `ScaleRule.at`), `validate.ts` (`bands.overlap`,
  `scales.shape`), `format/issues.ts` (the two codes), `IRView` (the bounds resolved per view), `classifyEdit` (a band
  edit is a view edit; a scale rule with `source` or `detail` is not view-only).

## Clipping (decided, Ludo 2026-11-11, after David's review; not built)

David (2026-11-11): "also don't see clipping in the spec". A view has `cutaway`, an address for copies to hide; clipping
by geometry was "not restored" (above). Mol\* clips per representation with one `Clip`
(`packages/core/src/util/clip.ts`: `{variant: instance | pixel, objects}`), at most 16 objects, each a plane, cube,
sphere, cylinder or infinite cone with an axis-angle rotation.

```lisp
(view v.slice
  :clip (:cut pixel
         :shapes [(plane cl.front :frame f.cell :normal [0 0 1] :point [0 0 0])
                  (box cl.core :frame f.cell :center [0 0 0] :size [800 800 200] :invert true)])
  :looks [(look l.membrane :select (population p.lipids) :clip none)])
```

- **`clip`** on a view is `{cut, shapes}`. `cut` is `copy` (the default: a copy whose centre is clipped is hidden whole)
  or `pixel` (a cross-section through molecules); it holds for the whole list. Each shape has an `id` and a frame
  (default the world), in the document's length unit: `plane` (`point`, `normal`), `box` (`center`, `size`, `rotation`;
  Mol\*'s `cube`), `sphere` (`center`, `radius`), `cylinder` (`center`, `radius`, `height`, `rotation`). Rotations are
  quaternions, as the document's poses (the adapter converts to Mol\*'s axis-angle). `invert` keeps the inside instead
  of the outside. Shapes combine as a union: a point is clipped if any shape clips it, as in Mol\*.
- **How the adapter draws `cut`**, per representation, since Mol\*'s `instance` variant tests a whole Mol\* instance's
  bounding sphere and Prism draws a population as one non-instanced spacefill list:
  - spheres (particle lists): `copy` is the `pixel` variant with `clipPrimitive` (each sphere kept or dropped whole);
    `pixel` is the `pixel` variant without it;
  - instanced representations (a copy drawn as a structure instance, as Mesoscale Explorer v1 draws every copy): `copy`
    is the `instance` variant.
- **Limits:** Mol\* holds 16 clip objects per representation, and Prism's particle layers 15 cut objects
  (`MaxParticleCutIndex`) over at most 256 tag rows. Shapes past a limit are dropped from the end and reported
  (`clip.limit`, `render`).
- **Per look:** a look may set `clip: none` (not clipped by the view's list) or its own `{cut, shapes}` (clipped by that
  instead). The adapter draws a look's clip as tagged cut objects on its target's layer (Prism's particle cuts), so two
  looks on one list may clip differently; a look whose `cut` differs from the rest of its list is drawn with the list's
  and reported (`clip.mixed`). Where two looks with different `clip` reach a copy, the later wins, as for other fields.
  A partial look is not drawn by Prism (R8), nor is its clip. A copy no look reaches is clipped by the view's list.
- **`cutaway` stays** as the address form: the copies to hide, chosen by what they are rather than where. The two
  combine: a copy is hidden if either hides it.
- **Stories:** a track can move a shape by its id (`point`, `center`, `radius`;
  [stories.md](stories.md#time-and-animation)), so a story can cut into a cell.
- **Prism-me:** the viewer's own clipping (`clipping.*`, prism.md §5) stays viewer-only until a lane maps a view's
  `clip` into it.
- **Touches:** `format/doc.ts` (`Clip`, `ClipShape`, `View.clip`, `Look.clip`), `validate.ts`, `format/issues.ts`
  (`clip.limit`, `clip.mixed`), `IRView.clip` (shapes in world coordinates), the Prism adapter (the per-representation
  mapping, look clips as particle cuts).
