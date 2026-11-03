/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Mat4 } from '@molstar/core/math/linear-algebra';
import { parse as parseCcp4 } from '@molstar/io/reader/ccp4/parser';
import { openOmeZarr, readOmeZarrLevel } from '@molstar/io/reader/zarr/ome-zarr';
import { ZarrStore } from '@molstar/io/reader/zarr/store';
import { Grid, Volume } from '@molstar/model/model/volume';
import { volumeFromCcp4 } from '../ccp4.js';
import { volumeFromOmeZarr } from '../ome-zarr.js';
import { RecommendedIsoValue } from '../property.js';

/** io's Zarr fixtures (data files, made by make-fixtures.py there). */
const Fixtures = path.join(import.meta.dirname, '../../../../../io/src/reader/zarr/_test/fixtures');

function store(dir: string) {
  const root = path.join(Fixtures, dir);
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  for (const f of fs.readdirSync(root, { recursive: true, encoding: 'utf8' })) {
    const p = path.join(root, f);
    if (fs.statSync(p).isFile()) files.set(f.split(path.sep).join('/'), new Uint8Array(fs.readFileSync(p)));
  }
  return ZarrStore.fromMap(files);
}

async function zarrVolume(dir: string, level: number) {
  const file = await openOmeZarr(store(dir), dir).run();
  if (file.isError) throw new Error(file.message);
  const l = file.result.levels[level];
  const values = await readOmeZarrLevel(file.result, l).run();
  if (values.isError) throw new Error(values.message);
  return volumeFromOmeZarr(file.result, l, values.result, { label: dir }).run();
}

describe('volumeFromOmeZarr', () => {
  it('places level 0 as its MRC through the CCP4 path: the same dims, cell, origin and values', async () => {
    const zarr = await zarrVolume('multiscale.zarr', 0);
    const mrc = await parseCcp4(new Uint8Array(fs.readFileSync(path.join(Fixtures, 'multiscale-0.mrc')))).run();
    if (mrc.isError) throw new Error(mrc.message);
    const ccp4 = await volumeFromCcp4(mrc.result).run();

    expect(zarr.grid.cells.space.dimensions).toEqual([14, 11, 9]);
    expect(zarr.grid.cells.space.dimensions).toEqual(ccp4.grid.cells.space.dimensions);
    expect(zarr.grid.cells.space.axisOrderSlowToFast).toEqual(ccp4.grid.cells.space.axisOrderSlowToFast);
    const toCartesian = (v: Volume) => Grid.getGridToCartesianTransform(v.grid);
    expect(Mat4.areEqual(toCartesian(zarr), toCartesian(ccp4), 1e-4)).toBe(true);
    // voxel 0 at the NGFF translation (Å), 25 Å apart
    expect(Array.from(toCartesian(zarr)).filter((_, i) => [0, 5, 10, 12, 13, 14].includes(i))).toEqual([
      25, 25, 25, 300, 200, 100,
    ]);
    expect(Array.from(zarr.grid.cells.data)).toEqual(Array.from(ccp4.grid.cells.data));
    const { space, data } = zarr.grid.cells;
    // x, y, z = 7, 3, 5: 100 z + 10 y + x; and the missing chunk (z < 4, y < 5, 6 <= x < 12) is the fill value
    expect(space.get(data, 7, 3, 5)).toBe(537);
    expect(space.get(data, 7, 3, 2)).toBe(0);
    expect(zarr.grid.stats.max).toBe(ccp4.grid.stats.max);
    // the MRC header's mean and ARMS (a standard deviation): a relative iso value is the same on both
    expect(zarr.grid.stats.mean).toBeCloseTo(ccp4.grid.stats.mean, 2);
    expect(zarr.grid.stats.sigma).toBeCloseTo(ccp4.grid.stats.sigma, 2);
    expect(zarr.grid.periodicity).toBe('none');
    expect(RecommendedIsoValue.Provider.get(zarr)).toBeUndefined();
  });

  it('places a coarser level by its own scale and translation', async () => {
    const zarr = await zarrVolume('multiscale.zarr', 2);
    expect(zarr.grid.cells.space.dimensions).toEqual([4, 3, 3]);
    const m = Grid.getGridToCartesianTransform(zarr.grid);
    expect([m[0], m[12], m[13], m[14]]).toEqual([100, 337.5, 237.5, 137.5]);
  });

  it('leaves NaN voxels (a NaN fill value where a chunk is missing) out of the stats', async () => {
    // 1 x 1 x 4 float, chunks of 2, raw: chunk 0.0.0 [1, 3], chunk 0.0.1 missing (NaN)
    const enc = (o: object) => new TextEncoder().encode(JSON.stringify(o));
    const files = new Map<string, Uint8Array<ArrayBuffer>>([
      [
        '.zattrs',
        enc({
          multiscales: [
            {
              axes: ['z', 'y', 'x'].map((name) => ({ name, type: 'space', unit: 'angstrom' })),
              datasets: [{ path: '0', coordinateTransformations: [{ type: 'scale', scale: [1, 1, 1] }] }],
            },
          ],
        }),
      ],
      [
        '0/.zarray',
        enc({
          zarr_format: 2,
          shape: [1, 1, 4],
          chunks: [1, 1, 2],
          dtype: '<f4',
          compressor: null,
          fill_value: 'NaN',
          filters: null,
          order: 'C',
        }),
      ],
      ['0/0.0.0', new Uint8Array(Float32Array.from([1, 3]).buffer)],
    ]);
    const file = await openOmeZarr(ZarrStore.fromMap(files), 'nan').run();
    if (file.isError) throw new Error(file.message);
    const values = await readOmeZarrLevel(file.result, file.result.levels[0]).run();
    if (values.isError) throw new Error(values.message);
    const v = await volumeFromOmeZarr(file.result, file.result.levels[0], values.result).run();
    expect(v.grid.stats).toEqual({ min: 1, max: 3, mean: 2, sigma: 1 });
  });

  it('recommends the iso value 0.5 for a 0/1 mask', async () => {
    const mask = await zarrVolume('mask.zarr', 0);
    expect(mask.grid.cells.data).toBeInstanceOf(Int8Array);
    expect([mask.grid.stats.min, mask.grid.stats.max]).toEqual([0, 1]);
    expect(RecommendedIsoValue.Provider.get(mask)).toEqual(Volume.IsoValue.absolute(0.5));
  });
});
