# Group by function: a Compartment / Function switch (2026-10-24)

Lane `me/group-by-switch`, PR #2 (corredD/molstar-proto). The brief: TODO.md's Backlog line "A group-by switch
(compartment, function) in the Entities tab"; features.md "Group by function" from Partial to Done.

## Built

- `mesoscale.entities` and `mesoscale.style` take an optional `groupBy`. `MesoscaleInfo` says `hasCompartments`.
  `infoState(particles, groupBy)` follows a grouping state.
- A model with compartments has a Group by switch (Prism's `Choices`) in its properties, above its sections, and its
  Scene tree rows follow it. The grouping is the explorer's view state, keyed by model ref (`SceneModel.groupings`, a
  `keyedState`): there is no operation and no history step, and a switch remakes only that model's rows.
- Function groups are keyed apart (`g:<ref>:fn:<name>`) only when the model has compartments, so sessions saved before
  keep their keys.
- A label made at a group that the current grouping does not show sits under its model.
- Look's and the right-click menu's Generate colors follow the model's grouping.
- A removed object's parts and grouping are forgotten.
- A rule in AGENTS.md (the explorer's four places), with its guard (`src/_test/hidden-parts.test.ts`).

## Decided

- The switch first went into the extension's Entities tab, as the brief said. Ludovic corrected this: the switch goes in
  the scene tree's model properties, because prism-me hides extension tabs. This became the rule "the explorer's four
  places" in AGENTS.md. The tab switch was dropped, because no app shows that tab.
- The grouping is view state, not an operation's (the lane's choice, stated in the PR).
- A label on a group that is not shown attaches under its model and goes back under the group when that grouping
  returns. This is the coordinator's default, for Ludovic to confirm.
- Group rows act by entity ids, so eyes, Look, clips and picks need no grouping. `style`'s `groupBy` serves ⌘K and the
  agent.

## Learned

- **The hidden-tab trap.** A brief can name a place the app does not show: prism-me removes the extensions' tabs
  (`HiddenParts`). The first build passed every test and was invisible in the app. Before building a view, check that
  the app shows the place it goes. The guard catches a new visible tab, a stale hidden id and a lazy extension. It
  cannot catch UI added inside a tab that is already hidden.
- Keys derived from view state (group keys per grouping) break whatever stores them: labels keep a row key. Any keyed
  reference needs a fallback when its row is not shown.
- The review gate found five real issues (S1–S5) that the feature tests did not cover.

## Size

The brief gave no line count.

| Part                                                                   | Lines      |
| ---------------------------------------------------------------------- | ---------- |
| Production (`git diff` vs `origin/prism-me`, excluding tests and docs) | +238 / −40 |
| Tests                                                                  | about +450 |

The production lines split as follows:

| Where                                                                   | Lines      |
| ----------------------------------------------------------------------- | ---------- |
| Mesoscale operations (`groupBy`, `infoState`)                           | +75 / −24  |
| Explorer: switch, keyed groupings, label fallback, menu wiring, pruning | +163 / −16 |

What took the room: the move from the tab to the tree (one rework commit) and the review fixes.
