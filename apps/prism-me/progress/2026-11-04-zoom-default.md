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

## Built (2026-11-04)

- `ZoomColorsMmcifParticlesProvider` (`packages/extensions/mesoscale/src/formats.ts`): the `mmcif_particles` format with
  `complexVisuals(plugin, data, { params })`, the params `withColorLevels({ params: { structure: {} } }, true)`
  (`withColorLevels` exported from `operations.ts`, so the shape of "on" has one writer).
- `withZoomColorsAtLoad` (`apps/prism-me/src/formats.ts`), applied to the base extensions in
  `createMesoscaleExplorerSpec`: the lazy `particles` feature's `load` wrapped, its registry's `MmcifParticlesProvider`
  replaced by the provider above (`replaceFormat`, which `withTomogramSlices` now uses too).
- Tests (`apps/prism-me/src/_test/zoom-default.test.ts`, failing first in `c611ce3c2`): the cellPACK fixture (the
  descriptions test's, moved to `src/_test/fixtures.ts`) loaded through `load.files` on prism-me's spec: its target made
  with the levels on (the defaults) and the type's other params kept, Particle 3D objects created once and never
  updated, Look's graphics state On; Off one step; Prism's own spec: off.
- Spec: `features.md` (a row), `ui.md` §4 (a paragraph under the sections' table), `.v6/changelogs/zoom-default.md`.

## Decided

- **The swap is in the lazy feature's load, not in `finalize`** (differs from the brief's "same pattern as
  `withTomogramSlices`"): `mmcif_particles` is registered by the lazy particles feature when it loads
  (`extension-plugin.ts`), after `finalize`, and `DataFormatRegistry.add` throws on another provider under a name
  already there, so neither `finalize` nor an eager registry entry can do it. The wrapper keeps the format's name (the
  stub's `owns.formats` and sniff still match), registers once, and loads its two modules with the feature's chunk
  (checked: the dev build's static closure from `index.js` holds no mmCIF particles provider).
- **Partial params:** `{ structure: { colorLevels: on } }` is enough; the state fills the rest
  (`normalizeParams(…, 'all')` in `state.ts` `resolveParams`; probe: 16 top-level and 29 structure keys, as a default
  load). The test guards it (the structure's `type` and `sizeFactor`).

## Cost (measured 2026-11-04, Chrome headless, M1 Pro, the machine loaded: load average about 30)

Frame time in ms, `zoom-bench.mjs` as is on port 1347, median of 3 runs, at fractions of the load distance. On: this
branch's load; off: the same page after `mesoscale.colorLevels { on: false }` (checked off before measuring).

| Model, backend       | 1 on \| off  | 0.1 on \| off | 0.02 on \| off |
| -------------------- | ------------ | ------------- | -------------- |
| CellPack MG, WebGPU  | 12.0 \| 11.9 | 24.7 \| 23.8  | 17.1 \| 16.5   |
| CellPack MG, WebGL2  | 44.2 \| 42.9 | 89.5 \| 84.0  | 79.3 \| 74.6   |
| PetWorld HIV, WebGPU | 29.0 \| 28.8 | 14.1 \| 13.8  | 19.5 \| 19.0   |
| PetWorld HIV, WebGL2 | 44.3 \| 42.0 | 90.3 \| 84.7  | 65.8 \| 61.4   |

- **On costs 1 to 7 % over off** (WebGL2 zoomed in the most, 5 to 7 %), under the dynamic-color lane's 14 %.
- **Load time unchanged:** navigation to the target representation ready and drawn, WebGPU, median of 3 after a warm-up:
  CellPack MG 8288 ms here against 8398 ms on `origin/prism-me` (`d8890437d`), PetWorld HIV 1149 against 1177. One
  representation each, its `transform.version` unchanged 6 s after the load and a zoom (nothing built twice).
- Headed Chromium (WebGPU): far and zoomed-in shots of both examples show the colors change with the zoom
  (compartment/entity far, chains and CPK atoms close); a model's Look shows By zoom on, its Entity 3, Chain 10, Atom 30
  px edges. No console error.

## Learned

- A lazy Prism feature's registry is outside `finalize`; an app changes it by wrapping the stub's `load` (the host
  retries through the wrapper after a failed load, and its undo unregisters the swapped provider).
- Session restore keeps the saved levels (a session saved off reopens off); a list given targets later
  (`particles.targets`) gets a target representation with the defaults, off: outside "at load".

## Size against the brief

About 30 production lines asked; about 80 added with comments, 10 removed (`formats.ts` of the app 53 with
`replaceFormat` shared with `withTomogramSlices`, which lost 8; the extension's `formats.ts` 23 with its comment; 3 in
`spec.ts` and `operations.ts`). The room went to the lazy-load wrapper the brief did not foresee.

## Review

Reviewer: 0 must-fix, 1 should-fix (S1: the cost numbers and the in-app check missing: done above), 4 nits. Skeptic:
none refuted; 3 nits of its own. Fixed: N3 the control on prism-me's spec without the swap (`7e9bc9af2`), N4 the
changelog section (`0d3de5cbc`), the import order (`0514939b5`). Left: N2 the swap is silent if the particles feature
becomes eager or renamed (test 1 fails then), N5 the `replaceFormat` move rides in the feature commit, no PetWorld
fixture (checked in the browser), later-added targets come up off (outside the brief).
