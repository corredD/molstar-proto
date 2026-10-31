/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Interval } from '@molstar/core/data/int';
import { getFastBoundary } from '@molstar/core/math/geometry/boundary';
import { GridLookup3D } from '@molstar/core/math/geometry/lookup3d/grid';
import { Ray3D } from '@molstar/core/math/geometry/primitives/ray3d';
import { Vec3 } from '@molstar/core/math/linear-algebra';
import type { Mesh } from './mesh.js';

// The triangle of a mesh under a pick (.v6/plans/gl/triangle-picking.md). The GPU pick gives the object, the instance,
// the group and the depth point; a group may be a whole material or one vertex, so the triangle is found on the CPU:
// the exact ray through the pointer against the triangles near the depth point. A grid of the triangles' centroids,
// built on the first pick of a mesh and kept while its buffers are the same, finds them without a scan.

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
  /** Bytes it holds (its centroids and the grid), the mesh's own buffers aside */
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
const p = Vec3();
const q = Vec3();
const uvt = Vec3();
const closest = { u: 0, v: 0 };

function createLookup(vb: Float32Array, ib: Uint32Array, triangleCount: number): MeshTriangleLookup {
  const x = new Float32Array(triangleCount);
  const y = new Float32Array(triangleCount);
  const z = new Float32Array(triangleCount);
  let maxRadiusSq = 0;
  for (let t = 0; t < triangleCount; ++t) {
    Vec3.fromArray(a, vb, ib[3 * t] * 3);
    Vec3.fromArray(b, vb, ib[3 * t + 1] * 3);
    Vec3.fromArray(c, vb, ib[3 * t + 2] * 3);
    const cx = (a[0] + b[0] + c[0]) / 3;
    const cy = (a[1] + b[1] + c[1]) / 3;
    const cz = (a[2] + b[2] + c[2]) / 3;
    x[t] = cx;
    y[t] = cy;
    z[t] = cz;
    Vec3.set(p, cx, cy, cz);
    maxRadiusSq = Math.max(
      maxRadiusSq,
      Vec3.squaredDistance(p, a),
      Vec3.squaredDistance(p, b),
      Vec3.squaredDistance(p, c),
    );
  }
  const data = { x, y, z, indices: Interval.ofLength(triangleCount) };
  const grid = triangleCount > 0 ? GridLookup3D(data, getFastBoundary(data)) : undefined;
  const maxRadius = Math.sqrt(maxRadiusSq);
  const { buckets } = grid ?? { buckets: { offset: [], count: [], array: [] } };
  const byteCount =
    3 * x.byteLength + 4 * (buckets.offset.length + buckets.count.length + buckets.array.length) + 4 * triangleCount;

  const vertexOf = (out: Vec3, t: number, k: number) => Vec3.fromArray(out, vb, ib[3 * t + k] * 3);

  return {
    triangleCount,
    maxRadius,
    byteCount,
    pick(out, ray, near, tolerance) {
      if (!grid) return false;
      const found = grid.find(near[0], near[1], near[2], tolerance + maxRadius);
      // the ray's hit nearest to the depth point (not the first along the ray: a clipped or cut-away front is not
      // what the pick saw)
      let best = -1;
      let bestD = tolerance * tolerance;
      for (let i = 0; i < found.count; ++i) {
        const t = found.indices[i];
        vertexOf(a, t, 0);
        vertexOf(b, t, 1);
        vertexOf(c, t, 2);
        if (!Ray3D.intersectTriangle(uvt, ray, a, b, c)) continue;
        Vec3.scaleAndAdd(hit, ray.origin, ray.direction, uvt[2]);
        const d = Vec3.squaredDistance(hit, near);
        if (d <= bestD) {
          bestD = d;
          best = t;
          out.u = uvt[0];
          out.v = uvt[1];
        }
      }
      if (best >= 0) {
        out.index = best;
        return true;
      }
      // no hit near the depth point: the triangle nearest to it
      bestD = tolerance * tolerance;
      for (let i = 0; i < found.count; ++i) {
        const t = found.indices[i];
        vertexOf(a, t, 0);
        vertexOf(b, t, 1);
        vertexOf(c, t, 2);
        closestPointOnTriangle(q, closest, near, a, b, c);
        const d = Vec3.squaredDistance(q, near);
        if (d <= bestD) {
          bestD = d;
          best = t;
          out.u = closest.u;
          out.v = closest.v;
        }
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
