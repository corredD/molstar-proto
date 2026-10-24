# Color file import (2026-10-24, lane `me/color-file-import`, PR #3)

The TODO Backlog's "Color file import (JSON, by entity name)", taken from Deferred to Done.

## Built

- `mesoscale.importColors` (`packages/extensions/mesoscale/src/operations.ts`): one JSON file of colors by entity name,
  applied in one commit (one history step). It reads the Mesoscale Explorer's file (v5 `loadColors`: the full cellPACK
  name, `{x, y, z}` integers in 0-255) or a plain `{"<entity>": "#rrggbb"}` map. A key matches by full name, else by the
  last dotted part. Its result lists the names not found, the values that are not colors, and the entities named twice.
  A ⌘K command and an agent tool `import_mesoscale_colors`.
- `color-file.ts`: the parse and the match (names indexed once in a Map).
- Import colors… (`ImportColors` in `controls.tsx`) in a model's Look in prism-me's properties.
- Tests: quick (the formats, the failures, one undo step, names twice, the control in jsdom with two models) and a
  `test:scaling` for the extension (new script and config). Sample: `data/examples/mesoscale/cellpack-hiv1-colors.json`
  (CellPack HIV, keys as v5's, with its duplicates and one name not in the model).
- Tried in the app (headless Chromium, software GL): 44 of 45 entities colored, the message said, one undo restores.

## Decided

- The button lives in the model's Look, not the Entities tab: prism-me hides that tab (`HiddenParts`). The coordinator's
  correction (the first build had it in both).
- Keys naming one entity twice (its copies in two compartments): the last color is kept and the entity reported in the
  result and the message. The coordinator's default after review (S2), for Ludovic to confirm: v5 colored each
  compartment's copy. Per-compartment colors are a TODO entry.
- 0-1 channels are reported as not colors, not drawn near black as v5 did (review N1).
- A file that cannot be read is logged as the plugin's error (`MesoscaleApi.fileUnreadable`), so it stays on the status
  line (review N4).

## Learned

- The particle model has one entity per name across compartments (`entityNameToIdx` in the particle mmCIF reader): in
  the HIV model RT, NC 1f6u, NC 1a1t, IN and the inner and outer membranes are each one entity for two compartments. A
  v5 color file colors them per compartment. (TAT is named twice in the sample only because it also has a plain-format
  entry.)
- A global gitignore rule `Data` (`~/.gitignore_global`) matches `data/` on macOS's case-insensitive disk: a new file
  under `data/examples` has to be force-added.
- A scaling case over a real viewer needs n large enough for the viewer's fixed cost not to hide a quadratic: a per-key
  scan read ×6.1 at 1000 → 4000 entities (passes the ×8 band) and ×12.7 at 4000 → 16000.
- In headless software GL the redraw after the import blocks the page past the status line's 4 s fade: check the message
  in the notifications history, not in a screenshot.
- `check:workspace` in a fresh worktree after `tsc -b` needs `node scripts/workspace/assets.mjs` (plugin-ui's CSS).

## Size

The brief gave no size. About 245 production lines (`color-file.ts` 104, `operations.ts` +85, `controls.tsx` +41,
`prism-viewer.ts` +12, `properties.tsx` +2), 400 lines of tests, the sample file, the spec lines. What took the room:
the review's five nits and three should-fix findings (8 commits after the first two).
