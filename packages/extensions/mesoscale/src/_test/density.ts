/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { Mat4, Quat, Tensor, Vec3 } from '@molstar/core/math/linear-algebra';
import type { ParticleSites } from '@molstar/model/model/particles/particle-list';
import type { Grid } from '@molstar/model/model/volume';

// Synthetic densities for the fit's tests (density-fit): 1CRN's atoms as a Gaussian map at known poses, in a grid of
// a voxel and an origin, with seeded noise; Dark (a tomogram's protein) by default.

/** 1CRN's atoms (data/examples/1crn.cif), x, y, z each */
export function crnAtoms(): Float32Array {
  const text = readFileSync(new URL('../../../../../data/examples/1crn.cif', import.meta.url), 'utf8');
  const xyz: number[] = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('ATOM')) continue;
    const t = line.trim().split(/\s+/);
    // _atom_site.Cartn_x is the 11th column
    xyz.push(Number(t[10]), Number(t[11]), Number(t[12]));
  }
  return Float32Array.from(xyz);
}

/** 1CRN's atoms as a `sites` target's sites */
export function crnSites(): ParticleSites {
  const positions = crnAtoms();
  return { count: positions.length / 3, positions, radii: new Float32Array(positions.length / 3).fill(1.7) };
}

/** The centroid of points (x, y, z each) */
export function centroidOf(xyz: ArrayLike<number>): Vec3 {
  const c = Vec3();
  const n = xyz.length / 3;
  for (let i = 0; i < n; ++i) for (let k = 0; k < 3; ++k) c[k] += xyz[i * 3 + k] / n;
  return c;
}

/** A seeded uniform random number in [0, 1) (mulberry32) */
export function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A copy of the atoms at a pose: its center (their centroid) at `position`, turned by `rotation` about it */
export interface Site {
  readonly position: Vec3;
  readonly rotation: Quat;
}

export interface DensityOptions {
  /** The grid's corner (Å) and its voxels along x, y, z */
  readonly origin: Vec3;
  readonly size: readonly [number, number, number];
  /** Å a voxel */
  readonly voxel: number;
  /** The Gaussian's σ about an atom, Å */
  readonly blur?: number;
  /** The noise's σ, in units of the map's peak; 0 without */
  readonly noise?: number;
  readonly seed?: number;
  /** The protein darker (a tomogram's; default) or brighter */
  readonly contrast?: 'dark' | 'bright';
}

/** A grid of the atoms at each site (Gaussians), with noise, and its data (for an MRC) */
export function density(atoms: Float32Array, sites: readonly Site[], o: DensityOptions) {
  const [nx, ny, nz] = o.size;
  const space = Tensor.Space([nx, ny, nz], [2, 1, 0], Float32Array);
  const data = new Float32Array(nx * ny * nz);
  const blur = o.blur ?? 2;
  const center = centroidOf(atoms);
  const reach = Math.ceil((3 * blur) / o.voxel);
  const p = Vec3();
  for (const s of sites) {
    for (let a = 0; a < atoms.length; a += 3) {
      Vec3.set(p, atoms[a] - center[0], atoms[a + 1] - center[1], atoms[a + 2] - center[2]);
      Vec3.transformQuat(p, p, s.rotation);
      Vec3.add(p, p, s.position);
      const gi = (p[0] - o.origin[0]) / o.voxel;
      const gj = (p[1] - o.origin[1]) / o.voxel;
      const gk = (p[2] - o.origin[2]) / o.voxel;
      for (let i = Math.max(0, Math.floor(gi) - reach); i <= Math.min(nx - 1, Math.ceil(gi) + reach); ++i)
        for (let j = Math.max(0, Math.floor(gj) - reach); j <= Math.min(ny - 1, Math.ceil(gj) + reach); ++j)
          for (let k = Math.max(0, Math.floor(gk) - reach); k <= Math.min(nz - 1, Math.ceil(gk) + reach); ++k) {
            const d2 = ((i - gi) ** 2 + (j - gj) ** 2 + (k - gk) ** 2) * o.voxel * o.voxel;
            data[space.dataOffset(i, j, k)] += Math.exp(-d2 / (2 * blur * blur));
          }
    }
  }
  let peak = 0;
  for (let i = 0; i < data.length; ++i) peak = Math.max(peak, data[i]);
  const noise = (o.noise ?? 0) * peak;
  if (noise) {
    const r = seeded(o.seed ?? 1);
    // Gaussian noise (Box-Muller)
    for (let i = 0; i < data.length; ++i) {
      data[i] += noise * Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
    }
  }
  if ((o.contrast ?? 'dark') === 'dark') for (let i = 0; i < data.length; ++i) data[i] = -data[i];
  return { grid: gridOf(space, data, o.origin, o.voxel), data };
}

/** A grid of data (in `space`'s order) with its stats, a voxel `voxel` Å, its corner at `origin` */
export function gridOf(space: Tensor.Space, data: Float32Array, origin: Vec3, voxel: number): Grid {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (let i = 0; i < data.length; ++i) {
    min = Math.min(min, data[i]);
    max = Math.max(max, data[i]);
    sum += data[i];
  }
  const mean = sum / data.length;
  let sq = 0;
  for (let i = 0; i < data.length; ++i) sq += (data[i] - mean) ** 2;
  const matrix = Mat4.fromScaling(Mat4(), Vec3.create(voxel, voxel, voxel));
  Mat4.setTranslation(matrix, origin);
  return {
    transform: { kind: 'matrix', matrix },
    cells: Tensor.create(space, Tensor.Data1(data)),
    stats: { min, max, mean, sigma: Math.sqrt(sq / data.length) },
  };
}

/** A turn of `degrees` about a unit axis */
export function turn(axis: Vec3, degrees: number): Quat {
  return Quat.setAxisAngle(Quat(), Vec3.normalize(Vec3(), axis), (degrees * Math.PI) / 180);
}

/** The angle between two orientations, ° */
export function angleBetween(a: Quat, b: Quat): number {
  const d = Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]));
  return (2 * Math.acos(d) * 180) / Math.PI;
}
