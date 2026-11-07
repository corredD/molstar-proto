# A particle's handle that follows the drag on a whole-cell model (2026-11-05, lane `fast-particle-drag`)

## Brief

- **Asked** (Ludo, 2026-11-05, testing MG cellPACK models on WebGPU): "the handle to move individual protein position or
  all the same instance, or just the full model is not realtime, and LAG. I can drag, but nothing happen and I have to
  release and wait." Lane 1 is the particle handle (one protein, or its kind); the whole model's drag (lane 2,
  `stage.previewMove` → `Visual.setTransform` over every instance) is not touched. Then: "make a test also, what's the
  maximum number of HIV models can we load before it slows down"
  (`G:\DATA\HIV\fixed_latest_cellpack_atom_instances.bcif`).
- **Cause** (read in the code): each preview step ran `offsetParticles` over the whole list (new arrays, the cached
  transforms and target groups lost) and `createOrUpdate` on every representation of the list: every target visual's
  transforms, instance grid, colors and bounds made again. The gizmo controller keeps one preview in flight (the latest
  wins), so a step longer than a frame shows nothing until the release.

## What was built

1. **Graphics, the target representation** (`target/common.ts`, `target/representation.ts`): `setParticleFrames(frames)`
   writes some particles' frames into their targets' visuals' instance transforms only (no geometry, color, size), each
   visual given its own run of the frames (O(moved)); `undefined` puts them back from the list. `canSetParticleFrames`
   finds it. Public API, new.
2. **Graphics, the merged render object** (`gl/renderable/merged.ts`): `sync` writes only the members whose instances
   changed (it copied every member's on any change), and `sync({ growBounds })` grows the merged bounds from the changed
   members (the union over every member, `BoundaryHelper.includeSphere` × members × 2, was most of a step: ~25 ms at 800
   members). The preview syncs with it; its put-back and every other sync are exact.
3. **Stage tools** (`particle-handle.ts`): the preview computes the moved particles' frames alone (`movedIndices`,
   `offsetFrames`, as `offsetParticles` places them), gives them to the target representation, and makes another
   representation again only if it draws a moved particle (`drawsAny`: cellPACK's spacefill leaves the targeted ones
   out, fibers draw the fiber particles). The orientation representation is still made again every step.

## Measured

- **Synthetic** (`stage-tools` `test:scaling`, triangle targets × 50 particles, 30 steps; this machine):

  | instances (targets) | slowest step | median | the rebuild it replaces |
  | ------------------- | ------------ | ------ | ----------------------- |
  | 10 000 (200)        | 0.33 ms      | 0.17   | 29 ms                   |
  | 40 000 (800)        | 2.7 ms       | 0.8    | 104 ms                  |
  | 160 000 (3200)      | 10.8 ms      | 3.5    | 445 ms                  |

  What is left grows with the merged object's members (its sync reads ~30 cell versions a member), not its instances.

- **HIV, headless** (`apps/prism-me/src/_test/hiv-copies.test.ts`, heavy, opt in with `PRISM_ME_HIV=<the .bcif>`): one
  copy 287k instances, loads in ~4.5 s; 12 copies 3.44 M instances, 660 MB of JS heap, each load still 4–7 s (about
  linear, no knee). A drag step on a protein of the last copy at most 12–41 ms (one target's instances and the copy's
  merged sync), its release (`cryoet.instance`, the copy made again) ~0.8 s. Headless has no GPU: where drawing slows
  down (frame time, GPU memory: 64 B of `aTransform` an instance, 220 MB at 12 copies) is the browser's to measure.

## Learned

- The first ~13 steps of each drag were slow while later ones were fast, the same with warm code: not the JIT but the
  bounds union (a profile of those steps alone: `includeSphere` 85 %). The scaling case now times a drag (30 steps), not
  one step after setup.
- `PRISM_ME_HIV`'s particle 0 is a lipid (untargeted, drawn by the spacefill); the benchmark drags the first targeted
  particle.

## Left open

- Lane 2, the whole model's drag: `Visual.setTransform` rewrites every instance and its grid per pointer event.
- The release still makes the copy again (~0.8 s on HIV): every target's colors and transforms for one moved particle.
- A step re-uploads the merged object's whole `aTransform`; `updateSubData` exists in `webgl/buffer.ts` (measure first).
- The merged sync's per-member scan (O(members) a step): the representation knows which members changed.
- `one-look-writer.test.ts` fails on Windows (path separators), before this lane.
- Ludo to say whether the two graphics commits also go on a branch from `origin/master` for upstream.
