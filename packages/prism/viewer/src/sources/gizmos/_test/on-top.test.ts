/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import type { GizmoItem } from '@molstar/graphics/util/gizmo/controller';
import { transformHandles } from '@molstar/graphics/util/gizmo/transform';
import { describe, expect, it } from 'vitest';
import { cbs, expectOk, headlessViewer } from '../../../_test/harness.js';
import { mountGizmoCanvas } from '../../../testing/gizmo-canvas.js';
import type { PrismViewer } from '../../../viewer.js';
import { GizmoHandles } from '../handles.js';

// Handles on top (gizmos.md): `canvas.handles` sets every host's handles at once, Prism's own and any other, as a view
// setting (no history step); a drag is one step, undone at once, whether they are on top or not.

/** A second host (an extension's): a structure's transform handles, committing nothing */
function otherHost(v: PrismViewer) {
  const key = v.plugin.managers.structure.hierarchy.current.structures[0].cell.transform.ref;
  return new GizmoHandles<{ readonly x: number }>(v.plugin, {
    items: () => [{ key, value: { x: 0 }, label: 'A' }],
    layout: (item: GizmoItem<{ readonly x: number }>) => ({
      ...transformHandles(10),
      frame: Mat4.fromTranslation(Mat4(), Vec3.create(item.value.x + 30, 0, 0)),
    }),
    sameGeometry: () => true,
    equal: (a, b) => a.x === b.x,
    apply: (from, _h, _f, dx) => ({ x: from.x + dx }),
    preview: async () => {},
    commit: async () => true,
    cancel: () => {},
  });
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('handles on top', () => {
  it("sets every host's handles, the bodies too, and is no history step", async () => {
    const v = await headlessViewer({ files: [cbs()] });
    const clipping = v.api.clipping;
    expectOk(await clipping.add({ shape: 'plane', target: 'polymer' }));
    const canvas = mountGizmoCanvas(v.plugin);
    clipping.gizmos.handleOnly(1);
    expect(clipping.showGizmos(v.api)).toBe(true);
    const other = otherHost(v);
    other.show();
    await settle();
    const shown = canvas.shown();
    // the cut's handles and its plane, the other host's handles
    expect(shown.length).toBeGreaterThanOrEqual(3);
    expect(canvas.onTop.size).toBe(0);
    const steps = v.managers.history.steps.value.length;

    expectOk(await v.api.run('canvas.handles', { onTop: true }));
    expect(shown.every((r) => canvas.onTop.has(r))).toBe(true);
    expect(v.api.canvas.handleLook.onTop).toBe(true);
    expect(v.managers.history.steps.value.length).toBe(steps);
    expect(await v.api.run('canvas.handles', { onTop: true })).toMatchObject({ ok: true, unchanged: true });

    // the command flips it
    const command = v.managers.commands.get('canvas.handles')!;
    await command.run({}, undefined as never, new AbortController().signal);
    expect(canvas.onTop.size).toBe(0);
    expect(v.managers.history.steps.value.length).toBe(steps);

    other.hide();
    clipping.gizmos.hide();
    canvas.remove();
  });

  it('a drag is one step, undone at once, on top or not', async () => {
    const v = await headlessViewer({ files: [cbs()] });
    const clipping = v.api.clipping;
    expectOk(await clipping.add({ shape: 'sphere', target: 'polymer' }));
    const position = () => [...clipping.cuts.value[0].object.position];
    const steps = () => v.managers.history.steps.value.length;
    const canvas = mountGizmoCanvas(v.plugin);
    clipping.gizmos.handleOnly(1);
    expect(clipping.showGizmos(v.api)).toBe(true);
    for (const onTop of [true, false]) {
      expectOk(await v.api.run('canvas.handles', { onTop }));
      await settle();
      expect(canvas.shown().every((r) => canvas.onTop.has(r) === onTop)).toBe(true);
      const before = position();
      const n = steps();
      expect(await canvas.hover()).toBe(true);
      await canvas.drag([2, 4, 6]);
      await canvas.release();
      expect(steps()).toBe(n + 1);
      expect(position()[0]).toBeGreaterThan(before[0]);
      expectOk(await v.api.run('history.undo', {}));
      expect(position()).toEqual(before);
    }
    clipping.gizmos.hide();
    canvas.remove();
  });
});
