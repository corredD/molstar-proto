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

## Decided

- Ludo, 2026-11-10: the design as briefed (a layer of its own, not an append-aware representation); the decorator
  replaced, sessions saved on the paint branch with strokes not kept loading; stacked on `me/paint`.

## Learned

## Size

## Review

| Finding | Severity | Verdict | Commit / open |
| ------- | -------- | ------- | ------------- |
