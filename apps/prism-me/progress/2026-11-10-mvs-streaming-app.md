# A streamed document in prism-me (2026-11-10, lane `mvs-streaming-app`)

## Brief

From `packages/mesoscale/_spec/prism.md` §12.2, lane 8. Stacked on `me/mesoviewspec` at `185bc8d0d` (lanes 0 to 6 and
the streaming lane merged). prism-me dev server for this worktree: port 1371. In flight beside it: lane 7 (`mvs-agent`,
port 1370), which edits `prism-viewer.ts` and the evals. Keep off those.

- **Check (Ludo):** the streaming lane's tiled fixture opened in prism-me: coarse first, copies where the camera looks,
  the budget in Settings; History shows no tile steps; Undo of a look edit while tiles stream.
- **Spec:** prism.md §9; streaming.md (the streaming lane's).
- **Tests:** unit: tiles requested from the canvas camera; tile lists are no step and no outside change; a checkpoint
  leaves them out; the budget setting.
- **Touches:** `packages/mesoscale/molstar/src/document-model.ts`, the tile cells' transformer registered as
  behavior-owned (lane 0's registry), Settings.
- **Size:** ~300 production lines.
- **Lane model:** Sonnet; Opus for the history rule.
- **Steps:** 1. the camera feed and the budget (Sonnet) 2. the history rule (Opus) 3. checked in the app
  (coordinator) 4. the gate (Opus).
- **Base:** after lanes 0 and 2 and the streaming lane merged (all are).
- **Known from lane 5 (open):** streamed tile lists may record steps (latent); this lane's history rule settles it.

## Built

Steps 1 and 2 (the camera feed and the budget; the history rule). Steps 3 (the app check) and 4 (the gate) are the
coordinator's.

- **The camera feed.** `TileStreamer.step(ir, focus?)` (`spec/src/runtime/streaming.ts`, streaming.md) plans from a
  focus the viewer gives instead of the IR's camera. `MesoSession.setFocus` keeps it for every stream step after it (a
  view shown forgets it); `MesoDocumentModel.setFocus` passes it on. `feedCanvasCamera` (`molstar/src/camera-feed.ts`)
  reads the canvas camera's target after each draw and feeds it once it rests (250 ms, moved more than 1 Å), radius 0;
  the `mesoviewspec` area starts it.
- **The budget.** `streaming-settings.ts` (exported as `@molstar/meso-molstar/streaming-settings`): an eager plugin
  behavior `mesoviewspec-streaming`, one param "Streamed copies" (default 3000), in prism-me's spec. Settings lists it
  under Behaviors; `settings.set` is one step and Undo restores it; the owner follows `streamingBudget(plugin)` (a
  stream step, no step of its own).
- **The history rule.** Tiles are `MesoTilePlacements` (`ms-plugin.meso-view-spec-tiles`), registered behavior-owned
  through lane 0's `registerBehaviorOwned` by the area. The adapter makes, draws (spacefill, the type's defaults),
  styles (`ParticleRepresentation3DLayers`) and deletes tile lists through the state only, in edits and stream steps; a
  commit with no API to call touches only tiles. `adopt` keeps the restored stream's tiles, deletes the others and
  writes the restored looks over the kept ones; `forget` (Undo of the open) deletes them. An evicted tile's placements
  go with its list; the owner holds only the document's sets for Undo. `MesoSession.restore` splices the resident tiles
  in, and the owner adopts in the session's turn (`restore`/`restoreView` take the adoption, `exclusive`).
- **Wiring.** The owner gives each session the document's tile provider (`DocumentSource.tiles`, kept per document state
  like its files) and the budget. `mesoviewspec.open` takes `example: 'tiled'`: the streaming lane's `tiledFixture`
  (`packages/mesoscale/spec/src/examples/streaming.ts`, 4×4×2 tiles of 2000 Å, 400 copies each) with its provider at 150
  ms a tile, its module loaded only then.
