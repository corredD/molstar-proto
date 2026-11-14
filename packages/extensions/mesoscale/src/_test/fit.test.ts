/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Quat, Tensor, Vec3 } from '@molstar/core/math/linear-algebra';
import type { ParticleTarget } from '@molstar/model/model/particles/particle-list';
import { envelopeOf, fitGrown, fitMapOf, fitPose, fitScore, PaintReach, rayOnPlane, slicePlane } from '../fit.js';
import { allocated } from '../../../../../test-harness/src/scaling.js';
import { angleBetween, centroidOf, crnAtoms, crnSites, density, gridOf, seeded, turn } from './density.js';

// The fit (density-fit; plans/2026-11-10-paint-on-density.md, D1, Tests): a synthetic 1CRN map plus noise, a copy put
// 4 Å and 10° off fits back within 1 Å and 3°; a flat map leaves it; it never goes past its reach; the map inverted
// with the other Contrast gives the same fit; a slice's plane exactly; grown copies kept above a threshold.

const atoms = crnAtoms();
const target: ParticleTarget = { kind: 'sites', sites: crnSites() };
const envelope = envelopeOf(target, 0);
const site = { position: Vec3.create(40, 40, 40), rotation: turn(Vec3.create(1, 2, 3), 40) };
// a 3.5 Å-like map: a voxel of 1.5 Å, each atom a Gaussian of 1.5 Å
const box = { origin: Vec3.create(0, 0, 0), size: [54, 54, 54] as [number, number, number], voxel: 1.5, blur: 1.5 };
const reach = { reach: PaintReach.shift * envelope.radius, turn: PaintReach.turn, contrast: 'dark' as const };

/** A pose off the site by `shift` Å and `degrees`, in a direction and about an axis drawn from `seed` */
function off(seed: number, shift: number, degrees: number) {
  const r = seeded(seed);
  const unit = () => Vec3.normalize(Vec3(), Vec3.create(r() - 0.5, r() - 0.5, r() - 0.5));
  return {
    position: Vec3.scaleAndAdd(Vec3(), site.position, unit(), shift),
    rotation: Quat.multiply(Quat(), turn(unit(), degrees), site.rotation),
  };
}

describe('the envelope', () => {
  it('is 1CRN about its center: 200 points, centered, as far as its atoms', () => {
    expect(envelope.inside.length).toBe(200 * 3);
    const c = centroidOf(envelope.inside);
    expect(Vec3.magnitude(c)).toBeLessThan(1);
    const center = centroidOf(atoms);
    let far = 0;
    for (let i = 0; i < atoms.length; i += 3) {
      far = Math.max(far, Math.hypot(atoms[i] - center[0], atoms[i + 1] - center[1], atoms[i + 2] - center[2]));
    }
    expect(envelope.radius).toBeCloseTo(far, 3);
    // a third of it: past the 4 Å a seed is off
    expect(reach.reach).toBeGreaterThan(4);
  });

  it("is about the target's own center when it gives one (review S7)", () => {
    const sites = crnSites();
    const a = envelopeOf({ kind: 'sites', sites }, 0);
    const b = envelopeOf({ kind: 'sites', sites, center: Vec3.create(100, 0, 0) }, 0);
    expect(b).not.toBe(a);
    expect(centroidOf(b.inside)[0]).toBeLessThan(-50);
  });

  it('put at a site, it is where the atoms are: the score there well above any 6 Å off', () => {
    const map = fitMapOf(density(atoms, [site], box).grid)!;
    const at = fitScore(map, envelope, site, 'dark');
    expect(at).toBeGreaterThan(1);
    for (let s = 0; s < 6; ++s) expect(fitScore(map, envelope, off(s, 6, 0), 'dark')).toBeLessThan(at);
  });
});

