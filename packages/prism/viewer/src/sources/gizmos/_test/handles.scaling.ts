/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { expect, it } from 'vitest';
import {
  allocated,
  checkLinear,
  quadraticControl,
  scaling,
  scalingAsync,
} from '../../../../../ui/src/_test/scaling.js';
import { cbs, headlessViewer } from '../../../_test/harness.js';
import { type GizmoCanvas, mountGizmoCanvas } from '../../../testing/gizmo-canvas.js';
import type { PrismViewer } from '../../../viewer.js';
import { applyToPlacement, PlacementHandles } from '../placement.js';
import { StructureMoveGizmos } from '../../structure-move/gizmos.js';

// A drag's previews grow about linearly with their number (`test:scaling`; AGENTS.md: nothing allocated per pointer
// event that grows): N moves of a structure's handles (`GizmoHandles`, the structure's preview on its representations),
// each previewed, at N and 4N. And what a move allocates of its own, read exactly: a placement's gesture and its frame
// work in scratch matrices, the new placement's matrix and the gesture's pose aside.

it('the positive control (a copy per item) is caught', () => {
  checkLinear('quadratic control', scaling(quadraticControl, 2000), false);
});

it("N previews of a drag on a structure's handles", async () => {
  const s = await scalingAsync<{ v: PrismViewer; canvas: GizmoCanvas; gizmos: StructureMoveGizmos; steps: number[] }>(
    {
      setup: async (n) => {
        const v = await headlessViewer({ files: [cbs()] });
        const canvas = mountGizmoCanvas(v.plugin);
        const gizmos = new StructureMoveGizmos(v.plugin);
        gizmos.setTarget(v.plugin.managers.structure.hierarchy.current.structures[0].cell.transform.ref);
        gizmos.show(async () => false);
        if (!(await canvas.hover())) throw new Error('no handle');
        return { v, canvas, gizmos, steps: Array.from({ length: n }, (_, i) => i + 1) };
      },
      run: ({ canvas, steps }) => canvas.drag(steps),
      teardown: async ({ v, canvas, gizmos }) => {
        canvas.escape();
        gizmos.hide();
        canvas.remove();
        await v.dispose();
      },
    },
    100,
    // over a real plugin at rest: the drag is all that runs
    { alloc: true },
  );
  checkLinear('structure handles: N previews', s);
}, 600_000);

it("a move of a placement's handles allocates its result, not its steps", () => {
  const p = { matrix: Mat4.identity(), center: Vec3.create(1, 2, 3), radius: 10 };
  const frame = { right: Vec3.create(1, 0, 0), up: Vec3.create(0, 1, 0), perPixel: 0.5 };
  const item = { key: 'a', label: 'a', value: p };
  const n = 10_000;
  const apply = () => {
    for (let i = 0; i < n; i++) applyToPlacement(p, { kind: 'move' }, frame, i, 0);
  };
  const placed = () => {
    for (let i = 0; i < n; i++) PlacementHandles.frame!(item);
  };
  apply();
  placed();
  // bytes a move: a Mat4 and a placement, the gesture's pose; a frame: its Mat4
  expect(allocated(apply) / n).toBeLessThan(1200);
  expect(allocated(placed) / n).toBeLessThan(400);
});
