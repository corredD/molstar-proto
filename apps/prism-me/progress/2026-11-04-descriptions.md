# Lane descriptions (2026-11-04)

Branch `me/descriptions`, worktree `~/prism-me-lanes/descriptions`, dev server port 1347.

## Brief (Ludo, 2026-11-04)

"one thing we are missing is a description field, like in mesoscale explorer. When mouse hover [the classic explorer's
hover box: **ITG** / "Integrin alpha-5, important for cell adhesion and signaling."]. Mouse over has the same info, but
add any short description available. That info also appears in the properties panel [the classic Focus Info: the name,
then the description]."

### What was found (2026-11-04)

- The text is in the file. The CellPack Exosome example
  (`https://mesoscope.scripps.edu/explorer/examples/cellpack_apr2024_instances.bcif`, 5 MB) has 36 `_entity` rows, with
  text such as "Integrin alpha-5, important for cell adhesion and signaling." and some with a markdown link ("… PDB
  entry [5TCX](http://www.rcsb.org/…)"). **Which column holds it is not yet checked**: `details` or
  `pdbx_parent_entity_id` (the classic `apps/mesoscale-explorer/src/data/cellpack/model.ts:170` reads
  `pdbx_parent_entity_id` as the description, and its `preset.ts:176` reads `details` as the function). Check first, on
  this file and on CellPack MG and one PetWorld example.
- The particles model (`packages/model/src/formats/particles/mmcif.ts:341-358`, `ParticleEntityInfo` in
  `packages/model/src/model/particles/particle-list.ts:40`) keeps `_entity.details` as `function` (used by the
  by-function colour themes and the mesoscale grouping, `extensions/mesoscale/src/model.ts:79-116`). There is no
  description field.
- The classic explorer shows `**label**\n\ndescription` as markdown (`apps/mesoscale-explorer/src/data/state.ts:482`) on
  hover and in Focus Info.

### Steps

1. **Read the description.** Find the column. If it is `details` (today's `function`), do not overload `function` with a
   sentence: the by-function themes and grouping need short categories. Add an optional `description` to
   `ParticleEntityInfo` (library: `packages/model`, the smallest change, its own commit with a test, marked as an
   upstream candidate) and decide, with the evidence, what `function` keeps for files whose `details` is a sentence.
   Report that decision in the PR. Other sources, only where already loaded: a structure's entity `pdbx_description`
   (the label today?), a portal annotation's object name or description if the index has one (do not rebuild the index
   for this lane; list it as open if absent).
2. **Hover.** The canvas hover label shows the entity name (as today) and, under it, the short description (one or two
   lines, ellipsis past that; markdown links rendered as text or links, no raw `[..](..)`). Reuse Prism's hover label
   (its loci label provider / markdown label), not a new overlay; match the classic look (name, then text).
3. **Properties panel.** The picked entity's (or particle's) properties show the same description under its name, in the
   existing explorer properties (`apps/prism-me/src/explorer/properties.tsx`), no new tab. Also the tree row's tooltip,
   if rows have one.
4. Spec in the same commits: `apps/prism-me/_spec/features.md` (Mesoscale Explorer parity: descriptions on hover and in
   the properties), `ui.md` if it lists the hover label, `.v6/changelogs/descriptions.md`, the TODO.

### Tests

- Fails first: the exosome-like fixture (a small cellPACK mmCIF with one `_entity` row carrying the text, made in the
  test, no network) gives the entity's description; the MG-like row (short `details`) keeps its function.
- The hover label of a particle of that entity has the name and the description; a description with a markdown link
  shows no raw brackets.
- The properties of the picked entity show the description (jsdom, as the other properties tests).
- Headed Chromium (`--enable-unsafe-webgpu`, Playwright from the worktree, port 1347): `?example=cellpack-exosome`,
  hover an ITG particle: screenshot of the hover label with "Integrin alpha-5, …"; click it: screenshot of the
  properties with the same text. Also CellPack MG (no regression of the by-function colour).

### Ludo's check

http://localhost:1347/apps/prism-me/build/?example=cellpack-exosome: hover an integrin (ITG): under its name, "Integrin
alpha-5, important for cell adhesion and signaling."; click it: the same text in the properties under its name.

Size: about 120 production lines (reader 25, hover 40, properties 40, the rest specs), plus tests.

## Built (2026-11-04)

- **Reader** (`packages/model`, upstream candidate: `dac4930de`, `43de664ef`): `ParticleEntityInfo.description`, from
  `_entity.pdbx_parent_entity_id` in the cellpack variant, raw Markdown; not a dotted name with no space (a compartment
  path) and not the entity's name. `function` keeps `_entity.details`.
- **Hover** (`packages/model`, `78c0b8514`): a single particle's loci label puts its entity's description between the
  bold particle line and the small list line; Markdown links as their text, escaped, cut at a word at 90 characters with
  an ellipsis. Prism's hover label shows it as is (`hoverRich`), no new overlay.
- **Properties** (`242ccdfe1`, `48d9c01e0`): `MesoEntity.description`; `PropertiesFrame`'s `description` (prism-ui
  `Markdown`) under the header for a picked model entity; story Explorer/Properties/Model Entity.

