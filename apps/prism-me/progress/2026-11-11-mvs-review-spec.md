# David's review written into the spec (2026-11-11, lane `mvs-review-spec`)

## Brief

David reviewed the v0.5 proposals on 2026-11-11 (nine points, then a tenth on scenes, snapshots and views). Ludo
accepted the nine proposed answers in the status doc (all "Accept", no notes) and said yes to `.mesoviewx`. The tenth is
left to our judgement ("maybe ok for a prototype … up to your judgement").

- **Check (Ludo):** reads the changed sections; David reads them after.
- **Spec only.** No type in `format/doc.ts` changes; every section says "decided, not built" and names what building it
  touches.
- **Touches:** `views.md` (named levels; clipping), `mesoql.md` (`element` and `part`; `within :to`), a new `stories.md`
  (scene, views and stories as separate but connected; patches in a story's steps; time and animation), `format.md`
  (shape; resources `range` and `derivedFrom`; not in the document), `archive.md` (decided; stories in the archive),
  `design.md` §11 (decisions 1, 3, 4, 5, 7, 8, 12 and a new 13), `README.md` (files).
- **The nine answers** (David → the answer Ludo accepted):
  1. Semantic levels generic and declared → named levels declared once, thresholds overridable per view; scale rules key
     on a level name.
  2. MesoLocation down to atoms → `element` (an atom or residue in a copy) and `part` (a superstructure's part).
  3. `within` between a region and copies → filter first stays; `:to surface | centre | closest`, default `surface`.
  4. Animations and time → a time axis, tracks of keyframed overrides, procedural drivers as models over time.
  5. Clipping → `clip` on a view and per look: planes, boxes, spheres in a frame.
  6. Placement frames → both: plain sets baked, frames carried where a set is reused.
  7. Derived results → a `placements` range with `derivedFrom`, read through the cache.
  8. Schema → generated tables and JSON; msgpack later as a second encoding.
  9. `.mesoviewx` → archive.md's draft, decided.
- **The tenth (our call):** the document stays one file for the prototype, but its parts are three, connected by ids:
  the scene (what exists), views (how to look at it) and stories (a sequence of steps, each a view and optionally a
  patch over the scene). `tours` become stories without patches.
- **Gate:** Opus reviewer, Opus skeptic, fixes.

## Gate

Reviewer (Opus) and skeptic (Opus), read-only, on `4000bc5d8` (the skeptic on `dfe0dd0e0`); fixed in `dfe0dd0e0` and the
commit after it. R = reviewer, S = skeptic.

| Finding                                                               | Fix                                                                                                                                                             |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R M1: `part` and `residues` already exist in `format/mesoql.ts`       | a part copy is a `copy` on `part`'s virtual set key; `residues` gains a copies form; `atoms` new; type `elements`                                               |
| R M2: region filtering said to work, unbuilt                          | "the rule regions are built to"; `:of` takes a region                                                                                                           |
| R M3, S N2: phase `validate` does not exist                           | phase `static`; the codes listed for `issues.ts`                                                                                                                |
| R M4, S M1: a view naming a patch-inserted id fails the base document | views only story steps name are checked per step scene                                                                                                          |
| S M2: `story.patch` as an error blocks compile and the person's edits | story issues are warnings that disable the story from the failing step                                                                                          |
| S M3, R S3: Keep this step breaks the story                           | Keep removes the kept patches from the story in the same patch                                                                                                  |
| S M4, R S1: `base` and `revision` break the step chain                | step patches carry neither; `sceneRevision` is advisory                                                                                                         |
| R M5, S M5: wrong fast-path claims                                    | a step patch is a model edit; an instance edit re-packs procedural models                                                                                       |
| R M6, M7, S M6: clocks                                                | a step's `clock`; `Model.clock`; declared frames; set key without the time, positions in place; no avoidance of a clocked model; procedural frames forward only |
| R M8, S S2, S3, S4: track targets                                     | look ids (warn when absent), clip shapes by id, annotations' `visible`, the camera as resolved; `visible` steps; linear RGB                                     |
| R M9: `levels` reverses an earlier decision                           | renamed `bands`, half-open, overlap checked per view                                                                                                            |
| S M7, S1, R S7, S8, S N5: the clip mapping                            | per representation: spheres `pixel` + `clipPrimitive`, instanced `instance`; limits 16 and 15 over 256 rows; look clips as particle cuts; union                 |
| S S5: the example story cannot be told                                | β-cell ids and a count patch; superstructure inner nodes not patchable per instance, stated                                                                     |
| S S6: validation recursion; patch.ts sections                         | steps applied without validation to the document without stories, validated once; patch.ts and `classifyEdit` in touches                                        |
| S S7: the player's cache                                              | its own held keys; read-only while a patched step shows                                                                                                         |
| S S8: `surface` 0 inside; no compartment region                       | `surface` unsigned; a `(membrane c.x)` region                                                                                                                   |
| S S9: stream tiles carried                                            | tiles stay baked                                                                                                                                                |
| S S10, S11, S12: the archive                                          | the stored key trusted without the resolver, a sidecar; two ranges per frame, a fixed count; stored zip entries                                                 |
| R S9, S10, S12, S15, N1–N7; S N4, N6, N7                              | prism.md, streaming.md, archive.md's decided list and touches, format.md's shape and parts, element keys, story files' views, the converter's claims            |
| R S14: closest                                                        | `(nearest … :count n)`; `average` left to measurements                                                                                                          |

Open: easing names; a track by MesoQL; the frame cache budget; where Mesoscale Explorer's groups and `sizeFactor` go.
