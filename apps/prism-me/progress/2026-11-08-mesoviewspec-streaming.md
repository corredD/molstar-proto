# MesoViewSpec streaming (2026-11-08, lane `mesoviewspec-streaming`)

## Brief

- **Asked** (David, Slack, after v0.1: "it needs … streaming concepts"; Ludo 2026-11-08: "yes" to a lane of its own). A
  document can name a scene too large to hold at once; the viewer shows the whole thing coarse first, then loads copies
  where the camera looks, within a budget. **Check:** a "Streaming" story in Storybook (MesoViewSpec): a tiled fixture
  scene opens at level 0 (counts and envelopes, no copies), loads copies around the focus as the semantic camera moves
  through a tour, the loaded-copy count stays under the budget, and the panel shows tiles requested, loaded, evicted.
- **Spec:** `packages/mesoscale/_spec/design.md`, a new §6.8 Streaming (source, manifest, provider, budget, levels) and
  open decisions 5 (tiles) and 12 (levels 0/1/2: statistical, copies, atoms) answered or narrowed;
  `_spec/renderer-recommendations.md` R5 measured.
- **Tests:**
  - quick: manifest validation (levels, tile bounds, counts); the planner picks coarse-first, nearest-first tiles for a
    camera and never exceeds the budget; edge tiles (a focus on a tile boundary loads both sides); eviction is
    farthest-first and keeps the focus's tiles; level 0 alone gives counts and envelopes with no placement set; the same
    camera and manifest give the same plan (deterministic).
  - integration (medium): a fixture provider over tiles drives `compile` + the Prism adapter through a tour; each step
    commits only added and removed tile sets (`planCommit`), never a full rebuild.
  - heavy: R5, 1M copies split into 1, 10, 100, 1,000 placement sets through the Prism adapter: commit time, frame time,
    memory; the result written into R5.
- **Touches:** `packages/mesoscale/spec/src/format/doc.ts` (a `stream` source on a model or resource), `validate.ts`, a
  new `runtime/streaming.ts` (manifest, provider contract, planner, budget), `examples/` (a tiled fixture),
  `molstar/src/session.ts` (camera-driven requests), a new `_stories/streaming.stories.ts`, the perf lane. **Stays
  off:** `resolvers/` (the packers), `ir/loci.ts` beyond reading it; nothing outside `packages/mesoscale` except
  `storybook/packages.ts` if needed.
- **Size:** ~600 production lines (tests apart), plus the design.md section.
- **Lane model:** Sonnet, with the design step on Opus: the manifest and provider contract are design; the planner,
  fixture, story and measurement are mechanical once the contract is fixed.
- **Steps and models:**
  1. read the lane's design.md (§4, §5.1, §6, §11 decisions 5 and 12), the camera and instances code, and Seq\*'s
     streaming notes if available (Opus);
  2. design the manifest, provider contract, levels and budget; write design.md §6.8 first (Opus subagent);
  3. the types, validation and planner with quick tests (Sonnet);
  4. the fixture provider, session wiring and medium test (Sonnet);
  5. the story (Sonnet), checked in Storybook (Sonnet: load, play the tour, no console errors);
  6. the R5 heavy measurement and its write-up (Sonnet runs, Opus writes the conclusion);
  7. the checks of How we work (Sonnet); the gate (Opus).

## Built

- design.md §6.8 Streaming (v0.4): source, manifest (`meso-tiles`), provider, planner, budget, levels; decisions 5 and
  12 narrowed (levels are a runtime concept, the top level is not restructured). R5 measured and concluded.
- `format/doc.ts` (`StreamSource`, `TileManifest`), `validate.ts` (`validateManifest` + static rules), `ir/ir.ts`
  (stream node), `runtime/streaming.ts` (`TileProvider`, `planStream`, `TileStreamer`, `tileSet`, `withTiles`,
  `level0IR`), `runtime/runtime.ts` (compile builds the stream node; the camera reads level 0), `examples/streaming.ts`
  (tiled fixture with a delayed provider), `molstar/src/session.ts` (stream step per edit and per settled load,
  `setBudget`, `restore` on a failed commit), the story `mesoviewspec-streaming--tiled-scene`.
