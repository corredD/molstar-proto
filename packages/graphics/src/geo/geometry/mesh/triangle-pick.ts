/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Ray3D } from '@molstar/core/math/geometry/primitives/ray3d';
import { Vec3 } from '@molstar/core/math/linear-algebra';
import type { Mesh } from './mesh.js';

// The triangle of a mesh under a pick (.v6/plans/gl/triangle-picking.md). The GPU pick gives the object, the instance,
// the group and the depth point; a group may be a whole material or one vertex, so the triangle is found on the CPU:
// the exact ray through the pointer against the triangles near the depth point. A grid of the triangles by their
// centroids, built on the first pick of a mesh and kept while its buffers are the same, finds them without a scan.

/** A triangle picked on a mesh: its index, the barycentric weights of its second and third vertices at the point */
export interface MeshTrianglePick {
  index: number;
  u: number;
  v: number;
}

export function MeshTrianglePick(): MeshTrianglePick {
  return { index: -1, u: 0, v: 0 };
}

/** The triangles of a mesh, by where they are */
export interface MeshTriangleLookup {
  readonly triangleCount: number;
  /** The largest distance from a triangle's centroid to its vertices */
  readonly maxRadius: number;
  /** Bytes it holds (the triangles sorted by cell, the cells' starts), the mesh's own buffers aside */
  readonly byteCount: number;
  /**
   * The triangle `ray` hits nearest to `near` within `tolerance` of it (the mesh's space); when the ray hits none
   * there (the pick's depth point is a pixel off an edge), the triangle nearest to `near` within `tolerance`, at its
   * point nearest to it. False when there is none.
   */
  pick(out: MeshTrianglePick, ray: Ray3D, near: Vec3, tolerance: number): boolean;
}

interface Cached {
  readonly vertices: number;
  readonly indices: number;
  readonly triangleCount: number;
  readonly lookup: MeshTriangleLookup;
}

const cache = new WeakMap<Mesh, Cached>();

/** The mesh's triangle lookup: built at the first call, again only after its vertices or triangles changed */
export function getMeshTriangleLookup(mesh: Mesh): MeshTriangleLookup {
  const vertices = mesh.vertexBuffer.ref.version;
  const indices = mesh.indexBuffer.ref.version;
  const c = cache.get(mesh);
  if (c && c.vertices === vertices && c.indices === indices && c.triangleCount === mesh.triangleCount) {
    return c.lookup;
  }
  const lookup = createLookup(mesh.vertexBuffer.ref.value, mesh.indexBuffer.ref.value, mesh.triangleCount);
  cache.set(mesh, { vertices, indices, triangleCount: mesh.triangleCount, lookup });
  return lookup;
}

const a = Vec3();
const b = Vec3();
const c = Vec3();
const hit = Vec3();
const q = Vec3();
const uvt = Vec3();
const closest = { u: 0, v: 0 };

/** At most this many grid cells a triangle (the cells' starts are kept: half a cell a triangle, 2 bytes) */
const CellsPerTriangle = 0.5;

/**
 * The lookup: the triangles sorted by the grid cell of their centroid (a counting sort), the cells' starts. Not
 * Mol*'s `GridLookup3D`, on purpose: it keeps the centroids and its buckets (about 20 bytes a triangle, and 12 times
 * slower to build: measured, .v6/plans/gl/triangle-picking.md); this keeps 4 bytes a triangle and 2 for the cells, a
 * pick reading the vertices of the few hundred triangles near it from the mesh's buffers. A surface fills few cells of
 * its box: the cells are capped by the triangle count.
 */
