/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mat4, Tensor, Vec3 } from '@molstar/core/math/linear-algebra';
import { CryoetExtension } from '@molstar/cryoet-extension/prism-viewer';
import { CCP4Writer } from '@molstar/model/formats/writer/ccp4/ccp4';
import type { Grid } from '@molstar/model/model/volume';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import { mountGizmoCanvas } from '@molstar/prism-viewer/testing/gizmo-canvas';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { StageToolsExtension } from '@molstar/stage-tools-extension/prism-viewer';
import { afterEach, describe, expect, it } from 'vitest';

// An oblique slice's handle (cryoet) on a volume the stage moves (stage-tools: both extensions, so the app's test): the
// slice's plane follows the volume's transform, above the slice, so an undo of the volume's move during a drag cancels
// the drag, and its release commits nothing.

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

function expectOk<R>(r: ApiResult<R>): asserts r is Extract<ApiResult<R>, { ok: true }> {
  if (!r.ok) expect.fail(`${r.code}: ${r.message}${r.hint ? ` (${r.hint})` : ''}`);
}

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

describe("an oblique slice's handle on a moved volume", () => {
  it("is cancelled by an undo of the volume's move during a drag", async () => {
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: { ...base, extensions: [...(base.extensions ?? []), StageToolsExtension, CryoetExtension] },
    });
    viewers.push(v);
    expectOk(await v.api.load.files({ files: [mapFile('map.mrc', 12)] }));
    const volume = v.plugin.managers.volume.hierarchy.current.volumes[0].cell.transform.ref;
    const added = await v.api.cryoet!.oblique({ volume } as never);
    expectOk(added);
    const slice = (added as { value: { slice: string } }).value.slice;
    const steps = () => v.managers.history.steps.value.length;
    const n = steps();
    expectOk(
      await v.api.stage!.move({
        target: volume,
        matrix: Array.from(Mat4.fromTranslation(Mat4(), Vec3.create(5, 0, 0))),
      } as never),
    );
    const canvas = mountGizmoCanvas(v.plugin);
    const handles = v.api.cryoet!.useObliqueHandles(v.api);
    expect(handles.show({ volume, slice })).toBe(true);
    expect(await canvas.hover()).toBe(true);
    await canvas.drag([5]);
    expectOk(await v.api.run('history.undo', {}));
    await canvas.release();
    expect(steps()).toBe(n);
    handles.hide();
    canvas.remove();
  });
});
