/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import type { IRShape } from '../ir/ir.js';
import type { Random } from '../runtime/random.js';
import type { MeshData } from '../runtime/resolver.js';

// Compartment shapes as samplers (design.md §4.4): inside tests, interior points kept a margin from the boundary, surface
// points with their outward normal. Analytic shapes are exact; a mesh samples its triangles by area and tests inside by
// ray parity (O(triangles) a test: fine for the fixtures' meshes, a signed distance grid for real segmentations, as
// mesobuild's `engine/geometry.py` has; design.md §9).

export interface ShapeSampler {
  readonly volume?: number;
  readonly area?: number;
  readonly min: readonly number[];
  readonly max: readonly number[];
  /** Inside, at least `margin` Å from the boundary (approximate for ellipsoids and meshes). */
  contains(x: number, y: number, z: number, margin: number): boolean;
  /** A point on the boundary (`p`) and its outward normal (`n`), uniform by area (approximate for ellipsoids). */
  sampleSurface(r: Random, p: number[], n: number[]): void;
}

export function shapeSampler(shape: IRShape, mesh?: MeshData): ShapeSampler | undefined {
  switch (shape.kind) {
    case 'sphere':
      return sphere(shape.center, shape.radius);
    case 'ellipsoid':
      return ellipsoid(shape.center, shape.radii);
    case 'box':
      return box(shape.center, shape.size);
    case 'mesh':
      return mesh ? meshSampler(mesh) : undefined;
    default:
      return undefined;
  }
}

function sphere(c: readonly number[], R: number): ShapeSampler {
  const [cx, cy, cz] = c;
  return {
    volume: (4 / 3) * Math.PI * R ** 3,
    area: 4 * Math.PI * R * R,
    min: [cx - R, cy - R, cz - R],
    max: [cx + R, cy + R, cz + R],
    contains(x, y, z, m) {
      const r = R - m;
      if (r <= 0) return false;
      const dx = x - cx, dy = y - cy, dz = z - cz;
      return dx * dx + dy * dy + dz * dz <= r * r;
    },
    sampleSurface(rand, p, n) {
      rand.onSphere(n);
      p[0] = cx + R * n[0];
      p[1] = cy + R * n[1];
      p[2] = cz + R * n[2];
    },
  };
}

function ellipsoid(c: readonly number[], radii: readonly number[]): ShapeSampler {
  const [cx, cy, cz] = c;
  const [a, b, d] = radii;
  // Knud Thomsen's approximation of the area (within ~1%)
  const pw = 1.6075;
  const area = 4 * Math.PI * (((a * b) ** pw + (a * d) ** pw + (b * d) ** pw) / 3) ** (1 / pw);
  return {
    volume: (4 / 3) * Math.PI * a * b * d,
    area,
    min: [cx - a, cy - b, cz - d],
    max: [cx + a, cy + b, cz + d],
    contains(x, y, z, m) {
      const A = a - m, B = b - m, D = d - m;
      if (A <= 0 || B <= 0 || D <= 0) return false;
      const u = (x - cx) / A, v = (y - cy) / B, w = (z - cz) / D;
      return u * u + v * v + w * w <= 1;
    },
    sampleSurface(rand, p, n) {
      // a sphere point scaled: denser where the curvature is high; fine for a prototype (design.md §9)
      rand.onSphere(n);
      p[0] = cx + a * n[0];
      p[1] = cy + b * n[1];
      p[2] = cz + d * n[2];
      const nx = n[0] / a, ny = n[1] / b, nz = n[2] / d;
      const l = Math.hypot(nx, ny, nz);
      n[0] = nx / l;
      n[1] = ny / l;
      n[2] = nz / l;
    },
  };
}

