# MesoViewSpec in prism-me: checklist

The one tracker for the stack on `me/mesoviewspec` (prism.md §12). It links, never copies: the briefs are in
`packages/mesoscale/_spec/prism.md` §12.2, each lane's narrative and review table in
`apps/prism-me/progress/<date>-<slug>.md`. Only the coordinator (the main checkout) edits this file. The loop that
drives it is [loop.md](loop.md).

## Open for Ludo

Questions that stop the loop. One line each; move it to Decided with the answer.

- (none)

## Decided

- 2026-11-10: the stale resource on edit (an edit writing a resource's `uri` draws the old one; `document-model.ts`
  `load()` reads `session.doc`, set only after the compile), found by lane 7, is fixed in lane 8 before it merges.

- 2026-11-09: default colors, option A. Today's per-population palette stays; the IR tells stated colors from defaults,
  and defaults are dropped only where the person chose a theme (lane 4).
- 2026-11-09: lane 4, M1: a theme, By entity or Reset that would clear a color look reaching beyond the selection is
  refused with no step, naming the look (kept as built).
- 2026-11-09: lane 6: a model edit runs as a Mol\* task in the status pill with Cancel (prism.md), not only in Built by.
- 2026-11-09: lane 5: Undo keeps the camera still; clicking the shown view re-applies its camera; Update camera on a
  semantic view writes a numeric camera (with fov, transition); a failed show redraws the previous view.
- 2026-11-10: an agent's open asks per resource host: a document opened by URL (a known service included) asks before
  fetching a resource on an unknown host, as an edit does; prism.md §3 to change with it (lane 7).
- 2026-11-10: lane 7 gate S1: `get_mesoviewspec` `detail: 'document'` stays uncapped (asked for on request).
- 2026-11-10: Ludo runs lane 7's real-model evals, after the gate fixes.
- 2026-11-10: lane 7's library hook `ViewerExtension.agentState` (`14c430588`) stays in lane 7.
- 2026-11-10: showing a document's view becomes an undoable step (History), so Undo turn puts it back; prism.md §4.4 and
  §7.4 to change with it (done in lane 7, after its gate fixes).
- 2026-11-09: the semantic levels and MesoLocation draft merged into `me/mesoviewspec` before David's review.

## Lanes

Each lane: brief committed · steps · checks green · gate (reviewer, skeptic, fixes) · Ludo's check in the app · merged.

### 0. `checkpoint-owned-cells` ([progress](../apps/prism-me/progress/2026-11-08-checkpoint-owned-cells.md))

- [x] built, gated, merged
- [x] Ludo's check confirmed (2026-11-10)

### 1. `mvs-patch` ([progress](../apps/prism-me/progress/2026-11-08-mvs-patch.md))

- [x] built, gated, merged
- [ ] Ludo's check confirmed (in Storybook, not running on 2026-11-10)

### 2. `mvs-open` ([progress](../apps/prism-me/progress/2026-11-08-mvs-open.md))

- [x] built, gated, merged
- [x] Ludo's check confirmed (2026-11-10)

### 3. `mvs-tree` ([progress](../apps/prism-me/progress/2026-11-09-mvs-tree.md))

- [x] built, gated, merged
- [x] Ludo's check confirmed (2026-11-10)

### Spec: `mvs-levels-spec` ([progress](../apps/prism-me/progress/2026-11-09-mvs-levels-spec.md))

- [x] semantic levels (views.md) and MesoLocation as a union (mesoql.md) drafted, gated, merged
- [x] the draft's open questions answered by Ludo, written into the spec (`f48bea732`); still open: `within` between a
      region and copies
- [x] David's 2026-11-10 comments proposed: drawing as `meso.paint` models (runtime.md), static pointers as
      `locationToAddress` and `:key` (mesoql.md); design.md decision 11 points to both
- [ ] David's review
- [ ] prism.md §5.1 (representation and LOD viewer-only) reconciled, after lane 4

### 4. `mvs-drive` ([progress](../apps/prism-me/progress/2026-11-09-mvs-drive.md)), port 1358

- [x] brief committed
- [x] default colors decided (A)
- [x] 1. the owner port and `mesoscale.style`; stated vs default colors (Opus)
- [x] 2. the other rows of §5.1: `entities`, `colors`, `importColors`, `theme` (Sonnet)
- [x] 3. §5.2's calls (Sonnet)
- [x] checks: tsc, format, styles green; `pnpm lint` (2 errors) and `check:workspace` (unbuilt assets) fail on the base
      too; 14 Windows-only path-separator test failures also on the base
