/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { OrderedSet, Interval } from '@molstar/core/data/int';
import { Grid, Volume } from '@molstar/model/model/volume';
import { Mat4, Tensor, Vec3 } from '@molstar/core/math/linear-algebra';
import { Box3D, SpacegroupCell } from '@molstar/core/math/geometry';
import { CustomProperties } from '@molstar/model/model/custom-property';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { applySliceObjectLoci, applySliceGroupIntervals, createImage, SliceParams } from '../slice.js';

function createTestVolume(instanceCount: number, periodic = false, stats: Grid['stats'] = Grid.One.stats): Volume {
  return {
    grid: periodic ? { ...Grid.One, periodicity: 'xyz', stats } : { ...Grid.One, stats },
    instances: Array.from({ length: instanceCount }, () => ({ transform: Mat4.identity() })),
    sourceData: { kind: 'test', name: 'test', data: {} } as any,
    customProperties: new CustomProperties(),
    _propertyData: Object.create(null),
    _localPropertyData: Object.create(null),
  };
}

describe('slice helpers', () => {
  it('applies object loci as displayed plane intervals for contiguous instances', () => {
    const volume = createTestVolume(4);
    const loci = Volume.Loci(volume, OrderedSet.ofBounds(1, 3) as OrderedSet<Volume.InstanceIndex>);
    const intervals: Array<[number, number]> = [];

    const changed = applySliceObjectLoci(loci, volume, 5, (interval) => {
      intervals.push([Interval.start(interval), Interval.end(interval)]);
      return true;
    });

    expect(changed).toBe(true);
    expect(intervals).toEqual([[5, 15]]);
  });

  it('applies object loci per displayed instance for discontiguous selections', () => {
    const volume = createTestVolume(4);
    const loci = Volume.Loci(volume, OrderedSet.ofSortedArray([0, 2]) as OrderedSet<Volume.InstanceIndex>);
    const intervals: Array<[number, number]> = [];

    const changed = applySliceObjectLoci(loci, volume, 5, (interval) => {
      intervals.push([Interval.start(interval), Interval.end(interval)]);
      return true;
    });

    expect(changed).toBe(true);
    expect(intervals).toEqual([
      [0, 5],
      [10, 15],
    ]);
  });

  it('collapses periodic object loci to the single displayed slice plane', () => {
    const volume = createTestVolume(4, true);
    const loci = Volume.Loci(volume, OrderedSet.ofBounds(1, 3) as OrderedSet<Volume.InstanceIndex>);
    const intervals: Array<[number, number]> = [];

    const changed = applySliceObjectLoci(loci, volume, 6, (interval) => {
      intervals.push([Interval.start(interval), Interval.end(interval)]);
      return true;
    });

    expect(changed).toBe(true);
    expect(intervals).toEqual([[0, 6]]);
  });

  it('batches contiguous slice pixels into minimal intervals', () => {
    const intervals: Array<[number, number]> = [];

    const changed = applySliceGroupIntervals([1, 2, 3, 7, 8, 10], 5, (interval) => {
      intervals.push([Interval.start(interval), Interval.end(interval)]);
      return true;
    });

    expect(changed).toBe(true);
    expect(intervals).toEqual([
      [6, 9],
      [12, 14],
      [15, 16],
    ]);
  });
});

/** A whole unit cell (periodic) of 4³ voxels, 40 Å a side, its origin at -0.5 (centered, as EMDB maps are) */
function centeredCell(): Volume {
  const space = Tensor.Space([4, 4, 4], [0, 1, 2], Float32Array);
  const cell = SpacegroupCell.create(
    'P 1',
    Vec3.create(40, 40, 40),
    Vec3.create(Math.PI / 2, Math.PI / 2, Math.PI / 2),
  );
  const fractionalBox = Box3D.create(Vec3.create(-0.5, -0.5, -0.5), Vec3.create(0.5, 0.5, 0.5));
  return {
    ...createTestVolume(1, true, { min: 0, max: 1, mean: 0.5, sigma: 0.5 }),
    grid: {
      transform: { kind: 'spacegroup', cell, fractionalBox },
      cells: Tensor.create(space, space.create()),
      stats: { min: 0, max: 1, mean: 0.5, sigma: 0.5 },
      periodicity: 'xyz',
    },
  };
}

describe('slice of a periodic volume', () => {
  it('is drawn in the grid, its origin kept', async () => {
    const volume = centeredCell();
    const theme = { color: { granularity: 'uniform', color: () => 0xffffff }, size: {} } as any;
    const props = { ...PD.getDefaultValues(SliceParams), dimension: { name: 'z', params: 2 } } as any;
    const image = await createImage({} as any, volume, 0, theme, props);
    // the z slice through the middle voxel: x and y across the cell (-20..20 Å), z at the third of four voxels
    const corners = Array.from(image.cornerBuffer.ref.value);
    const xs = corners.filter((_, i) => i % 3 === 0);
    const zs = corners.filter((_, i) => i % 3 === 2);
    expect(Math.min(...xs)).toBeCloseTo(-20);
    expect(Math.max(...xs)).toBeCloseTo(20);
    for (const z of zs) expect(z).toBeCloseTo(0);
    // where the isosurface and the volume's bounds are
    for (const c of image.boundingSphere.center) expect(c).toBeCloseTo(0);
  });
});
