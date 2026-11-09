# Behavior-owned cells and custom-state size in Prism's checkpoints (2026-11-08, lane `checkpoint-owned-cells`)

## Brief

From `packages/mesoscale/_spec/prism.md` §12.2 (the `mvs-prism-design` lane). Stacked (Ludo, 2026-11-08: "just start the
work and make it usable"): this lane branches from `me/mesoviewspec` and merges back into it, not from `origin/master`.
Keep its commits to `packages/prism/viewer` only, one cause each, so they can be cherry-picked onto `origin/master` for
upstream later.

- **Check (Ludo):** none in the app; in prism-me after the cherry-pick, the volume streaming and focus cells behave as
  before (History unchanged while streaming).
- **Spec:** `packages/prism/viewer/_spec/sequence.md` §7.2-§7.4 (the behaviors' cells, the size pass); prism.md §7.1,
  §9.
- **Tests:** unit, failing first: a cell of a transformer registered as behavior-owned is no outside change and is left
  out of a checkpoint, and a restore keeps it; the existing fixed list still holds; a custom state whose value is the
  same object is measured once across checkpoints.
- **Touches:** `packages/prism/viewer/src/sources/checkpoint.ts`, its tests, `CHANGELOG.md` if it applies to 5.x.
- **Size:** ~120 production lines.
- **Lane model:** Sonnet; Opus gate.
- **Steps:** 1. the failing tests (Sonnet) 2. the registry and the filter (Sonnet) 3. the size per value (Sonnet) 4.
  checks, the gate (Opus).
- **Base:** `origin/master` (a library lane); cherry-picked into `prism-me` (or the stack) when lane 2 starts.

## Built

## Decided

## Learned

## Size

## Review

| Finding | Severity | Verdict | Commit / open |
| ------- | -------- | ------- | ------------- |
