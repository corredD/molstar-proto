# prism-me: what is not built

The deferred and partial features of [_spec/features.md](_spec/features.md), as work items (an entry leaves in the
commit that builds it). How a lane takes one: [AGENTS.md](AGENTS.md), How we work.

## Next

Ludovic's briefs, in the order to build them: one item a lane. Each says what he wants to see and how he checks it in
the app, in his words; the lane turns it into spec and tests.

<!-- - **Title**: what I want to see. Check: what I do in the app and what I expect. -->

- **Measure a distance, structures and particles** (Ludovic, 2026-10-24): like in the Mesoscale Explorer, click two
  points and have the distance labeled, with a line (Mol\*'s). Ctrl+click one, Ctrl+click two: the distance label
  appears as a child in the tree below the first selection. The line and the label are proportional to the object
  measured. Between atoms, residues, chains, instances and particle positions. Its options in the UI: text size, line
  width, opacity, and a ref to the two selections. Check: load CellPack HIV and 1CRN; Ctrl+click two atoms, then two
  particles; each label appears under its first pick's row; change the text size and opacity; undo once removes it.
- **Measure a distance, volumes** (after the first): the same between a volume and a volume pixel (voxel) and the
  targets above. Check: Ctrl+click a volume's voxel and an atom; the distance appears under the first pick.
- **Graphics quality and procedural animation on every object** (Ludovic, 2026-10-24): these options are only on
  cellPACK right now. They should be on every object in the tree: I can enable the wiggle (and tumble, and quality) on
  any tree entry; what does not apply to an object type is left out (e.g. wiggle on a volume). Check: load 1CRN,
  PetWorld HIV and a volume; wiggle 1CRN alone; set the PetWorld model's quality to performance and 1CRN is unchanged;
  the volume shows quality only.

## Library fixes ready for upstream

Each its own lane from `origin/master` (AGENTS.md, How we work), upstream only when Ludovic says so.

- Periodic volume slices drawn half a box away (`5affa6d17`).
- Plane slice sized in voxels used as Å (`ea7dc5d3e`).
- Gizmo: `rotate` axes option, `poseOfFrame`/`frameOfPose` (`ded144e8d`).
- MRC reader: mode 6, mode 12 (float16), `.rec`/`.st`/`.mrcs`/`.ali` (`33dbca0c5`, `59ef5aa38`).

## Backlog

- The Mesoscale Explorer's generic zip (`manifest.json`) and Martini `instanced_structure.json`, read to a particle
  list.
- Lightness, pattern, illustrative and cel shading per entity (particle layers beyond color, transparency, emissive);
  the explorer's quick styles for particles.
- Level of detail per entity; tumble except membranes.
- Color import per compartment (v5 parity): one entity per name across compartments; per-compartment layers
  (`ParticleLayerProps.compartments`) would restore it.
- Snapshot descriptions' links: `#key`, `i<names>`, `g<group>.<names>`.
- Tilt angles (`.tlt`, `.rawtlt`) with the images of a tilt series; binning large tomograms.
- Decorating by a string column (a tomogram name).
- Keys on cuts (animation).
- Upstream (Prism): Home counts particles as loaded; `particles.representation` on decorated lists; shapes in the scene
  tree.
- Storybook stories for the Entities tab, the Decorations and Slice rows, the Segmentations tab and the stage menu,
  checked in the light and dark themes (Prism's AGENTS.md asks one for each view a user sees).
- Deploy: a `prism-me/` prefix in `scripts/deploy.js` (and the distribution, if it ships there).
- The classic Mesoscale Explorer's sessions (`.molx` with its own transforms): a reader that maps them to prism-me's.
- Before upstream PRs: squash `Particles: targets that reference objects in the state` with its fix
  (`a target ref is any cell`), and check each library commit builds and passes its tests on its own (`git rebase -x`).
