# Lane label-selection (2026-11-04)

Branch `me/label-selection`, worktree `~/prism-me-lanes/label-selection`, dev server port 1348.

## Brief (Ludo, 2026-11-04)

Item 1 of the small items left by #46-#49. The question was: since #46, "label residue A:10" or "label the ligand" no
longer works, because the stage tools' `add_label` puts a label on an object (state ref) or a point (x, y, z in Å), and
Prism's `measure.label` (which took a selection) is hidden. Ludo's answer: **"Ours takes a selection"**. Our label tool
also accepts an atom, residue or chain ("A:10@CA", "ligand", a residue range) and puts the label at its centre, so the
assistant and the right-click menu use one label tool.

### What was found

- `stage.label`: `packages/extensions/stage-tools/src/operations.ts` ~line 569 (params ~571-586: a target by state ref,
  or x/y/z).
- `stage.distance` (~line 721) already resolves a point from a text: a structure's target (`A:10@CA`, a residue, a
  chain) or a particle (`<list ref>#<index>`), and a pick (`{ loci }`): the point type at ~line 1159. **Reuse that
  resolver** for the label's anchor; no new selection parser, no copy of Prism's `measure.label` code.

### Steps

1. `stage.label` takes a selection the way `stage.distance` takes a point: its label sits at the selection's centre (one
   atom: the atom; several: their centre), in front of it as an object's label is today. Object and x/y/z forms
   unchanged.
2. The stage skill's guidance (`packages/extensions/stage-tools/src/prism-viewer.ts`, `StageSkill`) says it, so the
   assistant uses it for "label residue A:10".
3. The right-click menu's Label on an atom or residue pick labels that pick (if it labels the whole object today).
4. Note, do not fix: a label on a selection may not follow a later move of its structure (the same open core issue as
   distances, in current.md's Waiting on Ludo).
5. Spec in the same commits: `apps/prism-me/_spec/features.md` (the #46 row that says a label cannot take a selection;
   the stage tools' label row), `.v6/changelogs/label-selection.md`, the TODO.

### Tests

- Fails first: `stage.label` with `A:10@CA` on a headless viewer with 1CBS (or the repo's structure fixture) gives a
  label at that atom's position; a residue gives its centre; a bad selection fails with a clear message.
- The assistant path: the explorer's agent has `add_label` with the selection parameter in its schema.
- Headed Chromium (`--enable-unsafe-webgpu`, Playwright from the worktree, port 1348): load a PDB entry, run the label
  with a residue from ⌘K or the API, screenshot.

### Ludo's check

On http://localhost:1348/apps/prism-me/build/?pdb=1cbs: ask the assistant (or ⌘K) "label residue A:10": a label sits on
residue 10. Right-click an atom › Label: the label is on that atom.

Size: about 40 production lines, plus tests.
