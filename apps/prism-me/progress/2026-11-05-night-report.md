# Night report, 2026-11-04 → 05

Ludo's request (2026-11-04, evening): a careful review of all prism-me code (bugs, design choices), fix bugs and evident
inefficiencies, evaluate animation (Stories Untold's automatic keyframing) and a draw mode (click/drag creates
instances, coarse physics with jure/webphysics), and a feature → citation dictionary for a paper. "Be independent until
tomorrow morning."

## Summary (read this first)

_In progress. Each section below is filled as its work finishes._ At about 01:30 every agent hit the 5-hour usage limit
(resets 04:20); the work in flight resumes then from where it stopped.

## 1. Code review

Three areas done, findings in [2026-11-05-night/](2026-11-05-night/); the library review was cut by the limit.

- **cryoet + EMPIAR** ([review-cryoet.md](2026-11-05-night/review-cryoet.md), 25 findings):
  - **Undo of a load throws** (portal and EMPIAR): root cause found, and it is on master too. Removing a volume and a
    particle list in one update makes prism-viewer's scene sync read a stale particle hierarchy and throw. Fix lane
    `scene-sync-undo` (library, from master).
  - **New must-fix: a slow load blocks every other edit.** The download runs inside the history step, so for the whole
    EBI download (hours) nothing else can be undone or edited, with no cancel. Fix: download outside the step, with
    progress and Cancel (in the PR #56 fix round).
  - Card races on both cards, MB vs MiB, EMPIAR failing whole where the portal warns, seven blocks copied between
    `portal.ts` and `empiar.ts`, the tomogram kept twice in memory.
- **App** ([review-app.md](2026-11-05-night/review-app.md), 20 findings):
  - **Must-fix:** removing an object with labels is one undo step per label (undo brings back a label floating alone).
  - The properties panel keeps a removed object; a label in front of a particle loses its Move; Clip whole and a graded
    cut disagree; hovering a big group row is quadratic (2.2 s at 16k entities); slow `includes` loops.
  - #55's slice picking: nothing in the app relied on the old Map; checked.
  - Design: about 500 lines of clip logic sit in the app (against architecture §7.5); `properties.tsx` is 2,212 lines.
- **Mesoscale + stage tools** ([review-mesoscale-stage.md](2026-11-05-night/review-mesoscale-stage.md), 20 findings):
  - **Must-fix:** a structure dragged by its handle leaves its clip and label behind (typing the position carries them).
  - A mesh's clip never moves with it; `stage.scale` leaves labels and clips; By zoom on a uniform theme shows nothing;
    90 ms after each move on a 2M-particle model (the entity tree recounts); colour parsing differs between tools.
  - Design for Ludo: a clip shared by two objects splits when one moves; two writers of the clip variant overwrite each
    other.

## 2. Fixes (PR)

In flight when the limit hit (each resumes at 04:20):

- `scene-sync-undo` (library from master, then a prism-me PR): fix written, its failing-first check under way.
- PR #56 fix round (EMPIAR and portal): download outside the step, card races, units, shared helpers.
- `night-fixes` (app + stage tools, from the review's must-fix and should-fix): starting with the handle drag.

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
