# MesoViewSpec: Scenes, views and stories

What a document says about the scene it describes, the ways to look at it, and the stories told over it; and how a story
moves through time. The concepts and terms are in [README.md](README.md); the reasons are in [design.md](design.md).

**Decided, not built** (Ludo, 2026-11-11, after David's review). No type in `format/doc.ts` changes until a lane builds
it; what each part touches is named at its end.

## Three parts, connected by ids

David (2026-11-11): "there should be the 'scene description' ('mvs snapshot'), list of snapshots in parent container,
views as 'separate but connected' things … should definitely be able to have a sequence of things, perhaps with patches
… so you can tell 'stories' on top of changing scenes". MolViewSpec has the first two (a snapshot is a whole tree; a
`multiple` file lists snapshots) and no third: a snapshot's camera is inside its tree. A MesoViewSpec document had the
third and a weak second: `views[]`, and `tours` that step through views over one unchanging scene.

| Part      | Says                                                      | Sections                                                           | Refers to                              |
| --------- | --------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------- |
| **Scene** | what exists: biology, data, how it was realized, and why  | everything but the two rows below                                  | itself                                 |
| **Views** | how to look at the scene, without changing it             | `views`, `levels`, `scales` ([views.md](views.md)), `session.view` | the scene, by MesoQL addresses and ids |
| **Story** | a sequence of steps, each a view and maybe a scene change | `stories` (replaces `tours`), `session.story`                      | views by id; the scene by patches      |

- **Separate:** a part never holds another's nodes. A view does not create copies; a story step does not hold a camera
  of its own (it names a view) and does not hold a whole scene (it holds a patch).
- **Connected:** by ids in the one namespace ([format.md](format.md#shape)). A view's addresses name scene nodes; a
  story's steps name views and patch scene nodes.
- **One file for the prototype.** The three parts stay sections of one document, as today: `classifyEdit` already tells
  a view edit from a scene edit, and Undo, the cache and the archive work on one document. Splitting them into files is
  allowed only inside a `.mesoviewx` (below), never required.
- **A snapshot** in MolViewSpec's sense is _the scene after a story's patches up to a step, seen through that step's
  view_. It is materialized when the step is shown and never stored whole.

## Stories (`stories`, replacing `tours`)

```lisp
(story st.secretion
  :steps [(:view v.cell :duration 3000 :caption "A β-cell")
          (:view v.docked :duration 4000 :caption "A granule docks")
          (:view v.docked :duration 4000 :caption "It fuses"
           :patch (patch :ops [(set i.granule-docked :fields (:location membrane))
                               (set p.insulin :fields (:compartment c.extracellular))]))
          (:view v.release :duration 5000 :caption "Insulin is released"
           :tracks [(track l.insulin :transparency [0 1] [1 0])])])
```

- **A step** is `{id?, view, duration?, caption?, transition?, patch?, tracks?}`. `view` names a view; `transition` (ms)
  is the camera's move into it, as a view's own `transition` (the step's wins).
- **`patch`** is a patch in lane 1's format ([prism.md](prism.md) §2; `set`, `remove`, `insert`, `move` by id), applied
  over the scene as the step before left it. Step k's scene is the document's scene with the patches of steps 1 to k
  applied in order. A patch may touch scene sections only: one that touches `views`, `stories` or `session` is refused
  (`story.patch`), so a story cannot rewrite itself.
- **Validated with the document** (phase `validate`, code `story.patch`, path `/stories/<i>/steps/<j>/patch`): each
  patch applies, all or nothing, to the scene before it, and every view a step names validates against the scene of that
  step (a view may name an instance a patch inserted). A patch that does not apply fails its story only; the rest of the
  document compiles.
- **Showing a step** compiles its scene through the same keyed runtime. A patch that edits a model's parameters reruns
  that model's resolver once and caches it, so stepping back and forth reruns nothing; a patch that moves an instance or
  changes a look-only field takes the view fast path. The next step may be compiled ahead while the current one plays.
- **Not the person's document.** Playing a story never edits the document and never adds an Undo step, as tours today
  (`mesoviewspec.tour.view`, [prism.md](prism.md) §4.4). "Keep this step" applies the step's patches to the document as
  one step, which Undo takes back.
- **`tours` become stories with no patches.** A document with `tours` reads as `stories` with the same steps, and
  `session.tour` as `session.story`; the writer writes `stories`. A minor version change while the format is 0.x
  ([format.md](format.md#shape)).

## Time and animation

David (2026-11-11): "still missing the animations (declarative overwrite of properties; maybe some procedural stuff) and
time abstraction(s)". Three layers, from coarse to fine:

1. **Story time:** steps, each with a `duration`. Discrete; a step's scene is fixed for its whole duration.
2. **A step's tracks:** declarative overrides of view properties over the step's duration. `tracks` is a list of
   `(track <target> <property> <keys…>)`, where the target is a look of the step's view (by its `id`, which looks have
   since lane 1), `camera` (the step's view's camera), or an annotation by id, and each key is `[t value]` with `t` in
   [0, 1] of the step's duration. Properties: a look's `color`, `transparency`, `emissive` and `visible`; the camera's
   `position`, `target` and `fov`. Values between keys are interpolated (linear by default; `:easing`). Tracks never
   change the scene: a track on a model's parameter is refused (`story.track`); a scene that changes is a patch on a
   step boundary.
3. **Clocks and procedural drivers:** a scene's own time. `clocks[]` declares named clocks, `{id, label?, unit, range}`,
   with `unit` the time the scene's data mean (`ns` of simulation, `s` of biology, a tilt series' `frame`). A model
   bound to a clock (`:clock k.sim`) is resolved at a clock time: a precomputed model with frames (Mesoscale Explorer's
   `trajectories`, an MD trajectory) reads the frame at that time; a procedural one (diffusion) steps to it. A step sets
   the clock (`:clock [k.sim 0 120]`, from 0 to 120 ns over its duration), so a story plays a trajectory as it plays a
   track. Each clock time is a resolution keyed by `(model, params, time)`, so a played range is cached and replays
   without rerunning.

- **What is wall time and what is scene time.** Durations and track keys are the viewer's time (ms, fractions of a
  step). A clock's unit is the scene's. A step maps one to the other; nothing else does.
- **Not decided:** easing names; whether a track can address copies by MesoQL rather than a look by id (a look is
  already an address); the cache's budget for clock times.

## In the archive

A `.mesoviewx` ([archive.md](archive.md)) holds the document at `index.mesoview.json`, its three parts in one file, as
above. An archive may also hold stories in files of their own, `stories/<id>.mesostory.json`,
`{format: "meso_view_spec_story", version, scene: "../index.mesoview.json", sceneRevision, story}`: a story told about a
scene by someone else, without editing it. `sceneRevision` is the scene document's `revision`; a story whose scene has
another revision still loads, and each patch that no longer applies fails its step (`story.patch`).

## What building it touches

- `format/doc.ts`: `Story`, `StoryStep`, `Track`, `Clock`; `stories`, `clocks`, `session.story`; `tours` read as
  stories.
- `format/validate.ts`: `story.patch` (patches applied in sequence, scene sections only), `story.track`, clock ranges.
- `runtime/runtime.ts`: a step's scene compiled through the cache; a clock time in the model's key.
- `molstar/src`: the tour player becomes a story player (patches, tracks, clocks); "Keep this step".
- prism-me: the Views panel lists stories.
