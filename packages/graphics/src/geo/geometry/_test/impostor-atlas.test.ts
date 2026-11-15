/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { ImpostorAtlas } from '../impostor-atlas.js';

const V = ImpostorAtlas.Views;

/** spheres of radius `r` filling the ellipsoid of semi-axes `a`, `b`, `c` (on a grid of `step`) */
function ellipsoid(a: number, b: number, c: number, r: number, step: number) {
  const p: number[] = [];
  for (let x = -a; x <= a; x += step) {
    for (let y = -b; y <= b; y += step) {
      for (let z = -c; z <= c; z += step) {
        if ((x / a) ** 2 + (y / b) ** 2 + (z / c) ** 2 <= 1) p.push(x, y, z, p.length / 4);
      }
    }
  }
  const count = p.length / 4;
  return { positionGroup: new Float32Array(p), radii: new Float32Array(count).fill(r), count };
}

/** the area (Å²) the view of frame (i, j) of entry `e` covers */
function coveredArea(atlas: ImpostorAtlas, e: number, i: number, j: number) {
  const { x, y, tile } = ImpostorAtlas.decodeEntry(atlas.codes[e]);
  const { array, width } = atlas.image;
  const radius = atlas.radii[e];
  const texel = (2 * radius) / tile;
  let sum = 0;
  for (let t = 0; t < tile; ++t) {
    for (let s = 0; s < tile; ++s) {
      sum += array[((y + j * tile + t) * width + x + i * tile + s) * 2] / 255;
    }
  }
  return sum * texel * texel;
}

/** the frame (i, j) nearest to direction `d` */
function nearestFrame(d: Vec3) {
  const uv = ImpostorAtlas.encode([0, 0], d);
  return [Math.round(uv[0] * (V - 1)), Math.round(uv[1] * (V - 1))];
}

