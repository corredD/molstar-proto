/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { OptionalParam } from '@molstar/prism-viewer/api/params';
import { type GrowOn, type GrowPose, type GrowPoses, HelixAxes, SurfaceHit } from './grow.js';
import { fiberOffsetDirection } from './paint.js';

// Grow › Symmetry (progress/2026-11-13-symmetry.md; Ludo, 2026-11-13): copies of the source by a point group about a
// center a Radius from it. The groups' turns are unit quaternions in their own frame (the principal axis z: Cn's and
// Dn's n-fold, O's 4-fold, T's and I's 2-fold, the standard setting: T's and I's 2-folds on x, y and z, I's 5-folds
// through (0, ±1, ±φ)); the frame is put in the scene so the source sits at the group's general position.

/** The point groups: cyclic, dihedral, tetrahedral, octahedral, icosahedral */
export const SymmetryGroups = ['c', 'd', 't', 'o', 'i'] as const;
export type SymmetryGroup = (typeof SymmetryGroups)[number];

/** A symmetry: its group (Cn, Dn: its n), the source's distance from the center (Å) and the center's side */
export interface SymmetryParams {
  readonly group: SymmetryGroup;
  readonly n: number;
  readonly radius: number;
  /** inside: the center against the source's axis (a capsid's subunit points out); outside: along it */
  readonly side: 'inside' | 'outside';
}

const Z = Vec3.create(0, 0, 1);
const phi = (1 + Math.sqrt(5)) / 2;
const turn = (axis: Vec3, angle: number) => Quat.setAxisAngle(Quat(), Vec3.normalize(Vec3(), axis), angle);

/** A turn's key: q and −q the same (its first part not zero, of w, x, y, z, positive), to 1e-6 */
function key(q: Quat) {
  const first = [q[3], q[0], q[1], q[2]].find((v) => Math.abs(v) > 1e-9) ?? 1;
  const s = first > 0 ? 1e6 : -1e6;
  return `${Math.round(s * q[0])},${Math.round(s * q[1])},${Math.round(s * q[2])},${Math.round(s * q[3])}`;
}

/** The group made by `generators`: the identity first, then breadth first (a set keyed by turn) */
function closure(generators: Quat[]): Quat[] {
  const out = [Quat.identity()];
  const seen = new Set([key(out[0])]);
  for (let head = 0; head < out.length; ++head) {
    for (const g of generators) {
      const q = Quat.normalize(Quat(), Quat.multiply(Quat(), g, out[head]));
      const k = key(q);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(q);
    }
  }
  return out;
}

const threefold = turn(Vec3.create(1, 1, 1), (2 * Math.PI) / 3);
const polyhedral = {
  t: () => closure([turn(Z, Math.PI), threefold]),
  o: () => closure([turn(Z, Math.PI / 2), threefold]),
  i: () => closure([turn(Z, Math.PI), threefold, turn(Vec3.create(0, 1, phi), (2 * Math.PI) / 5)]),
};
const cache = new Map<string, Quat[]>();

/** Cn and Dn: n 2 to 60 (T, O and I have none) */
const foldOf = (group: SymmetryGroup, n: number) =>
  group === 'c' || group === 'd' ? Math.min(60, Math.max(2, Math.floor(n))) : 1;

/**
 * The group's turns in its frame, the identity first: Cn, the turns 2πk/n about z; Dn, those and the 2-folds about
 * the xy plane's axes at πk/n; T (12), O (24) and I (60) from their generators
 */
export function symmetryOperators(group: SymmetryGroup, n: number): readonly Quat[] {
  const fold = foldOf(group, n);
  const k = `${group}${fold}`;
  let ops = cache.get(k);
  if (ops) return ops;
  if (group === 'c' || group === 'd') {
    ops = [];
    for (let i = 0; i < fold; ++i) ops.push(turn(Z, (2 * Math.PI * i) / fold));
    if (group === 'd') {
      for (let i = 0; i < fold; ++i) {
        const t = (Math.PI * i) / fold;
        ops.push(Quat.create(Math.cos(t), Math.sin(t), 0, 0));
      }
    }
  } else {
    ops = polyhedral[group]();
  }
  cache.set(k, ops);
  return ops;
}

