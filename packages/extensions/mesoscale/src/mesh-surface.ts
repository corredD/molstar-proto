/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Ray3D } from '@molstar/core/math/geometry/primitives/ray3d';
import { Mat3, Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import type { Mesh } from '@molstar/graphics/geo/geometry/mesh/mesh';
import {
  closestPointOnTriangle,
  getMeshTriangleLookup,
  MeshTrianglePick,
} from '@molstar/graphics/geo/geometry/mesh/triangle-pick';
import type { GrowSurface, SurfaceHit } from './grow.js';

// A file mesh as a surface to paint and grow on (progress/2026-11-13-grow-mesh.md): the triangle lookup of its picks
// (`getMeshTriangleLookup`) finds the triangle, in the mesh's own space; the shape's instance transform (its scale: a
// mesh in pixels at its pixel size) takes points and normals there and back.

const _a = Vec3();
const _b = Vec3();
const _c = Vec3();
const _q = Vec3();
const _uv = { u: 0, v: 0 };

/**
 * A mesh as a `GrowSurface` in the scene, drawn with `transform` (its shape's instance transform): its normal at a point
 * the vertices' normals there (a coarse sphere's are radial), else its triangle's
 */
export function meshSurface(mesh: Mesh, transform: Mat4 = Mat4.identity()): GrowSurface {
  const inverse = Mat4.invert(Mat4(), transform);
  const toMesh = Mat3.fromMat4(Mat3(), inverse);
  // normals by the inverse transpose (a scale along one axis tilts them)
  const normalTurn = Mat3.transpose(Mat3(), toMesh);
  const scale = Mat4.getMaxScaleOnAxis(transform) || 1;
  const vb = mesh.vertexBuffer.ref.value;
  const nb = mesh.normalBuffer.ref.value;
  const ib = mesh.indexBuffer.ref.value;
  const pick = MeshTrianglePick();
  const ray = Ray3D();
  const near = Vec3();

  const vertex = (out: Vec3, t: number, k: number) => Vec3.fromArray(out, vb, ib[3 * t + k] * 3);
  /** The normal at weights u, v of triangle t (the mesh's space): its vertices' normals, else its face's; unit */
  const normalAt = (out: Vec3, t: number, u: number, v: number) => {
    const [i0, i1, i2] = [ib[3 * t] * 3, ib[3 * t + 1] * 3, ib[3 * t + 2] * 3];
    const w = 1 - u - v;
    for (let k = 0; k < 3; ++k) out[k] = w * nb[i0 + k] + u * nb[i1 + k] + v * nb[i2 + k];
    if (Vec3.squaredMagnitude(out) < 1e-12) {
      vertex(_a, t, 0);
      Vec3.cross(out, Vec3.sub(_b, vertex(_b, t, 1), _a), Vec3.sub(_c, vertex(_c, t, 2), _a));
    }
    return out;
  };
  /** A normal of the mesh's space in the scene's, unit */
  const toScene = (n: Vec3) => Vec3.normalize(n, Vec3.transformMat3(n, n, normalTurn));

  return {
    project(out: SurfaceHit, p: Vec3, along: Vec3, reach: number) {
      const local = reach / scale;
      Vec3.transformMat4(near, p, inverse);
      Vec3.transformMat3(ray.direction, along, toMesh);
      if (Vec3.squaredMagnitude(ray.direction) > 0) Vec3.normalize(ray.direction, ray.direction);
      // the line from `reach` behind the point (a ray only meets what is ahead of it); a zero line meets nothing
      Vec3.scaleAndAdd(ray.origin, near, ray.direction, -local);
      if (!getMeshTriangleLookup(mesh).pick(pick, ray, near, local)) return false;
      const t = pick.index;
      vertex(_a, t, 0);
      vertex(_b, t, 1);
      vertex(_c, t, 2);
      Vec3.scale(out.position, _a, 1 - pick.u - pick.v);
      Vec3.scaleAndAdd(out.position, out.position, _b, pick.u);
      Vec3.scaleAndAdd(out.position, out.position, _c, pick.v);
      Vec3.transformMat4(out.position, out.position, transform);
      toScene(normalAt(out.normal, t, pick.u, pick.v));
      return true;
    },
    triangles(center: Vec3, radius: number) {
      const positions: number[] = [];
      const normals: number[] = [];
      Vec3.transformMat4(near, center, inverse);
      const local = radius / scale;
      const n = Vec3();
      for (let t = 0; t < mesh.triangleCount; ++t) {
        closestPointOnTriangle(_q, _uv, near, vertex(_a, t, 0), vertex(_b, t, 1), vertex(_c, t, 2));
        if (!(Vec3.distance(_q, near) <= local)) continue;
        for (let k = 0; k < 3; ++k) {
          Vec3.transformMat4(_q, vertex(_q, t, k), transform);
          positions.push(_q[0], _q[1], _q[2]);
          toScene(normalAt(n, t, k === 1 ? 1 : 0, k === 2 ? 1 : 0));
          normals.push(n[0], n[1], n[2]);
        }
      }
      return { positions, normals };
    },
  };
}
