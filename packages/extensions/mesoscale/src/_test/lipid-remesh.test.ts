/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { icosphere, isotropicRemesh, meshStats, offsetSurface, type TriMesh } from '../lipids/remesh.js';

function scaled(mesh: TriMesh, sx: number, sy: number, sz: number): TriMesh {
  const positions = mesh.positions.slice();
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] *= sx;
    positions[i + 1] *= sy;
    positions[i + 2] *= sz;
  }
  return { positions, indices: mesh.indices };
}

/** A closed cube of 12 triangles, outward. */
function cube(side: number): TriMesh {
  const h = side / 2;
  // biome-ignore format: a vertex a line
  const positions = new Float32Array([
        -h, -h, -h, h, -h, -h, h, h, -h, -h, h, -h,
        -h, -h, h, h, -h, h, h, h, h, -h, h, h,
    ]);
  // biome-ignore format: a face a line
  const indices = new Uint32Array([
        0, 2, 1, 0, 3, 2,
        4, 5, 6, 4, 6, 7,
        0, 1, 5, 0, 5, 4,
        2, 3, 7, 2, 7, 6,
        1, 2, 6, 1, 6, 5,
        0, 4, 7, 0, 7, 3,
    ]);
  return { positions, indices };
}

function signedVolume({ positions: p, indices: ix }: TriMesh) {
  let v = 0;
  for (let t = 0; t < ix.length; t += 3) {
    const a = 3 * ix[t],
      b = 3 * ix[t + 1],
      c = 3 * ix[t + 2];
    v +=
      p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
      p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
      p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return v / 6;
}

/** Distance from a point to a triangle, by projection on its plane, then its edges (an oracle independent of the grid). */
function pointTriangleDistance(q: number[], a: number[], b: number[], c: number[]) {
  const sub = (u: number[], v: number[]) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const dot = (u: number[], v: number[]) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const cross = (u: number[], v: number[]) => [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  const n = cross(sub(b, a), sub(c, a));
  const nl = Math.sqrt(dot(n, n));
  const d = dot(sub(q, a), n) / nl;
  const f = [q[0] - (d * n[0]) / nl, q[1] - (d * n[1]) / nl, q[2] - (d * n[2]) / nl];
  const inside =
    dot(cross(sub(b, a), sub(f, a)), n) >= 0 &&
    dot(cross(sub(c, b), sub(f, b)), n) >= 0 &&
    dot(cross(sub(a, c), sub(f, c)), n) >= 0;
  if (inside) return Math.abs(d);
  const segment = (u: number[], v: number[]) => {
    const e = sub(v, u);
    const t = Math.min(1, Math.max(0, dot(sub(q, u), e) / dot(e, e)));
    const r = sub(q, [u[0] + t * e[0], u[1] + t * e[1], u[2] + t * e[2]]);
    return Math.sqrt(dot(r, r));
  };
  return Math.min(segment(a, b), segment(b, c), segment(c, a));
}

function maxDistanceToSurface(mesh: TriMesh, surface: TriMesh) {
  const p = mesh.positions,
    s = surface.positions,
    ix = surface.indices;
  const at = (i: number) => [s[3 * i], s[3 * i + 1], s[3 * i + 2]];
  let worst = 0;
  for (let v = 0; v < p.length; v += 3) {
    const q = [p[v], p[v + 1], p[v + 2]];
    let best = Infinity;
    for (let t = 0; t < ix.length; t += 3) {
      best = Math.min(best, pointTriangleDistance(q, at(ix[t]), at(ix[t + 1]), at(ix[t + 2])));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

describe('icosphere', () => {
  it('has near-equilateral edges at the target, closed, on the sphere', () => {
    const mesh = icosphere(500, 100);
    const s = meshStats(mesh);
    expect(s.edgeMin).toBeGreaterThan(85);
    expect(s.edgeMax).toBeLessThan(115);
    expect(Math.abs(s.edgeMean - 100)).toBeLessThan(5);
    expect(s.boundaryEdges).toBe(0);
    expect(s.nonManifoldEdges).toBe(0);
    expect(s.eulerCharacteristic).toBe(2);
    expect(s.angleBelow30Fraction).toBe(0);
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const r = Math.hypot(mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]);
      expect(Math.abs(r - 500)).toBeLessThan(1e-3);
    }
    expect(signedVolume(mesh)).toBeGreaterThan(0);
  });

  it('takes any k, not only powers of two', () => {
    // 10k² + 2 vertices: k = 6 here.
    expect(meshStats(icosphere(500, 100)).vertexCount).toBe(362);
    expect(meshStats(icosphere(500, 1e9)).vertexCount).toBe(12);
  });
});

describe('isotropicRemesh (Botsch & Kobbelt 2004)', () => {
  const cases: { name: string; input: TriMesh; L: number }[] = [
    { name: 'a coarse icosahedron', input: icosphere(500, 1e9), L: 60 },
    { name: 'an ellipsoid 2:1:1', input: scaled(icosphere(300, 60), 2, 1, 1), L: 60 },
    { name: 'a cube of 12 triangles', input: cube(600), L: 100 },
  ];

  for (const { name, input, L } of cases) {
    it(`remeshes ${name} near-equilateral, keeping topology, orientation and surface`, () => {
      const out = isotropicRemesh(input, L);
      const s = meshStats(out);
      const s0 = meshStats(input);
      expect(Math.abs(s.edgeMean - L) / L).toBeLessThan(0.15);
      expect(s.angleBelow30Fraction).toBeLessThanOrEqual(0.05);
      expect(s.minAngleDeg).toBeGreaterThan(20);
      expect(s.boundaryEdges).toBe(0);
      expect(s.nonManifoldEdges).toBe(0);
      expect(s.eulerCharacteristic).toBe(s0.eulerCharacteristic);
      expect(Math.sign(signedVolume(out))).toBe(Math.sign(signedVolume(input)));
      expect(maxDistanceToSurface(out, input)).toBeLessThan(0.02 * L);
      // Compacted: every vertex is used.
      const used = new Uint8Array(s.vertexCount);
      for (const i of out.indices) used[i] = 1;
      expect(used.every((u) => u === 1)).toBe(true);
    });
  }

  it('remeshes an unwelded mesh (three vertices a triangle, as OBJ duplicates them) as the welded one', () => {
    // review M4: boundary edges were kept as they were, the tiles stretched and their edges unmatched
    const welded = icosphere(500, 1e9);
    const n = welded.indices.length;
    const positions = new Float32Array(n * 3);
    const indices = new Uint32Array(n);
    for (let i = 0; i < n; ++i) {
      positions.set(welded.positions.subarray(welded.indices[i] * 3, welded.indices[i] * 3 + 3), i * 3);
      indices[i] = i;
    }
    const s = meshStats(isotropicRemesh({ positions, indices }, 100));
    expect(s.boundaryEdges).toBe(0);
    expect(s.eulerCharacteristic).toBe(2);
    expect(Math.abs(s.edgeMean - 100) / 100).toBeLessThan(0.15);
  });

  it('is deterministic', () => {
    const input = scaled(icosphere(300, 60), 2, 1, 1);
    const a = isotropicRemesh(input, 60);
    const b = isotropicRemesh(input, 60);
    expect(b.positions).toEqual(a.positions);
    expect(b.indices).toEqual(a.indices);
  });
});

describe('offsetSurface', () => {
  it('moves an icosphere of radius R to radius R + d along the normals', () => {
    const mesh = icosphere(500, 100);
    for (const d of [25, -25]) {
      const out = offsetSurface(mesh, d);
      expect(out.indices).toBe(mesh.indices);
      for (let i = 0; i < out.positions.length; i += 3) {
        const r = Math.hypot(out.positions[i], out.positions[i + 1], out.positions[i + 2]);
        expect(Math.abs(r - (500 + d))).toBeLessThan(0.05);
      }
    }
  });
});
