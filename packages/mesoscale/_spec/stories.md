# MesoViewSpec: Scenes, views and stories

What a document says about the scene it describes, the ways to look at it, and the stories told over it; and how a story
moves through time. The concepts and terms are in [README.md](README.md); the reasons are in [design.md](design.md).

**Decided, not built** (Ludo, 2026-11-11, after David's review). No type in `format/doc.ts` changes until a lane builds
it; what each part touches is named at its end. The rules below are written against today's `validate`, `applyPatch`,
`compile` and prism-me's cache, and say where each must change.

## Three parts, connected by ids

David (2026-11-11): "there should be the 'scene description' ('mvs snapshot'), list of snapshots in parent container,
views as 'separate but connected' things … should definitely be able to have a sequence of things, perhaps with patches
… so you can tell 'stories' on top of changing scenes". MolViewSpec has the first two (a snapshot is a whole tree; a
`multiple` file lists snapshots) and no third: a snapshot's camera is inside its tree. A MesoViewSpec document had the
third and a weak second: `views[]`, and `tours` that step through views over one unchanging scene.

| Part      | Says                                                      | Sections                                                                     | Refers to                              |
| --------- | --------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------- |
| **Scene** | what exists: biology, data, how it was realized, and why  | `metadata`, `units`, the data, the biology, the models, provenance, `clocks` | itself                                 |
| **Views** | how to look at the scene, without changing it             | `views`, `bands`, `scales` ([views.md](views.md)), `session.view`            | the scene, by MesoQL addresses and ids |
| **Story** | a sequence of steps, each a view and maybe a scene change | `stories` (replaces `tours`), `session.story`                                | views by id; the scene by patches      |

- **Separate:** a part never holds another's nodes. A view does not create copies; a story step does not hold a camera
  of its own (it names a view) and does not hold a whole scene (it holds a patch).
