# Lane decisions (2026-11-13, night)

## Brief

From [plans/2026-11-13-night-lanes.md](../plans/2026-11-13-night-lanes.md) (Ludo, 2026-11-13). Branch `me/decisions`
from prism-me at eaf253942 (grow-helix merged).

From the [decisions doc](https://claude.ai/artifact/Jh985ir9vUiRxaUagxuKqV) (Ludo's answers, 2026-11-13):

1. A fiber unit as the Grow source: its offset direction is its "up" (the axis put along the normal), not its
   path-tangent axis. Test: grow Tiling from the last unit of a fiber painted on a mesh: tiles' up = the unit's offset
   direction = the normal.
2. Place Auto switches to Surface whenever the pointer is over a mesh (any brush); at a depth elsewhere as now.
3. A fiber painted on a surface: with helix settings (Twist ≠ 0 or an Offset) it keeps them (units turned about the path
   as set); a plain walk (Twist 0, no Offset) has its units' up along the surface normal, as a grown walk.
4. and 21. Helix and Spiral: Count (copies) and Turns both editable, linked: setting one sets the other (Turns → the
   copies those turns hold; Count → the turns reached); Count prefix-stable as now. The helix's length by copy count.
5. Tiling: Count in space too (Rings gone): in space the hex/square rings filled in order up to Count; sessions with
   Rings read as their count.
6. Color… on a VTP leaves an array color theme alone (it applies to uniform-colored meshes only; an array-themed mesh
   says so in the menu's title).

- The spec (ui.md, features.md) records every answered decision of the doc, the "keep"s included.

**Shared rules for the night.** New code in new files where it can be; edits to operations.ts, controls.tsx, paint.ts
kept to the wiring (four lanes touch the mesoscale package). Nothing pushed, no PR. Tests fail first; the gate
(lane-reviewer, then lane-skeptic); progress file, `.v6/changelogs/decisions.md`, ui.md and features.md.

**Size.** ~250 production lines. **Model.** Sonnet; Opus subagent for items 1 and 3. **Port.** 1369
(`node scripts/esbuild/app.mjs apps/prism-me --dev --port 1369`, log `~/prism-me-lanes/dev-1369.log`), left running for
Ludo's morning try.

## Built

- Item 2: `paint-mode.ts` `autoPlace`: Place Auto (not upright) reads the surface at the pointer (hover, and the press)
  and goes to Surface when it is on a mesh; a pending pick keeps what the hover showed; the hint follows.
- Items 1 and 3 (Opus subagent): `fiber-up.ts` `fiberUnitUp` (a fiber unit's offset direction is the source's axis on a
  mesh, in `surfaceAxis`); `paint.ts` `makeFibers` gives a painted fiber's stored surface normals to `makeFiber` only
  for a plain walk (Twist, Jitter 0, no Offset); a stroke painted with Turn View stores none.
- Item 11: `TilingParams { pattern, spacing, count }`; `tilingPoses` fills rings in order up to Count in space; the
  operation reads `count`, else a session's `rings` as `tilingTotal`, else 3 rings'; the section has Count only.
- Items 8, 21: `grow-link.ts` (helixCopies by the real polyline, helixTurns, spiralCount, linkedValue); `helixPath`
  `info.turnsAt(length)`; `mesoscale.grow` Helix by `count` (ends at that many copies via `trimEnd`, records the turns
  at the cut), Spiral by `turns`; the record has `by`, `count`, `turns`, `copies`. The section: `linked` sliders; the
  driver is `GrowSettings.by`; the follower is shown from the live grow, else (in space) flat geometry, never kept in
  the settings.
- Item 13: `colorItems`: the swatches of a mesh with `colorBy` are disabled ("Colored by Cell: Labels: change it in
  Properties").
- Spec (ui.md, features.md), changelog `.v6/changelogs/decisions.md`, scripts `~/prism-me-lanes/decisions-capsid.cjs`.

## Decided

- (author) Turns win when both Count and Turns are given to `mesoscale.grow`.
- (author) `by` defaults to Turns for a helix, Count for a spiral; it is shared between them (like the values).
- (author) Jitter counts as a helix setting for painted fibers (it turns the units about the path); grown walks and
  helices keep following their normals as before.
- (author) Color… guard is in the menu (the swatches), not in `cryoet.mesh`: the assistant's explicit color still sets
  it.

## Learned

- A Mode change on a live grow, then a drag, then Undo does not restore the list (also for Count, so not from this
  lane): the review-gate test of Undo uses no Mode change before it. To look at (open item).
- The review (6 must, 7 should) found the follower numbers wrong at the cut (turns read one rise too far) and a
  shared-value leak between Spiral, Helix and Sphere through the settings; both fixed with tests. The first design
  stored both values.

## Gate

Reviewer then skeptic (18 findings: 15 confirmed, 1 half refuted, 1 out of scope, 1 part plausible, 1 new). Fixed: M1
changelog, M2 format, M3 this file, M4 turns at the cut, M5 helixCopies by the polyline, M6 `by` in the record, S1
follower not kept, S2/S4 `copies` and `count` asked recorded, N4 error past 200 turns, X1 descriptions, S6 hint, S7
files, N2 hints. Left open: S3 (the linked readout in space ignores a list's scale; on a mesh it shows the grow's), S5
(below), N1, N3, N5.

## Size

About 300 production lines against ~250 (the review's fixes added the link record and `fiber-up.ts`; comments are a
third).

## Open

- S5: the Meshes category's Color… (By object, Uniform…) and `mesoscale.theme` still replace a VTP's array theme.
  Decision 13 names Color… on a VTP; ask Ludo whether the category's applies too.
- The spec has no answers for the doc's other questions (the "keep"s: 4–7, 9, 12, 14–20, 22–25): the brief carried only
  six.
