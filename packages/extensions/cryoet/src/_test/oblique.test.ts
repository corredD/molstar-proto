/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Box3D, SpacegroupCell } from '@molstar/core/math/geometry';
import { Mat4, Tensor, Vec3 } from '@molstar/core/math/linear-algebra';
import { Grid } from '@molstar/model/model/volume';
import { obliqueFrame, obliquePlane, obliquePoseOf, obliquePoseOfPlane, type ObliquePose } from '../oblique.js';

/** A cell of 4³ voxels, 40 Å a side, centered on 0 (as EMDB maps are) */
function centered(): Grid {
  const space = Tensor.Space([4, 4, 4], [0, 1, 2], Float32Array);
  const cell = SpacegroupCell.create(
    'P 1',
    Vec3.create(40, 40, 40),
    Vec3.create(Math.PI / 2, Math.PI / 2, Math.PI / 2),
  );
  const fractionalBox = Box3D.create(Vec3.create(-0.5, -0.5, -0.5), Vec3.create(0.5, 0.5, 0.5));
  return {
    transform: { kind: 'spacegroup', cell, fractionalBox },
    cells: Tensor.create(space, space.create()),
    stats: { min: 0, max: 1, mean: 0.5, sigma: 0.5 },
  };
}

/** The grid moved by `m`, as the volume's move (`VolumeTransform`) moves it */
function moved(grid: Grid, m: Mat4): Grid {
  return {
    ...grid,
    transform: { kind: 'matrix', matrix: Mat4.mul(Mat4(), m, Grid.getGridToCartesianTransform(grid)) },
  };
}

const close = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  for (let i = 0; i < b.length; i++) expect(a[i]).toBeCloseTo(b[i], 6);
};

const samePose = (a: ObliquePose, b: ObliquePose) => {
  close(a.position, b.position);
  close(a.tilt, b.tilt);
};

describe('the oblique slice', () => {
  it("is placed in its volume's frame: untilted, along the volume's Z", () => {
    const plane = obliquePlane(centered(), { position: [0, 0, 5], tilt: [0, 0] });
    close(plane.point, [0, 0, 5]);
    close(plane.normal, [0, 0, 1]);
    // tilted a quarter about X: its normal along -Y
    close(obliquePlane(centered(), { position: [0, 0, 0], tilt: [90, 0] }).normal, [0, -1, 0]);
  });

  it('reads back the pose it was given, from its plane and from its handle', () => {
    const grid = centered();
    const pose: ObliquePose = { position: [3, -4, 5], tilt: [30, -40] };
    samePose(obliquePoseOfPlane(grid, obliquePlane(grid, pose)), pose);
    samePose(obliquePoseOf(grid, obliqueFrame(grid, pose)), pose);
    // a handle turned about its normal: the same plane, the same pose
    const twisted = Mat4.mul(Mat4(), obliqueFrame(grid, pose), Mat4.fromRotation(Mat4(), 0.8, Vec3.unitZ));
    samePose(obliquePoseOf(grid, twisted), pose);
  });

  it('keeps its pose as the volume moves: its plane moved as the stage moves it', () => {
    const grid = centered();
    const pose: ObliquePose = { position: [3, -4, 5], tilt: [30, -40] };
    const m = Mat4.mul(Mat4(), Mat4.fromTranslation(Mat4(), Vec3.create(100, 0, -20)), Mat4.rotZ90);
    const before = obliquePlane(grid, pose);
    const after = obliquePlane(moved(grid, m), pose);
    close(after.point, Vec3.transformMat4(Vec3(), before.point, m));
    close(after.normal, Vec3.transformDirection(Vec3(), before.normal, m));
    samePose(obliquePoseOfPlane(moved(grid, m), after), pose);
  });
});
