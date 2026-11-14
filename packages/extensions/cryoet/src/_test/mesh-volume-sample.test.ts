/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Mat4, Tensor, Vec3 } from '@molstar/core/math/linear-algebra';
import type { Grid } from '@molstar/model/model/volume';
import { meshSamplePoints, sampleVolume } from '../mesh-volume.js';
import { sphereMesh, squareMesh } from './mesh-volume-fixtures.js';

// The sampler of a mesh's Color by › Volume (apps/prism-me/progress/2026-11-14-mesh-volume-color.md): the density at
// each vertex (or cell center) of a mesh in its drawn frame, or the Mean, Min or Max along its normal within ±Depth,
// in σ of the volume's grid, read in the grid's own frame (its origin, its voxel).

/** A grid of n³ voxels of `voxel` Å, voxel 0 at `origin`, its values f(x, y, z) at each voxel's place in Å */
function gridOf(n: number, voxel: number, origin: Vec3, f: (x: number, y: number, z: number) => number): Grid {
  const values = new Float32Array(n * n * n);
  let sum = 0;
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const v = f(origin[0] + i * voxel, origin[1] + j * voxel, origin[2] + k * voxel);
        values[i + n * (j + n * k)] = v;
        sum += v;
      }
    }
  }
  const mean = sum / values.length;
  let sq = 0;
  for (const v of values) sq += (v - mean) ** 2;
  const matrix = Mat4.mul(Mat4(), Mat4.fromTranslation(Mat4(), origin), Mat4.fromUniformScaling(Mat4(), voxel));
  return {
    transform: { kind: 'matrix', matrix },
    cells: Tensor.create(Tensor.Space([n, n, n], [2, 1, 0], Float32Array), Tensor.Data1(values)),
    stats: { min: Math.min(...values), max: Math.max(...values), mean, sigma: Math.sqrt(sq / values.length) },
  };
}

/** A dark shell of radius 30 Å about (40, 40, 40): -1 on it, 0 far from it */
const Center = Vec3.create(40, 40, 40);
const shell = (x: number, y: number, z: number) =>
  -Math.exp(-(((Math.hypot(x - Center[0], y - Center[1], z - Center[2]) - 30) / 3) ** 2));
const ShellGrid = gridOf(80, 1, Vec3(), shell);
const sigmaOf = (g: Grid, v: number) => (v - g.stats.mean) / g.stats.sigma;

/** A linear field: trilinear interpolation reads it exactly */
const linear = (x: number, y: number, z: number) => x + 2 * y + 3 * z;

