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
  `design.md` §11 (decisions 1, 3, 4, 7, 8, 12 and a new 13), `README.md` (files).
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
