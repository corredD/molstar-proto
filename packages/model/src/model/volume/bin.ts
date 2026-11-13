/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Box3D } from '@molstar/core/math/geometry';
import { Mat4, Tensor, Vec3 } from '@molstar/core/math/linear-algebra';
import type { RuntimeContext } from '@molstar/core/task';
import type { Grid } from './grid.js';

/**
 * A grid binned by `factor` along each side (a side shorter than it: by its length): each voxel the mean of its block
 * of the grid, a partial block at the far edge the mean of what it holds; Float32 whatever the grid's type. Its voxels
 * are where their blocks' centers are (Å): the voxel size times the factor, voxel 0 moved half a block less one voxel.
 * Its stats are its own. The grid itself at 1×.
 */
export async function binGrid(grid: Grid, factor: number, ctx?: RuntimeContext): Promise<Grid> {
  const f = Math.floor(factor);
  if (!(f > 1)) return grid;
  const { space, data } = grid.cells;
  const dims = space.dimensions;
  const by = [0, 1, 2].map((a) => Math.max(1, Math.min(f, dims[a])));
  const out = [0, 1, 2].map((a) => Math.ceil(dims[a] / by[a]));
  const [a0, a1, a2] = space.axisOrderSlowToFast;
  const binned = Tensor.Space(out, [a0, a1, a2], Float32Array);
  const sums = new Float64Array(out[0] * out[1] * out[2]);
  // the binned grid's index along each axis of each voxel of the grid, and its stride: one pass in memory order
  const strides = Tensor.strides(binned)!;
  const step = [0, 1, 2].map((a) => Int32Array.from({ length: dims[a] }, (_, i) => Math.floor(i / by[a]) * strides[a]));
  const read = Tensor.strides(space);
  const [s0, s1, s2] = [step[a0], step[a1], step[a2]];
  const [n0, n1, n2] = [dims[a0], dims[a1], dims[a2]];
  const c = [0, 0, 0];
  for (let i0 = 0; i0 < n0; i0++) {
    if (ctx?.shouldUpdate) await ctx.update({ message: `Binning ${f}×…`, current: i0, max: n0 });
    c[a0] = i0;
    for (let i1 = 0; i1 < n1; i1++) {
      c[a1] = i1;
      const o = s0[i0] + s1[i1];
      if (read) {
        let at = i0 * read[a0] + i1 * read[a1];
        const r2 = read[a2];
        for (let i2 = 0; i2 < n2; i2++, at += r2) sums[o + s2[i2]] += data[at];
      } else {
        for (let i2 = 0; i2 < n2; i2++) {
          c[a2] = i2;
          sums[o + s2[i2]] += space.get(data, c[0], c[1], c[2]);
        }
      }
    }
  }
  // each voxel's count: the product of its block's lengths along the three axes (shorter at the far edge)
  const length = [0, 1, 2].map((a) =>
    Int32Array.from({ length: out[a] }, (_, i) => Math.min(by[a], dims[a] - i * by[a])),
  );
  const values = binned.create() as Float32Array;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let sumSq = 0;
  for (let z = 0; z < out[2]; z++) {
    for (let y = 0; y < out[1]; y++) {
      const n = length[2][z] * length[1][y];
      for (let x = 0; x < out[0]; x++) {
        const o = x * strides[0] + y * strides[1] + z * strides[2];
        const v = sums[o] / (n * length[0][x]);
        values[o] = v;
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v;
        sumSq += v * v;
      }
    }
  }
  const count = values.length;
  const mean = sum / count;
  const stats = { min, max, mean, sigma: Math.sqrt(Math.max(0, sumSq / count - mean * mean)) };
  return { ...grid, transform: binnedTransform(grid, by, out), cells: Tensor.create(binned, values), stats };
}

/** The transform of a grid binned `by` along each axis to `out` voxels: voxel 0 at its block's center, `by` times the voxel */
function binnedTransform(grid: Grid, by: number[], out: number[]): Grid.Transform {
  const shift = Vec3.create((by[0] - 1) / 2, (by[1] - 1) / 2, (by[2] - 1) / 2);
  const { transform } = grid;
  if (transform.kind === 'matrix') {
    const m = Mat4.mul(Mat4(), transform.matrix, Mat4.fromTranslation(Mat4(), shift));
    return { kind: 'matrix', matrix: Mat4.mul(m, m, Mat4.fromScaling(Mat4(), Vec3.create(by[0], by[1], by[2]))) };
  }
  // fractional: voxel i at min + i·Δ, Δ = size / dimensions; binned, min + shift·Δ and by·Δ for each of `out` voxels
  const dims = grid.cells.space.dimensions;
  const size = Box3D.size(Vec3(), transform.fractionalBox);
  const delta = Vec3.create(size[0] / dims[0], size[1] / dims[1], size[2] / dims[2]);
  const min = Vec3.add(Vec3(), transform.fractionalBox.min, Vec3.mul(Vec3(), shift, delta));
  const extent = Vec3.create(out[0] * by[0] * delta[0], out[1] * by[1] * delta[1], out[2] * by[2] * delta[2]);
  return { ...transform, fractionalBox: Box3D.create(min, Vec3.add(Vec3(), min, extent)) };
}
