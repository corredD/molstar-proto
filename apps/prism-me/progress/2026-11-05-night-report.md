# Night report, 2026-11-04 → 05

Ludo's request (2026-11-04, evening): a careful review of all prism-me code (bugs, design choices), fix bugs and evident
inefficiencies, evaluate animation (Stories Untold's automatic keyframing) and a draw mode (click/drag creates
instances, coarse physics with jure/webphysics), and a feature → citation dictionary for a paper. "Be independent until
tomorrow morning."

## Summary (read this first)

_In progress. Each section below is filled as its work finishes._

## 1. Code review

## 2. Fixes (PR)

## 3. Animation, a simple interface

## 4. Draw mode and coarse physics

**Physics engine** (full: [../plans/2026-11-05-physics-eval.md](../plans/2026-11-05-physics-eval.md)):

- **webphysics: no** (a good MIT code reference only). Chrome-only (three.js TSL, WebGPU, no WebGL2), at most 65,536
  bodies, a table of every body pair (≈390 MB GPU at 32k bodies), spheres and boxes but no compound bodies (a protein of
  beads = joints, ≤8 a body), no npm package, no worker.
- **Instead: our own bead solver** on Mol*'s WebGPU compute (spatial hash + position-based dynamics + shape matching, so
  a protein stays a rigid group of 2–10 beads); the same in TypeScript in a worker for WebGL2. Rapier or Jolt (WASM) if
  real rigid-body behaviour is needed on the CPU (to measure on the M1 first).
- **The hard part is Mol\*, not the engine:** each moved instance today goes through a CPU transform update and a
  culling-grid rebuild. Millions need the solver to write transforms on the GPU straight into the culler (core
  graphics).
- **Effort:** about 1.8–2.6k lines in 4 lanes; the first two (draw seam + CPU solver) give a usable draw mode for up to
  ~10⁴–10⁵ moving beads.

## 5. Feature → citation dictionary

## 6. Waiting on Ludo
