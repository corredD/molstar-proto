/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Box3D, SpacegroupCell } from '@molstar/core/math/geometry';
import { Mat4, Tensor, Vec3 } from '@molstar/core/math/linear-algebra';
import { CustomProperties } from '../../custom-property.js';
import { Grid, Volume } from '../../volume.js';

/** A whole unit cell (periodic) of 4³ voxels, 40 Å a side, its origin at -0.5 (centered, as EMDB maps are) */
function centeredCell(instances: Vec3[] = [Vec3()]): Volume {
  const space = Tensor.Space([4, 4, 4], [0, 1, 2], Float32Array);
  const cell = SpacegroupCell.create(
    'P 1',
    Vec3.create(40, 40, 40),
    Vec3.create(Math.PI / 2, Math.PI / 2, Math.PI / 2),
  );
  const grid: Grid = {
    transform: {
      kind: 'spacegroup',
      cell,
      fractionalBox: Box3D.create(Vec3.create(-0.5, -0.5, -0.5), Vec3.create(0.5, 0.5, 0.5)),
    },
    cells: Tensor.create(space, space.create()),
    stats: { min: 0, max: 1, mean: 0.5, sigma: 0.5 },
    periodicity: 'xyz',
  };
  return {
    grid,
    instances: instances.map((t) => ({ transform: Mat4.fromTranslation(Mat4(), t) })),
    sourceData: { kind: 'test', name: 'test', data: {} },
    customProperties: new CustomProperties(),
    _propertyData: Object.create(null),
    _localPropertyData: Object.create(null),
  };
}

describe('periodic volume', () => {
  it('counts its copies in cells, whatever the origin of the grid', () => {
    // the cell and one copy a cell (40 Å) along x
    const volume = centeredCell([Vec3(), Vec3.create(40, 0, 0)]);
    const { min, max } = Volume.getPeriodicRange(volume)!;
    expect(Array.from(min)).toEqual([0, 0, 0]);
    expect(Array.from(max)).toEqual([2, 1, 1]);
    // the copy's voxels map to the second instance
    const mapping = Volume.getPeriodicMapping(volume)!;
    expect(mapping.get(0, 0, 0)?.instance).toBe(0);
    expect(mapping.get(4, 0, 0)?.instance).toBe(1);
  });
});
