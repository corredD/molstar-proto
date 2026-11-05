# Night report, 2026-11-04 → 05

Ludo's request (2026-11-04, evening): a careful review of all prism-me code (bugs, design choices), fix bugs and evident
inefficiencies, evaluate animation (Stories Untold's automatic keyframing) and a draw mode (click/drag creates
instances, coarse physics with jure/webphysics), and a feature → citation dictionary for a paper. "Be independent until
tomorrow morning."

## Summary (read this first)

At about 01:30 every agent hit the 5-hour usage limit; nothing ran after it. Done:

- **Review** of the app, cryoet + EMPIAR, mesoscale + stage tools: 65 findings, 3 must-fix (below). Not done: the
  library review (cut by the limit).
- **Fixes:** only the undo throw is written (`me/scene-sync-undo`, 2 local commits: test + fix, from master; not pushed,
  no PR, no gate yet). The PR #56 fix round and `night-fixes` had not committed anything.
- **Physics:** webphysics no; our own bead solver instead (§4).
- **Citations:** `_spec/references.md` + `.bib`, 70 verified references, 5 candidate novelty claims (§5).
- **Not done:** the animation and draw-mode evaluations.

The 3 must-fix: (1) a slow EMPIAR/portal load blocks every other edit for its whole download; (2) removing an object
with labels takes one undo per label; (3) a structure dragged by its handle leaves its clip and label behind. Plus the
undo throw after a portal or EMPIAR load (fix written).

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

Stopped by the limit:

- `scene-sync-undo` (`~/prism-me-lanes/scene-sync-undo`, from master): `09c608d39` test, `24abc06f8` fix (the scene
  syncs its rows once a state update ends). Left: push, the prism-me cherry-pick, the gate, the PR.
- PR #56 fix round: nothing committed (`me/empiar` still at `90ad58048`).
- `night-fixes`: nothing committed (one untracked test file).

## 3. Animation, a simple interface

Not done (cut by the limit).

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

[../_spec/references.md](../_spec/references.md) and [../_spec/references.bib](../_spec/references.bib): one table per
features.md section (feature, references, prior art, novel or not), 70 references checked against a DOI or PubMed, 18
unverified listed apart. Of 73 rows, 1 is novel, 23 partly, 49 not (most rendering and the particle model are Mol\* v6's
own, credited to Alexander Rose). Corrections: PetWorld is YASARA's (Ozvoldik 2021); Stories Untold is unpublished. Top
claims: decoration by live reference (any scene object, swapped without re-parsing); mesoscale models and cryo-ET picks
in one browser scene; one undoable operation per change, the assistant's included; CryoET Data Portal runs opened in a
molecular viewer; cellVIEW's per-type cutaways on the web for any data type.

## 6. Waiting on Ludo

- Which fixes to resume first: the 3 must-fix, the undo throw (fix written), then the should-fix lists.
- Design points from the reviews (recorded, not changed): clip logic in the app; a shared clip splitting on a move; two
  writers of the clip variant; the portal's index vs EMPIAR's live walk; duplicated portal/EMPIAR code (Ludo's rule: no
  repetition).
- The animation and draw-mode evaluations: still to do.
