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
      const dx = x - cx,
        dy = y - cy,
        dz = z - cz;
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
      const A = a - m,
        B = b - m,
        D = d - m;
      if (A <= 0 || B <= 0 || D <= 0) return false;
      const u = (x - cx) / A,
        v = (y - cy) / B,
        w = (z - cz) / D;
      return u * u + v * v + w * w <= 1;
    },
    sampleSurface(rand, p, n) {
      // a sphere point scaled: denser where the curvature is high; fine for a prototype (design.md §9)
      rand.onSphere(n);
      p[0] = cx + a * n[0];
      p[1] = cy + b * n[1];
      p[2] = cz + d * n[2];
      const nx = n[0] / a,
        ny = n[1] / b,
        nz = n[2] / d;
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
      return Math.abs(x - c[0]) <= h[0] - m && Math.abs(y - c[1]) <= h[1] - m && Math.abs(z - c[2]) <= h[2] - m;
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
    const a = 3 * I[3 * i],
      b = 3 * I[3 * i + 1],
      c = 3 * I[3 * i + 2];
    const ux = P[b] - P[a],
      uy = P[b + 1] - P[a + 1],
      uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a],
      vy = P[c + 1] - P[a + 1],
      vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    area += Math.hypot(nx, ny, nz) / 2;
    cumulative[i] = area;
    // signed volume of the tetrahedron with the origin
    volume +=
      (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) -
        P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) +
        P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) /
      6;
  }
  return { area, volume: Math.abs(volume), cumulative };
}

/** The inside test's ray: off every axis and every rational direction a mesh's grid-aligned edges would hold. */
const RayDirection = (() => {
  const d = [1, 0.0017 * Math.PI, 0.0013 * Math.E];
  const l = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / l, d[1] / l, d[2] / l] as const;
})();

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
    const a = 3 * I[i],
      b = 3 * I[i + 1],
      c = 3 * I[i + 2];
    signed +=
      P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) -
      P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) +
      P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  }
  const flip = signed < 0 ? -1 : 1;
  const [dx, dy, dz] = RayDirection;
  const inside = (x: number, y: number, z: number) => {
    // a ray along a skewed direction, Möller–Trumbore, odd crossings: inside. Not an axis: a ray along +x from a
    // grid-aligned point runs through the shared diagonal of a box face and counts it twice
    let n = 0;
    for (let i = 0; i < I.length; i += 3) {
      const a = 3 * I[i],
        b = 3 * I[i + 1],
        c = 3 * I[i + 2];
      const e1x = P[b] - P[a],
        e1y = P[b + 1] - P[a + 1],
        e1z = P[b + 2] - P[a + 2];
      const e2x = P[c] - P[a],
        e2y = P[c + 1] - P[a + 1],
        e2z = P[c + 2] - P[a + 2];
      // h = d × e2
      const hx = dy * e2z - dz * e2y,
        hy = dz * e2x - dx * e2z,
        hz = dx * e2y - dy * e2x;
      const det = e1x * hx + e1y * hy + e1z * hz;
      if (Math.abs(det) < 1e-12) continue;
      const f = 1 / det;
      const sx = x - P[a],
        sy = y - P[a + 1],
        sz = z - P[a + 2];
      const u = f * (sx * hx + sy * hy + sz * hz);
      if (u < 0 || u > 1) continue;
      // q = s × e1
      const qx = sy * e1z - sz * e1y,
        qy = sz * e1x - sx * e1z,
        qz = sx * e1y - sy * e1x;
      const v = f * (dx * qx + dy * qy + dz * qz);
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
        inside(x + m, y, z) &&
        inside(x - m, y, z) &&
        inside(x, y + m, z) &&
        inside(x, y - m, z) &&
        inside(x, y, z + m) &&
        inside(x, y, z - m)
      );
    },
    sampleSurface(rand, p, n) {
      const t = rand.next() * area;
      let lo = 0,
        hi = cumulative.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cumulative[mid] < t) lo = mid + 1;
        else hi = mid;
      }
      const a = 3 * I[3 * lo],
        b = 3 * I[3 * lo + 1],
        c = 3 * I[3 * lo + 2];
      let u = rand.next(),
        v = rand.next();
      if (u + v > 1) [u, v] = [1 - u, 1 - v];
      for (let k = 0; k < 3; k++) p[k] = P[a + k] + u * (P[b + k] - P[a + k]) + v * (P[c + k] - P[a + k]);
      const ux = P[b] - P[a],
        uy = P[b + 1] - P[a + 1],
        uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a],
        vy = P[c + 1] - P[a + 1],
        vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy,
        ny = uz * vx - ux * vz,
        nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) * flip;
      n[0] = nx / l;
      n[1] = ny / l;
      n[2] = nz / l;
    },
  };
}

/**
 * A signed distance grid of a shape (negative inside), sampled once: O(1) inside tests with a margin and a gradient to
 * push a point back in. Built from the sampler's inside test at the nodes and its surface samples for the distance
 * (design.md §11: the mesh's O(triangles) inside test is too slow per copy per iteration; mesobuild's
 * engine/geometry.py keeps such grids too). Resolution `n` nodes a side; accuracy about one cell.
 */
