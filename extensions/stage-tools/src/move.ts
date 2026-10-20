/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mat4, Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import type { Clip } from '@molstar/core/util/clip';
import type { ScreenFrame } from './cuts.js';

// An object moved or turned on the canvas (apps/prism-me/_spec/ui.md §5, step 3d): the matrix of a drag, and what it
// does to what is placed in the scene's space with the object (its clip objects, its labels).

export type MoveMode = 'move' | 'rotate';

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

/** A point placed by `m` */
export function movedPoint(p: Vec3, m: Mat4): Vec3 {
  return Vec3.transformMat4(Vec3(), p, m);
}
