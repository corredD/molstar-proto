# Measurements on meshes, per triangle (lane `mesh-measure`)

Branch `me/mesh-measure` from `origin/prism-me` (after #28). Worktree `~/prism-me-lanes/mesh-measure`. Dev port 1364.

## Why (Ludo, 2026-10-31)

"make another lane that will take care of the measurement between obj/shape at the triangle highlight/selection and
other selection. Right now, mesh selection is global not at the triangle level."

## What is known (from a first read; check it)

- OBJ, PLY and VTP meshes load as shapes (`packages/graphics/src/formats/shape/obj.ts`, `ply.ts`, `vtp.ts`,
  `common.ts`).
- Their pick groups are not triangles:
  - OBJ: one group per material, or one per vertex position when the file has vertex colors (`obj.ts` around line 211
    and 264).
  - PLY: a vertex property such as `atomid` or `material_index`.
- So hover, highlight and select take a whole material or the whole mesh.
- Prism's measurements (`packages/prism/viewer/src/features/measurements/operations.ts`) take only
  `StructureElement.Loci`, i.e. atoms.
- Mol*'s measurement representations are in `packages/graphics/src/repr/shape/loci/` (distance, angle, dihedral, label).
  They are built on `Loci` and bounding spheres or centers. A `ShapeGroup.Loci` has a center through its bounding
  sphere.

## Do

1. **Triangle picking on meshes.** Hover, highlight and select of OBJ, PLY and VTP meshes at the triangle: one pick
   group per triangle, or a pick that resolves to the triangle and its hit point, without losing what the groups do
   today.
   - Today a material or vertex group gives the colours and the per-segment looks of the cryoet meshes.
   - Pick the state-of-the-art way that keeps colors, memory and drawing cost in check on large segmentation meshes
     (millions of triangles), and measure it.
   - Whole-mesh select must stay easy (for example click selects the triangle, and the existing whole-object actions
     stay).
2. **The point measured on a triangle.** Choose from the state of the art and write the reason in this file. Candidates:
   - the picked surface point;
   - the triangle's centroid;
   - the nearest vertex.
3. **Measurements between any picks.** Distance, angle and dihedral between:
   - a mesh triangle and a mesh triangle;
   - a mesh triangle and atoms;
   - a mesh triangle and a particle;
   - and the existing atom-to-atom ones, unchanged.

   Through Prism's measurement operations, the selection and the UI, with labels. The measurement must follow the mesh
   when it moves (Position handles, scale).

4. **Tests.** A failing test first for each step. Run headless in Chrome on WebGPU and WebGL2:
   - load a mesh and a structure (`data/examples` or a small OBJ made in the test);
   - hover a triangle: only it highlights;
   - select two triangles and measure;
   - measure a triangle against an atom.

   Screenshots go in this file.

5. Say which parts are library changes that could go upstream, and which are prism-me.

## Rules

- Never rebase; merge. Never push to upstream molstar/molstar.
- Commit messages say "Ludo" and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push after each
  commit.
- Tests with `--maxWorkers=2`, no parallel suites. Stop your dev server when done. Another lane (`decorate-transform`,
  port 1363) runs at the same time: do not use its port or worktree. Ludo's live server is 1343: do not use it.
- Do not touch `current.md`.
- The gate before the PR:
  - `npx tsc -b`;
  - `npx tsc --noEmit -p apps/prism-me`;
  - lint and format:check;
  - `node scripts/workspace/assets.mjs`, then check:workspace;
  - the unit tests of the packages touched;
  - test:scaling;
  - styles:check and typecheck:storybook.

  Then the lane-reviewer, then the lane-skeptic.

- Then `gh pr create -R corredD/molstar-proto --base prism-me`. The PR body ends with
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Do not merge.