- **How the coordinator opens it** (port 1371):
  `await window.molstar.api.run('mesoviewspec.open', { example: 'tiled' })` (works on the stub, before the chunk loads).
  The budget:
  `await window.molstar.api.settings.set({ group: 'behaviors', values: { 'mesoviewspec-streaming': { budget: 800 } } })`.
  Stats: `window.molstar.api.mesoviewspec.model.session.streamer.stats()`.
- **Tests:** `spec/src/_test/streaming.test.ts` (a focus given is planned from); `molstar/src/_test/session.test.ts` (a
  fed focus; a view shown plans from its camera; a restore keeps the resident tiles); `camera-feed.test.ts` (the feed
  over a fake canvas); `streaming-settings.test.ts` (in Settings, one step, Undo); `streaming-app.test.ts` (headless,
  the person's API: no step, no unsafe step, no `particles.*` run while tiles come and go; a checkpoint without tiles;
  Undo and Redo of a look edit; Undo of the open; a `.molj` on a new viewer; the budget and its Undo).
- **Size:** about 590 production lines added, 70 removed (brief: ~300). What took the room: drawing tiles through the
  state (the adapter, ~240: list, representation params, layers, adopt, forget), the budget behavior (~90 with its
  holder), the feed (~60).

## Decided (by this lane; for Ludo)

- **The budget lives in Settings › Behaviors**, not a group of its own: Prism's `ViewerExtension.settings` is reserved
  and nothing reads it. A group of the extension's own would be a Prism change. The behavior is eager (prism-me's spec),
  because one the lazy chunk added would vanish on Undo of a step taken before the chunk loaded.
- **Default budget 3000** (the story's: 7 of the fixture's 32 tiles), so partial loading shows.
- **The canvas focus has radius 0** (the target alone): an orbit or a zoom loads nothing new; only a pan (or a view
  shown, a Focus) moves the target. No hysteresis (the planner's default 0).
- **Tile representations are spacefill with the type's defaults**, not through `particles.representation`: the person's
  representation settings on a document list do not reach tiles, and Prism's look of a new list (zoom colors) does not
  apply to them.
- **The example opener is a param of `mesoviewspec.open`** (`example: 'tiled'`), so it works through the stub as any
  open.

## Learned

- A commit had no way to tell an edit from a stream step: the adapter falls back to the viewer's API when none is bound.
  The owner's viewer has none, so "no API to call" is the stream step's mark there; an adapter over a viewer with an API
  (stories, older tests) still writes document lists' looks in an unbound commit, as before.
- `keepOwnedCells` puts the tile lists back with their layers as they are now, so the looks of kept tiles are not undone
  by the restore itself: `adopt` must write them.
- The owner's restore adopted outside the session's queue, so a stream step settling between could commit against the
  pre-restore IR; the adoption now runs in the session's turn.
- A tile that arrives while a restore waits in the queue is taken in by the restore's own stream step, so it is in the
  IR the adapter adopts but has no list; the stream step after it sees no change and never draws it (a hole until the
  next commit). `adopt` draws the restored IR's tiles that have no list (found by the advisor before handback; the test
  holds the queue while tiles land and undoes meanwhile, with a budget of 4 tiles so no later arrival masks it).
- A `.molj` holds tile lists (`getSnapshot` is not a checkpoint); on a new viewer the stub's declared transformer
  (`MesoPlacements`) loads the chunk, which registers `MesoTilePlacements` before the state is set, and `adopt` then
  deletes them (no provider on a fresh page: `stream.manifest`). The stub (`prism-viewer.ts`, lane 7's) does not name
  the tile transformer: a session holding tile lists and no document list would be refused. Not changed here.
- The Prism adapter draws no level 0 (streaming.md "Not yet"): "coarse first" in the app shows only the fixture's three
  landmark instances until tiles arrive.

## Open

- The stub's `owns.transformers` could name `ms-plugin.meso-view-spec-tiles` (lane 7's file).
- Level 0 (envelopes) drawn; the panel's stream counters (streaming.md, "The panel reports") in prism-me.
- A per-frame cost: the rest timer is set again on every draw while the target moves (no allocation otherwise).

## Review