function box(c: readonly number[], s: readonly number[]): ShapeSampler {
  const h = [s[0] / 2, s[1] / 2, s[2] / 2];
  const faces = [s[1] * s[2], s[1] * s[2], s[0] * s[2], s[0] * s[2], s[0] * s[1], s[0] * s[1]];
  const total = faces.reduce((x, y) => x + y, 0);
  return {
    volume: s[0] * s[1] * s[2],
    area: total,
    min: [c[0] - h[0], c[1] - h[1], c[2] - h[2]],
    max: [c[0] + h[0], c[1] + h[1], c[2] + h[2]],
    contains(x, y, z, m) {
      return (
        Math.abs(x - c[0]) <= h[0] - m && Math.abs(y - c[1]) <= h[1] - m && Math.abs(z - c[2]) <= h[2] - m
      );
    },
    sampleSurface(rand, p, n) {
      let t = rand.next() * total;
      let f = 0;
      while (f < 5 && t > faces[f]) t -= faces[f++];
      const axis = f >> 1;
      const sign = f & 1 ? 1 : -1;
      for (let k = 0; k < 3; k++) {
        p[k] = k === axis ? c[k] + sign * h[k] : c[k] + (rand.next() - 0.5) * s[k];
        n[k] = k === axis ? sign : 0;
      }
    },
  };
}

export function meshArea(mesh: MeshData): { area: number; volume: number; cumulative: Float64Array } {
  const { positions: P, indices: I } = mesh;
  const t = I.length / 3;
  const cumulative = new Float64Array(t);
  let area = 0;
  let volume = 0;
  for (let i = 0; i < t; i++) {
    const a = 3 * I[3 * i], b = 3 * I[3 * i + 1], c = 3 * I[3 * i + 2];
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    area += Math.hypot(nx, ny, nz) / 2;
    cumulative[i] = area;
    // signed volume of the tetrahedron with the origin
    volume += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) -
      P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) +
      P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6;
  }
  return { area, volume: Math.abs(volume), cumulative };
}

function meshSampler(mesh: MeshData): ShapeSampler {
  const { positions: P, indices: I } = mesh;
  const { area, volume, cumulative } = meshArea(mesh);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], P[i + k]);
      max[k] = Math.max(max[k], P[i + k]);
    }
  // the winding's sign: outward normals when the signed volume is positive
  let signed = 0;
  for (let i = 0; i < I.length; i += 3) {
    const a = 3 * I[i], b = 3 * I[i + 1], c = 3 * I[i + 2];
    signed += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  }
  const flip = signed < 0 ? -1 : 1;
  const inside = (x: number, y: number, z: number) => {
    // a ray along +x, Möller–Trumbore, odd crossings: inside
    let n = 0;
    for (let i = 0; i < I.length; i += 3) {
      const a = 3 * I[i], b = 3 * I[i + 1], c = 3 * I[i + 2];
      const e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2], e1x = P[b] - P[a];
      const e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2], e2x = P[c] - P[a];
      // d = (1,0,0); h = d × e2 = (0, -e2z, e2y)
      const hy = -e2z, hz = e2y;
      const det = e1y * hy + e1z * hz;
      if (Math.abs(det) < 1e-12) continue;
      const f = 1 / det;
      const sx = x - P[a], sy = y - P[a + 1], sz = z - P[a + 2];
      const u = f * (sy * hy + sz * hz);
      if (u < 0 || u > 1) continue;
      // q = s × e1
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const v = f * qx;
      if (v < 0 || u + v > 1) continue;
      const t = f * (e2x * qx + e2y * qy + e2z * qz);
      if (t > 0) n++;
    }
    return (n & 1) === 1;
  };
  return {
    volume,
    area,
    min,
    max,
    contains(x, y, z, m) {
      if (!inside(x, y, z)) return false;
      if (m <= 0) return true;
      // the margin, checked along the six axis directions (approximate, design.md §9)
      return (
        inside(x + m, y, z) && inside(x - m, y, z) && inside(x, y + m, z) && inside(x, y - m, z) && inside(x, y, z + m) && inside(x, y, z - m)
      );
    },
    sampleSurface(rand, p, n) {
      const t = rand.next() * area;
      let lo = 0, hi = cumulative.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cumulative[mid] < t) lo = mid + 1;
        else hi = mid;
      }
      const a = 3 * I[3 * lo], b = 3 * I[3 * lo + 1], c = 3 * I[3 * lo + 2];
      let u = rand.next(), v = rand.next();
      if (u + v > 1) [u, v] = [1 - u, 1 - v];
      for (let k = 0; k < 3; k++) p[k] = P[a + k] + u * (P[b + k] - P[a + k]) + v * (P[c + k] - P[a + k]);
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) * flip;
      n[0] = nx / l;
      n[1] = ny / l;
      n[2] = nz / l;
    },
  };
}