/**
 * The general position (unit, in the group's frame) the source takes: Cn, x (on the equator); the others, the middle
 * of a triangle of adjacent axes (the sum of their directions), which is on none: Dn, z and the 2-folds at 0 and π/n
 * (a barrel: two rings at ± a height); T and O, O's 4-, 3- and 2-fold (z, (1, 1, 1), (1, 0, 1)); I, its 2-, 3- and
 * 5-fold (z, the face (0, ±1, φ), (φ, 0, 1), and (0, 1, φ))
 */
export function symmetryPosition(group: SymmetryGroup, n: number): Vec3 {
  const sum = (...vs: Vec3[]) => {
    const out = Vec3();
    for (const v of vs) Vec3.add(out, out, Vec3.normalize(Vec3(), v));
    return Vec3.normalize(out, out);
  };
  if (group === 'c') return Vec3.create(1, 0, 0);
  if (group === 'd') {
    const t = Math.PI / foldOf(group, n);
    return sum(Z, Vec3.create(1, 0, 0), Vec3.create(Math.cos(t), Math.sin(t), 0));
  }
  if (group === 'i') return sum(Z, Vec3.create(phi, 0, 2 * phi + 1), Vec3.create(0, 1, phi));
  // O's 4-, 3- and 2-fold about one corner (review M1: not (1, 1, 0), in the plane of the other two); T's axes are O's
  return sum(Z, Vec3.create(1, 1, 1), Vec3.create(1, 0, 1));
}

/**
 * The nearest two copies of a point `at` (unit, in the group's frame; absent: the general position) apart on the unit
 * sphere: a Radius of diameter / this makes them touch
 */
export function symmetryContact(group: SymmetryGroup, n: number, at?: Vec3): number {
  const u = at ?? symmetryPosition(group, n);
  const x = Vec3();
  let min = Infinity;
  // every copy has the same neighbours: the source's nearest is the nearest two
  for (const g of symmetryOperators(group, n).slice(1))
    min = Math.min(min, Vec3.distance(Vec3.transformQuat(x, u, g), u));
  return min;
}

/**
 * The turn taking the frame of (e1, e2) to that of (f1, f2): e1 to f1, e2's part across e1 to f2's across f1;
 * false when f2 is along f1
 */
function frame(out: Quat, e1: Vec3, e2: Vec3, f1: Vec3, f2: Vec3): boolean {
  const basis = (a: Vec3, b: Vec3) => {
    const x = Vec3.normalize(Vec3(), a);
    const y = Vec3.scaleAndAdd(Vec3(), b, x, -Vec3.dot(b, x));
    if (Vec3.squaredMagnitude(y) < 1e-12) return undefined;
    Vec3.normalize(y, y);
    return Quat.fromBasis(Quat(), x, y, Vec3.cross(Vec3(), x, y));
  };
  const e = basis(e1, e2);
  const f = basis(f1, f2);
  if (!e || !f) return false;
  Quat.multiply(out, f, Quat.invert(e, e));
  Quat.normalize(out, out);
  return true;
}

/** The source's axis in the scene, its direction from the center, and the group's frame in the scene (`symmetryPoses`) */
function placed(source: GrowPose, axis: Vec3, p: Omit<SymmetryParams, 'radius'>, direction?: Vec3) {
  const u = symmetryPosition(p.group, p.n);
  const local = Vec3.normalize(Vec3(), axis);
  const a = Vec3.transformQuat(Vec3(), local, source.rotation);
  const o = p.side === 'inside' ? a : Vec3.negate(Vec3(), a);
  const m = Quat();
  if (direction) {
    if (!frame(m, Z, u, direction, o)) return undefined;
  } else {
    const side = Vec3.transformQuat(Vec3(), fiberOffsetDirection(Vec3(), 'auto', local), source.rotation);
    frame(m, u, Z, o, side);
  }
  return { local, o, m };
}

/**
 * Where the source is in the group's frame (unit; `symmetryPoses`'s rule): Auto, the general position; about a chosen
 * axis, wherever its direction from the center is (review M2: its contact, not the general position's, makes them
 * touch); undefined when it is along the chosen axis
 */
export function symmetryAt(
  source: GrowPose,
  axis: Vec3,
  p: Omit<SymmetryParams, 'radius'>,
  direction?: Vec3,
): Vec3 | undefined {
  const f = placed(source, axis, p, direction);
  return f && Vec3.transformQuat(Vec3(), f.o, Quat.invert(Quat(), f.m));
}

