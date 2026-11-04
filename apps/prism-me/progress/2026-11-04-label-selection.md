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

## Built (2026-11-04)

- `stage.label` takes a `selection` (a `DistanceTarget`: a text, `A:10@CA`, `A:10`, `chain A`, `ligand`,
  `<list ref>#<index>`, or a pick `{ loci }`), resolved by `stage.distance`'s `distancePoint` and `pointLoci` (one small
  `labelPoint` wrapper, no new parser). The label sits at the point's bounding-sphere centre (the centre a distance
  measures from), sized by the part's radius as before, in front of it by its radius and at least its height (one atom
  has no radius). Its target is the point's object, so `stage.move` carries it; its row the given one, else its
  object's. No text: named after the point ("ARG 10 CA (A)"); `text`'s default is now `''` (`|| 'Label'` keeps the old
  outcome). A selection and x, y, z together, or a selection of nothing, fail with a clear message. `target` scopes a
  text selection to a structure.
- The stage skill's guidance and `add_label`'s description say it ("label residue A:10" is selection A:10).
- ⌘K: the selection is the form's first field and optional (`order`, `form`), so "add label A:10" labels residue 10 and
  an object's or a point's label still runs without one (review must-fix: it had become required).
- The right-click's Add a label: a pick smaller than its row (at the selection's granularity: an atom, a residue) is
  labelled itself (`addLabel`'s `loci`, from `ui.tsx`'s request); a chain's or an object's pick as before.
- Spec: features.md (Commands row, a new row), ui.md §5 (Add label), `.v6/changelogs/label-selection.md`, TODO (the move
  caveat, the review's leftovers).

## Decided

- Ludo: "Ours takes a selection" (the brief). Mine: the param is `selection` (the brief's word; `target` stays the
  object and scopes a text selection, no `structure` param); "smaller than its row" by element count rather than by
  granularity names, so a chain pick under a multi-chain entity row is labelled too.

## Learned

- The default selection granularity is residue, so right-clicking an atom labels its residue (the highlighted pick).
  Ludo's check "the label is on that atom" needs Atom granularity. Question for Ludo: keep the granularity's pick, or
  always the atom?
- ⌘K has two label commands: Prism's Measure › Label an atom or residue… (alias `label`) comes first for "label A:10";
  the stage's is "add label A:10". Hiding Prism's measurement commands in prism-me is Ludo's call (TODO).
- "residue A:10" is not a target in Prism's language (PyMOL reads it and fails); "A:10" is. The assistant maps it.

## Review

Reviewer: 1 must-fix, 4 should-fix, 6 nits. Skeptic: confirmed 1, 3, 7, 9, 10, N1 (⌘K form untested); 2 confirmed as
spec'd (question for Ludo); 4 partly (test gap only); 8, 11, N2 plausible; 5, 6 refuted.

- Fixed: 1 + N1 (df3d4c5f4, with an invocation test), 3 (c0d6c279d, through `nodeMenuItems`; `ui.tsx`'s line itself
  still untested: TODO), 4 (c5a378c8b), 7 (64881e9c2), 10 (5f604878c).
- Left: 2 (Ludo), 8 (`target`'s description says it scopes a selection), 9 (a pick names its own object, kept), 11 and
  N2 (instance and operator granularities: TODO).

## Checked

- Tests of stage-tools and prism-me, `npx tsc -b`, `npx tsc --noEmit -p apps/prism-me`, `pnpm lint`,
  `pnpm format:check`, `pnpm check:workspace` (after `node scripts/workspace/assets.mjs`).
- Headed Chromium on http://localhost:1348/apps/prism-me/build/?pdb=1cbs: `stage.label { selection: 'A:10' }` → "ILE 10
  (A)" on residue 10
  (/private/tmp/claude-501/-Users-ludovicautin-molstar-pr-review/e37614fe-2a0d-4fa5-b9e0-0668f489ab66/scratchpad/label/1cbs-label-A10.png);
  a right-click on residue THR 49 › Add a label → "THR 49 (A)" on it, listed under the entity
  (/private/tmp/claude-501/-Users-ludovicautin-molstar-pr-review/e37614fe-2a0d-4fa5-b9e0-0668f489ab66/scratchpad/label/rclick-menu.png,
  /private/tmp/claude-501/-Users-ludovicautin-molstar-pr-review/e37614fe-2a0d-4fa5-b9e0-0668f489ab66/scratchpad/label/rclick-atom-label.png);
  ⌘K "add label A:10" → "ILE 10 (A)"
  (/private/tmp/claude-501/-Users-ludovicautin-molstar-pr-review/e37614fe-2a0d-4fa5-b9e0-0668f489ab66/scratchpad/label/cmdk-typed.png,
  /private/tmp/claude-501/-Users-ludovicautin-molstar-pr-review/e37614fe-2a0d-4fa5-b9e0-0668f489ab66/scratchpad/label/cmdk-label-A10.png).
  The assistant end to end was not run (no model key).

## Size

About 110 production lines against the brief's 40: the ⌘K form fix, the row path kept beside the pick path in
`addLabel`, and the messages.

## Ludo's answers to the lane's questions (2026-11-04)

- Right-click › Add a label on an atom: **"Follow the granularity"**, the label goes on what was highlighted (a residue
  by default, an atom in Atom mode). As built.
- ⌘K, Prism's own Measure › Label next to ours: **"Keep both"**. As built; nothing hidden.
