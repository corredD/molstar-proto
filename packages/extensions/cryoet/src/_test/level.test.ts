/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Mat4, Tensor } from '@molstar/core/math/linear-algebra';
import { CCP4Writer } from '@molstar/model/formats/writer/ccp4/ccp4';
import { Grid, type Volume } from '@molstar/model/model/volume';
import { OmeZarrFromUrl, VolumeFromOmeZarr } from '@molstar/plugin/state/formats/volume/ome-zarr';
import { CustomVolumeProperties } from '@molstar/plugin/state/transforms/volume/ops';
import type { ApiResult } from '@molstar/prism-viewer/api/area';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { samePoint, type SliceInfo, type VolumeDataInfo } from '../operations.js';
import { CryoetExtension } from '../prism-viewer.js';

// `cryoet.level` on a headless viewer: io's three-level OME-Zarr fixture (14×11×9 at 25 Å, 7×6×5 at 50 Å, 4×3×3 at
// 100 Å, in nm in the file; each level's voxel 0 at its own translation), served by a stubbed fetch, never the network.

const Fixtures = path.join(import.meta.dirname, '../../../../io/src/reader/zarr/_test/fixtures');
const Host = 'https://files.example.org/';

function serve() {
  vi.stubGlobal('fetch', async (url: string) => {
    const key = url.slice(Host.length);
    const file = path.join(Fixtures, ...key.split('/'));
    if (!key.includes('..') && fs.existsSync(file) && fs.statSync(file).isFile()) {
      return new Response(new Uint8Array(fs.readFileSync(file)));
    }
    return new Response('Not Found', { status: 404 });
  });
}

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
});

function expectOk<R>(r: ApiResult<R>): asserts r is Extract<ApiResult<R>, { ok: true }> {
  if (!r.ok) expect.fail(`${r.code}: ${r.message}${r.hint ? ` (${r.hint})` : ''}`);
}

/** A viewer with the fixture read at `level` (as the portal reads a tomogram), its three slices shown */
async function viewer(level = '1', maxSizeMB = 512) {
  serve();
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), CryoetExtension] },
  });
  viewers.push(v);
  const volume = v.plugin
    .build()
    .toRoot()
    .apply(OmeZarrFromUrl, { url: `${Host}multiscale.zarr` }, { state: { isGhost: true } })
    .apply(VolumeFromOmeZarr, { level, maxSizeMB, entryId: '' })
    .apply(CustomVolumeProperties);
  await volume.commit();
  const ref = v.plugin.managers.volume.hierarchy.current.volumes[0].cell.transform.ref;
  expectOk(await v.api.cryoet!.slices({ volume: ref } as never));
  return { v, ref };
}

const dataOf = (v: PrismViewer, ref: string) => v.plugin.state.data.cells.get(ref)!.obj!.data as Volume;
const slices = (v: PrismViewer, ref: string) => (v.api.cryoet!.sliceState(ref).value as SliceInfo).slices;

/** Where a grid slice is in Å: its index's voxel along its axis */
function sliceAt(v: PrismViewer, ref: string, axis: 'x' | 'y' | 'z') {
  const s = slices(v, ref).find((x) => x.axis === axis)!;
  const g = Grid.getGridToCartesianTransform(dataOf(v, ref).grid);
  const a = { x: 0, y: 1, z: 2 }[axis];
  return g[12 + a] + s.index * g[5 * a];
}