const _hit = SurfaceHit();

/**
 * The copies of the source by the group, about a center `radius` from it along its axis (`axis`, paint's: in its
 * frame), against it (Side inside) or along it (outside). The group's frame: Auto (`direction` absent), the source at
 * its general position, the principal axis in the plane of the source's direction and its own side
 * (`fiberOffsetDirection`), so it turns with the source; else the principal axis along `direction` (the scene's), the
 * source at the general position's azimuth about it. Each copy is the source's pose turned about the center (exact
 * orientations), the source not among them. On a surface (`on`: Snap), each copy is projected onto it along its line
 * from the center (within `on.reach`; else it stays) and turned with its axis along the normal there. Undefined when
 * two copies coincide (the source on an axis of the group).
 */
export function symmetryPoses(
  source: GrowPose,
  axis: Vec3,
  p: SymmetryParams,
  direction?: Vec3,
  on?: GrowOn,
): GrowPoses | undefined {
  const ops = symmetryOperators(p.group, p.n);
  const f = placed(source, axis, p, direction);
  if (!f) return undefined;
  const { local, o, m } = f;
  // the source's direction from the center
  const center = Vec3.scaleAndAdd(Vec3(), source.position, o, -p.radius);
  const back = Quat.invert(Quat(), m);
  const rel = Vec3.sub(Vec3(), source.position, center);
  const out: GrowPoses = { positions: [], rotations: [] };
  const w = Quat();
  const x = Vec3();
  const q = Quat();
  const c = Vec3();
  const along = Vec3();
  for (let k = 1; k < ops.length; ++k) {
    Quat.multiply(w, Quat.multiply(w, m, ops[k]), back);
    Vec3.add(x, center, Vec3.transformQuat(x, rel, w));
    if (Vec3.distance(x, source.position) < 1e-6 * Math.max(1, p.radius)) return undefined;
    Quat.normalize(q, Quat.multiply(q, w, source.rotation));
    if (on && on.surface.project(_hit, x, Vec3.normalize(along, Vec3.sub(along, x, center)), on.reach)) {
      Vec3.transformQuat(c, local, q);
      if (Vec3.dot(_hit.normal, c) < 0) Vec3.negate(_hit.normal, _hit.normal);
      Quat.normalize(q, Quat.multiply(q, Quat.rotationTo(Quat(), c, _hit.normal), q));
      Vec3.copy(x, _hit.position);
    }
    out.positions.push(x[0], x[1], x[2]);
    out.rotations.push(q[0], q[1], q[2], q[3]);
  }
  return out;
}

/** `mesoscale.grow`'s Symmetry params (ui.md, Grow › Symmetry) */
export const SymmetryGrowParams = {
  group: OptionalParam(
    PD.Select(
      'c',
      [
        ['c', 'Cn: n copies about an axis (a ring)'],
        ['d', 'Dn: 2n, Cn and n 2-folds across it (a barrel)'],
        ['t', 'T: tetrahedral, 12'],
        ['o', 'O: octahedral, 24'],
        ['i', 'I: icosahedral, 60'],
      ] as const,
      { description: 'Symmetry: the point group (the source counted)' },
    ),
  ),
  n: OptionalParam(PD.Numeric(6, { min: 2, max: 60, step: 1 }, { description: 'Symmetry Cn, Dn: its n' })),
  symmetryRadius: OptionalParam(
    PD.Numeric(
      0,
      { min: 0, step: 0.1 },
      {
        description:
          "Symmetry: the center's distance from the source along its axis, Å; absent: the copies touching (their nearest two a diameter apart)",
      },
    ),
  ),
  side: OptionalParam(
    PD.Select(
      'inside',
      [
        ['inside', 'Inside: the center against its axis'],
        ['outside', 'Outside: the center along its axis'],
      ] as const,
      { description: "Symmetry: the center's side of the source" },
    ),
  ),
  symmetryAxis: OptionalParam(
    PD.Select('auto', PD.arrayToOptions(HelixAxes), {
      description:
        "Symmetry: the group's principal axis through the center (auto: across the source's, so it sits on the shell; view: toward the viewer)",
    }),
  ),
  snap: OptionalParam(
    PD.Boolean(false, {
      description: 'Symmetry on a mesh: each copy projected onto it and turned to its normal (off: exact)',
    }),
  ),
};
