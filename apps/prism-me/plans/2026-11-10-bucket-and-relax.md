# Bucket fill and interactive relaxation (plan, 2026-11-10)

Ludo: "a bucket mode so when we paint it populates a volume all at once with a given molarity", and "interactive
relaxation/physics feedback like in cellPAINT and cellPACKgpu (gpu relax and Flex)". Evaluate both, plan, decide.

This builds on `plans/2026-11-05-physics-eval.md` (a custom bead solver on Mol*'s compute; webphysics rejected) and
paint (PR #64).

## What exists (surveys, 2026-11-10)

- **prism-me:**
  - A compartment is only a name (`ParticleCompartmentInfo`, particle-list.ts:37). There is no mesh, volume, SDF or
    inside test. Membranes exist only as particles in `….membrane` / `….surface` compartments.
  - Helpers we can build on:
    - `computeGaussianDensity`: a GPU density from spheres.
    - `Tensor.createFloodfilled`: inside/outside of a grid.
    - `GridLookup3D`.
    - `ComputeContext`: WebGPU compute (`cell-cull`, `prefix-sum`, the merged culler's `sCulledData`, which holds each
      instance's transform).
- **The update path is the bottleneck, not the engine.**
  - A paint stroke rebuilds the whole list: about 1.2 s on cellpack-mg's 2.1 M particles.
  - `setParticleFrames` moves particles without a state change, but `updateTransform` still recomputes the target
    visual's instance grid.
- **cellpackgpu:**
  - _Bucket._ Count = `ceil(M · 6.022e-4 · V[Å³])`, V from the compartment's voxels; Halton points in the compartment's
    voxel list, random rotations, no rejection; the relax resolves the overlaps.
  - _Relax._ Each instance is a sphere cluster (k-means LODs). Each step:
    1. Rebuild the voxel grid.
    2. Each instance gathers ≤ 64 neighbours.
    3. Sphere-pair overlaps add a force and a torque.
    4. Position and quaternion are updated, ping-ponged between two buffers.
    - No velocities. Compartments: SDF containment; surface proteins re-projected and slerped to the normal. Fibres:
      grid collision of control points; a clean PBD distance + bending kernel (`RopeConstraints.compute`) that nothing
      calls.
  - _Flex._ Rigid bodies from the clusters, ropes with persistence springs, an SDF compartment, a drag spring, results
    read back into the instance buffers. Native and NVIDIA only: not portable.
- **cellPAINT:**
  - _Engine._ Box2D with heavy damping; fibres and membranes as hinge chains plus persistence springs; Brownian forces
    from a slider.
  - _Interaction._ Drag by a spring to the cursor, pin, bind, push-away.
  - _Bucket._ 10 copies a click, at Halton points inside the clicked compartment's region on screen. No concentration.
- **mesobuild (Python):**
  - Counts from molarity × V (or × area for surface ingredients); V from a mesh by an SDF.
  - Random sequential addition with sphere trees, then an optional push-apart relax.
  - About 1.8 M instances in 132 s. Offline (a CLI), not interactive.

## Shared foundation (needed by both)

**F1: painted copies as a dynamic layer.** Painted, bucketed and relaxed copies live in a small list of their own, drawn
beside the model, instead of being appended to the model's list.

- A stroke or a fill rebuilds only that layer: thousands of particles, not 2.1 M. This fixes the stroke lag.
- Its transforms update in place: `aTransform` + `requestDraw`, the instance grid updated or bounded loosely, no state
  commit while it moves.
- It is saved as paint's strokes are, and merged into the model only at export.
- This is the physics eval's L1. Without it neither feature is interactive.

**F2: the compartment field.** A voxel grid per compartment, cached per list:

1. Splat the compartment's membrane particles with `computeGaussianDensity`.
2. Close the shell (a dilation by the lipid's size).
3. Flood-fill from outside; what is left is the inside.
4. Make an SDF from the inside (a distance transform; CPU in a worker first).

- Each voxel is about the smallest ingredient's radius, or capped, for example at 256³.
- It gives three things: the volume (inside voxels · h³), Halton sampling of inside voxels, and containment for the
  relax.
- A compartment without a membrane (`root`, the cytoplasm of a file with no shell) is the scene's box minus the other
  compartments.

**F3: collision proxies.** A few spheres per target: k-means of its sites (4–16), or one sphere of its radius as the
first cut. Made once per target, in a worker.

## A. Bucket fill

**What Ludo sees.**

1. In Paint: a **Bucket** tool, and a **Concentration** field (µM, or a count).
2. Hover: the compartment under the pointer is highlighted, and the hint says "≈ 12 400 copies of RNAP at 5 µM in
   root.cytoplasm (6.7 × 10⁹ Å³)".
3. Click: the volume is filled in one undo step.
4. A **Relax** pass (B) runs right after, so the copies settle.

**How.**

- Compartment: the one whose F2 inside holds the clicked 3D point (the pick's depth, or the paint depth). Auto: the
  entity's own compartment.
- Count: `N = c · V · 6.022e-4`, c in µM → `c·1e-6` M, V in Å³. By default it tops up to the concentration: the entity's
  copies already inside are counted. **Ludo decides.**
- Placement, as cellpackgpu does it:
  - Halton points in the inside voxels, skipping the voxels the model already occupies (a splat of the current particles
    into the same grid).
  - Random rotations, or normal-aligned for a membrane protein (A2).
  - A cheap rejection against the occupancy grid; the relax resolves what is left.
- Stored as one stroke of the dynamic layer: positions, rotations, and its parameters (compartment, c, seed) for the
  report.
- Membrane proteins (A2): concentration per area (copies/µm², as mesobuild and cellpackgpu do), sampled on the
  compartment's membrane particles (their mid-plane and normal, `membraneFrame`).
- Fibres (A3, later): a random walk inside the compartment with the entity's fibre settings, a length per fibre. This is
  how mesobuild does it.

**Cost.**

- F2 is GPU density + flood fill + SDF: about 1 s for a 256³ grid on first use, then cached.
- The fill is one dynamic-layer rebuild.
- No server: mesobuild stays the offline builder (whole recipes).

**Tests.**

- Count = c·V·Nₐ for a sphere compartment of known volume.
- Every copy is inside (SDF < 0).
- Same seed, same fill.
- Top-up counts the existing copies.
- One undo step.
- A scaling guard: n and 4n copies are linear.

## B. Interactive relaxation and physics

**What Ludo sees.**

- **Relax** (once, N steps): after a fill or a stroke, overlaps are pushed apart and copies stay in their compartment.
  It runs in the frame loop, so it is visible, and commits as one undo step.
- **Live**, a toggle while painting:
  - Painted copies keep relaxing as more are painted.
  - Dragging a copy pulls it on a spring and pushes its neighbours.
  - A **Brownian** slider adds random kicks of √(2D·Δt).
- **Scope:** only the dynamic layer moves. The file's model is a frozen obstacle, in the same grid. Selection-only
  relax, as cellpackgpu has it, comes later.
- Fibres (B3): their points relax as a PBD chain (distance plus bending, from `RopeConstraints`). The units are
  re-turned along the path (`makeFiber`), so a relaxed DNA stays a helix.

**Engine.** A port of cellpackgpu's relax to WGSL, on F3's clusters. Each step:

1. Count sort the instances into a uniform grid with `prefix-sum`, instead of 16 fixed atomic slots.
2. Each instance visits its 27 cells (frozen model particles included) and tests sphere pairs; each overlap adds a force
   and a torque.
3. Integrate with a damped step and a cap per step: position, and the quaternion by the torque.
4. Push back into the F2 SDF. Surface proteins are projected to the membrane and slerped to its normal.

- PBD rather than forces (the eval's choice) is a later step if pushing apart jitters.
- Output: the transforms go to the dynamic layer's `aTransform`. The GPU-resident path straight into `sCulledData`, with
  no readback (eval L4), comes later.
- WebGL / no compute: the same algorithm in TypeScript in a worker, for about 20–50 k moving copies.
- Rejected:
  - Flex: native, NVIDIA only.
  - webphysics: Chrome only, ≤ 65 k bodies, O(n²) memory.
  - Box2D: 2D.
- Rapier (WASM) stays the alternative if Ludo wants joints and binding as real rigid bodies at small counts; it is not
  the default.

**Cost.**

- A grid step over about 100 k moving copies plus their frozen neighbours should run in a few ms on the GPU. To be
  measured, not promised.
- Live mode is bounded by F1's in-place update, not by the solver.

**Tests.**

- Two overlapping copies separate in ≤ k steps, and their distance ≥ the sum of their radii.
- A copy outside its compartment is pushed in.
- Frozen particles never move.
- A fibre chain keeps its rise within ε after relaxing.
- The GPU and CPU paths agree within ε on a fixed seed.
- A scaling guard: the step is linear in moving copies.

## Plan (lanes, in order)

| #   | Lane                       | Gives                                                                                     | Size | Depends |
| --- | -------------------------- | ----------------------------------------------------------------------------------------- | ---- | ------- |
| 0   | `scaling-harness`          | the `*.scaling.ts` configs on `@molstar/test-harness` again (io, cryoet, mesoscale)       | S    | —       |
| 1   | `paint-layer` (F1)         | painted copies as their own dynamic list; strokes instant on 2.1 M; in-place transforms   | M–L  | PR #64  |
| 2   | `compartment-field` (F2)   | a compartment's inside, volume and SDF from its membrane particles; the hover's highlight | M    | —       |
| 3   | `bucket` (A)               | Bucket tool, concentration → count, fill in one step; membrane proteins next (A2)         | M    | 1, 2    |
| 4   | `relax-cpu` (B, F3)        | clusters, the worker solver, Relax once, the drag spring, Brownian                        | M    | 1, 2    |
| 5   | `relax-gpu` (B)            | the WGSL solver, Live mode at 100 k copies                                                | L    | 4       |
| 6   | `relax-fibres` (B3) and A3 | fibre chains relaxing; fibres poured by the bucket                                        | M    | 4       |

Lanes 2 and 4 can run in parallel with 1. The CPU solver comes first so the behaviour is decided and tested before the
GPU port; its tests become the GPU's.

## For Ludo to decide

1. **Bucket target:** a compartment (needs F2; recommended), a region flood-filled around the clicked point between
   membranes (cellPAINT's 2D way, in 3D), or a drawn box or sphere.
2. **Concentration:** top up to it, counting the copies already there (recommended), or add that many on top. Units: µM
   by default, or copies per µm² for membranes.
3. **Physics scope:** only painted and bucketed copies move, with the file's model as frozen obstacles (recommended), or
   the file's particles too (a different scale problem: 2.1 M moving).
4. **Engine:** cellpackgpu's push-apart ported to WGSL, CPU first (recommended), or PBD with shape matching from the
   start, or Rapier for real joints at small scale.
5. **Order:** F1 (the layer) first, because both features and the stroke lag need it (recommended), or the bucket first
   on the current append path (works, but each fill costs about 1.2 s on cellpack-mg, and nothing can move live).
