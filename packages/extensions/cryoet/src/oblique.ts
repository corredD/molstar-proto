/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { Grid } from '@molstar/model/model/volume';

// An oblique slice (apps/prism-me/_spec/ui.md, the oblique slice): a volume's slice on any plane, Mol*'s `plane` mode,
// placed by its own handle. Its pose is in the volume's frame (its grid's center and axes), so its numbers stay as
// the volume moves; the plane its representation is given is in the scene's Å (as the slice reads it), moved with the
// volume by the stage's move.

/** Where an oblique slice is, in its volume's frame: its point (Å from the volume's center), its tilt (°) */
export interface ObliquePose {
  readonly position: readonly [number, number, number];
  /** Tilted about X, then about Y: its normal is the volume's Z so turned */
  readonly tilt: readonly [number, number];
}

/** A slice's plane as its representation holds it: in the scene's Å */
export interface SlicePlane {
  readonly point: Vec3;
  readonly normal: Vec3;
}

const Deg = Math.PI / 180;

/** A volume's frame in the scene: at its grid's center, along its grid's axes (made orthonormal), in Å */
export function volumeFrame(grid: Grid): Mat4 {
  const g = Grid.getGridToCartesianTransform(grid);
  const [nx, ny, nz] = grid.cells.space.dimensions;
  const x = Vec3.normalize(Vec3(), Vec3.create(g[0], g[1], g[2]));
  const along = Vec3.create(g[4], g[5], g[6]);
  const z = Vec3.normalize(Vec3(), Vec3.cross(Vec3(), x, along));
  const y = Vec3.cross(Vec3(), z, x);
  const m = Mat4.fromBasis(Mat4(), x, y, z);
  return Mat4.setTranslation(m, Vec3.transformMat4(Vec3(), Vec3.create(nx / 2, ny / 2, nz / 2), g));
}

/** A pose's frame in the volume's: at its point, its Z its normal (`T(position) Ry Rx`) */
function localFrame(pose: ObliquePose): Mat4 {
  const rx = Mat4.fromRotation(Mat4(), pose.tilt[0] * Deg, Vec3.unitX);
  const ry = Mat4.fromRotation(Mat4(), pose.tilt[1] * Deg, Vec3.unitY);
  const m = Mat4.mul(Mat4(), ry, rx);
  return Mat4.setTranslation(m, Vec3.create(...pose.position));
}

/** Where its handle is in the scene: at its point, its Z the plane's normal */
export function obliqueFrame(grid: Grid, pose: ObliquePose): Mat4 {
  return Mat4.mul(Mat4(), volumeFrame(grid), localFrame(pose));
}

/** The pose of a frame in the scene (its handle's): its point, and the tilts of its Z (its turn about Z left out) */
export function obliquePoseOf(grid: Grid, frame: Mat4): ObliquePose {
  const local = Mat4.mul(Mat4(), Mat4.invert(Mat4(), volumeFrame(grid)), frame);
  const n = Vec3.normalize(Vec3(), Vec3.create(local[8], local[9], local[10]));
  // n = Ry(ey) Rx(ex) z = (cos ex sin ey, -sin ex, cos ex cos ey)
  const ex = Math.asin(Math.max(-1, Math.min(1, -n[1]))) / Deg;
  const ey = Math.abs(n[1]) > 1 - 1e-12 ? 0 : Math.atan2(n[0], n[2]) / Deg;
  return { position: [local[12], local[13], local[14]], tilt: [ex, ey] };
}

/** The plane of a pose, in the scene's Å */
export function obliquePlane(grid: Grid, pose: ObliquePose): SlicePlane {
  const m = obliqueFrame(grid, pose);
  return {
    point: Mat4.getTranslation(Vec3(), m),
    normal: Vec3.normalize(Vec3(), Vec3.create(m[8], m[9], m[10])),
  };
}

/** The pose of a plane (a slice's), in the volume's frame */
export function obliquePoseOfPlane(grid: Grid, plane: SlicePlane): ObliquePose {
  return obliquePoseOf(grid, Mat4.fromPlane(Mat4(), Vec3.normalize(Vec3(), plane.normal), plane.point));
}