describe('fitPose', () => {
  const noisy = fitMapOf(density(atoms, [site], { ...box, noise: 0.1, seed: 7 }).grid)!;

  it('fits a copy 4 Å and 10° off back within 1 Å and 3°, from several sides', () => {
    for (let s = 1; s <= 6; ++s) {
      const from = off(s, 4, 10);
      const r = fitPose(noisy, envelope, from, reach);
      expect(Vec3.distance(r.position, site.position), `seed ${s}`).toBeLessThan(1);
      expect(angleBetween(r.rotation, site.rotation), `seed ${s}`).toBeLessThan(3);
      expect(r.score).toBeGreaterThan(fitScore(noisy, envelope, from, 'dark'));
      expect(r.shift).toBeCloseTo(Vec3.distance(r.position, from.position), 3);
      expect(r.angle).toBeCloseTo(angleBetween(r.rotation, from.rotation), 1);
    }
  });

  it('leaves the pose on a flat map', () => {
    const space = Tensor.Space([20, 20, 20], [2, 1, 0], Float32Array);
    const flat = gridOf(space, new Float32Array(8000).fill(3), Vec3(), 2);
    expect(fitMapOf(flat)).toBeUndefined();
    const from = off(3, 0, 0);
    const r = fitPose(fitMapOf(flat), envelope, from, reach);
    expect(Vec3.distance(r.position, from.position)).toBe(0);
    expect(r.score).toBe(0);
    expect(r.shift).toBe(0);
    expect(r.angle).toBe(0);
  });

  it('leaves a copy near its pose on noise alone (the pull back)', () => {
    const noise = fitMapOf(gridNoise())!;
    const from = { position: Vec3.create(40, 40, 40), rotation: Quat.identity() };
    const r = fitPose(noise, envelope, from, reach);
    expect(r.shift).toBeLessThanOrEqual(reach.reach + 1e-9);
    expect(r.angle).toBeLessThanOrEqual(reach.turn + 1e-9);
  });

  it('never goes past its reach, the site out of it', () => {
    for (let s = 1; s <= 4; ++s) {
      const from = off(s, 15, 40);
      const r = fitPose(noisy, envelope, from, reach);
      expect(r.shift).toBeLessThanOrEqual(reach.reach + 1e-6);
      expect(Vec3.distance(r.position, from.position)).toBeLessThanOrEqual(reach.reach + 1e-6);
      expect(angleBetween(r.rotation, from.rotation)).toBeLessThanOrEqual(reach.turn + 1e-3);
    }
  });

  it('gives the same fit on the inverted map with the other Contrast', () => {
    const bright = fitMapOf(density(atoms, [site], { ...box, noise: 0.1, seed: 7, contrast: 'bright' }).grid)!;
    const from = off(2, 4, 10);
    const a = fitPose(noisy, envelope, from, reach);
    const b = fitPose(bright, envelope, from, { ...reach, contrast: 'bright' });
    expect(Vec3.distance(a.position, b.position)).toBeLessThan(1e-3);
    expect(angleBetween(a.rotation, b.rotation)).toBeLessThan(1e-2);
    expect(b.score).toBeCloseTo(a.score, 4);
    // the same map with the wrong Contrast: the copy is pushed off the density
    expect(fitPose(noisy, envelope, from, { ...reach, contrast: 'bright' }).score).toBeLessThan(a.score);
  });
});

/** Noise alone in a 40³ grid of 2 Å */
function gridNoise() {
  const space = Tensor.Space([40, 40, 40], [2, 1, 0], Float32Array);
  const r = seeded(11);
  const data = Float32Array.from({ length: 40 ** 3 }, () => r() - 0.5);
  return gridOf(space, data, Vec3(), 2);
}

