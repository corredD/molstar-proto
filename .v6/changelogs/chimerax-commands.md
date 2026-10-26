## Command language: ChimeraX commands

- ChimeraX commands in the Prism viewer (`@molstar/command-language-extension`): the `chimerax ` prefix in the command
  menu (and `!` set to ChimeraX), a third dialect in the console, `.cxc` scripts (Import, `open file.cxc`) and the
  assistant's `run_commands`. `open`, `close`, `show`/`hide` (atoms, cartoons, surfaces, models), `style`, `cartoon`,
  `surface`, `color` (names, `byhetero`, `bychain`, …), `color bfactor`, `rainbow`, `transparency`, `size`, `select`,
  `name`, `view`, `turn`, `move`, `zoom`, `distance`, `angle`, `torsion`, `label`, `matchmaker`, `align`, `set`,
  `lighting`, `graphics silhouettes`, `camera`, `save`, `undo`, `redo`, `info`; abbreviations as ChimeraX resolves
  them; every other ChimeraX command fails saying so.
- `@molstar/query-language`: a ChimeraX atom-spec transpiler (`transpilers/chimerax/parser`: `#1/A:12-20@CA`,
  selectors, attribute tests, zones), checked against ChimeraX 1.10's atom counts.
- Prism: `representation.transparency` takes `types`, to make some representations transparent only.
