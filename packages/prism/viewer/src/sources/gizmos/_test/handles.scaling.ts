/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { it } from 'vitest';
import { checkLinear, quadraticControl, scaling, scalingAsync } from '../../../../../ui/src/_test/scaling.js';
import { cbs, headlessViewer } from '../../../_test/harness.js';
import { type GizmoCanvas, mountGizmoCanvas } from '../../../testing/gizmo-canvas.js';
import type { PrismViewer } from '../../../viewer.js';
import { StructureMoveGizmos } from '../../structure-move/gizmos.js';

// A drag's previews grow about linearly with their number (`test:scaling`; AGENTS.md: nothing allocated per pointer
// event that grows): N moves of a structure's handles (`GizmoHandles`, the structure's preview on its representations),
// each previewed, at N and 4N. What a preview costs is its own (the handles' meshes remade by the library's `layout`),
// never a walk that grows with the drag.

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
