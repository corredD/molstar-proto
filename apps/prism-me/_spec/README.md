# prism-me: the Mesoscale Explorer on Prism

prism-me is the Mol\* Mesoscale Explorer rebuilt on the Prism viewer (`packages/prism`): mesoscale models (cellPACK,
PetWorld) and cryo-ET data (tomograms, tilt series, particle lists, segmentation meshes) in one app. Prism's `TODO.md`
names this port "the test of the shell's modularity": the app adds three extensions to the Prism viewer with Mol\*'s
extensions (`FullPrismViewerSpec`), and changes none of Prism's code (one of its tests also covers the new MRC file
names).

- **How it is built, where it is weak, and the decisions on it:** [architecture.md](architecture.md).
- **What it does, feature by feature, and what is missing:** [features.md](features.md). It is the checklist to test
  from (its last section).
- **cellVIEW, the Unity viewer before it:** [cellview.md](cellview.md), its scene tree and cut mapping, as read from its
  code (a reference, not a decision).
- **Decisions** (Ludovic, 2026-10-18):
  - Everything mesoscale is the particles model (`ParticleList`, Alexander Rose's): cellPACK and PetWorld load through
    the plugin's `mmcif_particles`, so a mesoscale model and a cryo-ET particle list are the same thing, decorated by
    objects. The Mesoscale Explorer's group tree and per-entity controls work on particle entities and compartments.
  - From Stories Untold: the canvas's right-click menu, the commands. Not its story authoring.
  - Tomograms: loading (MRC modes 6 and 12, the cryo-ET file names), gray slices with a contrast window, a tilt series
    stepped image by image along z. Binning large tomograms is deferred.

## The parts

| Part        | Package                                   | What                                                                                                                                                                                   |
| ----------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The app     | `apps/prism-me` (`@molstar/prism-me-app`) | the page, the spec (the explorer's canvas look, the right button freed for the menu), the Mesoscale Explorer's URL                                                                     |
| Mesoscale   | `packages/extensions/mesoscale`           | the `mesoscale` area: entities and groups, their look, colors, motion, graphics modes, examples; the Entities tab, Home's examples                                                     |
| Cryo-ET     | `packages/extensions/cryoet`              | the `cryoet` area: decorations (what each target of a particle list is drawn as), targets by class, slices, segmentation meshes; the Decorations and Slice rows, the Segmentations tab |
| Stage tools | `packages/extensions/stage-tools`         | the `stage` area: the canvas's right-click menu, labels, moves (clips are Prism's)                                                                                                     |

Each extension is a `ViewerExtension` (viewer-spec.md §2): an API area whose operations are the only way its views, its
commands and the agent's tools change anything (one history step each), a skill for the agent, and lazy views. An
extension uses another's operations by id (`api.run('mesoscale.style', …)`) when the viewer has them, never by import.

## Library changes the app needed

Each is its own commit, with its tests, meant to go upstream on its own:

- CCP4/MRC: MODE 6 and MODE 12; `.rec`, `.st`, `.ali`, `.mrcs` open as maps.
- MVS: a plane clip whose normal points down cuts the right half (Stories Untold's H005).
- Particles (`ParticleListWithTargets`): targets that reference objects of the state (`ref`, through #1838's
  dependencies), updated in place when one changes; `ParticleListTargetsFromAttribute` (a target per class);
  `ParticleRepresentation3DLayers` (color, transparency, visibility, emissive by entity, compartment or target) and the
  target representation applying such layers.
- Shapes: the wireframe visual of OBJ, PLY and VTP meshes.

## Running it

`node scripts/esbuild/app.mjs apps/prism-me --dev --port 1343` (or `.claude/launch.json`'s `prism-me`), then
`http://localhost:1343/apps/prism-me/build/`. URL: the Prism viewer's options and loads, plus the Mesoscale Explorer's
`example`, `graphics-mode`, `url` with `type` (cif, bcif, molx, molj), `pdbihm`.