- Tests: quick 232 (was 147 + 85 new incl. fixes), medium 11 (+1 skipped, no `gl`), heavy 10 (R5: 4 cases, in files of
  their own), scaling 4 (a new guard for `updateView` on a stream document).
- Browser check (Storybook 6008, Browser pane): the story opens at level 0 (0 copies, 0 / 3000); Play tour: tiles
  requested 7, 13, 20, evicted 0, 6, 13, 7 resident, 2800 / 3000 copies at most, no console errors.

## Decided

- Opus design agent: the budget is a session option, not a document field (renderer settings stay out of the document);
  the manifest comes only from the provider; the camera always reads level 0 (otherwise it moves as tiles load); one
  stream model per document in v0.4.
- Me: the story opens with budget 0 (level 0 only), because the first run opened with 7 tiles loaded and the brief asks
  for level 0 first; `setBudget` added for it.
- Me: R5 cases in files of their own, because the 1,000-list case peaks near 6 GB and was SIGKILLed after other cases.

## Learned

- R5: 1M copies in 1/10/100/1000 lists commit in 0.8/1.5/5.6/39 s (about 37 ms and 0.1 MB a list); a stream step is
  cheap to 100 lists, 100-160 ms at 1,000 (looks rewritten on every list). Frame time is unmeasured (no GL here):
  TODO.md.
- A type table alternating between populations made `byTypes` quadratic (37 ms at 1.8k tiles, 605 ms at 7.2k): emitting
  population-major fixed it without touching `loci.ts`.
- Sonnet implemented the contract well but a reviewer found the edges: missing `counts`, hysteresis vs focus tile, a
  foreign AbortError, a sync throw from a provider, stale issues.

## Size

Production lines against the brief's ~600: about 1,260 (streaming.ts 554, fixture 171, story 160, session +127, runtime
+91, validate +84, doc +38, ir +31, others small), tests about 1,400, design.md +550. What took the room: the planner
and `TileStreamer` (abort and arrival races, standing issues), the fixture and the story (not counted in the brief's
600), and the session wiring. Over by about 2x; recorded, work kept going.

## Review

Reviewer (Opus, read-only) 13 findings (4 must-fix, 5 should-fix, 4 nits); skeptic confirmed 8, partly confirmed 1 (#4:
changelog real, features.md refuted: it lists app features, no MesoViewSpec entry), refuted 0, 2 nits confirmed and 2
plausible, and added 1 (X). All fixed; none left open except frame time (TODO.md).

| Finding                                                   | Severity   | Verdict                                  | Commit / open                          |
| --------------------------------------------------------- | ---------- | ---------------------------------------- | -------------------------------------- |
| 1 tile without `counts` passes validation, compile throws | must-fix   | confirmed                                | 25e2a6962                              |
| 2 hysteresis evicts a focus tile                          | must-fix   | confirmed                                | 250c3c652                              |
| 3 level-0 camera path quadratic (types alternate)         | must-fix   | confirmed                                | b77451656 (+ scaling guard)            |
| 4 no changelog / features.md                              | must-fix   | changelog confirmed; features.md refuted | e713bbb4a                              |
| 5 foreign AbortError wedges a tile                        | should-fix | confirmed                                | cc7ddcc9b                              |
| 6 sync throw from `provider.load` escapes `step`          | should-fix | confirmed                                | e9edbb27f                              |
| 7 model edit drops stream warnings                        | should-fix | confirmed                                | ec21414f4                              |
| 8 failed stream commit swallowed, streamer ahead          | should-fix | confirmed                                | f3b0aaadb                              |
| 9 R5 frame time unmeasured                                | should-fix | confirmed                                | TODO.md 1e38906b4 (needs a GL machine) |
| X `reset` keeps stale issues (skeptic)                    | should-fix | confirmed                                | 7eca0e414                              |
| nit: remove looks not separately recorded                 | nit        | confirmed                                | 900aa00b9                              |
| nit: level0 caches keyed on `ir.root`                     | nit        | plausible                                | 37b1f2af0                              |
| nit: §6.8.7 names wrong test files                        | nit        | confirmed                                | 042b25a52                              |
| nit: NaN focus centre                                     | nit        | plausible                                | eb006b074                              |
