/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import { envelopeOf, envelopeOfPoints, type FitEnvelope } from './fit.js';
import { targetRadius } from './paint.js';
import type { GroupLeaves } from './paint-group.js';

// A group copy fitted to a density (paint-group with density-fit, me/night-integration): its envelope is its leaves',
// each leaf's own (its object's, else a ball of its radius) put at its pose in the group's frame, about the group's
// center. A ball of the group's radius does not fit: three proteins in a ball of 30 Å score about the same anywhere
// near them (the copy went to the reach's edge).

const kept = new WeakMap<GroupLeaves, FitEnvelope>();
const _p = Vec3();
const _q = Quat();
const _t = Vec3();

/** The envelope of a group copy (its leaves in `list`, made once a group's leaves) about the group's center */
export function groupEnvelope(list: ParticleList, leaves: GroupLeaves): FitEnvelope {
  const known = kept.get(leaves);
  if (known) return known;
  const parts: Float32Array[] = [];
  let total = 0;
  for (let i = 0; i < leaves.count; ++i) {
    const t = leaves.targets[i];
    const inside = envelopeOf(list.targetMapping?.get(t), targetRadius(list, t) || 10).inside;
    const at = new Float32Array(inside.length);
    Vec3.fromArray(_t, leaves.positions, i * 3);
    Quat.fromArray(_q, leaves.rotations, i * 4);
    for (let k = 0; k < inside.length; k += 3) {
      Vec3.transformQuat(_p, Vec3.fromArray(_p, inside, k), _q);
      Vec3.add(_p, _p, _t);
      Vec3.toArray(_p, at, k);
    }
    parts.push(at);
    total += at.length;
  }
  const points = new Float32Array(total);
  let o = 0;
  for (const p of parts) {
    points.set(p, o);
    o += p.length;
  }
  const e = envelopeOfPoints(points);
  kept.set(leaves, e);
  return e;
}
