/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { afterEach, describe, expect, it } from 'vitest';
import { Mat4, Tensor, Vec3 } from '@molstar/core/math/linear-algebra';
import { CCP4Writer } from '@molstar/model/formats/writer/ccp4/ccp4';
import { Grid } from '@molstar/model/model/volume';
import { VolumeTransform } from '@molstar/plugin/state/transforms/volume/ops';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { CryoetExtension } from '../prism-viewer.js';

// A volume's pixel size (the Data section): the facts the area reads of a volume whose decorator carries a scale (what
// `cryoet.volume` writes, through stage-tools: the app's test); its levels keep it. An MRC of 10 Å voxels.

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

function expectOk<R>(r: ApiResult<R>): asserts r is Extract<ApiResult<R>, { ok: true }> {
  if (!r.ok) expect.fail(`${r.code}: ${r.message}${r.hint ? ` (${r.hint})` : ''}`);
}

async function mrcViewer(dims: [number, number, number] = [40, 36, 30]) {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), CryoetExtension] },
  });
  viewers.push(v);
  const [nx, ny, nz] = dims;
  const values = new Float32Array(nx * ny * nz).map((_, i) => Math.sin(i * 0.01));
  const grid: Grid = {
    transform: { kind: 'matrix', matrix: Mat4.fromUniformScaling(Mat4(), 10) },
    cells: Tensor.create(Tensor.Space(dims, [2, 1, 0], Float32Array), Tensor.Data1(values)),
    stats: { min: 0, max: 0, mean: 0, sigma: 0 },
  };
  expectOk(await v.api.load.files({ files: [new File([CCP4Writer.writeMrc(grid, values)], 'map.mrc')] }));
  const ref = v.plugin.managers.volume.hierarchy.current.volumes[0].cell.transform.ref;
  /** The scale on the decorator, as stage-tools writes it */
  const scale = async (k: number) => {
    const identity = { name: 'matrix' as const, params: { data: Mat4.identity(), transpose: false } };
    const cell = v.plugin.state.data.cells.get(ref)!;
    await v.plugin.runTask(
      v.plugin.state.data.updateTree(v.plugin.state.data.build().to(cell).insert(VolumeTransform, { transform: identity, scale: k })),
    );
  };
  return { v, ref, scale };
}

describe('a volume with a pixel size', () => {
  it('shows the file’s value as the one in use when not changed', async () => {
    const { v, ref } = await mrcViewer();
    expect(v.api.cryoet!.dataState(ref).value).toMatchObject({ voxel: '10 Å', pixelSize: 10, filePixelSize: 10 });
  });

  it('shows the drawn voxel, the file’s beside it, and the pixel size in use', async () => {
    const { v, ref, scale } = await mrcViewer();
    await scale(2);
    expect(v.api.cryoet!.dataState(ref).value).toMatchObject({
      voxel: '20 Å (file: 10 Å)',
      pixelSize: 20,
      filePixelSize: 10,
      // the box is not touched: the grid is the file's
      grid: '40 × 36 × 30',
    });
  });

  it('keeps it across levels: the finest voxel is the file’s, each level’s voxel and label scaled', async () => {
    const { v, ref, scale } = await mrcViewer();
    await scale(2);
    expectOk(await v.api.cryoet!.level({ volume: ref, level: '2' } as never));
    const info = v.api.cryoet!.dataState(ref).value!;
    expect(info).toMatchObject({ voxel: '40 Å (file: 20 Å)', pixelSize: 20, filePixelSize: 10, level: '2' });
    expect(info.levels.map((l) => l.spacing)).toEqual([80, 40, 20]);
    expect(info.levels[1].label).toBe('2× · 40 Å · 0.0 MB');
  });

  it('takes the plane slices’ radius from the drawn volume', async () => {
    const { v, ref, scale } = await mrcViewer();
    expectOk(await v.api.cryoet!.slices({ volume: ref } as never));
    const r = v.api.cryoet!.sliceState(ref).value!.radius;
    await scale(2);
    expect(v.api.cryoet!.sliceState(ref).value!.radius).toBeCloseTo(2 * r, 4);
  });

  it('is refused without the stage tools (they place what goes with the volume)', async () => {
    const { v, ref } = await mrcViewer();
    expect(await v.api.cryoet!.volume({ volume: ref, pixelSize: 20 } as never)).toMatchObject({
      ok: false,
      code: 'blocked',
    });
  });
});

void Vec3;
