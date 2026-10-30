# Proteins or atoms, back where a clip is edited (2026-10-29, lane `clip-whole`)

## Brief

- **Asked** (Ludo, 2026-10-29, after #18 #20 #17 merged): "the proteins vs atoms mode for the clip disappear. So fix
  that". **Check:** load a cellPACK model (an example), cut it with a plane, pick the clip's row (Clips category) and
  find Proteins / Atoms there; pick it on both and see a protein go whole, then atoms carved; the model's own Clips has it
  too, in step with the clip's.
- **First, reproduce in a real browser** (headless Chrome, as `scripts/hidden-cost-bench.mjs` drives the page) and say
  what is missing and why, before any fix. Likely (coordinator, not verified): since #18 a clip's editor is in the clip's
  own section, and Clip whole (`properties.tsx` `Clips`, `stage.clipWholeState`) stayed only in a model's or list's
  Clips; or the control's `Show` no longer shows (`clipWholeState` undefined, `clippable`, the kind). If the cause is
  different from both, stop and report.
- **Spec:** `_spec/ui.md` Clip whole and §4 (a clip's What it cuts); `features.md` row.
- **Tests:** one that fails first: a clip on a decorated model shows Clip whole in its properties, and a pick there runs
  `stage.clipWhole` on that model (the existing `clips-category.test.tsx`, `properties.test` patterns).
- **Touches:** `apps/prism-me/src/explorer/properties.tsx` (the clip's section, What it cuts); **stays off:** the graded
  ways (lane `graded-cuts-ui`) and ghosts (lane `ghosts`), in the same section: keep the change small and in its own
  block so they merge it cleanly.
- **Size:** ~40 production lines.
- **Steps and models:** 1. reproduce (Sonnet) 2. fix with the test first (Opus) 3. checks (Sonnet) 4. gate (Opus).

## Reproduced

- Headless Chrome (Playwright, WebGL2), dev server on 1356, `?example=cellpack-hiv1`: the model's row, Clips open:
  Clip whole with Proteins and Atoms is there, before and after New clip → Plane. The Clips category's `Plane 1` row
  picked: its section is the clip's editor and What it cuts, with no Clip whole. So the first cause the brief names:
  since #18 a clip's properties are its own section (`ClipProperties`), and Clip whole stayed only in the `Clips` of a
  model or list (`properties.tsx`). `clipWholeState` and its `Show` work (the model's control shows).
- Fix: in the clip's What it cuts, each model or list it cuts that draws objects gets Clip whole, the same control on
  the same `stage.clipWhole` and `clipWholeState`, so the two stay in step.

## Built

## Decided

## Learned

## Size

## Review
