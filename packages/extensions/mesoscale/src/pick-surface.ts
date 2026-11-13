/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import type { PickResult } from '@molstar/graphics/canvas3d/passes/pick';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';

// Where a paint stroke goes (progress/2026-11-08-paint.md, Design 3): the surface's point under the pointer and its
// normal, from the canvas's pick (a position, no normal): the picks around the pointer give the surface's slope, on
// any representation. On a membrane particle the particle's own frame is better (`membraneFrame`).

/** The canvas's pick at a point (CSS pixels from the canvas's top left), as `Canvas3D.identify` */
export type Identify = (x: number, y: number) => PickResult;

/** A surface point: where, its normal (unit, toward the viewer), and the pick there */
export interface SurfacePoint {
  readonly position: Vec3;
  readonly normal: Vec3;
  id: unknown;
}

export function SurfacePoint(): SurfacePoint {
  return { position: Vec3(), normal: Vec3(), id: undefined };
}

const _u = Vec3();
const _v = Vec3();
const _toEye = Vec3();

/** The difference along one screen axis: central where both sides hit alike, else the shorter side, else none */
function slope(out: Vec3, centre: Vec3, minus: PickResult, plus: PickResult): boolean {
  const m = minus && minus !== 'pending' ? minus.position : undefined;
  const p = plus && plus !== 'pending' ? plus.position : undefined;
  if (m && p) {
    const dm = Vec3.distance(m, centre);
    const dp = Vec3.distance(p, centre);
    // alike: the same surface on both sides (no edge between)
    if (Math.max(dm, dp) <= 2 * Math.min(dm, dp) + 1e-6) {
      Vec3.sub(out, p, m);
      return true;
    }
    if (dp <= dm) Vec3.sub(out, p, centre);
    else Vec3.sub(out, centre, m);
    return true;
  }
  if (p) {
    Vec3.sub(out, p, centre);
    return true;
  }
  if (m) {
    Vec3.sub(out, centre, m);
    return true;
  }
  return false;
}

/**
 * The surface at (x, y): the pick there and its normal from the picks `step` pixels left, right, up and down (the cross
 * product of their differences, turned toward `eye`, the camera's position). `'pending'` while the canvas's pick is
 * read (ask again next frame: it is read once a scene and camera, the neighbours from the same read); false where
 * nothing is. Where the neighbours give no slope (an edge, a lone pixel), the normal faces the viewer.
 */
export function surfaceAt(
  identify: Identify,
  x: number,
  y: number,
  step: number,
  eye: Vec3,
  out: SurfacePoint,
): boolean | 'pending' {
  const centre = identify(x, y);
  if (centre === 'pending') return 'pending';
  if (!centre) return false;
  const left = identify(x - step, y);
  const right = identify(x + step, y);
  const up = identify(x, y - step);
  const down = identify(x, y + step);
  if (left === 'pending' || right === 'pending' || up === 'pending' || down === 'pending') return 'pending';
  Vec3.copy(out.position, centre.position);
  out.id = centre.id;
  Vec3.sub(_toEye, eye, centre.position);
  const n = out.normal;
  if (slope(_u, centre.position, left, right) && slope(_v, centre.position, up, down)) {
    Vec3.cross(n, _u, _v);
  } else {
    Vec3.set(n, 0, 0, 0);
  }
  if (Vec3.squaredMagnitude(n) < 1e-12) Vec3.copy(n, _toEye);
  if (Vec3.dot(n, _toEye) < 0) Vec3.negate(n, n);
  Vec3.normalize(n, n);
  return true;
}

const _z = Vec3();
const _q = Quat();

/** Whether a compartment's path is a membrane's or its surface's (cellPACK's `….surface`, mesobuild's `….membrane`) */
export function isMembranePath(name: string | undefined): boolean {
  if (!name) return false;
  const parts = name.split('.');
  return parts.includes('surface') || parts.includes('membrane');
}

/**
 * On a membrane particle (its compartment a membrane or a surface: +z out, its mid-plane at z = 0, as cellPACK and
 * mesobuild place them), the membrane there: the particle's +z as the normal (out, from either side), the point
 * moved onto its mid-plane (the hit is on the outer leaflet's atoms, a copy put there would float ~2 nm out). False for
 * any other particle, the point as it was.
 */
export function membraneFrame(list: ParticleList, index: number, out: SurfacePoint): boolean {
  if (index < 0 || index >= list.count || !list.rotations) return false;
  if (!isMembranePath(list.compartmentInfo?.get(list.compartments?.[index] ?? -1)?.name)) return false;
  Quat.fromArray(_q, list.rotations, index * 4);
  Vec3.transformQuat(_z, Vec3.set(_z, 0, 0, 1), _q);
  // the mid-plane through the particle's centre
  const c = list.coordinates;
  const d =
    (out.position[0] - c[index * 3]) * _z[0] +
    (out.position[1] - c[index * 3 + 1]) * _z[1] +
    (out.position[2] - c[index * 3 + 2]) * _z[2];
  Vec3.scaleAndAdd(out.position, out.position, _z, -d);
  Vec3.copy(out.normal, _z);
  return true;
}