## Decided

- The column (checked on the deployed files, 2026-11-04): the Exosome (`cellpack_feb2024_exosome.bcif`, the one
  `?example=cellpack-exosome` loads; the brief's apr2024 file is the same) has the sentence in `pdbx_parent_entity_id`,
  `details` empty. MG: `details` a short function (571 of 572 entities), the parent column the entity's compartment.
  HIV: the parent column a compartment, for its membranes another one (`root.HIV_capsid.membrane`; found by the review).
  PetWorld (flagellar motor): only `id` and `pdbx_description`. So `function` is untouched and no sentence goes into it.
- Where the hover text goes: in Mol*'s particle label, not a provider of the extension: a provider's line can only come
  before the title or after the list name, not "under its name".
- Two lines by a character cut (90): the label's width is Prism's; a CSS line clamp would be a Prism change. The 32
  Exosome descriptions fit two lines at the label's 280px (HLAI, 88 characters after the cut: two lines).

## Checked in the app (headed Chromium, WebGPU, port 1347)

Screenshots in the session scratchpad `shots/`: `cellpack-exosome-before-hover.png` (today: no description),
`cellpack-exosome-after-hover.png` (ITG: "Integrin alpha-5, important for cell adhesion and signaling." under its name),
`cellpack-exosome-after-properties.png` (clicked: the same under ITG in the properties),
`cellpack-exosome-long-hover.png` (HLAI cut on two lines with "…"), `cellpack-mg-after-hover.png` (MG: no description
line). MG's Group by Function: 17 function groups, 0 descriptions. Storybook: Model Entity in light, dark, 360px and
260px.

## Learned

- `pdbx_parent_entity_id` is cellPACK's free column: a sentence in the newer recipes, a compartment path in the older,
  `protein_label` (the writer's placeholder) in some archive files (not in the example list: left, review nit).
- The worktree's `check:workspace` needs `node scripts/workspace/assets.mjs` once (plugin-ui's `./*.css` export).

## Review

Reviewer 10 findings (1 must, 3 should, 6 nits), skeptic: 1 fixed (`43de664ef`, failing test first), 4 recorded here, 2
refuted (6: the measurement list gets structure loci only; 9: a `#` link is inert), the rest nits left open: the
`protein_label` placeholder, the description read once per pick (window under a frame), a cut splitting a surrogate pair
or after an early space, the first entity winning a shared name, a parse per hover, Markdown images loaded in the
properties (as the classic Focus Info).

## Size

About 75 production lines with their comments (reader, label, mesoscale, properties) against the brief's 120: the hover
reused Mol*'s label and Prism's hover label whole; plus about 230 lines of tests, the story and the specs.
