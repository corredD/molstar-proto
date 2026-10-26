/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mat3, Mat4, Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import type { GizmoItem } from '@molstar/graphics/util/gizmo/controller';
import { type DragFrame, type GizmoPose, poseGesture } from '@molstar/graphics/util/gizmo/gestures';
import type { Handle } from '@molstar/graphics/util/gizmo/handle';
import { transformHandles } from '@molstar/graphics/util/gizmo/transform';
import type { HandlesBinding } from './handles.js';

// A thing placed in the scene and moved by hand (gizmos.md, structure-move.md): its transform on top of where it was
// loaded and its center there. A rigid move is a turn about the center then a move, `T(position) R T(−center)`: the
// handles' frame is the center as placed now, turned as now; what the transform has beyond a rigid move (a scale, a
// shear) is kept under the new pose.

/** Where a thing is placed: the transform on top of where it was loaded, and its center there */
export interface Placement {
  readonly matrix: Mat4;
  readonly center: Vec3;
  /** Its reach (the bounds' radius), for the handles' size */
  readonly radius: number;
}

/** A placement's turn (a scale in its matrix left out: the columns made unit) */
function turnOf(out: Quat, matrix: Mat4): Quat {
  const m = Mat3.fromMat4(Scratch.m3, matrix);
  for (let c = 0; c < 3; c++) {
    const n = Math.hypot(m[3 * c], m[3 * c + 1], m[3 * c + 2]) || 1;
    for (let r = 0; r < 3; r++) m[3 * c + r] /= n;
  }
  return Quat.normalize(out, Quat.fromMat3(out, m));
}

/** A placement's pose: its center as placed, its rotation (a scale in its matrix left out) */
export function placementPose(p: Placement): GizmoPose {
  const position = Vec3.transformMat4(Vec3(), p.center, p.matrix);
  return { position, rotation: turnOf(Quat(), p.matrix), scale: Vec3.create(1, 1, 1) };
}

/** `poseMatrix` into `out` */
function poseMatrixInto(out: Mat4, pose: GizmoPose, center: Vec3): Mat4 {
  Mat4.fromTranslation(out, pose.position);
  Mat4.mul(out, out, Mat4.fromQuat(Scratch.turn, pose.rotation));
  return Mat4.mul(out, out, Mat4.fromTranslation(Scratch.back, Vec3.negate(Scratch.v, center)));
}

/** The matrix a pose makes of a thing: turned about its center, then moved there (`T(position) R T(−center)`) */
export function poseMatrix(pose: GizmoPose, center: Vec3): Mat4 {
  return poseMatrixInto(Mat4(), pose, center);
}

/** Scratch for a drag's steps (one at a time: never kept past a call) */
const Scratch = {
  m3: Mat3(),
  turn: Mat4(),
  back: Mat4(),
  base: Mat4(),
  residual: Mat4(),
  v: Vec3(),
  pose: { position: Vec3(), rotation: Quat(), scale: Vec3.create(1, 1, 1) } as GizmoPose,
};

/** The placement a drag on `handle` makes from `from`: what it has beyond a rigid move kept under the new pose */
export function applyToPlacement<P extends Placement>(
  from: P,
  handle: Handle,
  frame: DragFrame,
  dx: number,
  dy: number,
): P {
  // the pose a gesture starts from, in scratch (the gesture makes its own)
  const base = Scratch.pose;
  Vec3.transformMat4(base.position, from.center, from.matrix);
  turnOf(base.rotation, from.matrix);
  const pose = poseGesture(base, handle, frame, dx, dy);
  if (!pose) return from;
  const residual = Mat4.invert(Scratch.residual, poseMatrixInto(Scratch.base, base, from.center));
  Mat4.mul(residual, residual, from.matrix);
  return { ...from, matrix: Mat4.mul(Mat4(), poseMatrixInto(Scratch.base, pose, from.center), residual) };
}

/** The handles' frame on a placement: its center as placed, turned as it is */
function placementFrame(item: GizmoItem<Placement>): Mat4 {
  const { center, matrix } = item.value;
  const out = Mat4.fromQuat(Mat4(), turnOf(Scratch.pose.rotation, matrix));
  return Mat4.setTranslation(out, Vec3.transformMat4(Scratch.v, center, matrix));
}

/** The transform handles on a placement (`GizmoHandles`' binding but its items and what a drag does to the state) */
export const PlacementHandles: Pick<
  HandlesBinding<Placement>,
  'layout' | 'frame' | 'sameGeometry' | 'equal' | 'apply'
> = {
  layout: (item) => ({ ...transformHandles(item.value.radius * 0.6), frame: placementFrame(item) }),
  frame: placementFrame,
  sameGeometry: (a, b) => a.radius === b.radius,
  equal: (a, b) => Mat4.areEqual(a.matrix, b.matrix, 1e-6),
  apply: applyToPlacement,
};
