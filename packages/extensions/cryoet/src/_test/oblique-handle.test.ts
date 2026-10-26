/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mat4, Tensor } from '@molstar/core/math/linear-algebra';
import { CCP4Writer } from '@molstar/model/formats/writer/ccp4/ccp4';
import type { Grid } from '@molstar/model/model/volume';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import { mountGizmoCanvas } from '@molstar/prism-viewer/testing/gizmo-canvas';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterEach, describe, expect, it } from 'vitest';
import type { SliceInfo } from '../operations.js';
import { CryoetExtension } from '../prism-viewer.js';

// An oblique slice's handle (`ObliqueHandles`) on a headless viewer and a fake canvas: a drag is one `cryoet.oblique`,
// undone at once; an undo during a drag cancels it, and its release commits nothing.

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

function expectOk<R>(r: ApiResult<R>): asserts r is Extract<ApiResult<R>, { ok: true }> {
  if (!r.ok) expect.fail(`${r.code}: ${r.message}${r.hint ? ` (${r.hint})` : ''}`);
}

/** A map of n³ voxels, its values rising along x */
function mapFile(name: string, n: number) {
  const space = Tensor.Space([n, n, n], [2, 1, 0], Float32Array);
  const data = new Float32Array(n * n * n).map((_, i) => i % n);
  const grid: Grid = {
    transform: { kind: 'matrix', matrix: Mat4.identity() },
    cells: Tensor.create(space, Tensor.Data1(data)),
    stats: { min: 0, max: n - 1, mean: n / 2, sigma: 1 },
  };
  return new File([CCP4Writer.writeMrc(grid, data)], name);
}

describe("an oblique slice's handle", () => {
  it('places the slice in one step; an undo during a drag cancels it', async () => {
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: { ...base, extensions: [...(base.extensions ?? []), CryoetExtension] },
    });
    viewers.push(v);
    expectOk(await v.api.load.files({ files: [mapFile('map.mrc', 12)] }));
    const c = v.api.cryoet!;
    const volume = v.plugin.managers.volume.hierarchy.current.volumes[0].cell.transform.ref;
    const added = await c.oblique({ volume } as never);
    expectOk(added);
    const slice = (added as { value: { slice: string } }).value.slice;
    const position = () => (c.sliceState(volume).value as SliceInfo).obliques[0].position.map((x) => Math.round(x));
    const steps = () => v.managers.history.steps.value.length;
    const canvas = mountGizmoCanvas(v.plugin);
    const handles = c.useObliqueHandles(v.api);
    expect(handles.show({ volume, slice })).toBe(true);
    const before = position();
    const n = steps();
    expect(await canvas.hover()).toBe(true);
    await canvas.drag([2, 4, 6]);
    // previewed: not in the state
    expect(position()).toEqual(before);
    await canvas.release();
    expect(steps()).toBe(n + 1);
    expect(position()).not.toEqual(before);
    expectOk(await v.api.run('history.undo', {}));
    expect(position()).toEqual(before);

    // a step on the slice, then a drag the undo of it cancels: its release commits nothing
    expectOk(await c.oblique({ volume, slice, x: 2 } as never));
    expect(await canvas.hover()).toBe(true);
    await canvas.drag([5]);
    expectOk(await v.api.run('history.undo', {}));
    await canvas.release();
    expect(steps()).toBe(n);
    expect(position()).toEqual(before);
    handles.hide();
    canvas.remove();
  });
});
