/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Ray3D } from '@molstar/core/math/geometry/primitives/ray3d';
import { Mat3, Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { type State, StateTransform } from '@molstar/core/state';
import type { Mesh } from '@molstar/graphics/geo/geometry/mesh/mesh';
import { Shape } from '@molstar/model/model/shape';
import {
  closestPointOnTriangle,
  getMeshTriangleLookup,
  MeshTrianglePick,
} from '@molstar/graphics/geo/geometry/mesh/triangle-pick';
import { PluginStateObject as SO } from '@molstar/plugin/state/objects';
import type { ApiFailure } from '@molstar/prism-viewer/api/area';
import { pickNamed } from '@molstar/prism-viewer/api/scope';
import type { Loci } from '@molstar/model/model/loci';
import { ShapeGroup } from '@molstar/model/model/shape';
import { type GrowSurface, SurfaceHit } from './grow.js';
import type { SurfacePoint } from './pick-surface.js';

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

const _hit = SurfaceHit();

/**
 * Paint on a mesh (grow-mesh): when a surface point's pick is a file mesh's (`loci`, a shape picked by triangle), the
 * point brought onto the mesh along its normal (within `reach`, Å) and the mesh's normal there, on the side of the
 * point's (the viewer's); returns the mesh's shape. Undefined for any other pick, the point as it was.
 */
export function meshFrame(loci: Loci, point: SurfacePoint, reach: number): Shape<Mesh> | undefined {
  if (!ShapeGroup.isLoci(loci) || loci.shape.geometry.kind !== 'mesh' || !loci.shape.getTriangleLoci) return undefined;
  const shape = loci.shape as Shape<Mesh>;
  const transform = shape.transforms[loci.groups[0]?.instance ?? 0] ?? shape.transforms[0];
  if (!meshSurface(shape.geometry, transform).project(_hit, point.position, point.normal, reach)) return undefined;
  if (Vec3.dot(_hit.normal, point.normal) < 0) Vec3.negate(_hit.normal, _hit.normal);
  Vec3.copy(point.position, _hit.position);
  Vec3.copy(point.normal, _hit.normal);
  return shape;
}

// --- The scene's meshes --------------------------------------------------------------------------------------------------

/** A file mesh of the scene (OBJ, PLY, VTP): its representation (state ref), its file's name and its shape */
export interface SceneMesh {
  readonly ref: string;
  readonly label: string;
  readonly shape: Shape<Mesh>;
}

/** The shape a representation draws when it is a file's mesh (a mesh shape picked by triangle: OBJ, PLY, VTP opt in) */
export function fileMeshShape(obj: unknown): Shape<Mesh> | undefined {
  if (!SO.Shape.Representation3D.is(obj as never)) return undefined;
  for (const l of (obj as SO.Shape.Representation3D).data.repr.getAllLoci()) {
    if (Shape.isLoci(l) && l.shape.geometry.kind === 'mesh' && l.shape.getTriangleLoci) return l.shape as Shape<Mesh>;
  }
  return undefined;
}

/** The file meshes of the scene, named by their file (the data at the root of their branch) */
export function sceneMeshes(state: State): SceneMesh[] {
  const out: SceneMesh[] = [];
  for (const cell of state.cells.values()) {
    if (cell.state.isGhost) continue;
    const shape = fileMeshShape(cell.obj);
    if (!shape) continue;
    let root = cell.transform.ref;
    for (;;) {
      const parent = state.tree.transforms.get(root)?.parent;
      if (!parent || parent === StateTransform.RootRef) break;
      root = parent;
    }
    out.push({ ref: cell.transform.ref, label: state.cells.get(root)?.obj?.label ?? cell.obj!.label, shape });
  }
  return out;
}

/** A file mesh of the scene by its state ref or its file's name */
export function sceneMesh(state: State, name: string): SceneMesh | ApiFailure {
  return pickNamed(sceneMeshes(state), name, {
    what: 'mesh',
    ids: (m) => [m.ref],
    names: (m) => [m.label],
    describe: (m) => `${m.label} (${m.ref})`,
    none: { message: 'No mesh is loaded.', hint: 'Open an OBJ, PLY or VTP mesh.' },
  });
}

/** A scene mesh as a surface in the scene (its shape's first instance: a file mesh has one) */
export function sceneMeshSurface(mesh: SceneMesh): GrowSurface {
  return meshSurface(mesh.shape.geometry, mesh.shape.transforms[0]);
}
