/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Box3D, SpacegroupCell } from '@molstar/core/math/geometry';
import { Mat4, Tensor, Vec3 } from '@molstar/core/math/linear-algebra';
import { Task } from '@molstar/core/task';
import { arrayStats } from '@molstar/core/util/array';
import type { ZarrTypedArray } from '@molstar/io/reader/zarr/metadata';
import type { OmeZarrFile, OmeZarrLevel } from '@molstar/io/reader/zarr/ome-zarr';
import { CustomProperties } from '@molstar/model/model/custom-property';
import { Volume } from '@molstar/model/model/volume';
import type { ModelFormat } from '../format.js';
import { RecommendedIsoValue } from './property.js';

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
    const stats = arrayStats(values);

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
        stats: { min: stats.min, max: stats.max, mean: stats.mean, sigma: stats.rms },
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
