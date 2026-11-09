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

- `registerBehaviorOwned(plugin, [transformer | id, ...])` (`sources/checkpoint.ts`, exported as
  `@molstar/prism-viewer/sources/checkpoint`): per plugin, whole-id match, returns the unregister function (counted per
  id). A registered cell and what hangs from it: no outside change, left out of the data tree of a checkpoint, kept by a
  restore where its parent (and `dependsOn`) stay. `isBehaviorOwned(transform, plugin?)` is registry plus fixed list.
- A custom state's object value is measured once per object in `size()`.
- sequence.md §7.2-§7.4 describe both.

## Decided

- The fixed list is NOT left out of checkpoints, contrary to the brief's "existing behavior": the code never did (custom
  properties are the structures' parents). It stays no-outside-change per cell only. Pinned by a test.
- Descendants of a registered cell are owned too (a checkpoint tree cannot hold a child without its parent).
- No CHANGELOG line: the root CHANGELOG is Mol* 5.x and this is the v6 viewer.

## Learned

- Event order in a commit: every `cell.created`, then `cell.removed` (leaves first); a removed cell's parent is out of
  `state.tree` already, so ownership for removals comes from the transforms being removed, not a ref cache.

## Size

Production ~120 lines over checkpoint.ts (brief: ~120).

## Review

| Finding                                                                           | Severity | Verdict   | Commit / open                                                                                                                    |
| --------------------------------------------------------------------------------- | -------- | --------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Fixed-list cells' subtrees counted owned: outside changes under structures unseen | must     | confirmed | ownership commit                                                                                                                 |
| Owned-refs purge evicts refs before the same commit's removals                    | must     | confirmed | ownership commit                                                                                                                 |
| Purge quadratic                                                                   | should   | confirmed | ownership commit (set removed)                                                                                                   |
| Late registration leaves children unowned                                         | should   | confirmed | ownership commit                                                                                                                 |
| Stale owned ref hides a later cell with the same ref                              | nit      | confirmed | gone with the set                                                                                                                |
| Missing @author on two files                                                      | must     | confirmed | export/authorship commit                                                                                                         |
| Kept cell ignores dependsOn; duplicate refs                                       | should   | confirmed | dependsOn commit                                                                                                                 |
| registerBehaviorOwned not exported                                                | should   | confirmed | export commit                                                                                                                    |
| Test gaps (cell.version, measure count)                                           | should   | confirmed | export commit                                                                                                                    |
| prism.md §7.1, §9 contradict the code                                             | must     | confirmed | OPEN: outside packages/prism/viewer; coordinator updates (registry, restore keeps tiles, size per object) in a stack-only commit |
| Kept tile moves to end of parent's child order                                    | nit      | open      |                                                                                                                                  |

Counts: reviewer 4 must / 6 should / 5 nits; skeptic confirmed all, refuted none.