describe('impostor atlas', () => {
  it('maps directions to the octahedron and back', () => {
    for (const d of [
      [1, 0, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
      [0.3, -0.5, -0.8],
      [-0.7, 0.2, 0.1],
    ]) {
      const n = Vec3.normalize(Vec3(), Vec3.create(d[0], d[1], d[2]));
      const uv = ImpostorAtlas.encode([0, 0], n);
      expect(uv[0]).toBeGreaterThanOrEqual(0);
      expect(uv[0]).toBeLessThanOrEqual(1);
      const back = ImpostorAtlas.decode(Vec3(), uv[0], uv[1]);
      expect(Vec3.distance(back, n)).toBeLessThan(1e-6);
    }
  });

  it('frames on the grid of the octahedral map, an orthonormal basis each', () => {
    const right = Vec3();
    const up = Vec3();
    const d = Vec3();
    for (let j = 0; j < V; ++j) {
      for (let i = 0; i < V; ++i) {
        ImpostorAtlas.frameDirection(d, i, j);
        ImpostorAtlas.frameBasis(right, up, d);
        expect(Vec3.magnitude(d)).toBeCloseTo(1, 6);
        expect(Vec3.dot(right, up)).toBeCloseTo(0, 6);
        expect(Vec3.dot(right, d)).toBeCloseTo(0, 6);
        expect(Vec3.dot(up, d)).toBeCloseTo(0, 6);
        // right-handed: right x up = toward the camera
        expect(Vec3.distance(Vec3.cross(Vec3(), right, up), d)).toBeLessThan(1e-6);
      }
    }
  });

  it('blends the three nearest views, their weights summing to 1, the frame itself alone on it', () => {
    const out = ImpostorAtlas.views();
    const d = Vec3();
    ImpostorAtlas.frameDirection(d, 3, 5);
    ImpostorAtlas.getViews(out, d);
    const k = out.w.indexOf(Math.max(...out.w));
    expect(out.w[k]).toBeCloseTo(1, 5);
    expect([out.i[k], out.j[k]]).toEqual([3, 5]);
    for (const w of [
      [0.2, 0.9, -0.1],
      [-0.6, -0.6, -0.5],
    ]) {
      ImpostorAtlas.getViews(out, Vec3.normalize(Vec3(), Vec3.create(w[0], w[1], w[2])));
      expect(out.w[0] + out.w[1] + out.w[2]).toBeCloseTo(1, 6);
      for (const x of out.w) expect(x).toBeGreaterThanOrEqual(0);
    }
  });

  it('chooses for a copy turned by R the view of R⁻¹ d for the camera direction d', () => {
    const R = Mat4.fromRotation(Mat4(), 1.1, Vec3.normalize(Vec3(), Vec3.create(1, 2, 3)));
    const d = Vec3.normalize(Vec3(), Vec3.create(0.2, -0.4, 0.9));
    // what the shaders compute: the camera's direction in the copy's frame
    const local = ImpostorAtlas.localDirection(Vec3(), R, d);
    const inverse = Vec3.transformDirection(Vec3(), d, Mat4.invert(Mat4(), R));
    expect(Vec3.distance(local, inverse)).toBeLessThan(1e-6);
    const a = ImpostorAtlas.views();
    const b = ImpostorAtlas.views();
    ImpostorAtlas.getViews(a, local);
    ImpostorAtlas.getViews(b, inverse);
    expect([a.i, a.j]).toEqual([b.i, b.j]);
    for (let k = 0; k < 3; ++k) expect(a.w[k]).toBeCloseTo(b.w[k], 5);
  });

  it('packs entries and encodes their places in a float the shaders decode', () => {
    for (const [x, y, tile] of [
      [0, 0, 8],
      [4088, 4088, 64],
      [512, 1024, 16],
    ]) {
      const code = ImpostorAtlas.encodeEntry(x, y, tile);
      expect(Math.fround(code)).toBe(code);
      expect(ImpostorAtlas.decodeEntry(code)).toEqual({ x, y, tile });
    }
  });

  it('sizes a tile by the pixels the copy covers where the impostors start, a power of 2 in [8, 64]', () => {
    expect(ImpostorAtlas.tileSize(20, 6)).toBe(8);
    expect(ImpostorAtlas.tileSize(50, 6)).toBe(32);
    expect(ImpostorAtlas.tileSize(400, 6)).toBe(64);
  });

  it('gives an ellipsoid of spheres its silhouette area per view direction', () => {
    const [a, b, c] = [30, 15, 10];
    const e = ellipsoid(a, b, c, 1.5, 1);
    const atlas = ImpostorAtlas.create([{ ...e, center: Vec3(), radius: a + 1.5, tile: 64 }], 4096);
    expect(atlas.codes.length).toBe(1);
    // silhouettes of the ellipsoid grown by the spheres' radius
    const along = [
      [Vec3.create(0, 0, 1), Math.PI * (a + 1.5) * (b + 1.5)],
      [Vec3.create(1, 0, 0), Math.PI * (b + 1.5) * (c + 1.5)],
      [Vec3.create(0, 1, 0), Math.PI * (a + 1.5) * (c + 1.5)],
    ] as const;
    for (const [d, area] of along) {
      const [i, j] = nearestFrame(d);
      expect(Math.abs(coveredArea(atlas, 0, i, j) / area - 1)).toBeLessThan(0.1);
    }
  });

  it('writes the front surface: nearer the camera above, the background 0', () => {
    // two spheres along z: seen from +z the nearer one's front at z = 12
    const atlas = ImpostorAtlas.create(
      [
        {
          positionGroup: new Float32Array([0, 0, 10, 0, 0, 0, -10, 1]),
          radii: new Float32Array([2, 2]),
          count: 2,
          center: Vec3(),
          radius: 12,
          tile: 32,
        },
      ],
      4096,
    );
    const [i, j] = nearestFrame(Vec3.create(0, 0, 1));
    const { x, y, tile } = ImpostorAtlas.decodeEntry(atlas.codes[0]);
    const { array, width } = atlas.image;
    const at = (s: number, t: number) => ((y + j * tile + t) * width + x + i * tile + s) * 2;
    const middle = at(tile / 2, tile / 2);
    expect(array[middle]).toBeGreaterThan(200);
    // height 12 of the radius 12: (12 + 12) / 24 of 255
    expect(array[middle + 1]).toBeGreaterThan(245);
    expect(array[at(1, 1)]).toBe(0);
  });
});
