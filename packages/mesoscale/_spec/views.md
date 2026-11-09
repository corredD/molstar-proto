# MesoViewSpec: Views

## 5. Session state: what one document restores

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

  Open decision 4 is which hints beyond spheres an adapter must honour.

- **Not restored:** clipping, and annotations drawn in the viewer.
- **Copy ids are only as stable as the resolution.** A copy id (`p.catalase#12`) is valid only for one resolution key: a
  model edit can renumber copies. Selections that must survive edits should use semantic selectors, or name the copy as
  an instance (§3.13).

### 5.1 The semantic camera (v0.3, `Camera`, `Tour`)

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
  planes, not by copies, so the adapter reports it (renderer R8).
- **A numeric camera** (`position`, `target`) is read in its view's `frame`: a camera written in a tomogram's voxels
  lands where the tomogram is. Directions turn with the frame too (`up`, a `from` vector); a numeric annotation is a
  point in the view's frame.
- **`up`** written in the view turns with its frame; unstated, it is the world's y. Either way the runtime makes it
  perpendicular to the view direction, so a camera looking along y (a granule docked below the cell's centre) still has
  a defined roll.
- **Tours** step through views with durations and captions; `session.tour` names one to play.

The _Semantic camera_ story switches views (no resolver reruns; about 10 ms) and plays the tour.
