/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mat4 } from '@molstar/core/math/linear-algebra';
import { frameOfPose, poseGesture, poseOfFrame } from '@molstar/graphics/util/gizmo/gestures';
import { type TransformHandlesOptions, transformHandles } from '@molstar/graphics/util/gizmo/transform';
import type { HandlesBinding } from './handles.js';

// A thing a handle places by a rigid frame (gizmos.md): a slice's point and normal, a particle's place and turn. The
// transform handles at the frame, its size theirs; a drag moves and turns the frame about its origin.

/** A handle's frame in the scene and its size */
export interface FrameValue {
  readonly frame: Mat4;
  readonly size: number;
}

/** The transform handles on a frame (`GizmoHandles`' binding but its items and what a drag does to the state) */
export function frameHandles(
  options: TransformHandlesOptions = {},
): Pick<HandlesBinding<FrameValue>, 'layout' | 'sameGeometry' | 'equal' | 'apply'> {
  return {
    layout: (item) => ({ ...transformHandles(item.value.size, options), frame: item.value.frame }),
    sameGeometry: (a, b) => a.size === b.size,
    equal: (a, b) => Mat4.areEqual(a.frame, b.frame, 1e-6),
    apply(from, handle, frame, dx, dy) {
      const pose = poseGesture(poseOfFrame(from.frame), handle, frame, dx, dy);
      return pose ? { ...from, frame: frameOfPose(pose) } : from;
    },
  };
}
