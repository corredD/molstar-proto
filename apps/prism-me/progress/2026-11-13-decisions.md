# Lane decisions (2026-11-13, night)

## Brief

From [plans/2026-11-13-night-lanes.md](../plans/2026-11-13-night-lanes.md) (Ludo, 2026-11-13). Branch `me/decisions` from
prism-me at eaf253942 (grow-helix merged).

From the [decisions doc](https://claude.ai/artifact/Jh985ir9vUiRxaUagxuKqV) (Ludo's answers, 2026-11-13):

1. A fiber unit as the Grow source: its offset direction is its "up" (the axis put along the normal), not its
   path-tangent axis. Test: grow Tiling from the last unit of a fiber painted on a mesh: tiles' up = the unit's offset
   direction = the normal.
2. Place Auto switches to Surface whenever the pointer is over a mesh (any brush); at a depth elsewhere as now.
3. A fiber painted on a surface: with helix settings (Twist ≠ 0 or an Offset) it keeps them (units turned about the path
   as set); a plain walk (Twist 0, no Offset) has its units' up along the surface normal, as a grown walk.
8. and 21. Helix and Spiral: Count (copies) and Turns both editable, linked: setting one sets the other (Turns → the
   copies those turns hold; Count → the turns reached); Count prefix-stable as now. The helix's length by copy count.
11. Tiling: Count in space too (Rings gone): in space the hex/square rings filled in order up to Count; sessions with
   Rings read as their count.
13. Color… on a VTP leaves an array color theme alone (it applies to uniform-colored meshes only; an array-themed mesh
   says so in the menu's title).
- The spec (ui.md, features.md) records every answered decision of the doc, the "keep"s included.

**Shared rules for the night.** New code in new files where it can be; edits to operations.ts, controls.tsx, paint.ts
kept to the wiring (four lanes touch the mesoscale package). Nothing pushed, no PR. Tests fail first; the gate
(lane-reviewer, then lane-skeptic); progress file, `.v6/changelogs/decisions.md`, ui.md and features.md.

**Size.** ~250 production lines. **Model.** Sonnet; Opus subagent for items 1 and 3. **Port.** 1369
(`node scripts/esbuild/app.mjs apps/prism-me --dev --port 1369`, log `~/prism-me-lanes/dev-1369.log`), left
running for Ludo's morning try.