- [x] 4. checked in the app, through the API (Claude, 2026-11-09; Ludo was remote): all pass but Import colors by name;
      fixed (`bca543522` test, `030841c48`): entity ids and unambiguous bare ids (`ALB`) now match, a bare description
      (`Serum albumin`) still does not
- [x] 5. the gate (Opus reviewer, Opus skeptic, a failing test then a fix per confirmed finding): M1, S1–S4 and the §5.2
      eyes fixed (`b36de7a26`..`ed7fc4ce0`); open: refusing `particles.remove`/`visibility` on a document list through
      the API (needs a Prism hook), a Representation-form theme change, nits N1–N3, N5
- [x] Ludo's check by hand (2026-11-10)
- [x] merged into `me/mesoviewspec` (`4b9d4cd1c`), on Ludo's go-ahead after the Import colors fix

### `mvs-location`: MesoLocation `kind` ([progress](../apps/prism-me/progress/2026-11-09-mvs-location.md))

- [x] brief (mesoql.md "MesoLocation as a union", only `copy` built)
- [x] built (Sonnet), checks green (base failures only)
- [x] gate: reviewer (Opus); the story's `loci.size` fixed, `lociToLocations` dropped
- [x] merged into `me/mesoviewspec` (`29d95d6c5`); no app change to check

### 5. `mvs-views` ([progress](../apps/prism-me/progress/2026-11-09-mvs-views.md)), port 1359

- [x] brief committed
- [x] steps 1–4 (Opus; ~850 lines vs ~400)
- [x] checks green (base failures only)
- [x] checked in the app through the API (β-cell): all pass but Open with (no view named) fails; camera moves not
      verifiable (hidden pane)
- [x] gate: reviewer and skeptic; fixed: Open with, labels on stream commits, camera in a frame test, Ludo's four
      decisions; open: S5 (serial label runs), `pin()` order, tour caption, a click during a tour
- [x] Ludo's check by hand (2026-11-10)
- [x] merged into `me/mesoviewspec` (`3e42733f9`)

### 6. `mvs-model-edits` ([progress](../apps/prism-me/progress/2026-11-09-mvs-model-edits.md)), port 1368

- [x] brief committed
- [x] steps 1–2 (Sonnet)
- [x] checks green (base failures only)
- [x] checked in the app through the API (exosome): count, seed, relax, refused count, Cancel, Undo all pass
- [x] gate: reviewer and skeptic; fixed: status pill task, yield (MessageChannel, not `scheduler.yield`, which starved
      the abort in Chromium; Cancel at 20, 60 and 300 ms checked live), fields, abort guard, cancel test; open: S3b, N2,
      N3
- [x] Ludo's check by hand (2026-11-10)
- [x] merged with 4–5 in its worktree (`df2a671e8`; medium 115 pass, unit base failures only), then into
      `me/mesoviewspec` (`1bf3bd49e`)

Lanes 7 and 8 run in parallel (Ludo, 2026-11-10): their files do not meet (7: `prism-viewer.ts`, evals; 8:
`document-model.ts`, tile cells, Settings).

### 7. `mvs-agent` ([progress](../apps/prism-me/progress/2026-11-10-mvs-agent.md)), port 1370

- [x] brief committed (`4ef33fb74`)
- [x] steps 1–2 (Sonnet; `6ad6aca11`..`5a451548a`): the skill and 10 tools (`show_only_meso` added), the outline, focus
      and highlight no longer ask; checks green (base failures only; medium 128 pass)
- [x] step 3, evals (Opus; `68e410db1`..`c10dc5ca7`): three tasks on outcomes (document, layers, camera, Undo turn),
      near misses rejected; scripted 23/23, medium 151 pass; real model not run (no key)
- [x] gate: reviewer and skeptic (M1 edit fetches any host unasked, M2 open-data URL scan bypass, M3 raw ids in the turn
      state); fixed, a red test first each (`11f53ec59`..`2bb74ec59`): M1–M3, S2, S3 (line cap 800, not 240: the
      exosome's line), S4, S6, S7; open: S1 (decided), S5, S8, nits
- [x] Ludo's decisions built (`f9b8a20ff`..`18e325647`): showing a view is a step (a tour's views are not:
      `mesoviewspec.tour.view`); an agent's open by URL refuses resources on unasked hosts, `resources` names them;
      prism.md §3, §4.4, §5.3, §7.4, §8 updated
