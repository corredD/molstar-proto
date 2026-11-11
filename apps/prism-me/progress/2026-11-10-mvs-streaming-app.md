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
- (gate S3) `unsure` is cleared by any commit that succeeds: an unbound one (a stream step) after a failed bound one
  writes only the tiles' looks and clears it, so the document lists' looks are not written again by the next edit. Keep
  it across unbound commits.
- (gate) The budget across a reload: Prism's web store keeps the theme and the keybindings only, so "Streamed copies"
  may not persist (unverified).
- (gate) `MesoSession.restore` streams (`stream()`, loads requested) before the caller's `adopt`; when `adopt` throws
  there is no fallback (the streamer holds tiles the adapter never adopted).
- (gate) Dropped promises: `void this.model.setFocus(...)` (the extension's feed) and
  `void this.session?.setBudget(...)` (the owner's budget follower) need a `.catch`.
- (gate) `tileLayers` and `sameLayers` (`prism-adapter.ts`) duplicate `particles.look`'s patching of layers; one helper
  of the particles feature's would keep them the same.
- (gate) The extension's `dispose` unregisters the tile transformer (behavior-owned) before the model disposes (and its
  session with the tiles in flight).

## Review

The gate (reviewer and skeptic, Opus) and its fixes. Each fix's test is its own commit, red, before the fix. The rows to
record as Open came without a verdict or severity (`-`); S1 was not handed to the fix.

| Finding                                                                                                                                    | Severity   | Verdict    | Fixed by / Open                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ---------- | -------------------------------------------------------------------------- |
| M1. Close, Undo of the open and an open over an open document ran outside `session.exclusive`: a stream commit in flight landed after them | must-fix   | confirmed  | test `384e322be` (red), fix `f9d043700`                                    |
| S1                                                                                                                                         | -          | -          | not in the fix brief                                                       |
| S2. An unbound commit keeping no set reset the camera (`commitCamera`'s new scene)                                                         | should-fix | confirmed  | test `ab5c8f375` (red), fix `45b3692d8`                                    |
| S3. `unsure` is cleared by an unbound commit                                                                                               | should-fix | -          | Open                                                                       |
| S4. A session a restore made streamed around the document's camera, not the camera fed                                                     | should-fix | confirmed  | test `03d918376` (red), fix `5f9b1896f`                                    |
| S5. Tests that passed while wrong: the placement store after evictions; the extension's feed wiring; Close and Undo of the open in flight  | should-fix | confirmed  | tests `040e68960` (mutations seen red, no fix needed) and the M1, S4 tests |
| The budget across a reload                                                                                                                 | -          | unverified | Open                                                                       |
| `MesoSession.restore` streams before `adopt`, no fallback if it throws                                                                     | -          | -          | Open                                                                       |
| Dropped promises (`setFocus`, `setBudget`) without `.catch`                                                                                | -          | -          | Open                                                                       |
| `tileLayers` and `sameLayers` duplicate `particles.look`'s patching                                                                        | -          | -          | Open                                                                       |
| The extension's `dispose` unregisters the tiles before the model disposes                                                                  | -          | -          | Open                                                                       |

- **M1, how the test holds the commit.** The brief's gated provider was not deterministic: a tile released by a gated
  provider reaches the commit only by microtask order, and a stream step queued behind the close meets a disposed
  streamer either way. The test holds the arrival's commit midway (its plan made, at the particles extension's load) and
  releases it from the session's `dispose`, which both the old and the fixed code call. Seen red on the old code: one
  tile list left under the root. The first commit setting the camera is checked as "kept nothing" (headless has no
  canvas).
- **M1, a second shape.** A stream commit held before its plan (not midway) planned against the cleared adapter (`prev`
  none) and threw at its first document list (no API bound), leaving a `MesoPlacements` cell with no representation. The
  fix covers it too; the test checks no document list is left.
- **Lane 7's find, fixed here (Ludo, 2026-11-10: before the merge).** A model edit that writes a resource's `uri` drew
  the old resource: the owner's loader read `session.doc`, which `MesoSession` sets only after the step's compile. Undo
  and Redo had the mirror bug (a restore compiles before it takes its document, and every compile loads its resources,
  since a model's key hashes their content), so they loaded the document they left. `describe` (a list's type
  descriptions, built in the step's draw) had the same cause: a new entity's label missing. The session exposes
  `stepDoc` (the step's document while it runs, set and cleared around it, else `doc`); `load` and `describe` read it.
  `isInstance` keeps `session.doc`: a copy's label is asked for on hover, after the step that drew it. Tests `b8d81efab`
  and `5e0678dd3` (red), fix `cdf62db47`. Not checked in the app.
- **Ludo's app check (2026-11-10): the camera re-centered by itself, and the tiles did not follow it.** On port 1371,
  `example: 'tiled'`, a real GPU: a pan re-centered the camera; "the look is really weird and doesn't reflect where the
  camera looks".
  - **Cause, confirmed by reading and by the fixture's numbers, not by a frame.** No `gl` in this worktree (the native
    package is not installed) and no browser pane that draws, so Canvas3D did not run. The adapter sets no camera in a
    stream commit (gate S2). Mol*'s Canvas3D does: `commitMainScene` (`packages/graphics/src/canvas3d/canvas3d.ts`,
    ~2261) requests a reset when `!camera.manualReset && (reprCount === 0 || shouldResetCamera())`, and
    `shouldResetCamera` (~2175) is true when a visible renderable's sphere is outside the old visible bounds (and away
    from the camera sphere), or the camera sphere overlaps nothing. The open draws only the three landmarks, from (1000,
    1000, 1000) to (7000, 7000, 3000), a sphere of about 4400 Å around (4000, 4000, 2000); a tile is a 2000 Å cube (its
    sphere about 1800 Å), and with 2 tiles in z every tile touches a face of the box, so every arrival at the edge pokes
    out and the next frame re-frames the whole scene. An eviction can leave the camera sphere over nothing (the same
    reset). The feed (`camera-feed.ts`) then reads the re-centered target and the owner streams around the centre:
    symptom 2.
  - **Fix: `keepCamera` (`prism-adapter.ts`), the flag held per write, not per session.** `camera.manualReset` is set
    for each write of tile lists (a commit's deletions, the tiles' draw, the adoption's deletions) and a synchronous
    `canvas.commit(true)` of what it added (Canvas3D commits on a later frame otherwise, after the flag is put back:
    Mol*'s volume streaming toggles the same flag around its update without that commit), then put back; `radiusMax`
    then follows the scene, as Canvas3D's own commit does when the flag is off. Not the looks' write: an in-place
    update, no scene commit, no reset. Not held: someone else's `manualReset` (left as it is; Mol*'s headless screenshot
    and volume streaming set it), and a canvas with no representation yet (its first reset frames a first open).
  - **Why not the session (the brief's option).** A checkpoint holds the canvas props (`CheckpointParams.canvas3d`), and
    so does a `.molj`; `PluginState.setSnapshot` applies them after the custom state (the owner's `restore`), so the
    owner could not put the person's value back over a restore: a `.molj` saved while streaming would reopen with the
    flag on for good. Held for a session, it would also stop Canvas3D's reset for anything else loaded meanwhile.
  - **Kept intact.** The open frames (no hold before the first representation; `commitCamera` sets the IR camera after,
    unchanged); a view shown sets its camera (`commitCamera`, no hold); Reset camera works (`requestCameraReset` sets
    `cameraResetRequested` whatever the flag, and `resolveCameraReset` never reads it: canvas3d.ts ~2126, ~2864); Undo,
    Close and a restore leave the canvas props as they were (the flag is off outside a write, so no checkpoint holds it;
    the test reads one). Nothing in prism-viewer reads `manualReset` (only Mol*'s volume streaming, the headless
    screenshot, and prism-ui's story and test params). A direct `canvas3d.setProps` emits no `settingsUpdated`, and the
    outside-change detector watches the data tree only, so the hold is no step and no outside change.
  - **Tests.** `camera-kept.test.ts` (the hold over a recording canvas: the order, put back on a throw, someone else's
    flag, none before the first representation, `radiusMax`); `streaming-app.test.ts` (headless, a stand-in canvas that
    takes the representations as Canvas3D does and re-centers on any scene change committed without the flag, which is
    stricter than Canvas3D: tiles after a pan, an evicting budget, a look edit and its Undo leave the camera where the
    person left it, and the checkpoint holds the flag off). Red `d6e84869f` (1 reset; the hold missing), fix
    `2519b9181`; the gate S2 test's stand-in canvas given what the hold reads, `97a02620b`. Mutations seen red: the
    commit's deletions unwrapped. Not caught by a test: the adoption's deletions unwrapped (no test restores to another
    stream key with a canvas).
  - **Not covered.** Canvas3D's own reset (no WebGL here): the stand-in models its decision. Ludo's check on a GPU is
    the proof.
  - **The looks: compared, not changed.** A tile list's representation (`tileRepresentationParams`) and a document
    list's (`particles.representation`'s `representationParams`) have the same type params, size theme and color theme;
    only the default palette's kind differs (`set` and `interpolate`, from the data), which no copy shows because every
    type has a color layer from the IR's looks. A landmark (`i.corner`, entity `e.a`) and a tile's `p.a` copy differ in
    color because the IR gives each set's types their own default color (an instance is a type of its own), as in a
    document that does not stream. Nothing in prism-me styles a new list. So "weird" was the resets; level 0 is still
    not drawn (Open), so before tiles arrive only the landmarks show.
  - **Open.** A step taken while a tile write is in flight (the write spans a state update) takes a checkpoint with the
    flag on; Undo or Redo to it would leave it on. The camera's `radius` is the open's (the landmarks', about 4400 Å;
    the box's half-diagonal is 6000 Å): with far clipping on, now that no reset grows it, tiles more than that beyond
    the target could be cut by the far plane. Unverified; Ludo's check will show it.