describe('cryoet.level', () => {
  it('reads the volume at another level in place: its slices stay at their place in Å, at their σ window', async () => {
    const { v, ref } = await viewer('1');
    const c = v.api.cryoet!;
    expect(dataOf(v, ref).grid.cells.space.dimensions).toEqual([7, 6, 5]);
    expectOk(await c.slice({ volume: ref, axis: 'x', index: 5, contrast: 2 } as never));
    expectOk(
      await v.api.run('volume.representation', {
        volume: ref,
        type: 'isosurface',
        params: { isoValue: { kind: 'absolute', absoluteValue: 0.25 } },
      }),
    );
    const before = { x: sliceAt(v, ref, 'x'), refs: slices(v, ref).map((s) => s.ref) };
    const reprs = v.plugin.managers.volume.hierarchy.current.volumes[0].representations.map(
      (r) => r.cell.transform.ref,
    );

    expectOk(await c.level({ volume: ref, level: '0' } as never));

    expect(dataOf(v, ref).grid.cells.space.dimensions).toEqual([14, 11, 9]);
    // the same representations, the slices at the same place (within a voxel of the finer grid), the window in σ
    const after = v.plugin.managers.volume.hierarchy.current.volumes[0].representations.map(
      (r) => r.cell.transform.ref,
    );
    expect(after).toEqual(reprs);
    expect(slices(v, ref).map((s) => s.ref)).toEqual(before.refs);
    expect(Math.abs(sliceAt(v, ref, 'x') - before.x)).toBeLessThanOrEqual(25);
    expect(slices(v, ref).find((s) => s.axis === 'x')!.index).toBe(11);
    expect(slices(v, ref).find((s) => s.axis === 'x')!.contrast).toBe(2);
    expect(slices(v, ref).find((s) => s.axis === 'z')!.contrast).toBe(3);
    // an absolute iso value stays in data units
    const iso = v.plugin.managers.volume.hierarchy.current.volumes[0].representations.find(
      (r) => (r.cell.transform.params as any).type.name === 'isosurface',
    )!;
    expect((iso.cell.transform.params as any).type.params.isoValue).toEqual({ kind: 'absolute', absoluteValue: 0.25 });
    expect(await c.level({ volume: ref, level: '0' } as never)).toMatchObject({ unchanged: true });
  });

  it('keeps a window set apart from the contrast (its two ends) at the same σ, unrounded', async () => {
    const { v, ref } = await viewer('1');
    const x = slices(v, ref).find((s) => s.axis === 'x')!.ref;
    const inSigma = () => {
      const { mean, sigma } = dataOf(v, ref).grid.stats;
      const [lo, hi] = (v.plugin.state.data.cells.get(x)!.transform.params as any).colorTheme.params.domain.params;
      return [(lo - mean) / sigma, (hi - mean) / sigma];
    };
    const { mean, sigma } = dataOf(v, ref).grid.stats;
    await v.plugin
      .build()
      .to(x)
      .update((p: any) => ({
        ...p,
        colorTheme: {
          ...p.colorTheme,
          params: {
            ...p.colorTheme.params,
            domain: { name: 'custom', params: [mean - 1.04 * sigma, mean + 3.13 * sigma] },
          },
        },
      }))
      .commit();
    expectOk(await v.api.cryoet!.level({ volume: ref, level: '0' } as never));
    const [lo, hi] = inSigma();
    expect(lo).toBeCloseTo(-1.04, 6);
    expect(hi).toBeCloseTo(3.13, 6);
  });

  it('is one history step: an undo reads the old level again, its slices where they were', async () => {
    const { v, ref } = await viewer('1');
    const c = v.api.cryoet!;
    const index = slices(v, ref).map((s) => s.index);
    const window = (v.plugin.state.data.cells.get(slices(v, ref)[2].ref)!.transform.params as any).colorTheme.params
      .domain.params;
    expectOk(await c.level({ volume: ref, level: '2' } as never));
    expect(dataOf(v, ref).grid.cells.space.dimensions).toEqual([4, 3, 3]);
    expectOk(await v.api.run('history.undo', {}));
    expect((v.plugin.state.data.cells.get(ref)!.transform.params as any).level).toBe('1');
    expect(dataOf(v, ref).grid.cells.space.dimensions).toEqual([7, 6, 5]);
    expect(slices(v, ref).map((s) => s.index)).toEqual(index);
    expect(
      (v.plugin.state.data.cells.get(slices(v, ref)[2].ref)!.transform.params as any).colorTheme.params.domain.params,
    ).toEqual(window);
  });

  it("asks before a level over the volume's size guard, and reads it when asked again with large", async () => {
    // the guard under the finest level's 5.5 kB (the param's own minimum is 1 MB: set in the state directly)
    const { v, ref } = await viewer('2', 0.003);
    const c = v.api.cryoet!;
    expect((c.dataState(ref).value as VolumeDataInfo).levels.map((l) => [l.path, l.large])).toEqual([
      ['2', false],
      ['1', false],
      ['0', true],
    ]);
    const asked = await c.level({ volume: ref, level: '0' } as never);
    expect(asked).toMatchObject({ ok: false, code: 'confirm' });
    expect(dataOf(v, ref).grid.cells.space.dimensions).toEqual([4, 3, 3]);
    expectOk(await c.level({ volume: ref, level: '0', large: true } as never));
    expect(dataOf(v, ref).grid.cells.space.dimensions).toEqual([14, 11, 9]);
    expect((v.plugin.state.data.cells.get(ref)!.transform.params as any).maxSizeMB).toBe(1);
  });

  it("stays at its level, its slices kept, with the read's message when the level cannot be read", async () => {
    const { v, ref } = await viewer('1');
    const index = slices(v, ref).map((s) => s.index);
    // the finest level's chunks fail; the others are read again (the old level's, as the state reverts)
    const served = globalThis.fetch;
    vi.stubGlobal('fetch', async (url: string) =>
      url.includes('multiscale.zarr/0/') ? new Response('Gone', { status: 500 }) : served(url),
    );
    const r = await v.api.cryoet!.level({ volume: ref, level: '0' } as never);
    expect(r).toMatchObject({ ok: false, code: 'failed' });
    expect(!r.ok && r.message).toMatch(/Download failed with status code 500/);
    expect((v.plugin.state.data.cells.get(ref)!.transform.params as any).level).toBe('1');
    expect(dataOf(v, ref).grid.cells.space.dimensions).toEqual([7, 6, 5]);
    expect(slices(v, ref).map((s) => s.index)).toEqual(index);
  });

  it('lists the levels coarsest to finest, each its binning, voxel and size; the one read now', async () => {
    const { v, ref } = await viewer('1');
    const info = v.api.cryoet!.dataState(ref).value!;
    expect(info).toMatchObject({
      source: 'OME-ZARR',
      grid: '7 × 6 × 5',
      voxel: '50 Å',
      bytes: 7 * 6 * 5 * 4,
      level: '1',
    });
    expect(info.levels.map((l) => l.label)).toEqual([
      '4× · 100 Å · 0.0 MB',
      '2× · 50 Å · 0.0 MB',
      '1× · 25 Å · 0.0 MB',
    ]);
    expect(info.levels.map((l) => l.size)).toEqual([
      [4, 3, 3],
      [7, 6, 5],
      [14, 11, 9],
    ]);
  });

  it('gives a map of one resolution no levels, and refuses to change it', async () => {
    const { v } = await viewer('1');
    const space = Tensor.Space([4, 4, 4], [2, 1, 0], Float32Array);
    const values = new Float32Array(64).map((_, i) => i);
    const grid: Grid = {
      transform: { kind: 'matrix', matrix: Mat4.identity() },
      cells: Tensor.create(space, Tensor.Data1(values)),
      stats: { min: 0, max: 63, mean: 31.5, sigma: 18 },
    };
    expectOk(await v.api.load.files({ files: [new File([CCP4Writer.writeMrc(grid, values)], 'map.mrc')] }));
    const map = v.plugin.managers.volume.hierarchy.current.volumes.find((x) => x.cell.obj?.label === 'map.mrc')!;
    const ref = map.cell.transform.ref;
    const info = v.api.cryoet!.dataState(ref).value!;
    expect(info.levels).toEqual([]);
    expect(info).not.toHaveProperty('level');
    expect(info.grid).toBe('4 × 4 × 4');
    expect(await v.api.cryoet!.level({ volume: ref, level: '0' } as never)).toMatchObject({
      ok: false,
      code: 'invalid',
    });
  });

  it("keeps a direct volume's transfer function in σ: TS_08's Tomogram preset at 4× lands on its own at 2×", () => {
    // the portal's TS_08 at 4× and 2× (read in the browser): σ grows 2.5 times, the range 1.7 times
    const x4 = { min: -0.20752, max: 0.080056, mean: 0.0000018, sigma: 0.011368 };
    const x2 = { min: -0.27274, max: 0.22191, mean: 0.0000018, sigma: 0.02899 };
    // the preset's first point at each level (the direct volume's Tomogram (inverted), from each level's stats)
    expect(samePoint(0.62719, x4, x2)).toBeCloseTo(0.4142, 2);
    expect(samePoint(0.4142, x2, x4)).toBeCloseTo(0.62719, 2);
    expect(samePoint(0.3, x4, { ...x4, sigma: 0 })).toBe(0.3);
  });
});