export interface SdfGrid {
  readonly min: readonly number[];
  readonly cell: number;
  readonly n: number;
  /** Signed distance, Å, trilinear. */
  distance(x: number, y: number, z: number): number;
  /** The direction of increasing distance (outward), finite differences. */
  gradient(out: number[], x: number, y: number, z: number): number[];
}

export function sdfGrid(s: ShapeSampler, rand: Random, n = 40, surfaceSamples = 4000): SdfGrid {
  const pad = 0.05;
  const ext = [0, 1, 2].map((k) => s.max[k] - s.min[k]);
  const cell = (Math.max(...ext) * (1 + 2 * pad)) / (n - 1);
  const min = [0, 1, 2].map((k) => (s.min[k] + s.max[k]) / 2 - (cell * (n - 1)) / 2);
  const pts = new Float32Array(surfaceSamples * 3);
  const p = [0, 0, 0],
    nn = [0, 0, 0];
  for (let i = 0; i < surfaceSamples; i++) {
    s.sampleSurface(rand, p, nn);
    pts[3 * i] = p[0];
    pts[3 * i + 1] = p[1];
    pts[3 * i + 2] = p[2];
  }
  // surface samples bucketed in the grid's cells, so a node looks at nearby samples first
  const buckets = new Map<number, number[]>();
  const bucketOf = (x: number, y: number, z: number) => {
    const i = Math.floor((x - min[0]) / (cell * 4)),
      j = Math.floor((y - min[1]) / (cell * 4)),
      k = Math.floor((z - min[2]) / (cell * 4));
    return (i * 1024 + j) * 1024 + k;
  };
  for (let i = 0; i < surfaceSamples; i++) {
    const b = bucketOf(pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]);
    const l = buckets.get(b);
    if (l) l.push(i);
    else buckets.set(b, [i]);
  }
  const d = new Float32Array(n * n * n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      for (let k = 0; k < n; k++) {
        const x = min[0] + i * cell,
          y = min[1] + j * cell,
          z = min[2] + k * cell;
        let best = Infinity;
        const bi = Math.floor((x - min[0]) / (cell * 4)),
          bj = Math.floor((y - min[1]) / (cell * 4)),
          bk = Math.floor((z - min[2]) / (cell * 4));
        for (let r = 1; r <= 64 && best === Infinity; r *= 2)
          for (let u = bi - r; u <= bi + r; u++)
            for (let v = bj - r; v <= bj + r; v++)
              for (let w = bk - r; w <= bk + r; w++) {
                const l = buckets.get((u * 1024 + v) * 1024 + w);
                if (!l) continue;
                for (const q of l)
                  best = Math.min(best, (pts[3 * q] - x) ** 2 + (pts[3 * q + 1] - y) ** 2 + (pts[3 * q + 2] - z) ** 2);
              }
        const dist = Math.sqrt(best);
        d[(i * n + j) * n + k] = s.contains(x, y, z, 0) ? -dist : dist;
      }
  const at = (i: number, j: number, k: number) =>
    d[(Math.min(n - 1, Math.max(0, i)) * n + Math.min(n - 1, Math.max(0, j))) * n + Math.min(n - 1, Math.max(0, k))];
  const distance = (x: number, y: number, z: number) => {
    const fx = (x - min[0]) / cell,
      fy = (y - min[1]) / cell,
      fz = (z - min[2]) / cell;
    const i = Math.floor(fx),
      j = Math.floor(fy),
      k = Math.floor(fz);
    const tx = fx - i,
      ty = fy - j,
      tz = fz - k;
    let v = 0;
    for (let a = 0; a < 2; a++)
      for (let b = 0; b < 2; b++)
        for (let c = 0; c < 2; c++)
          v += at(i + a, j + b, k + c) * (a ? tx : 1 - tx) * (b ? ty : 1 - ty) * (c ? tz : 1 - tz);
    // outside the grid: the distance to its box adds on
    const ox = Math.max(min[0] - x, 0, x - (min[0] + cell * (n - 1)));
    const oy = Math.max(min[1] - y, 0, y - (min[1] + cell * (n - 1)));
    const oz = Math.max(min[2] - z, 0, z - (min[2] + cell * (n - 1)));
    return v + Math.hypot(ox, oy, oz);
  };
  return {
    min,
    cell,
    n,
    distance,
    gradient(out, x, y, z) {
      const h = cell / 2;
      out[0] = distance(x + h, y, z) - distance(x - h, y, z);
      out[1] = distance(x, y + h, z) - distance(x, y - h, z);
      out[2] = distance(x, y, z + h) - distance(x, y, z - h);
      const l = Math.hypot(out[0], out[1], out[2]) || 1;
      out[0] /= l;
      out[1] /= l;
      out[2] /= l;
      return out;
    },
  };
}
