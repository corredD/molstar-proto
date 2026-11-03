/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Box3D, SpacegroupCell } from '@molstar/core/math/geometry';
import { Mat4, Tensor, Vec3 } from '@molstar/core/math/linear-algebra';
import { Task } from '@molstar/core/task';
import type { ZarrTypedArray } from '@molstar/io/reader/zarr/metadata';
import type { OmeZarrFile, OmeZarrLevel } from '@molstar/io/reader/zarr/ome-zarr';
import { CustomProperties } from '@molstar/model/model/custom-property';
import { Volume } from '@molstar/model/model/volume';
import type { ModelFormat } from '../format.js';
import { RecommendedIsoValue } from './property.js';

/**
 * Min, max, mean and standard deviation over the finite values (formats.md §3): a NaN fill value marks voxels with no
 * data, and `sigma` is the MRC header's ARMS (a deviation from the mean), so a relative iso value is the same as on the
 * MRC of the same data. Not core's `arrayStats`: its `rms` is around 0 and it counts NaN.
 */
function finiteStats(values: ZarrTypedArray) {
  let min = Infinity,
    max = -Infinity,
    sum = 0,
    sumSq = 0,
    n = 0;
  for (let i = 0, il = values.length; i < il; ++i) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    sumSq += v * v;
    n++;
  }
  if (n === 0) return { min: 0, max: 0, mean: 0, sigma: 0 };
  const mean = sum / n;
  return { min, max, mean, sigma: Math.sqrt(Math.max(0, sumSq / n - mean * mean)) };
}

/**
 * A `Volume` of one OME-Zarr level and its voxels (`readOmeZarrLevel`), placed as a CCP4 map of the same grid: a P 1
 * cell of `size · scale` Å, voxel `i` at `translation + i · scale` (formats.md §3, zarr.md §4). A level of integers
 * from 0 to 1 (a segmentation mask) recommends the iso value 0.5.
 */
export function volumeFromOmeZarr(
  source: OmeZarrFile,
  level: OmeZarrLevel,
  values: ZarrTypedArray,
  params?: { label?: string; entryId?: string },
): Task<Volume> {
  return Task.create<Volume>('Create Volume', async () => {
    const size = Vec3.ofArray(level.size);
    const n = size[0] * size[1] * size[2];
    if (values.length !== n) throw new Error(`OME-Zarr: ${values.length} values for a ${level.size.join('x')} level`);
    const cell = SpacegroupCell.create(
      'P 1',
      Vec3.mul(Vec3(), size, Vec3.ofArray(level.scale)),
      Vec3.create(Math.PI / 2, Math.PI / 2, Math.PI / 2),
    );

    // the array's last three axes, slowest first, as x, y, z (0, 1, 2): [2, 1, 0] for z, y, x
    const { spaceAxes, rank } = source.multiscale;
    const axisOrderSlowToFast = [0, 1, 2].map((j) => spaceAxes.indexOf(rank - 3 + j));
    const space = Tensor.Space(Array.from(size), axisOrderSlowToFast, level.array.dtype.ctor);
    const data = Tensor.create(space, Tensor.Data1(values));

    // voxel 0 at `translation`: the fractional box starts there, and spans the cell
    const origin = Vec3.div(Vec3(), Vec3.ofArray(level.translation), Vec3.ofArray(level.scale));
    const min = Vec3.div(Vec3(), origin, size);
    const stats = finiteStats(values);

    const volume: Volume = {
      label: params?.label,
      entryId: params?.entryId,
      grid: {
        transform: {
          kind: 'spacegroup',
          cell,
          fractionalBox: Box3D.create(min, Vec3.add(Vec3(), min, Vec3.create(1, 1, 1))),
        },
        cells: data,
        stats,
        // a tomogram is not a crystal's cell: no wrap-around
        periodicity: 'none',
      },
      instances: [{ transform: Mat4.identity() }],
      sourceData: OmeZarrFormat.create(source, level),
      customProperties: new CustomProperties(),
      _propertyData: Object.create(null),
      _localPropertyData: Object.create(null),
    };
    if (level.array.dtype.isInteger && stats.min >= 0 && stats.max === 1) {
      RecommendedIsoValue.Provider.set(volume, Volume.IsoValue.absolute(0.5));
    }
    return volume;
  });
}

//

export { OmeZarrFormat };

type OmeZarrFormat = ModelFormat<{ file: OmeZarrFile; level: OmeZarrLevel }>;

namespace OmeZarrFormat {
  export function is(x?: ModelFormat): x is OmeZarrFormat {
    return x?.kind === 'ome-zarr';
  }

  export function create(file: OmeZarrFile, level: OmeZarrLevel): OmeZarrFormat {
    return { kind: 'ome-zarr', name: file.name, data: { file, level } };
  }
}
