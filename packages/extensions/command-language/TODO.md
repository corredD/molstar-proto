# Command language: to do

What is missing, and what was considered and deferred; an entry leaves when it is done (its `_spec` section says so
then). The spec: [\_spec](_spec/README.md).

## Next

- **Readable targets**: an atom set written back as an address list (`A`, `B:12-14`) instead of source-index ranges
  (`compactExpression`), so the inspector reads it and MVS takes it as schema selectors.
- **A key for the console** (\` was proposed): Prism's keybindings name commands; `script.console` could take one.

## Later

- **MolViewSpec export** of a script's result: in `packages/mvs`, separately.
- **Per-representation colors, sizes and transparency in PyMOL** (`cartoon_color`, `stick_radius`, `sphere_scale`,
  `cartoon_transparency` on one type only): the style layers are per atom over every type (a warning says so).
  Transparency can now be per type (`representation.transparency`'s `types`, used by ChimeraX); colors and sizes cannot
  yet (ChimeraX's `color … target c` and `size stickRadius` warn the same way).
- **A theme on part of a component** (`spectrum b, …, chain A` where the component holds more): Mol* themes whole
  components, so the rest is colored too (a warning says so); the console could split the component first.
- **Element lists in PyMOL selections** (`elem N+O`): query-language's PyMOL transpiler reads one element;
  `(elem N or elem O)` works.
- **PyMOL**: `set_view`, `scene`, maps (`isomesh`), `iterate` with `print`, `set_name`. **VMD**: `mol addfile`,
  `atomselect macro`, `mol rename`, `HBonds`.
- **Jmol** commands: another table on the same IR.
- **ChimeraX's volumes** (`volume`, `open emdb:…`, `volume … level`, `surface` of maps): the next branch; they need IR
  kinds for volumes (the IR has none).
- **ChimeraX as a core `Script['language']`** (Prism's targets, MVS, the plugin's selection languages): the extension
  imports query-language's parser now; adding it to `@molstar/core`'s union reaches every consumer (a public API).
- **ChimeraX**: named views (`view name`, `view N`), `clip`, `cofr`, `color name` (defining colors), `info chains`,
  `info residues`, `label` sizes and colors, `2dlabels`, `turn … frames` as an animation, `roll`, `hbonds`, `contacts`.
- _*ChimeraX's spec matching where Mol* reads the structure differently_*: chain ids are matched ignoring case
  (ChimeraX: unless the structure has lower-case chains); a residue number that matches no residue is not tried as a
  name (ChimeraX tries); zones and `#`-terms do not reach across structures (each structure's part is its own).
- **ChimeraX's atom styles at load**: ChimeraX's auto-style (ions as balls, waters hidden) is not applied; atoms not
  styled are sticks.
