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

## Decided

## Learned

## Size

<measured> against ~600; what took the room.

## Review

| Finding | Severity | Verdict | Commit / open |
| ------- | -------- | ------- | ------------- |
