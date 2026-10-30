# Proteins or atoms, back where a clip is edited (2026-10-29, lane `clip-whole`)

## Brief

- **Asked** (Ludo, 2026-10-29, after #18 #20 #17 merged): "the proteins vs atoms mode for the clip disappear. So fix
  that". **Check:** load a cellPACK model (an example), cut it with a plane, pick the clip's row (Clips category) and
  find Proteins / Atoms there; pick it on both and see a protein go whole, then atoms carved; the model's own Clips has
  it too, in step with the clip's.
- **First, reproduce in a real browser** (headless Chrome, as `scripts/hidden-cost-bench.mjs` drives the page) and say
  what is missing and why, before any fix. Likely (coordinator, not verified): since #18 a clip's editor is in the
  clip's own section, and Clip whole (`properties.tsx` `Clips`, `stage.clipWholeState`) stayed only in a model's or
  list's Clips; or the control's `Show` no longer shows (`clipWholeState` undefined, `clippable`, the kind). If the
  cause is different from both, stop and report.
- **Spec:** `_spec/ui.md` Clip whole and §4 (a clip's What it cuts); `features.md` row.
- **Tests:** one that fails first: a clip on a decorated model shows Clip whole in its properties, and a pick there runs
  `stage.clipWhole` on that model (the existing `clips-category.test.tsx`, `properties.test` patterns).
- **Touches:** `apps/prism-me/src/explorer/properties.tsx` (the clip's section, What it cuts); **stays off:** the graded
  ways (lane `graded-cuts-ui`) and ghosts (lane `ghosts`), in the same section: keep the change small and in its own
  block so they merge it cleanly.
- **Size:** ~40 production lines.
- **Steps and models:** 1. reproduce (Sonnet) 2. fix with the test first (Opus) 3. checks (Sonnet) 4. gate (Opus).

## Reproduced

- Headless Chrome (Playwright, WebGL2), dev server on 1356, `?example=cellpack-hiv1`: the model's row, Clips open: Clip
  whole with Proteins and Atoms is there, before and after New clip → Plane. The Clips category's `Plane 1` row picked:
  its section is the clip's editor and What it cuts, with no Clip whole. So the first cause the brief names: since #18 a
  clip's properties are its own section (`ClipProperties`), and Clip whole stayed only in the `Clips` of a model or list
  (`properties.tsx`). `clipWholeState` and its `Show` work (the model's control shows).
- Fix: in the clip's What it cuts, each model or list it cuts that draws objects gets Clip whole, the same control on
  the same `stage.clipWhole` and `clipWholeState`, so the two stay in step.
- Not part of it: the two `clips-category.test.tsx` failures on a clean `origin/prism-me` (#20's `cuts.add` replaces a
  record only when tag and selector both match; the app writes one merged record per tag; lane `graded-cuts-ui` fixes it
  in `me/clip-records`). In the reproduction the clip cuts the whole model (no selector) and What it cuts lists the
  model; the clip's section had no Clip whole in its code at all.

## Built

- `properties.tsx`: `ClipWhole`, the control taken out of `Clips` (a model's or list's Clips uses it as before); in
  `ClipProperties`, after Cut also, one `ClipWhole` per model or list the clip cuts (`area.cutOf`), labelled
  `Clip whole: <name>`, shown while it draws objects.
- Test (`clips-category.test.tsx`, "a clip's Clip whole"): fails before the fix (no Proteins in the clip's section:
  timeout), passes after; a pick there is one step and sets `clipWholeState`; Atoms picked in the model's Clips shows
  pressed in the clip's.
- Checked in headless Chrome on `cellpack-hiv1`: the clip's section shows
  `Clip whole: hiv1_cellpack_atom_instances.bcif` with Proteins and Atoms; Proteins → `instance`, Atoms → `element`; the
  model's Clips shows Atoms pressed after.

## Decided

- Under What it cuts, one control per model or list (named), not one for the clip: Clip whole is a setting of the
  object's representations, not of the clip; a clip can cut several.

## Learned

- The properties panel is in a shadow root: `document.body.textContent` sees none of it; Playwright's locators do. A
  clip's section opens folded the first time (`[data-section="clip"]`'s header).

## Size

- `properties.tsx` about +45 −30 (the control moved into `ClipWhole`, the clip's block 8 lines); test +41; spec,
  changelog a few lines.

## Review

- Gate: lane-reviewer 1 must-fix, 2 should-fix, 2 nits; lane-skeptic confirmed all 5, refuted none, added 1 nit.
- Fixed: the §4 table's Clip row names Clip whole (must-fix); `.v6/changelogs/clip-whole.md`; `ClipWhole` moved before
  `Clips` (no conflict with graded-cuts-ui's `properties.tsx` by `git merge-file`); the `For` keyed by ref and label (a
  renamed object's name follows).
- Left: `wholes` calls `cutOf` again where `more` did (a few objects: small); the test cuts a whole model only, not a
  part (by reading, `cutOf` returns the model for a part clip too).
- Merge note: graded-cuts-ui (`97c2f22c8`) rewrites the same §4 Clip row in `ui.md`: a conflict on that one row; keep
  both additions (its ways, then "; each model or list it cuts: Clip whole").
