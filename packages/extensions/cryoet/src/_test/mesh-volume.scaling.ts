/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { it } from 'vitest';
import { Mat4, Tensor, Vec3 } from '@molstar/core/math/linear-algebra';
import type { Grid } from '@molstar/model/model/volume';
import { checkLinear, quadraticControl, scaling } from '../../../../../test-harness/src/scaling.js';
import { colorBand, meshSamplePoints, sampleVolume } from '../mesh-volume.js';
import { sphereMesh } from './mesh-volume-fixtures.js';

// A mesh colored by a volume (`test:scaling`; apps/prism-me/AGENTS.md, no accidental quadratic): its sampling's time
// linear in vertices × depth samples: a sphere of N rings (64 vertices each) at ±4 Å, then a sphere of 64 rings at
// ±N Å (2N + 1 samples along each normal at 1 Å voxels), each at n and 4n; its color grid's band (Detail Texture)
// linear in triangles: a sphere of N rings.

const n = 64;
const values = new Float32Array(n * n * n).map((_, i) => Math.sin(i));
const grid: Grid = {
  transform: { kind: 'matrix', matrix: Mat4.identity() },
  cells: Tensor.create(Tensor.Space([n, n, n], [2, 1, 0], Float32Array), Tensor.Data1(values)),
  stats: { min: -1, max: 1, mean: 0, sigma: 0.7 },
};
const center = Vec3.create(32, 32, 32);

it('the positive control (a copy per item) is caught', () => {
  checkLinear('quadratic control', scaling(quadraticControl, 2000), false);
});

it('a mesh sampled along its normals: N vertices', () => {
  const s = scaling(
    {
      setup: (k) => meshSamplePoints(sphereMesh(20, center, k, 64)),
      run: (points) => void sampleVolume(points, Mat4.identity(), grid, 'max', 4),
    },
    64,
  );
  checkLinear('volume samples, N vertices', s);
});

it('a mesh sampled along its normals: N depth samples', () => {
  const points = meshSamplePoints(sphereMesh(20, center, 64, 64));
  const s = scaling(
    {
      setup: (k) => k,
      run: (depth) => void sampleVolume(points, Mat4.identity(), grid, 'max', depth),
    },
    1,
  );
  checkLinear('volume samples, N depth samples', s);
});

it("a mesh's color grid band: N triangles", () => {
  const s = scaling(
    {
      setup: (k) => sphereMesh(20, center, k, 64),
      run: (mesh) => void colorBand(mesh, Mat4.identity(), grid),
    },
    64,
  );
  checkLinear('color band, N triangles', s);
});