describe('a mesh sampled in a volume', () => {
  it('at surface: the profile at each vertex, in σ of the grid', () => {
    const points = meshSamplePoints(sphereMesh(30, Center, 24, 48));
    const values = sampleVolume(points, Mat4.identity(), ShellGrid, 'surface', 0);
    expect(values.length).toBe(points.count);
    const expected = sigmaOf(ShellGrid, -1);
    expect(expected).toBeLessThan(-2);
    for (const v of values) expect(Math.abs(v - expected)).toBeLessThan(0.25);
  });

  it('projected Min ±Depth finds the shell when the mesh is off it by less than Depth', () => {
    const points = meshSamplePoints(sphereMesh(34, Center, 24, 48));
    const surface = sampleVolume(points, Mat4.identity(), ShellGrid, 'surface', 0);
    const min = sampleVolume(points, Mat4.identity(), ShellGrid, 'min', 8);
    const expected = sigmaOf(ShellGrid, -1);
    for (let i = 0; i < points.count; i++) {
      expect(surface[i]).toBeGreaterThan(expected / 2);
      expect(Math.abs(min[i] - expected)).toBeLessThan(0.25);
    }
    // the shell is 4 Å under the mesh: ±3 Å does not reach it
    const short = sampleVolume(points, Mat4.identity(), ShellGrid, 'min', 3);
    for (const v of short) expect(v).toBeGreaterThan(expected / 2);
  });

  it('Mean, Min and Max along the normal: of the samples within ±Depth', () => {
    // a square at z = 20 (its normal z) in a linear field: its samples are f(z - D) … f(z + D), evenly
    const g = gridOf(48, 1, Vec3(), linear);
    const points = meshSamplePoints(squareMesh(10, 20, 20, 10));
    const at = (z: number) => sigmaOf(g, linear(20, 20, z));
    for (const [sample, z] of [
      ['surface', 20],
      ['mean', 20],
      ['min', 14],
      ['max', 26],
    ] as const) {
      const values = sampleVolume(points, Mat4.identity(), g, sample, 6);
      // the square's points are at x, y in 15…25: the field's x and y parts the same at each
      for (let i = 0; i < points.count; i++) {
        const [x, y] = [points.positions[3 * i], points.positions[3 * i + 1]];
        const offset = sigmaOf(g, linear(x, y, 0)) - sigmaOf(g, linear(20, 20, 0));
        expect(values[i]).toBeCloseTo(at(z) + offset, 4);
      }
    }
  });

  it('reads both where drawn: a moved and scaled mesh, a volume with an origin, give the unmoved values', () => {
    const g = gridOf(48, 1, Vec3(), linear);
    const mesh = sphereMesh(10, Vec3.create(24, 24, 24), 8, 16);
    const points = meshSamplePoints(mesh);
    const base = sampleVolume(points, Mat4.identity(), g, 'max', 4);
    // the mesh in nm, drawn ×10 Å and moved: its file's coordinates a tenth, less the move
    const move = Vec3.create(3, -2, 5);
    const nm = meshSamplePoints({
      ...mesh,
      vertices: mesh.vertices.map((v, i) => (v - move[i % 3]) / 10),
    });
    const drawn = Mat4.mul(Mat4(), Mat4.fromTranslation(Mat4(), move), Mat4.fromUniformScaling(Mat4(), 10));
    const moved = sampleVolume(nm, drawn, g, 'max', 4);
    for (let i = 0; i < base.length; i++) expect(moved[i]).toBeCloseTo(base[i], 4);
    // a volume with its origin at (100, 50, 20) and voxels of 2 Å, the mesh moved there too
    const origin = Vec3.create(100, 50, 20);
    const g2 = gridOf(24, 2, origin, (x, y, z) => linear(x - origin[0], y - origin[1], z - origin[2]));
    const there = sampleVolume(points, Mat4.fromTranslation(Mat4(), origin), g2, 'max', 4);
    for (let i = 0; i < base.length; i++) {
      expect(there[i] * g2.stats.sigma + g2.stats.mean).toBeCloseTo(base[i] * g.stats.sigma + g.stats.mean, 3);
    }
  });

  it('per cell: each cell at its center along its normal, when the mesh has cells', () => {
    const g = gridOf(48, 1, Vec3(), linear);
    // two cells: the square's two triangles each their own, then both in one
    const square = squareMesh(10, 20, 20, 10);
    const two = meshSamplePoints(square, { triangleCell: Int32Array.of(0, 1), count: 2 });
    expect(two.count).toBe(2);
    const one = meshSamplePoints(square, { triangleCell: Int32Array.of(0, 0), count: 1 });
    expect(one.count).toBe(1);
    expect(Array.from(one.positions)).toEqual([20, 20, 20]);
    expect(Math.abs(one.normals[2])).toBeCloseTo(1, 6);
    const values = sampleVolume(one, Mat4.identity(), g, 'min', 5);
    expect(values[0]).toBeCloseTo(sigmaOf(g, linear(20, 20, 15)), 4);
  });

  it('outside the grid: no value (NaN), even for a grid read as periodic', () => {
    const g = { ...gridOf(16, 1, Vec3(), linear), periodicity: 'xyz' as const };
    const points = meshSamplePoints(squareMesh(4, 40, 40, 8));
    for (const v of sampleVolume(points, Mat4.identity(), g, 'surface', 0)) expect(v).toBeNaN();
    // ±Depth reaching in from outside: only the samples inside count
    const edge = meshSamplePoints(squareMesh(4, 8, 8, 17));
    const max = sampleVolume(edge, Mat4.identity(), g, 'max', 4);
    for (let i = 0; i < edge.count; i++) {
      const [x, y] = [edge.positions[3 * i], edge.positions[3 * i + 1]];
      expect(max[i]).toBeCloseTo(sigmaOf(g, linear(x, y, 15)), 4);
    }
  });
});