- **Connected:** by ids in the one namespace ([format.md](format.md#shape)). A view's addresses name scene nodes; a
  story's steps name views and patch scene nodes. `custom` stays on any node, in whichever part the node is.
- **One file for the prototype.** The three parts stay sections of one document: Undo, the cache and the archive work on
  one document. `classifyEdit` and `patch.ts` learn the new sections (an edit of `bands`, or of `stories`, is a view
  edit; a `scales` rule with `source` or `detail` is not). A story may also be a file of its own inside a `.mesoviewx`
  (below).
- **A snapshot** in MolViewSpec's sense is _the scene after a story's patches up to a step, seen through that step's
  view_. It is materialized when the step is shown and never stored whole.

## Stories (`stories`, replacing `tours`)

```lisp
(story st.granules
  :steps [(:view v.cell :duration 3000 :caption "A β-cell")
          (:view v.granules :duration 4000 :caption "Its insulin granules")
          (:view v.granules :duration 4000 :caption "Twice as many after a meal"
           :patch (patch :ops [(set p.granules :fields (:abundance (:count 240)))]))
          (:view v.docked :duration 5000 :caption "One docked at the membrane"
           :tracks [(track l.docked :emissive [0 0] [0.5 0.8])])])
; l.docked: v.docked's look of the docked granule, once the writer has given looks ids (below)
```

- **A step** is `{id?, view, duration?, caption?, transition?, patch?, tracks?, clock?}`. `view` names a view;
  `transition` (ms) is the camera's move into it and wins over the view's `camera.transition`. `duration` is 2 s when
  absent, as tours today ([prism.md](prism.md) §4.4).
- **`patch`** is a patch in lane 1's ops (`set`, `remove`, `insert`, `move` by id; [prism.md](prism.md) §2) with **no
  `base` and no `revision`**: a step patch that carries either is refused (`story.patch`). It applies over the scene as
  the step before left it, so step k's scene is the scene with the patches of steps 1 to k applied in order. It may
  touch the scene only: an op on `views`, `bands`, `scales`, `stories`, `tours` or `session`, or a `set` of the reserved
  id `document` that writes `session`, is refused (`story.patch`). Ops reach a section's top-level nodes, as every patch
  does: a superstructure's inner populations are not patchable per instance (a patch on the template changes every copy
  of it).
- **How a story is checked** (phase `static`):
  - the base document is validated without its stories, as today;
  - for each story, the step patches are applied in order, without validation between them, to the document with
    `stories` and `session.story` removed; each step's scene is then validated once, and its view against it;
  - a view that only story steps name (not `session.view`, no other reference) is skipped by the base validation and
    checked per step, so a view may name an instance a step inserts;
  - every story issue (`story.patch`, `story.view`, `story.track`, `story.clock`) is a **warning** that disables that
    story from the first failing step on, never an error: `compile` still draws the document, and `applyPatch` does not
    refuse the person's edit because a story stops applying. The person's edit that breaks a story warns; the story's
    steps up to the break still play.
- **What showing a step costs.** A step patch is always a model edit through the keyed cache: only models whose
  projection changed rerun. An instance edit reruns every procedural model, since those models avoid instances; a count
  edit reruns its model. The player compiles the next step while the current one plays.
- **The player's cache.** The story player holds its own key set beside the document's (`Session.cacheKeys` and `hold()`
  keep the document's; the player's are kept while the story plays and released when it stops), so stepping back and
  forth reruns nothing and Undo still finds the document's results.
- **Not the person's document.** Playing a story never edits the document and never adds an Undo step, as tours today
  (`mesoviewspec.tour.view`, [prism.md](prism.md) §4.4). While a step whose scene differs from the document shows, the
  document is read-only in the viewer: picks and the tree read the step's scene, and an edit first stops the story.
- **"Keep this step"** applies steps 1 to k's patches to the document and, in the same patch, removes those patches from
  steps 1 to k of the story (their views, captions and tracks stay), so the story still applies after it. One Undo step
  takes both back.
- **`tours` become stories with no patches.** A document with `tours` reads as `stories` with the same steps, and
  `session.tour` as `session.story`; the writer writes `stories`. A 0.x minor version ([format.md](format.md#shape)).

## Time and animation

David (2026-11-11): "still missing the animations (declarative overwrite of properties; maybe some procedural stuff) and
time abstraction(s)". Three layers, from coarse to fine:

1. **Story time:** steps, each with a `duration`. A step's patches are fixed for its whole duration; clocked models
   (layer 3) are the only scene that moves within a step.
2. **A step's tracks:** declarative overrides of view properties over the step's duration,
   `(track <target> <property> <keys…>)`, each key `[t value]` with `t` in [0, 1] of the step's duration. Targets and
   properties:
   - a look of the step's view, by its `id`: `color`, `transparency`, `emissive`, `visible`. `Look.id` is optional today
     and none of the examples' looks has one: a track on a look without an id warns (`story.track`), and the writer
     gives every look an id;
   - a clip shape by its `id` ([views.md](views.md#clipping-decided-ludo-2026-11-11-after-davids-review-not-built)):
     `point`, `center`, `radius`;
   - an annotation by its `id`: `visible`;
   - `camera`: `position`, `target`, `fov`, over the view's camera as resolved (`IRView.camera`, after a semantic
     `focus` is placed), so a track works on a semantic camera too.

   Numbers interpolate linearly (`:easing` names a curve, not decided); colors in linear RGB; `visible` steps at each
   key. Tracks never change the scene: a track on a scene node warns (`story.track`); a scene that changes is a patch on
   a step boundary.

3. **Clocks:** a scene's own time. `clocks[]` declares named clocks, `{id, label?, unit, frames}`, with `unit` the time
   the data mean (`ns` of simulation, `s` of biology, a tilt series' `frame`) and `frames` the times that exist (a count
   and a spacing, or a list). A model bound to a clock (`Model.clock`) has copies at each frame: a precomputed model
   with frames (an MD trajectory, Mesoscale Explorer's `trajectories`) reads them; a procedural one computes them with a
   fixed seed and step, forward only, each frame cached. A step plays a range of frames (`:clock [k.sim 0 120]`, from 0
   to 120 ns over its duration, rounded to frames).
   - **Copies keep their identity across frames:** a clocked model's count and copy order are fixed (`story.clock`
     otherwise). Its set key does not hold the time, so the adapter updates positions and rotations in place each frame
     instead of replacing lists (R5: a list costs about 36 ms to commit).
   - **No avoidance across time:** a procedural model may not avoid a clocked one (`story.clock`), or every frame would
     re-pack it.
   - **Seeking back** reads cached frames; a frame not cached replays a procedural clock from the nearest cached frame
     before it.

- **Wall time and scene time.** Durations and track keys are the viewer's time (ms, fractions of a step). A clock's unit
  is the scene's. A step maps one to the other; nothing else does.
- **Not decided:** easing names; whether a track may address copies by MesoQL instead of a look; the cache's budget for
  frames.

## In the archive

A `.mesoviewx` ([archive.md](archive.md)) holds the document at `index.mesoview.json`, its three parts in one file. An
archive may also hold stories told by someone else about that scene, without editing it: `stories/<id>.mesostory.json`,
`{format: "meso_view_spec_story", version, scene: "../index.mesoview.json", sceneRevision?, views?, story}`.

- **Its own views:** a story file may carry views of its own; their ids and the story's must not collide with the
  scene's (`story.id`, the file is refused).
- **Opened on purpose:** `session.story` names only the document's own stories; a story file is played by opening it.
- **`sceneRevision`** is advisory: a scene with another revision still loads the story, and the checks above say which
  steps still apply.

## What building it touches

- `format/doc.ts`: `Story`, `StoryStep`, `Track`, `Clock`, `Model.clock`; `stories`, `clocks`, `session.story`; `tours`
  read as stories.
- `format/validate.ts`: base validation without stories; per-story step scenes; views named only by steps;
  `format/issues.ts`: `story.patch`, `story.view`, `story.track`, `story.clock`, `story.id` (warnings, phase `static`).
- `format/patch.ts`: `Sections`, `DocOrder` and `ViewSections` gain `stories`, `bands`, `scales`, `clocks`; step patches
  applied without `base` and without validation between steps.
- `format/sexpr.ts`: the story, step, track and clock codecs.
- The writer and the builder: every look gets an `id` (`l.<view>-<n>` when none is given), so tracks can name it.
- `runtime/runtime.ts`: `classifyEdit` strips `stories` and `bands`; a clocked model's frames keyed without the time.
- `molstar/src`: the tour player becomes a story player (patches, tracks, clocks, its own held keys, read-only while a
  patched step shows); "Keep this step"; positions updated in place per frame.
- prism.md §4.4 and §5: `mesoviewspec.tour.*` become `mesoviewspec.story.*`; the Views row lists stories.
