/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { Tensor } from '@molstar/core/math/linear-algebra/tensor';
import { Grid, type Volume } from '@molstar/model/model/volume';
import { PluginStateObject as SO } from '@molstar/plugin/state/objects';
import { VolumeTransform } from '../volume/ops.js';

/** A 4³ grid of 10 Å voxels, voxel 0 at (100, 50, 20) */
function volume(): Volume {
  const matrix = Mat4.mul(
    Mat4(),
    Mat4.fromTranslation(Mat4(), Vec3.create(100, 50, 20)),
    Mat4.fromUniformScaling(Mat4(), 10),
  );
  const grid = {
    transform: { kind: 'matrix', matrix },
    cells: Tensor.create(Tensor.Space([4, 4, 4], [2, 1, 0], Float32Array), Tensor.Data1(new Float32Array(64))),
    stats: { min: 0, max: 0, mean: 0, sigma: 0 },
  } as Grid;
  return { grid } as unknown as Volume;
}

function applied(params: object): Volume {
  const a = new SO.Volume.Data(volume(), { label: 'v' });
  const out = (VolumeTransform.definition.apply as any)({ a, params, cache: {} }) as SO.Volume.Data;
  return out.data;
}

const identity = { name: 'matrix' as const, params: { data: Mat4.identity(), transpose: false } };
const at = (v: Volume, i: number, j: number, k: number) =>
  Vec3.transformMat4(Vec3(), Vec3.create(i, j, k), Grid.getGridToCartesianTransform(v.grid));

describe('VolumeTransform scale', () => {
  it('scales a voxel center about the origin by `scale`, before the move', () => {
    const move = Mat4.fromTranslation(Mat4(), Vec3.create(7, 0, 0));
    const v = applied({ transform: { name: 'matrix', params: { data: move, transpose: false } }, scale: 2 });
    expect(Array.from(at(v, 1, 2, 3))).toEqual([2 * 110 + 7, 2 * 70, 2 * 50]);
  });

  it('is the file as drawn without one (an old session) or at 1', () => {
    for (const params of [{ transform: identity }, { transform: identity, scale: 1 }]) {
      expect(Array.from(at(applied(params), 1, 2, 3))).toEqual([110, 70, 50]);
    }
  });

  it('turns a centroid transform about the scaled grid’s center', () => {
    const rot = {
      name: 'components' as const,
      params: {
        axis: Vec3.create(0, 0, 1),
        angle: 180,
        translation: Vec3.create(0, 0, 0),
        rotationCenter: { name: 'centroid' as const, params: {} },
      },
    };
    const v = applied({ transform: rot, scale: 2 });
    // a turn of 180° about the scaled center c: p -> 2c - p (x, y); the scaled box center stays
    const grid = volume().grid;
    const c = Vec3.scale(Vec3(), Grid.getBoundingSphere(grid).center, 2);
    const p = Vec3.create(2 * 100, 2 * 50, 2 * 20);
    const q = at(v, 0, 0, 0);
    expect(q[0]).toBeCloseTo(2 * c[0] - p[0], 4);
    expect(q[1]).toBeCloseTo(2 * c[1] - p[1], 4);
  });
});
