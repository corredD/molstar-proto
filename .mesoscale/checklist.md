# MesoViewSpec in prism-me: checklist

The one tracker for the stack on `me/mesoviewspec` (prism.md §12). It links, never copies: the briefs are in
`packages/mesoscale/_spec/prism.md` §12.2, each lane's narrative and review table in
`apps/prism-me/progress/<date>-<slug>.md`. Only the coordinator (the main checkout) edits this file. The loop that
drives it is [loop.md](loop.md).

## Open for Ludo

Questions that stop the loop. One line each; move it to Decided with the answer.

- (none)

## Decided

- 2026-11-09: default colors, option A. Today's per-population palette stays; the IR tells stated colors from defaults,
  and defaults are dropped only where the person chose a theme (lane 4).
- 2026-11-09: lane 4, M1: a theme, By entity or Reset that would clear a color look reaching beyond the selection is
  refused with no step, naming the look (kept as built).
- 2026-11-09: lane 6: a model edit runs as a Mol\* task in the status pill with Cancel (prism.md), not only in Built by.
- 2026-11-09: lane 5: Undo keeps the camera still; clicking the shown view re-applies its camera; Update camera on a
  semantic view writes a numeric camera (with fov, transition); a failed show redraws the previous view.
- 2026-11-09: the semantic levels and MesoLocation draft merged into `me/mesoviewspec` before David's review.

## Lanes

Each lane: brief committed · steps · checks green · gate (reviewer, skeptic, fixes) · Ludo's check in the app · merged.

### 0. `checkpoint-owned-cells` ([progress](../apps/prism-me/progress/2026-11-08-checkpoint-owned-cells.md))

- [x] built, gated, merged
- [ ] Ludo's check confirmed

### 1. `mvs-patch` ([progress](../apps/prism-me/progress/2026-11-08-mvs-patch.md))

- [x] built, gated, merged
- [ ] Ludo's check confirmed

### 2. `mvs-open` ([progress](../apps/prism-me/progress/2026-11-08-mvs-open.md))

- [x] built, gated, merged
- [ ] Ludo's check confirmed

### 3. `mvs-tree` ([progress](../apps/prism-me/progress/2026-11-09-mvs-tree.md))

- [x] built, gated, merged
- [ ] Ludo's check confirmed

### Spec: `mvs-levels-spec` ([progress](../apps/prism-me/progress/2026-11-09-mvs-levels-spec.md))

- [x] semantic levels (views.md) and MesoLocation as a union (mesoql.md) drafted, gated, merged
- [x] the draft's open questions answered by Ludo, written into the spec (`f48bea732`); still open: `within` between a
      region and copies
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
- [ ] Ludo's check by hand (the gestures clicked in the tree and menus; Claude's check called the operations)
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
- [ ] Ludo's check by hand
- [x] merged into `me/mesoviewspec` (`3e42733f9`)

### 6. `mvs-model-edits` ([progress](../apps/prism-me/progress/2026-11-09-mvs-model-edits.md)), port 1368

- [x] brief committed
- [x] steps 1–2 (Sonnet)
- [x] checks green (base failures only)
- [x] checked in the app through the API (exosome): count, seed, relax, refused count, Cancel, Undo all pass
- [x] gate: reviewer and skeptic; fixed: status pill task, yield (MessageChannel, not `scheduler.yield`, which starved
      the abort in Chromium; Cancel at 20, 60 and 300 ms checked live), fields, abort guard, cancel test; open: S3b, N2,
      N3
- [ ] Ludo's check by hand
- [x] merged with 4–5 in its worktree (`df2a671e8`; medium 115 pass, unit base failures only), then into
      `me/mesoviewspec` (`1bf3bd49e`)

### 7. `mvs-agent` (after 4, 5 and `mvs-skill-cli`)

- [ ] brief · steps · checks · gate · Ludo's check · merged

### 8. `mvs-streaming-app`

- [ ] brief · steps · checks · gate · Ludo's check · merged
