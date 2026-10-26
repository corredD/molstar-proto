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

## Decided

## Learned

## Size

## Review

| Finding | Severity | Verdict | Commit / open |
| ------- | -------- | ------- | ------------- |
