# Lane scene-sync-undo (2026-11-05)

Library branch `me/scene-sync-undo` (from `origin/master`, worktree `~/prism-me-lanes/scene-sync-undo`), prism-me branch
`me/scene-sync-undo-pm` (from `origin/prism-me`, worktree `~/prism-me-lanes/scene-sync-undo-pm`).

## Asked

The night review's must-fix B1 (`progress/2026-11-05-night/review-cryoet.md`): the undo of a cryoet load (a tomogram and
a point list in one step) throws `TypeError: Cannot read properties of undefined (reading 'size')` at
`StateTree.getDecoratorRoot`, from prism-viewer's scene sync. So does any single update that removes a volume and a
particle list (`build().delete(volume).delete(list).commit()`). Fix it at the cause, in the library, test first; decide
whether a guard in `getDecoratorRoot` is also warranted.

## Built

- Library, test first (`packages/prism/viewer/src/sources/_test/scene.test.ts`, "one state update removes a volume and a
  particle list"): five cases, each red on master with the same TypeError, read from RxJS's `config.onUnhandledError` (a
  subscriber's error reaches no caller; RxJS reports it on a timer): a volume and a list deleted together; the undo of a
  load that made both; a structure and a list; a measurement and a list; streaming made in the update that removes a
  list.
- Library fix (`packages/prism/viewer/src/sources/scene.ts`): one deferral, `syncWhenDone`, the one the shapes already
  had (`syncShapes`, now gone). Every sync the scene takes from an event (the structure, volume and particle
  hierarchies' `selection`, the measurements' state, the shapes' objects, the streaming cells) waits for the data
  state's `isUpdating` to fall, then runs once. 17 production lines added, 25 removed.
- prism-me: the same two commits cherry-picked with `-x`, and a cryoet test
  (`packages/extensions/cryoet/src/_test/portal.test.ts`, "undoes a load of a tomogram and a point list"):
  `cryoetPortal.load` with `as: 'slices', annotations: '5'`, then `history.undo`, no error and no rows. It fails with
  the TypeError on prism-me without the fix.

## Decided

- **The cause, corrected.** The reviewer's chain is right for the volume, but the volume manager is not the only one
  that tells inside the update. `State._updateTree` emits `events.changed` while `_inUpdate` is true; every manager
  subscribed to it syncs then (`sync(true)` ignores `inUpdate`) and notifies, in the order they are built: structure
  hierarchy, measurements, volume hierarchy, particle hierarchy. Each subscriber that reads another hierarchy's
  `current` before that one's turn gets the tree from before (`sync(false)` returns during `inUpdate`). So a structure
  and a list removed together threw the same way (through the structure `selection` subscription, `scene.ts:1794`), and
  so did a measurement and a list. The streaming cells' `cell.created` / `cell.removed` handlers synced inside the
  update too. Routing only the volume and particle subscriptions, as the review proposed, would have left those.
- **One deferral for every event-driven sync**, not one per source: the end of an update runs one `sync()`, not one per
  flusher (the shapes had their own). The timing holds: `isUpdating` falls after `_inUpdate` is cleared (`state.ts:436`
  then `:439`, or `:368` then `:369` for a transaction) and before `commit()` / the undo resolves, so a caller that
  awaits sees the rows. The sequence's own deferral (`refreshSequence`) stays as it is.
- **No guard in `getDecoratorRoot`.** After the fix no scene sync runs inside an update, so no stale ref reaches it from
  the scene. Its other callers (`StateBuilder.To.getDecoratorRoot`, the structure hierarchy) pass refs of the tree they
  read. A guard in core would hide a stale-hierarchy read, which is the bug, and add a core file to an upstream PR for
  no case it fixes.
- The streaming `cell.removed` path is deferred with the rest but has no test of its own: a streaming row needs the
  behavior's object, which needs a canvas. The `cell.created` path has one.
- No TODO.md entry names this throw, so none is changed.

## Learned

- A throw in an RxJS subscriber does not reach the `commit()` that caused it: RxJS rethrows it on a timer. Vitest shows
  it as an "unhandled error" and still passes the test. To make a test red, read it from `config.onUnhandledError` and
  wait one macrotask before restoring it.
- `ParticleHierarchyManager.current` and the volume and structure ones return a stale tree during `inUpdate` by design;
  anything that crosses hierarchies inside an `events.changed` subscriber must wait for `isUpdating` to fall.

## Review

Gate run (Opus reviewer, then Opus skeptic): the fix is sound, no lost or late sync found.

| finding                                                                                                                                                                       | verdict                                                                     | outcome                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| M1 `@author` line missing in scene.ts and scene.test.ts                                                                                                                       | confirmed, must-fix                                                         | fixed, `8c35036b9` (master branch; here `2c6d8915e`)                                                                                       |
| S1 the scene-sync scaling guard brackets the hierarchies' events, where the sync no longer runs: an injected quadratic read 1.0x (passed), 52x once `isUpdating` is bracketed | confirmed by run, should-fix                                                | fixed, `6ca58f5fd` (here `534d956a2`): `isUpdating` bracketed, `ms` zeroed after setup (X2), comment true (X3); the guard passed on 3 runs |
| S2 the new tests assert rows only after a timer                                                                                                                               | confirmed, downgraded to nit by the skeptic (the code already satisfies it) | fixed anyway, `178f76ef9` (here `27c82fe6e`): rows asserted right after the awaited commit and undo                                        |
| N1 comment cites no spec section                                                                                                                                              | confirmed nit                                                               | fixed in `8c35036b9` (view-models.md §3)                                                                                                   |
| N2 changelog bullet lacks a period                                                                                                                                            | confirmed nit                                                               | fixed in `8c35036b9`                                                                                                                       |
| X1 (skeptic) the guard reads 7.7 to 8.1x against its 8x band, 7.85x on master too                                                                                             | confirmed, pre-existing                                                     | left open: not raised (never raise a budget); passed 3 of 3 here; the cause of the per-load growth is for a later lane                     |
| X4 (skeptic) the scene's and the sequence's `isUpdating` subscribers may both sync at one update end                                                                          | plausible nit                                                               | left open, as before the lane; `sync` is incremental                                                                                       |
| reviewer's "not covered": `object.updated` -> `streamingNode` and `cell.stateUpdated` read hierarchies inside an update                                                       | no failing case                                                             | left open                                                                                                                                  |

The failing-first proof for S1 is the skeptic's probe (quadratic passes before, caught after), not a committed test: the
guard is the test.

## 5.x

No `CHANGELOG.md` line: prism-viewer exists only on v6.

## How Ludo checks it

- `npx vitest run packages/prism/viewer/src/sources/_test/scene.test.ts -t "one state update"` (library), and
  `npx vitest run packages/extensions/cryoet/src/_test/portal.test.ts -t "undoes a load"` (prism-me).
- In prism-me: load a portal run with a tomogram and its ribosomes, press Undo: the scene empties, the Log shows no
  error.

## Size

113 production lines changed (scene.ts: 17 added, 25 removed, plus the comment); the rest is tests (the five scene
cases, the cryoet case, the guard).
