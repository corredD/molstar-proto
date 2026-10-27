/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { cbs, expectOk, headlessViewer } from '../../../_test/harness.js';
import { mountGizmoCanvas } from '../../../testing/gizmo-canvas.js';

// The cuts' handles (clipping.md §4) on a headless viewer and a fake canvas: a drag is one `clipping.update`, one step
// undone at once; an undo during a drag cancels it, and its release commits nothing.

describe("the cuts' handles", () => {
  it('move a cut in one step; an undo during a drag cancels it', async () => {
    const v = await headlessViewer({ files: [cbs()] });
    const clipping = v.api.clipping;
    expectOk(await clipping.add({ shape: 'sphere', target: 'polymer' }));
    const position = () => [...clipping.cuts.value[0].object.position];
    const steps = () => v.managers.history.steps.value.length;
    const canvas = mountGizmoCanvas(v.plugin);
    clipping.gizmos.handleOnly(1);
    expect(clipping.showGizmos(v.api)).toBe(true);
    expect(clipping.gizmos.handled.value).toEqual([1]);
    const before = position();
    const n = steps();
    expect(await canvas.hover()).toBe(true);
    await canvas.drag([2, 4, 6]);
    // previewed: not in the state
    expect(position()).toEqual(before);
    await canvas.release();
    expect(steps()).toBe(n + 1);
    expect(position()[0]).toBeGreaterThan(before[0]);
    expectOk(await v.api.run('history.undo', {}));
    expect(position()).toEqual(before);

    // a step on the cut, then a drag the undo of it cancels
    expectOk(await clipping.update({ cut: 1, position: [before[0] + 1, before[1], before[2]] }));
    expect(await canvas.hover()).toBe(true);
    await canvas.drag([5]);
    expectOk(await v.api.run('history.undo', {}));
    await canvas.release();
    expect(steps()).toBe(n);
    expect(position()).toEqual(before);
    clipping.gizmos.hide();
    canvas.remove();
  });
});
