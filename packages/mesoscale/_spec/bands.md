# MesoViewSpec: bands and their evaluators

**Proposed (v0.6), for Ludo, then David. Building in lane `mvs-lod-bands`.** It extends the named bands decided on
2026-11-11 ([views.md](views.md#named-bands-decided-ludo-2026-11-11-after-davids-review-not-built)): a band no longer
has to be a range of size on screen; it names an **evaluator**. David's comment, as Ludo relayed it (2026-11-20):
conditionals evaluated from the camera position and the scene state, fast to evaluate, possibly a reference to some
runtime, as `(band :evaluator … :params (…))`.

## The shape

```lisp
(bands
  ; a family: three bands of one measure, half-open ranges that do not overlap
  (band near :evaluator meso.size :range [40 inf])
  (band mid  :evaluator meso.size :range [12 40])
  (band far  :evaluator meso.size :range [0 12]
             :blend (:width 0.5 :by dither))           ; into mid, at 12 px

  ; a condition: holds or not
  (band in-cell :evaluator meso.eye-inside :params (:compartment (compartment c.cell))))

(scales
  (scale s.near-atoms :select (population p.catalase) :at near :show (:representation structure))
  (scale s.mid-atoms  :select (population p.catalase) :at mid  :show (:representation structure))
  (scale s.far-shape  :select (population p.catalase) :at far  :show (:representation [silhouette spheres]))
  (scale s.inside     :select (population p.lipids)   :at in-cell :show (:representation spheres)))

; this view keeps atoms longer: silhouettes only below 6 px, with no blend
(view v.overview
  :bands [(band far :range [0 6] :blend (:width 0))
          (band mid :range [6 40])])
```

- **`evaluator`** is an id from a registry (below), never code: a document may come from an unknown host. Its
  **`params`** are checked against the evaluator's schema (`bands.evaluator`). An evaluator the viewer does not have is
  reported (`bands.evaluator`, a warning) and its bands never hold, so their rules' defaults apply.
- **An evaluator is a measure or a test.** A measure gives a number, and its band holds over a **`range [lo hi)`**
  (half-open; `inf` for no bound). A test gives true or false, and its band holds while it is true; a test band has no
  range (`bands.shape`).
- **Families.** Bands with the same evaluator and the same params form a family. Their ranges may not overlap
  (`bands.overlap`, as decided); a gap is allowed, and no band of the family holds there. Bands of different families
  are independent: at one moment `far` and `in-cell` may both hold.
- **`:size [lo hi]`** stays valid: it is `:evaluator meso.size :range [lo hi]`. A band with both is refused
  (`bands.shape`).
- **Rules** name bands with `:at`, as decided: one id, or a list, which holds when any of its bands holds. When two
  rules that hold set the same field of the same copies, the later one wins, as decided.
- **A view** may change a band's `range`, `params` and `blend` (same id); it may not change its evaluator, nor add or
  remove a band (`bands.shape`), so every `:at` means something in every view.

## Evaluators

An evaluator is a pure function of what the viewer knows at a moment. It allocates nothing and costs O(1) per copy (a
measure per copy) or per scene. It declares a **tier**:

- **`copy`**: measured for each copy, so copies of one population may sit in different bands. Where the renderer can
  switch per copy for the representations involved, it does so on the GPU every frame; elsewhere the population is
  measured by its median copy on the camera's rest.
- **`scene`**: one value for the whole scene, evaluated on the camera's rest (the canvas camera feed, as streaming's)
  and when the view changes.

### Input

| Input    | What                                                                                      |
| -------- | ----------------------------------------------------------------------------------------- |
| camera   | eye, target, up (world Å); field of view; perspective or orthographic                     |
| viewport | width and height in CSS pixels; the pixel ratio                                           |
| copy     | its centre (world Å) and its bounding radius (Å): the entity's radius, or its structure's |
| view     | the id of the view shown                                                                  |
| scene    | the compiled document: compartments' geometry, populations                                |

### The registry (v0.6)

| Id                | Kind    | Tier  | Params                    | Gives                                                                                         |
| ----------------- | ------- | ----- | ------------------------- | --------------------------------------------------------------------------------------------- |
| `meso.size`       | measure | copy  | none                      | the copy's bounding sphere projected, its diameter in CSS pixels                              |
| `meso.distance`   | measure | copy  | none                      | the eye's distance to the copy's centre, Å                                                    |
| `meso.eye-inside` | test    | scene | `compartment`: an address | the eye is inside the compartment's geometry (a sphere, an ellipsoid, a box; a mesh: its box) |
| `meso.view`       | test    | scene | `view`: an id             | the view shown is this one                                                                    |

Ids carry a version (`meso.size@1`); an id alone means the newest the viewer has. An extension may register its own,
under its own prefix, with a schema; a document that names it opens anywhere and degrades as above.

## Blend

A band of a `copy` measure may say how it hands over to the next band of its family at its **upper bound**:
`:blend (:width w :by dither | fade)`.

- **`width`**: in octaves of the measure (doubling), centred on the bound; both bands draw inside it. 0, or no blend, is
  a hard switch with the viewer's hysteresis, as decided.
- **`by`**: `dither` gives each pixel of a copy to exactly one side by a screen-fixed pattern, so the hand-over stays
  still while zooming and orbiting; `fade` is an alpha cross-fade, for representations that cannot dither. A viewer that
  can do neither switches at the bound (`bands.blend`, info).
- Outside the blend a copy is drawn wholly on one side.
- Two blends of one family may not overlap (`bands.overlap`).
- A `scene` band has no blend: it switches with the viewer's hysteresis.

## `silhouette`

A new representation hint: each copy drawn as its outline seen from the camera's direction, filled with the copy's
color, with depth. It needs the entity's structure (or its sites); otherwise it falls back as hints do
(`[silhouette spheres]`), with a `render` issue. How a silhouette is drawn (its views, its tile size, flat or lit, far
copies thinned) is drawing quality and stays the viewer's ([views.md](views.md#two-kinds-of-level-of-detail)).

## In prism-me (lane `mvs-lod-bands`)

- **Structures:** an entity with a `structure` resource is drawn from it (its list's target); its copies are spheres
  until it loads, or if it cannot (`resource.unavailable`).
- **`structure` then `silhouette` at a `meso.size` or `meso.distance` bound** is one list with prism-me's silhouettes
  on: `lodImpostor`, `lodImpostorBy` (`size` or `distance`), and the bound as `lodImpostorPixels` or
  `lodImpostorDistance`. The switch and its blend run per copy on the GPU. Inside `structure`, the sphere levels are the
  viewer's (pixel LOD).
- **No `silhouette` rule:** `lodImpostor` off; the sphere levels alone, as today.
- **The blend width** is prism-me's 0.5 octave (`LodImpostorBand`, 0.25 each side of the bound); another width is drawn
  at 0.5 and said (`bands.blend`).
- **Scene bands** are evaluated on the camera's rest; when the bands that hold change, the lists' params are written
  again, out of History (view state, as streamed tiles), never per frame.
- **Not yet:** a switch between other representations (two lists and their visibility), `envelope`, `detail` and
  `source` per band.

## What building it touches

| Where                                    | What                                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `format/doc.ts`                          | `Band {id, evaluator?, params?, range?, size?, blend?}`, `bands`, `View.bands`, `ScaleRule` with `at`, `silhouette` |
| `format/validate.ts`, `format/issues.ts` | `bands.overlap`, `bands.shape`, `bands.evaluator`, `bands.blend`, `scales.shape`                                    |
| `runtime/bands.ts` (new)                 | the registry, the evaluators, which bands hold for a camera                                                         |
| `ir`                                     | `IRView` gets the bands as the view resolves them and the rules                                                     |
| `molstar/prism-adapter.ts`               | structures as targets; bands to `lodImpostor*`; scene bands on the camera's rest                                    |

## Open, for David

1. **And.** A rule holds when any of its `:at` bands holds. Is "far **and** outside the cell" needed in v0.6
   (`:at (all far out-of-cell)`), or is a test band per combination enough?
2. **Evaluators from extensions:** named, versioned, with a schema, and degrading when missing. Is that the "reference
   to some runtime" you meant, or did you mean code the document carries?
3. **A clock evaluator** (a band by time) belongs with stories' clocks ([stories.md](stories.md)): here, or there?
4. **Per copy beyond silhouettes:** which other switches should the renderer make per copy (spheres to an envelope,
   detail)?