- [x] checks green (base failures only; quick 613 pass, medium 165 pass)
- [x] checked in the app through the API (Claude, port 1370, β-cell): a view is one step, Undo and Undo turn put the one
      before back, the view shown again is no step, a tour leaves no step; an agent's open of a document with a resource
      on example.org is refused naming the host, nothing fetched, and opens with `resources`; the person's open is
      unchanged
- [x] Ludo's check in the app, with a real model (2026-11-10)
- [ ] real-model evals (Ludo)
- [x] merged into `me/mesoviewspec` (`cc3a7a69f`, Ludo 2026-11-10; no conflict; medium 166 pass, unit base failures
      only; the main checkout needed `pnpm install --offline` for `@molstar/ai/testing`)

### 8. `mvs-streaming-app` ([progress](../apps/prism-me/progress/2026-11-10-mvs-streaming-app.md)), port 1371

- [x] brief committed (`a99bdec2c`)
- [x] steps 1–2 (Opus; `42ff9af0b`..`582887974`, ~600 lines vs ~300): camera feed, budget (Settings › Behaviors, default
      3000), tile lists behavior-owned and out of History; checks green (base failures only; medium 122 pass)
- [x] checked in the app through the API (Claude, port 1371): open = one step, 7/32 tiles at 3000; budget 800 evicts to
      2, one step; a far focus streams with no step; an eye edit while streaming is one step, its Undo restores the
      looks; Undo of the budget gives 3000 and 7 tiles. Not verifiable: the feed from the real canvas (hidden pane)
- [x] gate: reviewer, skeptic; fixed (`384e322be`..`45b3692d8`, tests `040e68960`): M1 Close/Undo-of-open wait for the
      stream commit in flight, S4 a restored session streams where the camera was fed, S2 a stream commit never sets the
      camera, S5 tests; open: S3 and nits. Rechecked live: Close and Undo of the open mid-stream leave no list
- [x] the stale resource on edit fixed (`b8d81efab`..`6f4b6d21c`: red tests, then `session.stepDoc`, the document the
      step compiles, read by `load` and `describe`; it also made Undo/Redo load the document they left). Medium 129
      pass, unit base failures only. Checked in the app (β-cell): an edit of `r.isg-recipe`'s uri fetches the new recipe
      in that step and compiles a different IR; Undo fetches the old one and gives the same IR as before; Redo the new
- [ ] Ludo's check (2026-11-10): fails. What streams in looks wrong and does not follow where the camera looks; a pan
      re-centers the camera by itself. Cause: Canvas3D's own reset (`shouldResetCamera`) when a tile lands outside the
      old bounds or an eviction leaves the camera over nothing; the feed then sent the re-centered target. Fixed
      (`d6e84869f`..`7e7f39aae`): `keepCamera` holds `camera.manualReset` for each tile write and its synchronous
      commit, then puts it back (not for the session: checkpoints and `.molj` save canvas props). The looks do not
      differ (checked). Medium 130 pass, unit base failures only. Checked through the API: a stream to a corner (6 in, 6
      out) leaves the camera where set and the flag off. Not seen on a GPU (no WebGL here). Open: the near plane when
      zoomed out over the whole box, a checkpoint taken mid-write, a tiles-only document's first tile
- [x] step 5, tiles where the person looks (Ludo 2026-11-11, "like culling"; `eda1b5432`..`a0bf8024c`): the feed gives
      the canvas camera's view (side planes and one through the eye); the planner wants the tiles in view first, from
      the screen's centre out along the line of sight, then nearest the eye; app hysteresis 500 Å; a view shown feeds
      the camera again. Gate: reviewer and skeptic (the skeptic measured the real fixture); fixed M1 (behind the eye in
      view), the orbit churn, the corner before the centre, the view shown, resize/fov; open: the eye inside the box
      (loose test, ties), XR, a spin never feeds, 500 Å fixed. Medium 130 pass, unit base failures only. Checked in the
      app with the real camera (hidden pane, a draw signalled by hand): pan to a corner loads the corner (6 in, 6 out),
      the camera stays; a 5° orbit changes no tile; the eye inside looking down a row loads that row; a view shown is
      fed again with no draw
- [x] Ludo's check again (2026-11-11): passes
- [x] merged into `me/mesoviewspec` (`165ec9cf4`, Ludo 2026-11-11; two conflicts with lane 7, both sides kept:
      `features.md`'s rows, `extension.ts`'s imports and `openDocumentAddresses` beside `exampleDocument`; medium 181
      pass, unit base failures only)
