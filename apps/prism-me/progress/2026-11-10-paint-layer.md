# Paint: the painted copies as a layer of their own (2026-11-10, lane `paint-layer`)

Plan: [../plans/2026-11-10-bucket-and-relax.md](../plans/2026-11-10-bucket-and-relax.md), F1. Stacked on `me/paint` (PR
#64, not merged yet).

## Brief

- **Asked** (Ludo, 2026-11-10): "there is still delay on the painting … after the click we need to wait for the instance
  to appear"; "yes do the painting layer". **Check:** on cellpack-mg (2.1 M particles), a click or a stroke shows its
  copies with no wait, for a rare entity and for the most common one alike; the copies look, hide, colour, clip, move
  and undo as they do now.
- **Measured before** (paint lane at fecd0db3e, cellpack-mg, 848 targets, CDP profile, scratch `cl/prof.cjs`): a stroke
  takes 1.3–1.7 s, the same for an entity of 1 particle and one of 1.16 M. Of the ~600 ms of sampled JS:
  - every target visual's instance transforms written again: ~300 ms (`createTargetParticleTransform`; the appended list
    has new `keys`, `targets` and `entities` arrays, so `particlesMovedOnly` fails for every target);
  - the cellPACK fibre tubes built again whole: ~340 ms (`createParticleFibersTubeMesh`);
  - the merged objects' cells and the GPU culler synced: ~175 ms;
  - target signatures ~125 ms, target groups 65–95 ms, the entity tree 50–65 ms, the hierarchy index ~45 ms, the list's
    copy 25–65 ms.
  - So the cost is spread over seven O(n) consumers of the list. Making the target representation append-aware would
    still leave ~300 ms; a list of its own skips all of them.