function createLookup(vb: Float32Array, ib: Uint32Array, triangleCount: number): MeshTriangleLookup {
  const T = triangleCount;
  // the centroids' bounds, the triangles' largest and mean reach from their centroids; the centroids kept a moment
  // (the build's own, let go after it). Arithmetic inline: millions of triangles (AGENTS.md, a hot loop on purpose)
  const cx = new Float32Array(T);
  const cy = new Float32Array(T);
  const cz = new Float32Array(T);
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let maxRadiusSq = 0;
  let sumRadiusSq = 0;
  // the triangles with finite vertices: a NaN or an infinity (a broken file, an index past the vertices) is left out
  let valid = 0;
  for (let t = 0; t < T; ++t) {
    const i0 = ib[3 * t] * 3;
    const i1 = ib[3 * t + 1] * 3;
    const i2 = ib[3 * t + 2] * 3;
    const ax = vb[i0],
      ay = vb[i0 + 1],
      az = vb[i0 + 2];
    const bx = vb[i1],
      by = vb[i1 + 1],
      bz = vb[i1 + 2];
    const qx = vb[i2],
      qy = vb[i2 + 1],
      qz = vb[i2 + 2];
    const x = (ax + bx + qx) / 3;
    const y = (ay + by + qy) / 3;
    const z = (az + bz + qz) / 3;
    const da = (ax - x) * (ax - x) + (ay - y) * (ay - y) + (az - z) * (az - z);
    const db = (bx - x) * (bx - x) + (by - y) * (by - y) + (bz - z) * (bz - z);
    const dc = (qx - x) * (qx - x) + (qy - y) * (qy - y) + (qz - z) * (qz - z);
    const r = da > db ? (da > dc ? da : dc) : db > dc ? db : dc;
    if (!Number.isFinite(x + y + z + r)) {
      cx[t] = Number.NaN;
      continue;
    }
    valid++;
    cx[t] = x;
    cy[t] = y;
    cz[t] = z;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
    if (r > maxRadiusSq) maxRadiusSq = r;
    sumRadiusSq += r;
  }
  const min = Vec3.create(minX, minY, minZ);
  const max = Vec3.create(maxX, maxY, maxZ);
  const maxRadius = Math.sqrt(maxRadiusSq);
  if (valid === 0) {
    return { triangleCount: 0, maxRadius: 0, byteCount: 0, pick: () => false };
  }

  // cells about two triangles wide, fewer when the box would hold too many
  const extent = Vec3.sub(Vec3(), max, min);
  let size = Math.max(2 * Math.sqrt(sumRadiusSq / valid), 1e-6, Math.max(extent[0], extent[1], extent[2]) * 1e-6);
  const cap = Math.max(64, Math.ceil(T * CellsPerTriangle));
  let nx = 0;
  let ny = 0;
  let nz = 0;
  // bounded: each round grows the cells by at least 1 %, a few rounds reach the cap
  for (let round = 0; round < 100; ++round) {
    nx = Math.floor(extent[0] / size) + 1;
    ny = Math.floor(extent[1] / size) + 1;
    nz = Math.floor(extent[2] / size) + 1;
    const cells = nx * ny * nz;
    if (cells <= cap) break;
    size *= Math.max(1.01, Math.cbrt(cells / cap));
  }
  const inv = 1 / size;
  const cellOf = (x: number, y: number, z: number) => {
    const i = Math.min(nx - 1, Math.floor((x - min[0]) * inv));
    const j = Math.min(ny - 1, Math.floor((y - min[1]) * inv));
    const k = Math.min(nz - 1, Math.floor((z - min[2]) * inv));
    return (k * ny + j) * nx + i;
  };

  // counting sort by cell (`order`'s triangles, cell after cell; `starts`, each cell's first)
  const cells = nx * ny * nz;
  const starts = new Uint32Array(cells + 1);
  const order = new Uint32Array(T);
  // each triangle's cell, until sorted
  const cellOfTriangle = order;
  for (let t = 0; t < T; ++t) {
    if (Number.isNaN(cx[t])) continue;
    const cell = cellOf(cx[t], cy[t], cz[t]);
    cellOfTriangle[t] = cell;
    starts[cell + 1]++;
  }
  for (let i = 0; i < cells; ++i) starts[i + 1] += starts[i];
  const fill = starts.slice(0, cells);
  const sorted = new Uint32Array(valid);
  for (let t = 0; t < T; ++t) if (!Number.isNaN(cx[t])) sorted[fill[cellOfTriangle[t]]++] = t;

  const vertexOf = (out: Vec3, t: number, k: number) => Vec3.fromArray(out, vb, ib[3 * t + k] * 3);

  /** Calls `f` with the triangles whose centroid's cell is within `r` of `at` */
  const eachNear = (at: Vec3, r: number, f: (t: number) => void) => {
    const i0 = Math.max(0, Math.floor((at[0] - r - min[0]) * inv));
    const j0 = Math.max(0, Math.floor((at[1] - r - min[1]) * inv));
    const k0 = Math.max(0, Math.floor((at[2] - r - min[2]) * inv));
    const i1 = Math.min(nx - 1, Math.floor((at[0] + r - min[0]) * inv));
    const j1 = Math.min(ny - 1, Math.floor((at[1] + r - min[1]) * inv));
    const k1 = Math.min(nz - 1, Math.floor((at[2] + r - min[2]) * inv));
    for (let k = k0; k <= k1; ++k) {
      for (let j = j0; j <= j1; ++j) {
        const row = (k * ny + j) * nx;
        for (let i = i0; i <= i1; ++i) {
          const cell = row + i;
          for (let s = starts[cell], e = starts[cell + 1]; s < e; ++s) f(sorted[s]);
        }
      }
    }
  };

  // the state of a pick, set by its visits (no closure made a pick)
  let best = -1;
  let bestD = 0;
  let pickRay: Ray3D;
  let pickNear: Vec3;
  let pickOut: MeshTrianglePick;
  const visitHit = (t: number) => {
    vertexOf(a, t, 0);
    vertexOf(b, t, 1);
    vertexOf(c, t, 2);
    if (!Ray3D.intersectTriangle(uvt, pickRay, a, b, c)) return;
    Vec3.scaleAndAdd(hit, pickRay.origin, pickRay.direction, uvt[2]);
    const d = Vec3.squaredDistance(hit, pickNear);
    if (d <= bestD) {
      bestD = d;
      best = t;
      pickOut.u = uvt[0];
      pickOut.v = uvt[1];
    }
  };
  const visitNearest = (t: number) => {
    vertexOf(a, t, 0);
    vertexOf(b, t, 1);
    vertexOf(c, t, 2);
    closestPointOnTriangle(q, closest, pickNear, a, b, c);
    const d = Vec3.squaredDistance(q, pickNear);
    if (d <= bestD) {
      bestD = d;
      best = t;
      pickOut.u = closest.u;
      pickOut.v = closest.v;
    }
  };

  return {
    triangleCount: T,
    maxRadius,
    byteCount: starts.byteLength + sorted.byteLength,
    pick(out, ray, near, tolerance) {
      pickRay = ray;
      pickNear = near;
      pickOut = out;
      const reach = tolerance + maxRadius;
      // the ray's hit nearest to the depth point (not the first along the ray: a clipped or cut-away front is not
      // what the pick saw)
      best = -1;
      bestD = tolerance * tolerance;
      eachNear(near, reach, visitHit);
      if (best < 0) {
        // no hit near the depth point: the triangle nearest to it
        bestD = tolerance * tolerance;
        eachNear(near, reach, visitNearest);
      }
      if (best < 0) return false;
      out.index = best;
      return true;
    },
  };
}