describe('fitGrown', () => {
  // a row of 6 sites 40 Å apart along x, every other one empty
  const sites = [0, 1, 2, 3, 4, 5].map((i) => ({
    position: Vec3.create(30 + 40 * i, 40, 40),
    rotation: site.rotation,
  }));
  const filled = sites.filter((_, i) => i % 2 === 0);
  const map = fitMapOf(density(atoms, filled, { ...box, size: [187, 54, 54], noise: 0.1, seed: 5 }).grid)!;
  const poses = {
    positions: sites.flatMap((s, i) => [s.position[0] + (i % 3) - 1, s.position[1] + 1, s.position[2]]),
    rotations: sites.flatMap(() => Array.from(site.rotation)),
  };
  const source = fitScore(map, envelope, filled[0], 'dark');
  const o = { reach: envelope.radius / 6, turn: 7.5, contrast: 'dark' as const, threshold: 0.6 * source, apart: 10 };

  it('keeps only the copies on a site, each fitted onto it', () => {
    const kept = fitGrown(map, envelope, poses, o);
    expect(kept.positions.length / 3).toBe(3);
    for (let i = 0; i < 3; ++i) {
      const p = Vec3.fromArray(Vec3(), kept.positions, i * 3);
      expect(Vec3.distance(p, filled[i].position)).toBeLessThan(1);
      expect(kept.fit.score[i]).toBeGreaterThanOrEqual(o.threshold);
    }
    expect(kept.fit.shift.length).toBe(3);
    expect(kept.fit.angle.length).toBe(3);
  });

  it('stops at Count kept, the first ones the same (prefix-stable); none in a site already taken', () => {
    const two = fitGrown(map, envelope, poses, { ...o, count: 2 });
    const all = fitGrown(map, envelope, poses, o);
    expect(two.positions.length / 3).toBe(2);
    expect(all.positions.slice(0, 6)).toEqual(two.positions);
    // the source's site taken: no copy there
    const taken = fitGrown(map, envelope, poses, { ...o, from: filled[0].position });
    expect(taken.positions.length / 3).toBe(2);
  });
});

describe('slicePlane', () => {
  const space = Tensor.Space([10, 20, 30], [2, 1, 0], Float32Array);
  const grid = gridOf(
    space,
    Float32Array.from({ length: 6000 }, (_, i) => i % 7),
    Vec3.create(5, -3, 2),
    2,
  );

  it("gives a grid slice's point and normal exactly, and where a ray meets it", () => {
    const z = slicePlane(grid, { mode: 'grid', dimension: { name: 'z', params: 12 } })!;
    expect(Array.from(z.normal)).toEqual([0, 0, 1]);
    expect(z.point[2]).toBe(2 + 12 * 2);
    const rel = slicePlane(grid, { mode: 'grid', dimension: { name: 'relativeX', params: 1 } })!;
    expect(Array.from(rel.normal)).toEqual([1, 0, 0]);
    expect(rel.point[0]).toBe(5 + 9 * 2);
    const hit = Vec3();
    const dir = Vec3.normalize(Vec3(), Vec3.create(0.3, -0.2, -1));
    expect(rayOnPlane(hit, Vec3.create(10, 10, 100), dir, z)).toBe(true);
    expect(hit[2]).toBeCloseTo(26, 10);
  });

  it("gives an oblique slice's plane as set, and none for a frame slice", () => {
    const p = slicePlane(grid, {
      mode: 'plane',
      plane: { point: Vec3.create(1, 2, 3), normal: Vec3.create(0, 2, 0) },
    })!;
    expect(Array.from(p.normal)).toEqual([0, 1, 0]);
    expect(Array.from(p.point)).toEqual([1, 2, 3]);
    expect(slicePlane(grid, { mode: 'frame' })).toBeUndefined();
  });
});

describe('the copy under the pointer, a frame', () => {
  it('a fit into an out pose allocates no object, a slice plane into an out plane nothing (review M3)', () => {
    const map = fitMapOf(density(atoms, [site], box).grid)!;
    const out = { position: Vec3(), rotation: Quat(), score: 0, shift: 0, angle: 0 };
    const from = off(1, 3, 5);
    const n = 20;
    const fits = () => {
      for (let i = 0; i < n; ++i) fitPose(map, envelope, from, reach, out);
    };
    for (let k = 0; k < 10; ++k) fits();
    // no object a fit (it was 1.9 MB: a sort's buffers a step, Math.hypot's arguments, the closures, the poses); what
    // is left is V8's boxed numbers between calls (about 200 bytes an evaluation, short-lived)
    expect(allocated(fits) / n).toBeLessThan(100_000);
    const plane = { point: Vec3(), normal: Vec3() };
    const props = { mode: 'grid', dimension: { name: 'z', params: 12 } };
    const planes = () => {
      for (let i = 0; i < 1000; ++i) slicePlane(map.grid, props, plane);
    };
    for (let k = 0; k < 50; ++k) planes();
    expect(allocated(planes) / 1000).toBeLessThan(16);
  });
});
