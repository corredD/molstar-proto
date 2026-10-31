## Prism: the UI scale

- Settings › Appearance › UI scale, − and +, and View › Larger UI, Smaller UI, UI at 100 %: the whole UI drawn from 90
  to 200 % for reading; the 3D canvas is not touched (its picture, pixel ratio and labels), only its region gets
  smaller as the panels grow. Kept per browser, as the theme.
- One CSS variable, `--msp-ui-scale`, on the shell's root: the size tokens and the box sizes in px of Prism's CSS
  multiply by it. New API: `UIScaleModel`, `ShellOptions.uiScale` / `ShellModel.uiScale`, `SettingsGroup.rows`
  (`SettingsRow`), `UIScaleRow`.
