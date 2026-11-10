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
- [ ] the draft's open questions answered by Ludo, written into the spec
- [ ] David's review
- [ ] prism.md §5.1 (representation and LOD viewer-only) reconciled, after lane 4

### 4. `mvs-drive` ([progress](../apps/prism-me/progress/2026-11-09-mvs-drive.md)), port 1358

- [x] brief committed
- [x] default colors decided (A)
- [ ] 1. the owner port and `mesoscale.style`; stated vs default colors (Opus)
- [ ] 2. the other rows of §5.1: `entities`, `colors`, `importColors`, `theme` (Sonnet)
- [ ] 3. §5.2's calls (Sonnet)
- [ ] checks: `npx tsc -b`, `npx tsc --noEmit -p apps/prism-me`, `pnpm lint`, `pnpm format:check`,
      `pnpm check:workspace`, the quick lane
- [ ] 4. checked in the app (Sonnet)
- [ ] 5. the gate (Opus reviewer, Opus skeptic, a failing test then a fix per confirmed finding)
- [ ] Ludo's check: exosome eyes, color, Generate colors, Show only, Import colors, Save, Undo; a cellPACK `.bcif`
- [ ] merged into `me/mesoviewspec`

### Small lane: MesoLocation `kind` (after lane 4)

- [ ] brief (mesoql.md "MesoLocation as a union", only `copy` built)

### 5. `mvs-views` (after lane 4)

- [ ] brief · steps · checks · gate · Ludo's check · merged

### 6. `mvs-model-edits` (after lane 4, parallel with 5)

- [ ] brief · steps · checks · gate · Ludo's check · merged

### 7. `mvs-agent` (after 4, 5 and `mvs-skill-cli`)

- [ ] brief · steps · checks · gate · Ludo's check · merged

### 8. `mvs-streaming-app`

- [ ] brief · steps · checks · gate · Ludo's check · merged
