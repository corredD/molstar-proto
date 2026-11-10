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

- **Not restored:** clipping, and annotations drawn in the viewer.
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
- **Tours** step through views with durations and captions; `session.tour` names one to play.

The _Semantic camera_ story switches views (no resolver reruns; about 10 ms) and plays the tour.

## Semantic levels (proposed, v0.5; for David and Ludo)

David (2026-11-09), on [format.md](format.md#not-in-the-document) leaving "renderer settings: representation types, LOD,
quality" out of the document: "this not being in the document might be a mistake. we want to be able to define 'semantic
LOD' at the document level", "different rules/data sources for different levels", and "it needs to be part of both Mol\*
and the document format".

**Not built.** This section is a proposal: no type in `format/doc.ts` changes until it is agreed. It reopens decisions
4, 8 and 12 ([design.md](design.md#11-what-held-what-the-prototypes-exposed-what-is-open)), which turn out to be one
question asked three times.

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

### Proposal: level rules

A level rule says, for an address, what to show over a range of scale. Rules are ordered and the later wins, as looks
do. The document holds the default rules (`levels[]`, next to `views`); a view may add its own, which come after.

```lisp
(levels
  (level l.lipids-far  :select (population p.lipids)   :size (< 2)   :show (:representation surface))
  (level l.granule-in  :select (population p.granules) :size (> 150) :show (:detail parts))
  (level l.ribosome-at :select (entity e.ribosome)     :size (> 40)  :show (:representation structure
                                                                             :source r.ribosome-4v6x)))
```

- **`select`** is a MesoQL address, so a rule can name a population, an entity, a compartment's contents or one
  instance.
- **`size`** is the range of scale over which the rule holds, measured as the projected diameter of one copy in pixels.
  The renderer has that measure every frame, it does not depend on the camera's units, and it is what R4 needs. Open: a
  camera distance in the document's length unit instead or as well; named levels (`cell`, `organelle`, `molecule`) that
  a view picks.
- **`show`** reuses the vocabulary above:
  - `representation`: a hint, as on looks, falling back to spheres with a `render` issue. Open: an `envelope` hint (the
    population's level-0 envelope, a membrane as one surface) and a fallback chain (decision 4, SeqViewSpec's).
  - `detail`: `parts` or `entity`, so a granule is one body from afar and its contents close up. This answers decision 8
    per scale rather than per view.
  - `source`: a different realization over that range: a model id (another recipe or resolver) or a resource (another
    structure, such as a coarse model far and the atomic one near). Absent, the copy's own entity and model.
- **Copies no rule matches** keep today's behaviour: their look's representation and their population's `detail`.

### What it changes

- **The runtime.** A rule with a `source` or a `detail` needs the other realization too, resolved up front or on demand
  as the camera crosses the threshold (decision 8's open point). Proposed: rules compile into the IR as one `levels`
  node that lists, per placement set, the alternatives and their size ranges. The alternatives resolve lazily and are
  cached like any model.
- **Streaming.** Semantic levels say _what_ to show; streaming levels say _what is loaded_. A rule that asks for
  `structure` close up is what makes level 2 worth loading; a rule that shows an envelope far away is level 0 drawn.
  Decision 12's "the document's sections do not move" still holds: `levels` is a new section, not a restructuring.
- **The adapter and Mol\*.** The particle representation has one set of `lodLevels` per representation. A rule needs the
  representation, detail and source chosen per target by projected size ([renderer R9](renderer-recommendations.md)).
  Until Mol\* has that, the adapter can draw each rule's alternatives as separate lists and switch their visibility with
  the camera, or report the rule (`levels.unsupported`) and draw the default.
- **Patches.** A level rule has an `id`, as a look does, so the viewer can propose edits to it ([prism.md](prism.md)
  §2).

### Open for David and Ludo

1. Is `size` measured in projected pixels, as a camera distance, as named levels, or more than one of these?
2. Rules at the document level with view overrides (proposed), or in views only?
3. Does `source` replace only the entity's structure, or the whole realization (a different model, other copies)? The
   second lets a far view use a statistical recipe and a near one a packed recipe for the same population.
4. Is `envelope` a representation hint, and does the document state a fallback chain?
