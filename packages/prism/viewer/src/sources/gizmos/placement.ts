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

/** A placement's pose: its center as placed, its rotation (a scale in its matrix left out: the columns made unit) */
export function placementPose(p: Placement): GizmoPose {
  const position = Vec3.transformMat4(Vec3(), p.center, p.matrix);
  const m = Mat3.fromMat4(Mat3(), p.matrix);
  for (let c = 0; c < 3; c++) {
    const n = Math.hypot(m[3 * c], m[3 * c + 1], m[3 * c + 2]) || 1;
    for (let r = 0; r < 3; r++) m[3 * c + r] /= n;
  }
  const rotation = Quat.normalize(Quat(), Quat.fromMat3(Quat(), m));
  return { position, rotation, scale: Vec3.create(1, 1, 1) };
}

/** The matrix a pose makes of a thing: turned about its center, then moved there (`T(position) R T(−center)`) */
export function poseMatrix(pose: GizmoPose, center: Vec3): Mat4 {
  const out = Mat4.fromTranslation(Mat4(), pose.position);
  Mat4.mul(out, out, Mat4.fromQuat(Mat4(), pose.rotation));
  return Mat4.mul(out, out, Mat4.fromTranslation(Mat4(), Vec3.negate(Vec3(), center)));
}

/** The placement a drag on `handle` makes from `from`: what it has beyond a rigid move kept under the new pose */
export function applyToPlacement<P extends Placement>(
  from: P,
  handle: Handle,
  frame: DragFrame,
  dx: number,
  dy: number,
): P {
  const base = placementPose(from);
  const pose = poseGesture(base, handle, frame, dx, dy);
  if (!pose) return from;
  const residual = Mat4.mul(Mat4(), Mat4.invert(Mat4(), poseMatrix(base, from.center)), from.matrix);
  return { ...from, matrix: Mat4.mul(Mat4(), poseMatrix(pose, from.center), residual) };
}

/** The transform handles on a placement (`GizmoHandles`' binding but its items and what a drag does to the state) */
export const PlacementHandles: Pick<HandlesBinding<Placement>, 'layout' | 'sameGeometry' | 'equal' | 'apply'> = {
  layout(item: GizmoItem<Placement>) {
    const pose = placementPose(item.value);
    const frame = Mat4.mul(Mat4(), Mat4.fromTranslation(Mat4(), pose.position), Mat4.fromQuat(Mat4(), pose.rotation));
    return { ...transformHandles(item.value.radius * 0.6), frame };
  },
  sameGeometry: (a, b) => a.radius === b.radius,
  equal: (a, b) => Mat4.areEqual(a.matrix, b.matrix, 1e-6),
  apply: applyToPlacement,
};
