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
import { GizmoHandles, type HandlesBinding } from '../handles.js';

// The handles' host on a headless viewer and a fake canvas (gizmos.md): a drag previews (its handles' meshes kept), its
// release commits once with the frames held; Esc, a commit not taken and a change under the drag's cells put it back,
// and a cancelled drag's release commits nothing.

type Value = { readonly x: number };

function host(v: PrismViewer, commitResult = true) {
  const key = v.plugin.managers.structure.hierarchy.current.structures[0].cell.transform.ref;
  const log = { previews: [] as number[], commits: [] as number[], cancels: 0, layouts: 0 };
  const frame = (item: GizmoItem<Value>) => Mat4.fromTranslation(Mat4(), Vec3.create(item.value.x, 0, 0));
  const binding: HandlesBinding<Value> = {
    items: () => [{ key, value: { x: 0 }, label: 'A' }],
    layout: (item) => {
      log.layouts++;
      return { ...transformHandles(10), frame: frame(item) };
    },
    frame,
    sameGeometry: () => true,
    equal: (a, b) => a.x === b.x,
    apply: (from, _h, _f, dx) => ({ x: from.x + dx }),
    preview: async (_k, _f, next) => void log.previews.push(next.x),
    commit: async (_k, _f, next) => {
      log.commits.push(next.x);
      return commitResult;
    },
    cancel: () => void log.cancels++,
  };
  return { key, log, handles: new GizmoHandles(v.plugin, binding) };
}

describe('GizmoHandles', () => {
  it('shows nothing without a canvas', async () => {
    const v = await headlessViewer({ files: [cbs()] });
    expect(host(v).handles.show()).toBe(false);
  });

  it('previews a drag outside the state and commits its release once, the frames held', async () => {
    const v = await headlessViewer({ files: [cbs()] });
    const canvas = mountGizmoCanvas(v.plugin);
    const { handles, log } = host(v);
    expect(handles.show()).toBe(true);
    expect(handles.shown.value).toBe(true);
    expect(await canvas.hover()).toBe(true);
    await canvas.drag([1, 2, 3]);
    expect(log.previews.at(-1)).toBeGreaterThan(0);
    // the handles' meshes made once, at show: a move moves their frame
    expect(log.layouts).toBe(1);
    expect(handles.dragging).toBeDefined();
    await canvas.release();
    expect(log.commits).toHaveLength(1);
    expect(log.cancels).toBe(0);
    expect(canvas.holds).toBe(1);
    handles.hide();
    expect(handles.shown.value).toBe(false);
    canvas.remove();
  });

  it('cancels on Esc, on a commit not taken, and on hide: nothing committed, the item put back', async () => {
    const v = await headlessViewer({ files: [cbs()] });
    const canvas = mountGizmoCanvas(v.plugin);
    const { handles, log } = host(v);
    handles.show();
    await canvas.hover();
    await canvas.drag([5]);
    canvas.escape();
    await canvas.release();
    expect(log).toMatchObject({ commits: [], cancels: 1 });

    const refused = host(v, false);
    handles.hide();
    refused.handles.show();
    await canvas.hover();
    await canvas.drag([5]);
    await canvas.release();
    expect(refused.log.commits).toHaveLength(1);
    expect(refused.log.cancels).toBe(1);

    await canvas.hover();
    await canvas.drag([5]);
    refused.handles.hide();
    expect(refused.log.cancels).toBe(2);
    canvas.remove();
  });

  it('cancels a drag when a cell under its item changes (an undo), and its release commits nothing', async () => {
    const v = await headlessViewer({ files: [cbs(), cbs()] });
    const [, other] = v.plugin.managers.structure.hierarchy.current.structures.map((s) => s.cell.transform.ref);
    // a step on the item's structure to undo (its transform, a cell under it), then one on another structure
    const { handles, log, key } = host(v);
    expectOk(await v.api.run('structure.transform', { structure: key, translation: [5, 0, 0] }));
    expectOk(await v.api.run('structure.transform', { structure: other, translation: [5, 0, 0] }));
    const canvas = mountGizmoCanvas(v.plugin);
    handles.show();
    await canvas.hover();
    await canvas.drag([5]);
    // the other's undone: not under or above the item, the drag goes on
    expectOk(await v.api.run('history.undo', {}));
    expect(handles.dragging).toBe(key);
    // the item's undone: the drag is cancelled
    expectOk(await v.api.run('history.undo', {}));
    expect(handles.dragging).toBeUndefined();
    await canvas.release();
    expect(log).toMatchObject({ commits: [], cancels: 1 });
    canvas.remove();
  });
});
