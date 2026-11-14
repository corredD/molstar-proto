/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Quat, Tensor, Vec3 } from '@molstar/core/math/linear-algebra';
import { envelopeOf, fitMapOf, fitPose, fitScore, PaintReach, SurfaceTilt } from '../fit.js';
import { angleBetween, crnAtoms, crnSites, density, gridOf, type Site, turn } from './density.js';

// A fit on a surface (Ludo, 2026-11-14, real data: 8CKV hexamers on HIV capsids): a capsid's wall is a lattice, dark
// along it (its neighbours), bright off it. A copy on it between two of its proteins scores below 0 with the whole
// shell (half of it on its dark neighbours); a fit free in space leaves the surface. On a surface the copy stays on
// it and is scored against the wall's two sides only.

/** A lattice of 1CRN in the plane z = 40 (`spacing` Å, unturned), Dark, a dark wall about it of `wall` × its peak */
function latticeMap(spacing: number, wall: number, noise = 0) {
  const voxel = 2;
  const size: [number, number, number] = [80, 80, 40];
  const sites: Site[] = [];
  for (let i = -3; i <= 3; ++i)
    for (let j = -3; j <= 3; ++j)
      sites.push({ position: Vec3.create(80 + i * spacing, 80 + j * spacing, 40), rotation: Quat.identity() });
  const { data } = density(crnAtoms(), sites, {
    origin: Vec3(),
    size,
    voxel,
    blur: 2,
    noise,
    seed: 2,
    contrast: 'bright',
  });
  let peak = 0;
  for (let i = 0; i < data.length; ++i) peak = Math.max(peak, data[i]);
  const space = Tensor.Space(size, [2, 1, 0], Float32Array);
  for (let k = 0; k < size[2]; ++k)
    for (let j = 0; j < size[1]; ++j)
      for (let i = 0; i < size[0]; ++i) {
        const o = space.dataOffset(i, j, k);
        const d = k * voxel - 40;
        data[o] = -(data[o] + wall * peak * Math.exp(-(d * d) / 32));
      }
  return fitMapOf(gridOf(space, data, Vec3(), voxel))!;
}

describe('a fit on a surface', () => {
  const envelope = envelopeOf({ kind: 'sites', sites: crnSites() }, 0);
  const up = Vec3.create(0, 0, 1);
  const options = { reach: PaintReach.shift * envelope.radius, turn: PaintReach.turn, contrast: 'dark' as const };

  it('shifts the copy along the surface only, turns it about the normal and tilts it 5° at most', () => {
    const map = latticeMap(40, 0.2, 0.1);
    // 5 Å over the surface, 3 Å along it and 12° off a site (about a tilted axis)
    const from = { position: Vec3.create(83, 80, 45), rotation: turn(Vec3.create(1, 0, 1), 12) };
    const free = fitPose(map, envelope, from, options);
    const on = fitPose(map, envelope, from, { ...options, normal: up });
    // free, it leaves the surface (toward the lattice's plane); on it, it stays
    expect(Math.abs(free.position[2] - 45)).toBeGreaterThan(1);
    expect(Math.abs(on.position[2] - 45)).toBeLessThan(1e-6);
    // its turn tilts the surface's normal SurfaceTilt at most
    const turned = Quat.multiply(Quat(), on.rotation, Quat.conjugate(Quat(), from.rotation));
    expect((Vec3.angle(up, Vec3.transformQuat(Vec3(), up, turned)) * 180) / Math.PI).toBeLessThan(SurfaceTilt + 0.01);
    expect(angleBetween(on.rotation, from.rotation)).toBeLessThan(PaintReach.turn + SurfaceTilt);
    // on the lattice's plane, 4 Å along it and 8° about the normal off a site: back onto it (its turn on a map without
    // noise: a small protein's turn is the weak part on a noisy one)
    const near = { position: Vec3.create(83, 82.6, 40), rotation: turn(up, 8) };
    const back = fitPose(latticeMap(40, 0.2), envelope, near, { ...options, normal: up });
    expect(Vec3.distance(back.position, Vec3.create(80, 80, 40))).toBeLessThan(1);
    expect(angleBetween(back.rotation, Quat.identity())).toBeLessThan(3);
  });

  it("scores a copy on a lattice's wall between two of its proteins above 0: the shell along the normal only", () => {
    // its neighbours along the surface as dark as a protein: the whole shell's score is below 0 there
    const map = latticeMap(30, 0);
    const gap = { position: Vec3.create(95, 95, 40), rotation: Quat.identity() };
    expect(fitScore(map, envelope, gap, 'dark')).toBeLessThan(0);
    expect(fitScore(map, envelope, gap, 'dark', up)).toBeGreaterThan(0);
    // on a site it is a site still
    const site = { position: Vec3.create(80, 80, 40), rotation: Quat.identity() };
    expect(fitScore(map, envelope, site, 'dark', up)).toBeGreaterThan(fitScore(map, envelope, gap, 'dark', up));
  });
});
