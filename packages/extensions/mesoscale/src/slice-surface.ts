/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import type { State } from '@molstar/core/state';
import { Grid, type Volume } from '@molstar/model/model/volume';
import { PluginStateObject as SO } from '@molstar/plugin/state/objects';
import { type SlicePlane, sceneVolumeOf, slicePlane } from './fit.js';
import { type GrowSurface, SurfaceHit } from './grow.js';

// A volume's slice as a surface (progress/2026-11-14-slice-constraint.md; Ludo, 2026-11-14): Fit and Grow keep a copy
// on its plane as on a mesh. The plane ends where the volume's box does: its voxels' centers, indices 0 to n − 1 along
// each axis of the grid it is drawn by (a moved volume's).

/** A slice a stroke or a grow is on: its volume's state ref and its plane then (x, y, z each; a moved slice later moves nothing) */
export interface GrowSlice {
  readonly volume: string;
  readonly point: readonly number[];
  readonly normal: readonly number[];
}

/** A slice of an operation's params (`slice`, `slicePoint`, `sliceNormal`); an empty or absent volume: none */
export function sliceOfParams(v: {
  readonly slice?: unknown;
  readonly slicePoint?: ArrayLike<number>;
  readonly sliceNormal?: ArrayLike<number>;
}): GrowSlice | undefined {
  const volume = typeof v.slice === 'string' ? v.slice.trim() : '';
  if (!volume) return undefined;
  return { volume, point: Array.from(v.slicePoint ?? []), normal: Array.from(v.sliceNormal ?? []) };
}

/** An operation's params of a slice (`sliceOfParams`'s) */
export function sliceParams(slice: GrowSlice) {
  return { slice: slice.volume, slicePoint: [...slice.point], sliceNormal: [...slice.normal] };
}

/** A slice's plane (`SlicePlane`) of a `GrowSlice`, its normal unit; undefined for one of no plane (review 8) */
export function slicePlaneOf(slice: GrowSlice): SlicePlane | undefined {
  if (slice.point.length !== 3 || slice.normal.length !== 3) return undefined;
  const normal = Vec3.create(slice.normal[0], slice.normal[1], slice.normal[2]);
  const length = Vec3.magnitude(normal);
  if (!(length > 1e-9) || ![...slice.point].every(Number.isFinite)) return undefined;
  return {
    point: Vec3.create(slice.point[0], slice.point[1], slice.point[2]),
    normal: Vec3.scale(normal, normal, 1 / length),
  };
}

/** The share of a voxel a point may be outside the box and still be in it (rounding) */
const Eps = 1e-6;

/**
 * A slice's plane (`plane`, its normal unit) as a `GrowSurface` in the scene, bounded by `grid`'s box: a point projected
 * along a line where it meets the plane within the reach, else straight onto it; none outside the box. Its normal the
 * plane's everywhere; its triangles the plane's section of the box near a point.
 */
export function planeSurface(plane: SlicePlane, grid: Grid): GrowSurface {
  const toScene = Grid.getGridToCartesianTransform(grid);
  const toGrid = Mat4.invert(Mat4(), toScene);
  const dims = grid.cells.space.dimensions;
  const n = plane.normal;
  const g = Vec3();
  const inBox = (p: Vec3) => {
    Vec3.transformMat4(g, p, toGrid);
    for (let k = 0; k < 3; ++k) if (g[k] < -Eps || g[k] > dims[k] - 1 + Eps) return false;
    return true;
  };
  const d = Vec3();
  return {
    project(out: SurfaceHit, p: Vec3, along: Vec3, reach: number) {
      const offset = Vec3.dot(Vec3.sub(d, plane.point, p), n);
      // `along` unit or zero: a line along the plane (or none) meets it nowhere
      const cos = Vec3.dot(along, n);
      if (Math.abs(cos) > 1e-6 && Math.abs(offset / cos) <= reach) {
        Vec3.scaleAndAdd(out.position, p, along, offset / cos);
      } else if (Math.abs(offset) <= reach) {
        Vec3.scaleAndAdd(out.position, p, n, offset);
      } else return false;
      Vec3.copy(out.normal, n);
      return inBox(out.position);
    },
    triangles(center: Vec3, radius: number) {
      // a square of the plane about the center's foot (its side the ball's), clipped to the box in the grid's space
      const foot = Vec3.scaleAndAdd(Vec3(), center, n, Vec3.dot(Vec3.sub(d, plane.point, center), n));
      const u = Vec3.create(Math.abs(n[0]) < 0.9 ? 1 : 0, Math.abs(n[0]) < 0.9 ? 0 : 1, 0);
      Vec3.normalize(u, Vec3.cross(u, n, u));
      const w = Vec3.cross(Vec3(), n, u);
      let polygon: Vec3[] = [];
      for (const [a, b] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ]) {
        const corner = Vec3.scaleAndAdd(Vec3(), foot, u, a * radius);
        Vec3.scaleAndAdd(corner, corner, w, b * radius);
        polygon.push(Vec3.transformMat4(corner, corner, toGrid));
      }
      for (let k = 0; k < 3 && polygon.length; ++k) {
        polygon = clip(polygon, k, 0, 1);
        polygon = clip(polygon, k, dims[k] - 1, -1);
      }
      const positions: number[] = [];
      const normals: number[] = [];
      for (const v of polygon) Vec3.transformMat4(v, v, toScene);
      for (let i = 1; i + 1 < polygon.length; ++i) {
        for (const v of [polygon[0], polygon[i], polygon[i + 1]]) {
          positions.push(v[0], v[1], v[2]);
          normals.push(n[0], n[1], n[2]);
        }
      }
      return { positions, normals };
    },
  };
}

/** A convex polygon clipped to the half-space `sign · (x[k] − at) ≥ 0` (Sutherland–Hodgman) */
function clip(polygon: readonly Vec3[], k: number, at: number, sign: number): Vec3[] {
  const out: Vec3[] = [];
  const side = (v: Vec3) => sign * (v[k] - at);
  for (let i = 0; i < polygon.length; ++i) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const sa = side(a);
    const sb = side(b);
    if (sa >= 0) out.push(a);
    if (sa >= 0 !== sb >= 0) out.push(Vec3.lerp(Vec3(), a, b, sa / (sa - sb)));
  }
  return out;
}

/**
 * The slice shown (a volume's slice representation, not hidden) whose plane, inside its volume's box, is within `reach`
 * of `p`, the nearest: its volume's state ref and its plane now
 */
export function sceneSliceAt(state: State, p: Vec3, reach: number): GrowSlice | undefined {
  const hit = SurfaceHit();
  const none = Vec3();
  let best: GrowSlice | undefined;
  let nearest = Infinity;
  for (const cell of state.cells.values()) {
    if (cell.state.isHidden || !SO.Volume.Representation3D.is(cell.obj)) continue;
    const type = (cell.transform.params as { type?: { name?: string; params?: unknown } } | undefined)?.type;
    const drawn = (cell.obj.data as { sourceData?: Volume }).sourceData;
    if (type?.name !== 'slice' || !drawn) continue;
    const plane = slicePlane(drawn.grid, (type.params ?? {}) as Parameters<typeof slicePlane>[1]);
    const volume = plane && sceneVolumeOf(state, drawn);
    if (!volume || !planeSurface(plane, drawn.grid).project(hit, p, none, reach)) continue;
    const d = Vec3.distance(hit.position, p);
    if (d >= nearest) continue;
    nearest = d;
    best = { volume: volume.ref, point: [...plane.point], normal: [...plane.normal] };
  }
  return best;
}
