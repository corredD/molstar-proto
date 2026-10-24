/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mat4, Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import type { Clip } from '@molstar/core/util/clip';

// An object moved or turned on the canvas (apps/prism-me/_spec/ui.md §5, step 3d): the matrix of a drag, and what it
// does to what is placed in the scene's space with the object (its clip objects, its labels).

export type MoveMode = 'move' | 'rotate';

/** The camera, as a drag on the screen needs it: its right and up in world space, the world size of a pixel there */
export interface ScreenFrame {
  readonly right: Vec3;
  readonly up: Vec3;
  /** Å per pixel at the depth of what is dragged */
  readonly pixel: number;
}

/** Degrees turned per pixel dragged */
const TurnPerPixel = 0.5;

/**
 * The matrix of a drag of (dx, dy) pixels: moved in the screen's plane, or turned about `center` (across: about the
 * screen's up; along: about its right)
 */
export function dragMatrix(mode: MoveMode, dx: number, dy: number, frame: ScreenFrame, center: Vec3): Mat4 {
  if (mode === 'move') {
    const t = Vec3.scale(Vec3(), frame.right, dx * frame.pixel);
    Vec3.scaleAndAdd(t, t, frame.up, -dy * frame.pixel);
    return Mat4.fromTranslation(Mat4(), t);
  }
  const deg = Math.PI / 180;
  const across = Mat4.fromRotation(Mat4(), dx * TurnPerPixel * deg, frame.up);
  const along = Mat4.fromRotation(Mat4(), dy * TurnPerPixel * deg, frame.right);
  const turn = Mat4.mul(Mat4(), across, along);
  // about the center: to the origin, turned, back
  const back = Mat4.fromTranslation(Mat4(), center);
  const to = Mat4.fromTranslation(Mat4(), Vec3.negate(Vec3(), center));
  return Mat4.mul(Mat4(), back, Mat4.mul(Mat4(), turn, to));
}

/** A clip object placed by `m` (its position moved, its rotation turned), its size kept */
export function movedClipObject(o: Clip.Props['objects'][number], m: Mat4): Clip.Props['objects'][number] {
  const position = Vec3.transformMat4(Vec3(), o.position, m);
  const turn = Quat.normalize(Quat(), Mat4.getRotation(Quat(), m));
  const old = Quat.setAxisAngle(Quat(), Vec3.normalize(Vec3(), o.rotation.axis), (o.rotation.angle * Math.PI) / 180);
  const q = Quat.normalize(Quat(), Quat.multiply(Quat(), turn, old));
  const axis = Vec3();
  const angle = Quat.getAxisAngle(axis, q);
  return {
    ...o,
    position,
    rotation: { axis: Vec3.magnitude(axis) > 1e-9 ? axis : Vec3.create(1, 0, 0), angle: (angle * 180) / Math.PI },
  };
}

/** A volume slice's plane (`mode: 'plane'`), as its params hold it: in the scene's space, not the volume's grid */
interface SlicePlane {
  readonly point: Vec3;
  readonly normal: Vec3;
}

/**
 * A representation's params with what it places in the scene's space moved by `m`: its clip objects, a volume slice's
 * plane (a grid or frame slice is in its volume's grid, moved with it); undefined when it places nothing
 */
export function movedRepresentationParams<P extends { type?: { name?: string; params?: object } }>(
  params: P,
  m: Mat4,
): P | undefined {
  const type = params.type?.params as
    | { clip?: Clip.Props; mode?: string; plane?: SlicePlane; [k: string]: unknown }
    | undefined;
  if (!type) return undefined;
  const clip = type.clip?.objects.length
    ? { ...type.clip, objects: type.clip.objects.map((o) => movedClipObject(o, m)) }
    : undefined;
  const plane =
    params.type?.name === 'slice' && type.mode === 'plane' && type.plane
      ? {
          point: Vec3.transformMat4(Vec3(), type.plane.point, m),
          normal: Vec3.transformDirection(Vec3(), type.plane.normal, m),
        }
      : undefined;
  if (!clip && !plane) return undefined;
  return {
    ...params,
    type: { ...params.type, params: { ...type, ...(clip ? { clip } : {}), ...(plane ? { plane } : {}) } },
  };
}

/** A point placed by `m` */
export function movedPoint(p: Vec3, m: Mat4): Vec3 {
  return Vec3.transformMat4(Vec3(), p, m);
}

/** An object's pose: where its center is (Å, the scene's) and its turn (Euler angles, degrees: X, then Y, then Z) */
export interface ObjectPose {
  readonly position: readonly [number, number, number];
  readonly euler: readonly [number, number, number];
}

/** What a pose is read from: the object's matrix (on top of where it was loaded, a list's scale in it) and center */
export interface PlacedObject {
  readonly matrix: Mat4;
  readonly center: Vec3;
}

const Deg = 180 / Math.PI;

/** An object's pose: its center where the matrix puts it, the matrix's turn as Euler angles (X, then Y, then Z) */
export function poseOf(p: PlacedObject): ObjectPose {
  const c = Vec3.transformMat4(Vec3(), p.center, p.matrix);
  const s = Mat4.getMaxScaleOnAxis(p.matrix) || 1;
  // the turn's entries (row r, column k; the matrix column-major), the scale taken out
  const r = (row: number, col: number) => p.matrix[col * 4 + row] / s;
  // R = Rz Ry Rx: r20 = -sin y; r21 = cos y sin x; r22 = cos y cos x; r10 = sin z cos y; r00 = cos z cos y
  const sy = Math.max(-1, Math.min(1, -r(2, 0)));
  const y = Math.asin(sy);
  let x: number;
  let z: number;
  if (Math.abs(sy) < 1 - 1e-9) {
    x = Math.atan2(r(2, 1), r(2, 2));
    z = Math.atan2(r(1, 0), r(0, 0));
  } else {
    // straight up or down: x and z turn about the same axis, all of it in z
    x = 0;
    z = Math.atan2(-r(0, 1), r(1, 1));
  }
  return { position: [c[0], c[1], c[2]], euler: [x * Deg, y * Deg, z * Deg] };
}

/**
 * The matrix of an object at `pose`: turned (Euler X, then Y, then Z) about its center, its center there, the scale
 * of its matrix kept (a particle list's positions)
 */
export function placementWith(p: PlacedObject, pose: ObjectPose): Mat4 {
  const s = Mat4.getMaxScaleOnAxis(p.matrix) || 1;
  const [x, y, z] = pose.euler.map((a) => a / Deg);
  const turn = Mat4.mul(
    Mat4(),
    Mat4.fromRotation(Mat4(), z, Vec3.create(0, 0, 1)),
    Mat4.mul(
      Mat4(),
      Mat4.fromRotation(Mat4(), y, Vec3.create(0, 1, 0)),
      Mat4.fromRotation(Mat4(), x, Vec3.create(1, 0, 0)),
    ),
  );
  // the center (as scaled) to the origin, turned, to the pose's place; the scale first
  const scaled = Vec3.scale(Vec3(), p.center, s);
  const m = Mat4.fromUniformScaling(Mat4(), s);
  Mat4.mul(m, Mat4.fromTranslation(Mat4(), Vec3.negate(Vec3(), scaled)), m);
  Mat4.mul(m, turn, m);
  Mat4.mul(m, Mat4.fromTranslation(Mat4(), Vec3.create(...pose.position)), m);
  return m;
}