- **Design:** the strokes move from the `ParticleListPainted` decorator (which appends to the model's list) to a
  **painted layer**: a `SO.Particle.List` node, a child (not a decorator) of the list's last decorator, holding the
  strokes and the brushes' fibre settings as today. Its output holds the painted copies only and shares the model's
  `targetMapping`, `targetInfo` and `entityInfo` (extended for the bank's unit targets). Under it, one representation
  per representation of the model, of the same type and params, with the same layers.
  - The particle hierarchy takes a list under a list as part of it (`hierarchy-state.ts`, `isTypeRoot`): the layer's
    representations are the model list's representations. Every write that loops over them (`particles.look`:
    visibility, colour, transparency, glow; `mesoscale.colors`, `colorLevels`, `theme`, `graphics`, `motion`, a clip)
    reaches the copies with no change to those operations.
  - The move and scale (`ParticleListTransform`) are above the layer: the layer's input is the moved list, and the
    copies take its transform (strokes stay in the list's own frame, as now).
  - A stroke updates the layer alone: the model's list, its representations and its fibre tubes are not touched.
  - The decorator is removed (it is on `me/paint` only, never merged; Ludo, 2026-11-10: replace it, no loader kept).
- **Spec:** `_spec/ui.md` §Paint (the copies drawn as a layer; what follows the model), `_spec/architecture.md` (the
  painted copies' row), `features.md` (paint row), `.v6/changelogs/paint-layer.md`.
- **Tests** (failing first where they guard the speed):
  - A stroke leaves the model's representations as they were: the same render objects, no update of their cells.
  - A scaling guard: a stroke on a model of n and of 4n particles costs about the same (flat in the model's size).
  - The copies are drawn as before: the same image as the append path on a small model (HIV), ε.
  - An entity hidden, coloured, given transparency or colours by zoom: its painted copies follow.
  - A move and a scale of the list carry the copies; a clip cuts them.
  - One undo step per stroke; a fibre stroke and the DNA bank's units as before; a copy's label as before.
  - Saving and loading a session keeps the strokes.
- **Touches:** `packages/extensions/mesoscale/src/paint.ts`, `operations.ts` (`updatePainted`, `paintedFibers`,
  `fiberInfo`), `paint-host.ts`, `prism-viewer.ts` (the registry), their tests. **Stays off** `packages/graphics` and
  `packages/plugin`, and the lipid lanes' files.
- **Open, not in this lane:** a drag of the whole model (#59's preview) moves the copies at the release, not during the
  drag; export as one list (the copies with the model's particles) if an export of particle lists asks for it.
- **Size:** ~450 production lines (tests apart).
- **Lane model:** Opus: the layer's node and its representations' mirroring are design, and the stroke path is the hot
  path being fixed.
- **Steps and models:** 1. failing tests and the scaling guard (Opus) 2. the layer transform and the mirrored
  representations (Opus) 3. operations and host moved to the layer (Opus) 4. checks, the profile on cellpack-mg again
  (Sonnet) 5. gate (Opus reviewer and skeptic).

## Built

- `ParticleListPaintLayer` (paint.ts): the strokes and the brushes' fibre settings, a child of the list's last decorator
  (`decoratedTail`), `dependsOn` the list's root. Its output: `paintedCopies(root, …)` (the copies `paintParticles`
  appends, alone: the same keys after the root's largest, scanned once a list; targets, labels, fibres of their own),
  moved by `listMove(root, input)`. `paintParticles` kept (the same builder, `painting(…, append)`).
- `listMove`: ParticleListTransform records no `movedFrom`, so the move is read from the two lists (the same particles
  in the same order): the turn from particle 0's orientations, the scale from the particle farthest from it among 64,
  the translation from particle 0; checked on 16 particles (`exact`); kept per moved list. `mesoscale.paint` refuses a
  list whose move is not exact (offsets), as it refuses a list of class targets.
- `updatePainted` (operations.ts): the layer made on first use with a representation per representation of the list (its
  transformer, params, hidden state and children: the looks' layers), in the stroke's one commit.
- The hierarchy's `isTypeRoot` takes the layer's representations as the list's: `particles.look` (style, colours,
  transparency, glow), colours by zoom and the other writes over `l.representations` reach the copies unchanged.
- stage-tools `drawsList`: a particle drag's preview skips representations under a child that is not a decorator (it
  gave the layer's the list's particles: made again from the offset list, or framed by the list's indices).
- Measured (cellpack-mg, 2.1 M particles, 848 targets; scratch `cl/prof-layer.cjs`): a stroke 1.3–1.7 s → 4–8 ms to
  commit, 12–15 ms to its drawn frame (the first stroke 36 ms: the layer and its representations made); 21 copies drawn
  as 21 instances under the layer, the model's 2,124,844 instances unchanged.

## Decided

- Ludo, 2026-11-10: the design as briefed (a layer of its own, not an append-aware representation); the decorator
  replaced, sessions saved on the paint branch with strokes not kept loading; stacked on `me/paint`.

## Learned

- The particle hierarchy collects any representation under a nested list into the outer list's `representations`: the
  looks come free, but every loop over them that indexes by the list's particles must skip the nested list's (the drag
  preview did). Loci are matched by the list object (`loci.particles !== particles`), so highlight and selection of
  model particles never mark a copy.
- `spine.getRootOfType` returns nothing while the cell being applied has no object yet (its first apply): the layer
  takes its root from `dependsOn` instead.
- A fresh worktree's `check:workspace` needs the packages' assets (`node scripts/workspace/assets.mjs`, part of
  `build:lib`): plugin-ui's css and the backgrounds' images.

## Size

263 production lines added, 60 removed (tests and docs apart), against ~450: the hierarchy gave the looks for free (no
mirroring of each operation's writes), and the move read from the data needed no change to the Transform.

## Review

| Finding                                                                                        | Severity          | Verdict               | Commit / open                                        |
| ---------------------------------------------------------------------------------------------- | ----------------- | --------------------- | ---------------------------------------------------- |
| M1 a later offset (`cryoet.instance`) moves every copy (the move read from offset particles)   | must-fix          | confirmed             | round 2: the layer removed                           |
| M2 a pick on a copy resolves to the model's particle of the same index                         | must-fix          | confirmed             | round 2                                              |
| S3 a decoration after a stroke hides the copies (their targets the root's)                     | must-fix (raised) | confirmed             | round 2                                              |
| S1 representations mirrored once: added or removed later, not                                  | should-fix        | confirmed             | round 2                                              |
| S2 the inspector lists each representation twice                                               | should-fix        | confirmed             | round 2                                              |
| S4 the scaling guard checks linearity, not flatness; the config cannot run (predates the lane) | should-fix        | confirmed             | round 2 (guard removed with the layer); config: TODO |
| S5 tests of the brief missing (clip, transparency, after-stroke edits, picks)                  | should-fix        | partly                | round 2's tests                                      |
| X1 `exact` misses offsets on unsampled particles                                               | should-fix        | confirmed             | round 2: removed                                     |
| N1–N4 tolerance, coincident samples, dead append branch, focus leaves out copies               | nit               | confirmed / plausible | round 2: removed                                     |
| N5 progress file empty                                                                         | nit               | refuted               | —                                                    |

Ludo, 2026-11-10, after the gate: a copy must behave as its list's particles (edited alone and with its kind, new
representations at once); the layer's design cannot give that by construction: round 2 restores the copies in their
list.

## Round 2: the copies in their list again, painting into a list (brief, 2026-11-10)

- **Asked** (Ludo, 2026-11-10, after the gate): a copy behaves as any particle of its list: "all of the same kind
  continue to be able to all move. Same behaviour. a painted copy can be edited, and can edit all of the same type"; new
  representations reach the copies "Immediately"; "yes restore the in list copy. so it will also work for empty scene,
  or just painting a given PDB id. The target of the paint is a particle list parent." Answers: one "Painting" list for
  an empty scene; a structure painted while a model is loaded: **Paint into** asked each time (the model or the Painting
  list); the brush is a structure in the scene, offered by its right-click and its row's ⋯ (**Paint with**), after
  loading a PDB id or a file. Spelling: Fiber, not fibre.
- **Check:** (1) cellpack-mg: paint, then move one instance with the handle, "Offset all like it" from a copy, decorate,
  add a representation: the copies follow as the model's particles do. (2) An empty scene: load 1CRN, right-click it ›
  Paint with 1CRN, click and drag in empty space: copies at the pointer's depth, in a list named Painting, one undo step
  a stroke. (3) HIV loaded, load 1CRN, Paint with it: asked Paint into HIV or Painting; HIV gains an entity 1CRN.
- **Design:**
  1. The layer goes: `ParticleListPainted` (the decorator right under the list's root, above every later decorator) is
     back, so the copies are the list's particles: moves, offsets of a kind, decorations, picks, representations and
     focus work on them as on the others by construction. The lane's `ParticleListPaintLayer`, `listMove`, the offsets
     refusal and stage-tools' `drawsList` are removed (nothing nested to guard against).
  2. **Structure brushes:** the decorator gains `structures`: a structure of the scene by state ref (`dependsOn`, so a
     session reloads it), added to the list as a target and an entity of its name (ids after the list's largest), its
     compartment none. A brush is a list's entity, or a structure.
  3. **The Painting list:** painting with no list to paint into makes one (`mesoscale-painting-list`, a root list of no
     particle, labelled Painting) with the decorator and a target representation, in the stroke's commit; later
     structure brushes add to it. Without a surface the copies go at the paint depth (Place: Depth, as now).
  4. **Paint into:** a structure brush with a particle list in the scene asks, in the Paint section, Paint into: each
     list or Painting; `mesoscale.paint { structure, particles }` takes it.
  5. **Paint with** on a structure: the structure's right-click and its row's ⋯ (menu.ts, beside the entity's).
  6. Fiber spelling in UI strings, messages and docs of paint.
- **Speed:** a stroke into a model is as on `me/paint` (cellpack-mg ~1.3 s); into the Painting list it is small. The
  model's stroke speed is the next lanes', from master, one step of the profile each (fiber tubes, each target's
  transforms, the culler's sync, signatures, groups, entities, the hierarchy index: this lane's Brief, Measured).
- **Tests (failing first):** a copy moved by `cryoet.instance` on its own index and by an offset of its kind; a
  decorated list's copies decorated; a representation added after a stroke draws the copies; a pick of a copy is its
  list's particle; a structure brush into a model (one step: an entity added, copies of it); into an empty scene (the
  Painting list made, one step; undo leaves nothing); a session with a structure brush reloaded; the Paint into choice.
- **Touches:** mesoscale (paint.ts, operations.ts, paint-host.ts, paint-mode.ts, controls.tsx), apps/prism-me (menu.ts,
  properties.tsx), the specs. **Stays off** packages/graphics, packages/plugin, stage-tools.
- **Branch:** the lane is local only; its round-1 commits are reverted forward (`git revert`), the brief and the
  measurements kept.
- **Size:** ~350 production lines.
- **Lane model:** Opus (the structure targets and the Painting list are design).

### Round 2: built

- `ParticleListPainted` back under the list's root (round 1 reverted forward); `structures` of `PaintStructure` (name,
  target and entity ids kept from the first stroke, its source: the structure's `download` or `read-file`), loaded by
  the decorator itself (`loadParticleTarget`, cached by source): no dependency on the scene's cell.
- `MesoscalePaintingList` (no particle of its own) with the decorator and a move under it;
  `mesoscale.paint { structure, particles }` (`paintInto`); the target representation and the spheres' leave-out by
  `particles. representation` and `particles.look` in the stroke's step (`drawStructure`); Mol*'s particles loaded first
  (`ensureFor`).
- cryoet's `dataOf`: the deepest decorator's particles but its offsets' (a copy offset alone or with its kind).
- UI: Paint with on a structure's right-click and Paint section, Paint into (each list or Painting, reset at each
  start), the structure's copy under the pointer; a list's row counts its painted copies.
- Fiber spelling in paint's UI, messages, tests and docs.
- Measured: an empty scene, 24 copies of 1CRN in one stroke, 46–78 ms (browser, the lane's server). A stroke into
  cellpack-mg is as on `me/paint` (~1.3 s): the fast-path lanes' work.

### Round 2: learned

- Mol* has no optional dependency: a missing one fails the cell before `apply` (and its subtree, the list's
  representations): a list that paints with a structure keeps its own copy, loaded from the structure's source.
- An operation can run others through `ctx.api` in its one history step (several commits, one undo), as cryoet's
  decorate does: the stroke's target representation and leave-out are `particles.representation` and `particles.look`.
- Mol*'s particles are opt-in (`ParticlesRegistry`, lazy): an operation that makes a list in a scene without one loads
  them with `ctx.extensions.ensureFor({ transformers: [...] })`.

### Round 2: size

651 production lines added and 168 removed (tests apart), about 150 of each the spelling pass: ~500 new against ~350.
The structure's own copy (its source, loader and cache) and the gate's leave-out took the room.

### Round 2: review

| Finding                                                                                                         | Severity   | Verdict   | Commit / open                                                              |
| --------------------------------------------------------------------------------------------------------------- | ---------- | --------- | -------------------------------------------------------------------------- |
| M1 a decoration after a structure stroke moves its target id (copies drawn as another object, a phantom target) | must-fix   | confirmed | 1653a2e58                                                                  |
| M2 removing the painted structure fails the decorator: the list's own particles go                              | must-fix   | confirmed | 1653a2e58                                                                  |
| M3 the Painting list has no move under the decorator: copies left behind, strokes off                           | must-fix   | confirmed | 1653a2e58                                                                  |
| S1 a structure's entity offered Paint with, every stroke refused                                                | should-fix | confirmed | 1653a2e58                                                                  |
| S2 a structure's copies drawn twice on a list of spheres                                                        | should-fix | confirmed | 1653a2e58                                                                  |
| S3 Paint into stale across brushes and a deleted list                                                           | should-fix | confirmed | 1653a2e58, then the next commit                                            |
| Tests: entity added to a model, decorated list, move, delete, undo of the added representation                  | should-fix | confirmed | 1653a2e58 and after; open: the Paint into UI, a reload into a fresh viewer |
| N1 ids scanned a structure at a time; same-name entities                                                        | nit        | confirmed | 1653a2e58 (ids once; one entity a source)                                  |
| N2 Painting known by its label                                                                                  | nit        | confirmed | 1653a2e58                                                                  |
| N3 the 'fibre' command alias dropped                                                                            | nit        | confirmed | 1653a2e58                                                                  |
| N4 the target representation's params from the list's own data                                                  | nit        | refuted   | —                                                                          |

Open: a structure loaded by PDB id (a download) is not tested (no network in the tests); TODO.md's older entries still
say "fibre"; the model's stroke speed (the fast-path lanes).

## After round 2: Ludo's checks (2026-11-10)

- "I loaded 2PLV assembly, but it only paint the ASU, it should paint the assembly." The list reloaded the structure's
  file and took its first model (`Structure.ofModel`). A painted structure now keeps the scene's `structure-from-model`
  definition (`PaintStructure.definition`) and is built again with `RootStructureDefinition.create`; the definition is
  part of its key (the assembly and the model of one file are two structures). ece99ceb9.
- "also from a pdb structure I want the Fiber option as well in painting." The Paint section shows Fiber for a structure
  brush and, once its first stroke made its entity where it paints, its Rise/Twist (`structureBrushState`). Its first
  fiber's rise is its length along its principal axis, written as its own settings (it has no radius; 10 Å stacked the
  copies); the shared default for model entities is unchanged (paint-operation tests pin it). 696e82a7c.
- Measured in the browser (port 1363), 2PLV by its PDB id, assembly 1: the copy has 420 units as the scene's (it had
  the asymmetric unit's 4 before); a fiber of it, 321 Å a point, capsids touching. The download path, untested before,
  works.
- Open: a fiber's path is read 2 × the bounding radius apart on a structure's first stroke (its rise is not known before
  its entity exists); a structure's other model (`modelIndex` ≠ 0) still paints model 0. The graphics
  `backend-neutral` test fails with and without the lane's changes.
