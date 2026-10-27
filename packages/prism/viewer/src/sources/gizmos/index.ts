/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// Handles that move things (gizmos.md): the host of the gizmo library, for Prism's features and extensions.

export { type FrameValue, frameHandles } from './frame.js';
export { GizmoHandles, type GizmoHandlesOptions, type HandlesBinding } from './handles.js';
export {
  applyToPlacement,
  type Placement,
  PlacementHandles,
  placementPose,
  poseMatrix,
} from './placement.js';
