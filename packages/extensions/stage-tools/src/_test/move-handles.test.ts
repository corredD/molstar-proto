/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { PluginStateObject as SO } from '@molstar/plugin/state/objects';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import { mountGizmoCanvas } from '@molstar/prism-viewer/testing/gizmo-canvas';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterEach, describe, expect, it } from 'vitest';
import { StageToolsExtension } from '../prism-viewer.js';

// An object's move handles (`ObjectMoveGizmos`) on a headless viewer and a fake canvas: a particle list and a mesh,
// each dragged in one step undone at once; an undo during a drag (of the object's first move: its decorator, or its
// shape's transform, above it) cancels the drag, and its release commits nothing.

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

function expectOk<R>(r: ApiResult<R>): asserts r is Extract<ApiResult<R>, { ok: true }> {
  if (!r.ok) expect.fail(`${r.code}: ${r.message}${r.hint ? ` (${r.hint})` : ''}`);
}

describe("an object's move handles", () => {
  it('move a list and a mesh in one step each; an undo during a drag cancels it', async () => {
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: { ...base, extensions: [...(base.extensions ?? []), StageToolsExtension] },
    });
    viewers.push(v);
    const star = 'data_particles\n\nloop_\n_rlnCoordinateX\n_rlnCoordinateY\n_rlnCoordinateZ\n10 0 0\n20 0 0\n';
    expectOk(await v.api.load.files({ files: [new File([star], 'p.star')] }));
    expectOk(await v.api.load.files({ files: [new File(['v 0 0 0\nv 10 0 0\nv 0 10 0\nf 1 2 3\n'], 'seg.obj')] }));
    const list = v.plugin.managers.particles.hierarchy.current.lists[0].cell.transform.ref;
    const mesh = [...v.plugin.state.data.cells.values()].find((c) => SO.Shape.Representation3D.is(c.obj))!.transform
      .ref;
    const s = v.api.stage!;
    const steps = () => v.managers.history.steps.value.length;
    const canvas = mountGizmoCanvas(v.plugin);
    for (const target of [list, mesh]) {
      const x = () => s.placementOf(target)!.matrix[12];
      s.moveGizmos.setTarget(target);
      expect(s.moveGizmos.show()).toBe(true);
      const n = steps();
      expect(await canvas.hover()).toBe(true);
      await canvas.drag([2, 4, 6]);
      // previewed: not in the state
      expect(x()).toBe(0);
      await canvas.release();
      expect(steps()).toBe(n + 1);
      expect(x()).toBeGreaterThan(0);
      expectOk(await v.api.run('history.undo', {}));
      expect(x()).toBeCloseTo(0, 6);

      // its first move, then a drag the undo of that move cancels: its release commits nothing
      expectOk(
        await s.move({ target, matrix: Array.from(Mat4.fromTranslation(Mat4(), Vec3.create(5, 0, 0))) } as never),
      );
      expect(await canvas.hover()).toBe(true);
      await canvas.drag([5]);
      expectOk(await v.api.run('history.undo', {}));
      await canvas.release();
      expect(steps()).toBe(n);
      expect(x()).toBeCloseTo(0, 6);
      s.moveGizmos.hide();
    }
    canvas.remove();
  });
});
