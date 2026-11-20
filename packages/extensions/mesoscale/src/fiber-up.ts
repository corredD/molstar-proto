/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Vec3 } from '@molstar/core/math/linear-algebra';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import { type FiberAxis, fiberAxisVector, fiberConventionOf, fiberOffsetDirection, principalAxisOf } from './paint.js';

/**
 * A fiber unit's up in its frame (decisions 1: the axis a grow from it puts along a surface's normal), or undefined when
 * particle `index` of `drawn` is no fiber's point: its offset direction (`fiberOffsetDirection`) about the axis
 * `makeFibers` puts along the path (its Fiber Axis, else `list`'s fibers', else its target's principal axis)
 */
export function fiberUnitUp(
  drawn: ParticleList,
  index: number,
  list: ParticleList,
  id: number,
  target: number,
  axis: FiberAxis,
): Vec3 | undefined {
  if (!drawn.fibers || drawn.fibers.indices.indexOf(index) < 0) return undefined;
  const along =
    fiberAxisVector(axis) ?? fiberConventionOf(list, id)?.axis ?? principalAxisOf(list.targetMapping?.get(target));
  return fiberOffsetDirection(Vec3(), axis, along);
}
