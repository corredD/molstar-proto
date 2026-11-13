/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Box3D, SpacegroupCell } from '@molstar/core/math/geometry';
import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { Grid } from '../grid.js';
import { binGrid } from '../bin.js';
import { grid, Orders, viaAccessors } from './grid-test-util.js';

// A grid binned: each block's mean (a partial block at the edge, the mean of what it holds), its voxels where their
// blocks' centers are in Å, its stats its own.

const at = (g: Grid, i: number, j: number, k: number) => g.cells.space.get(g.cells.data, i, j, k);
const position = (g: Grid, i: number, j: number, k: number) =>
  Vec3.transformMat4(Vec3(), Vec3.create(i, j, k), Grid.getGridToCartesianTransform(g));

/** i + 10 j + 100 k: a block's mean is the value at its center */
const linear = (i: number, j: number, k: number) => i + 10 * j + 100 * k;

describe('binGrid', () => {
  it('gives the block means, a partial block at the edge the mean of what it holds', async () => {
    const g = grid([2, 1, 0], Float32Array, [5, 4, 3], linear);
    const b = await binGrid(g, 2);
    expect(b.cells.space.dimensions).toEqual([3, 2, 2]);
    // a full block: x 0–1, y 0–1, z 0–1
    expect(at(b, 0, 0, 0)).toBeCloseTo(linear(0.5, 0.5, 0.5), 5);
    // x 4 alone, y 2–3, z 2 alone
    expect(at(b, 2, 1, 1)).toBeCloseTo(linear(4, 2.5, 2), 5);
    expect(at(b, 1, 1, 0)).toBeCloseTo(linear(2.5, 2.5, 0.5), 5);
  });

  it('is the same for every axis order, read with strides or through the accessors', async () => {
    const ref = await binGrid(grid([2, 1, 0]), 2);
    for (const order of Orders) {
      for (const g of [grid(order), viaAccessors(grid(order))]) {
        const b = await binGrid(g, 2);
        expect(b.cells.space.dimensions).toEqual(ref.cells.space.dimensions);
        const [x, y, z] = b.cells.space.dimensions;
        for (let k = 0; k < z; k++) {
          for (let j = 0; j < y; j++) {
            for (let i = 0; i < x; i++) expect(at(b, i, j, k)).toBeCloseTo(at(ref, i, j, k), 5);
          }
        }
      }
    }
  });

  it("puts a voxel where its block's center is in Å, the voxel size times the factor (a matrix grid)", async () => {
    // 2 Å voxels, voxel 0 at (10, -4, 7); 7 × 5 × 3 (no side a multiple of 4)
    const matrix = Mat4.mul(
      Mat4(),
      Mat4.fromTranslation(Mat4(), Vec3.create(10, -4, 7)),
      Mat4.fromUniformScaling(Mat4(), 2),
    );
    const g = { ...grid([2, 1, 0], Float32Array, [7, 5, 3]), transform: { kind: 'matrix' as const, matrix } };
    for (const f of [2, 4]) {
      const b = await binGrid(g, f);
      // coarse voxel 1's center: its block's (fine voxels f … 2f−1), mean index f + (f − 1)/2; along z, 3 voxels at most
      const c = f + (f - 1) / 2;
      const z = (Math.min(f, 3) - 1) / 2;
      expect([...position(b, 1, 1, 0)]).toEqual([...position(g, c, c, z)].map((x) => expect.closeTo(x, 5)));
      const step = Vec3.sub(Vec3(), position(b, 1, 0, 0), position(b, 0, 0, 0));
      expect(step[0]).toBeCloseTo(2 * f, 5);
    }
  });

  it("puts a voxel where its block's center is in Å (an MRC's spacegroup grid, its sides not multiples)", async () => {
    // an MRC's grid: a cell of 5 × 6 × 3.5 Å per voxel, its box starting at voxel (3, -2, 1)
    const dims = [7, 5, 3];
    const cell = SpacegroupCell.create(
      'P 1',
      Vec3.create(35, 30, 10.5),
      Vec3.create(Math.PI / 2, Math.PI / 2, Math.PI / 2),
    );
    const min = Vec3.create(3 / 7, -2 / 5, 1 / 3);
    const transform = {
      kind: 'spacegroup' as const,
      cell,
      fractionalBox: Box3D.create(min, Vec3.add(Vec3(), min, Vec3.create(1, 1, 1))),
    };
    const g = { ...grid([2, 1, 0], Int16Array, dims, linear), transform };
    const b = await binGrid(g, 2);
    expect(b.transform.kind).toBe('spacegroup');
    expect([...position(b, 2, 1, 0)]).toEqual([...position(g, 4.5, 2.5, 0.5)].map((x) => expect.closeTo(x, 5)));
    const step = Vec3.sub(Vec3(), position(b, 0, 0, 1), position(b, 0, 0, 0));
    expect(step[2]).toBeCloseTo(7, 5);
    // the means of an integer map as floats
    expect(b.cells.data).toBeInstanceOf(Float32Array);
    expect(at(b, 0, 0, 0)).toBeCloseTo(linear(0.5, 0.5, 0.5), 5);
  });

  it('recomputes the stats over the binned voxels', async () => {
    const g = grid([2, 1, 0], Float32Array, [4, 2, 2], (i) => i);
    const b = await binGrid(g, 2);
    // the voxels 0.5 and 2.5
    expect(b.stats.min).toBeCloseTo(0.5, 6);
    expect(b.stats.max).toBeCloseTo(2.5, 6);
    expect(b.stats.mean).toBeCloseTo(1.5, 6);
    expect(b.stats.sigma).toBeCloseTo(1, 6);
  });

  it('keeps the grid at 1×', async () => {
    const g = grid([2, 1, 0]);
    expect(await binGrid(g, 1)).toBe(g);
  });

  it('bins a side shorter than the factor by its length: one voxel, where its voxels are (an image of one plane)', async () => {
    const g = grid([2, 1, 0], Float32Array, [6, 4, 1], linear);
    const b = await binGrid(g, 2);
    expect(b.cells.space.dimensions).toEqual([3, 2, 1]);
    expect(at(b, 0, 0, 0)).toBeCloseTo(linear(0.5, 0.5, 0), 5);
    expect([...position(b, 0, 0, 0)]).toEqual([...position(g, 0.5, 0.5, 0)].map((x) => expect.closeTo(x, 5)));
  });
});
