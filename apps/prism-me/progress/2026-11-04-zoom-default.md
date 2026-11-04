# Lane zoom-default (2026-11-04)

Branch `me/zoom-default`, worktree `~/prism-me-lanes/zoom-default`, dev server port 1347.

## Brief (Ludo, 2026-11-04)

"can we make the color by zoom on by default for the cellpack and petworld model."

### What was found (by reading the code)

- Colors that follow the zoom are a particle representation's `type.params.structure.colorLevels` (`on` with
  `ColorLevels.defaults`, or `off`), set by `mesoscale.colorLevels` (`packages/extensions/mesoscale/src/operations.ts`
  ~line 473) through `withColorLevels` (~line 1044). Today they start off; Look › By zoom turns them on.
- A cellPACK or PetWorld file (example, URL, drop) loads through `MmcifParticlesProvider`
  (`packages/plugin/core/src/state/formats/particles/mmcif-assembly.ts:118`, format `mmcif_particles`), whose `visuals`
  are `complexVisuals(plugin, data)` (`provider.ts:50`; it takes `targetProps.params` for the target type).
- prism-me already swaps a format's visuals in its spec: `withTomogramSlices` (`apps/prism-me/src/tomograms.ts`),
  applied in `createMesoscaleExplorerSpec`'s `finalize`.

### Steps

1. **On at load, prism-me only:** the `mmcif_particles` format's visuals in prism-me's spec make their target
   representations with colors that follow the zoom on (the defaults), in the same build: no second update of a large
   model after it is drawn (check that a partial `targetProps.params` does not drop the target type's other defaults; if
   it does, build the full params from the provider's defaults, or reuse `withColorLevels`). Same pattern as
   `withTomogramSlices`; the helper that knows `ColorLevels` lives in the mesoscale extension (exported), the spec only
   applies it. No library default changed: Mol\*'s own viewer keeps them off.
2. Simularium (the other `complexVisuals` user) stays as it is.
3. Look › By zoom shows On after a load, and Off still turns them off (one undo step as today).
4. **Cost:** frame time of CellPack MG and one PetWorld example, far and zoomed in, off against on (the dynamic-color
   lane measured up to 14 % zoomed in: `progress/2026-10-30-dynamic-color.md`); and load time, so nothing is built
   twice. Report the numbers; no optimisation in this lane.
5. Spec in the same commit: `apps/prism-me/_spec/features.md` and `ui.md` §4 Look (on by default for cellPACK and
   PetWorld), `.v6/changelogs/zoom-default.md`.

### Tests

- Fails first: on a headless viewer with prism-me's spec, a small cellPACK fixture (an existing test fixture) loaded
  through `mmcif_particles` has its target representations' `structure.colorLevels.name === 'on'`; the same file in the
  default Prism spec has it off.
- The representations are created once (no update after the visuals' commit).
- Headed Chromium (`--enable-unsafe-webgpu`, Playwright from the worktree): `?example=cellpack-mg` and
  `?example=petworld-hiv`: far and zoomed-in screenshots (the colors change with the zoom); Look › By zoom reads On.

### Ludo's check

http://localhost:1347/apps/prism-me/build/?example=cellpack-mg: zoom in, the colors go from the compartment's to the
entity's, chain's and atom's without touching Look; Look › By zoom is On. Same with a PetWorld example and a dropped
cellPACK file.

Size: about 30 production lines, plus tests.
