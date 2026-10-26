# Measuring outside selection mode says so (2026-10-25, lane `measure-hint`)

## Brief

- **Asked** (Ludovic, 2026-10-25, the TODO `Next` item "A distance follows its objects", hint only for now): measuring
  outside selection mode says so (a hint) instead of nothing. **Check:** selection mode off, ⌘+click (Ctrl off a Mac) a
  structure: the status line says to turn selection mode on to measure, and the row is still revealed; with selection
  mode on, measuring works as before.
- **Left out, decided by Ludovic (2026-10-25):** the distance following its objects' later moves needs a Mol\* core
  change (`packages/core/src/state/state.ts`, `initCells` :1181 and the delete loop :703-721: a dependency on an object
  is one on the object as decorated); it waits for his talk with the maintainer. When it is built, the distance follows
  live during a drag (Ludovic), not on release. This lane writes both into TODO.md (Backlog) and leaves ui.md's follow
  wording alone.
- **Where:** `apps/prism-me/src/explorer/ui.tsx:96` sends a measure click to the picker only in selection mode; the
  picker returns silently outside it (`measure.ts:52-55`). The hint goes on Prism's status line,
  `managers.notifications.post` (`packages/prism/ui/src/managers/notifications.ts:178`, fades after 4 s), already wired
  in ui.tsx as `post` (:84-90, consecutive duplicates dropped). Text: "Turn on selection mode to measure: ⌘+click two
  points" (Ctrl off a Mac, as the app's own key label).
- **Spec:** `_spec/ui.md` §7 ("with no hint about measuring" becomes the hint); `features.md` distances row if it says
  so; TODO.md: the hint item done, the follow and "follow live" to the Backlog, the click-routing tests item narrowed.
- **Tests** (fail first): `apps/prism-me/src/explorer/_test/measure.test.ts` (or a sibling): mount
  `explorerUI({ api, sources, managers })` headless as `group-by.test.tsx:110` does, drive
  `plugin.behaviors.interaction.click.next` with `{ control: true }` and `area.mac = false` as `measure.test.ts:191-219`
  does, selection mode off: the hint is posted to the notifications manager and the row is revealed; selection mode on:
  no hint, a point is picked.
- **Touches:** `apps/prism-me/src/explorer/ui.tsx` (and `measure.ts` if the text lives there), its test, `_spec/ui.md`
  §7, `features.md`, `TODO.md`. **Stays off:** `rows.ts`, the extensions, Prism (lane `looks-owner`).
- **Size:** ~10 production lines; test ~60.
- **Steps and models:** 1. the test, failing (Opus) 2. the hint (Opus) 3. checks (Sonnet) 4. the gate (Opus reviewer,
  skeptic).

## Built

- A ⌘+click on a Mac, a Ctrl+click elsewhere, outside selection mode posts "Turn on selection mode to measure: ⌘+click
  two points" (Ctrl+click off a Mac) on the status line, through the explorer's `post` (consecutive duplicates dropped),
  then picks its row as before (`ui.tsx` `setOnClick`). The gesture's word is built once (`measure.ts` `measureGesture`,
  `selectionModeHint`), for the picker's messages and the hint.
- `_test/measure-hint.test.ts` (jsdom, headless viewer, 1CRN): `explorerUI` wired (no mount needed: the click routing is
  set in `explorerUI`), clicks through `plugin.behaviors.interaction.click`. Off: the hint (Ctrl and ⌘), the row picked,
  a click on nothing hinted too, a plain click not; on: a first point taken, no hint. Failed first at the hint
  assertion.
- `_spec/ui.md` §7 (the hint, also on nothing), `features.md` (the distances row), TODO.md (the Next item out; the
  follow, live during a drag, to the Backlog; the click-routing item narrowed to the label case),
  `.v6/changelogs/measure-hint.md`.

## Decided

- The hint shows on any measuring click outside selection mode, on nothing too (lane, after the review: in selection
  mode a modifier click on nothing already says "Ctrl+click one"; the hint matches it). To change if Ludovic prefers it
  only on a hit.
- The follow and "live during a drag" wait (Ludovic, 2026-10-25), in the Backlog.

## Learned

- `import.meta.url` is not a file URL under vitest's jsdom environment: read test data with
  `resolve(import.meta.dirname, …)`.
- `pnpm check:workspace` needs the gitignored `lib/*.css` assets in a fresh worktree: run
  `node scripts/workspace/assets.mjs` once (or `pnpm build:lib`).
- The explorer's `post` drops a text equal to the one still showing: a repeat click in 4 s neither re-posts nor restarts
  the fade (inherited, kept).

## Size

Production 17 lines added, 10 removed (brief: ~10), test 113 (brief: ~60): the test covers both platforms and the click
on nothing.

## Review

Reviewer: 0 must-fix, 2 should-fix, 4 nits. Skeptic: 4 confirmed (1 not the lane's, 1 in part), 2 refuted, none new.

| Finding                                                             | Severity                   | Verdict                                                      | Commit / open                                       |
| ------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------ | --------------------------------------------------- |
| 1. TODO.md:13 "the first two in parallel" now names the gizmo lane  | should-fix (coordinator's) | confirmed; outside the lane (only distance items in TODO.md) | open: for the coordinator (and progress/current.md) |
| 2. The hint also on a Ctrl/⌘+click on nothing                       | nit (was should-fix)       | confirmed in part; consistent with selection mode            | ccc2a10dc (ui.md says so), e47104b26 (test)         |
| 3. A repeat click does not restart the hint's fade (dedupe)         | nit                        | confirmed, inherited                                         | kept; in Learned and the PR notes                   |
| 4. The ⌘ sub-step did not prove its row revealed                    | nit                        | refuted as stated (same row); real gap confirmed             | e47104b26                                           |
| 5. "measures as before" named more than it checks; needless `until` | nit                        | confirmed                                                    | e47104b26                                           |
| 6. Progress sections empty                                          | nit                        | refuted (filled after the gate)                              | this commit                                         |