const ab = Vec3();
const ac = Vec3();
const ap = Vec3();
const bp = Vec3();
const cp = Vec3();

/**
 * The point of triangle `a`, `b`, `c` nearest to `pt` (Ericson, Real-Time Collision Detection, 5.1.5), and its
 * barycentric weights of `b` and `c` in `uv`
 */
export function closestPointOnTriangle(out: Vec3, uv: { u: number; v: number }, pt: Vec3, a: Vec3, b: Vec3, c: Vec3) {
  Vec3.sub(ab, b, a);
  Vec3.sub(ac, c, a);
  Vec3.sub(ap, pt, a);
  const d1 = Vec3.dot(ab, ap);
  const d2 = Vec3.dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return setUV(out, uv, a, 0, 0);
  Vec3.sub(bp, pt, b);
  const d3 = Vec3.dot(ab, bp);
  const d4 = Vec3.dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return setUV(out, uv, a, 1, 0);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return setUV(out, uv, a, d1 / (d1 - d3), 0);
  Vec3.sub(cp, pt, c);
  const d5 = Vec3.dot(ab, cp);
  const d6 = Vec3.dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return setUV(out, uv, a, 0, 1);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return setUV(out, uv, a, 0, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return setUV(out, uv, a, 1 - w, w);
  }
  const denom = 1 / (va + vb + vc);
  return setUV(out, uv, a, vb * denom, vc * denom);
}

/** `out` = a + u (b - a) + v (c - a), with `ab`, `ac` already set */
function setUV(out: Vec3, uv: { u: number; v: number }, a: Vec3, u: number, v: number) {
  uv.u = u;
  uv.v = v;
  Vec3.scaleAndAdd(out, a, ab, u);
  return Vec3.scaleAndAdd(out, out, ac, v);
}
