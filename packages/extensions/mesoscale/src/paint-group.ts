/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import { PrincipalAxes } from '@molstar/core/math/linear-algebra/matrix/principal-axes';
import { CustomProperties } from '@molstar/model/model/custom-property';
import type { ParticleList, ParticleTarget } from '@molstar/model/model/particles/particle-list';

// Groups (cellPAINT's grouping; progress/2026-11-13-paint-group.md, Ludo 2026-11-13: "select a couple of instances,
// and make that a new ingredient"): a few instances made a brush of their own. A group is its members, each a brush
// (a target, its entity and compartment, or another group) at a pose relative to the group's frame. A group stroke
// (`PaintStroke.group`) holds the copies' poses; the painted decorator expands each copy to the group's leaves
// (`expandGroups`), a copy's leaves in a row, so a painted particle tells which copy it is of (`groupCopyAt`).

/** A member of a group: a brush at a pose relative to the group's frame (Å; a unit quaternion x, y, z, w) */
export interface PaintGroupMember {
  readonly target: number;
  readonly entity: number;
  readonly compartment: number;
  /** A group (its id) instead of a target: its members at this pose */
  readonly group?: number;
  readonly position: readonly number[];
  readonly rotation: readonly number[];
}

/** A group: a brush of a list (its id, above the list's target and entity ids), its members and bounding radius */
export interface PaintGroup {
  readonly id: number;
  readonly name: string;
  /** The members' bounding sphere about the frame's center, their own radii in (Å) */
  readonly radius: number;
  readonly members: readonly PaintGroupMember[];
}

/** An instance picked for a group: its brush, its pose (in the list's frame) and its radius */
export interface GroupPick {
  readonly target: number;
  readonly entity: number;
  readonly compartment: number;
  readonly group?: number;
  readonly position: ArrayLike<number>;
  readonly rotation: ArrayLike<number>;
  readonly radius: number;
}

export interface GroupPose {
  readonly position: Vec3;
  readonly rotation: Quat;
}

const _x = Vec3();
const _y = Vec3();
const _z = Vec3();
const _v = Vec3();
const _q = Quat();
const _inv = Quat();

/**
 * A group of the picks: its center their centroid, its axes their principal axes (x the largest; +z the smallest, the
 * way their own +z go on average, so a flat cluster painted along a normal lies on the surface; y = z × x: right-handed,
 * no member mirrored); two members: x along their line; one: its own pose. Its members relative to that frame. Also
 * the pose that puts them back where they were.
 */
export function makeGroup(id: number, name: string, picks: readonly GroupPick[]): { group: PaintGroup; pose: GroupPose } {
  const n = picks.length;
  const center = Vec3();
  for (const p of picks) Vec3.add(center, center, Vec3.set(_v, p.position[0], p.position[1], p.position[2]));
  if (n) Vec3.scale(center, center, 1 / n);
  // the members' +z, on average: the way the group's +z goes
  const up = Vec3();
  for (const p of picks) {
    Quat.set(_q, p.rotation[0], p.rotation[1], p.rotation[2], p.rotation[3]);
    Vec3.add(up, up, Vec3.transformQuat(_v, Vec3.create(0, 0, 1), Quat.normalize(_q, _q)));
  }
  const rotation = Quat.identity();
  if (n === 1) {
    Quat.set(rotation, picks[0].rotation[0], picks[0].rotation[1], picks[0].rotation[2], picks[0].rotation[3]);
    Quat.normalize(rotation, rotation);
  } else if (n >= 2) {
    const xyz: number[] = [];
    for (const p of picks) xyz.push(p.position[0], p.position[1], p.position[2]);
    let spread = 0;
    for (const p of picks) {
      spread = Math.max(spread, Vec3.distance(center, Vec3.set(_v, p.position[0], p.position[1], p.position[2])));
    }
    if (n === 2) Vec3.sub(_x, Vec3.set(_v, xyz[3], xyz[4], xyz[5]), Vec3.set(_y, xyz[0], xyz[1], xyz[2]));
    else Vec3.copy(_x, PrincipalAxes.calculateMomentsAxes(xyz).dirA);
    if (!(spread > 1e-6) || Vec3.squaredMagnitude(_x) < 1e-12) Vec3.set(_x, 1, 0, 0);
    Vec3.normalize(_x, _x);
    // +z: the smallest axis (3 or more), else the members' up; perpendicular to x
    if (n >= 3) Vec3.copy(_z, PrincipalAxes.calculateMomentsAxes(xyz).dirC);
    else Vec3.copy(_z, up);
    Vec3.scaleAndAdd(_z, _z, _x, -Vec3.dot(_z, _x));
    if (Vec3.squaredMagnitude(_z) < 1e-12) anyPerpendicular(_z, _x);
    Vec3.normalize(_z, _z);
    if (Vec3.dot(_z, up) < 0) Vec3.negate(_z, _z);
    Vec3.cross(_y, _z, _x);
    Quat.fromBasis(rotation, _x, _y, _z);
    Quat.normalize(rotation, rotation);
  }
  Quat.invert(_inv, rotation);
  let radius = 0;
  const members = picks.map((p): PaintGroupMember => {
    Vec3.set(_v, p.position[0] - center[0], p.position[1] - center[1], p.position[2] - center[2]);
    radius = Math.max(radius, Vec3.magnitude(_v) + p.radius);
    Vec3.transformQuat(_v, _v, _inv);
    Quat.set(_q, p.rotation[0], p.rotation[1], p.rotation[2], p.rotation[3]);
    Quat.multiply(_q, _inv, Quat.normalize(_q, _q));
    return {
      target: p.target,
      entity: p.entity,
      compartment: p.compartment,
      ...(p.group !== undefined ? { group: p.group } : {}),
      position: [_v[0], _v[1], _v[2]],
      rotation: [_q[0], _q[1], _q[2], _q[3]],
    };
  });
  return { group: { id, name, radius, members }, pose: { position: center, rotation } };
}

function anyPerpendicular(out: Vec3, a: Vec3) {
  const e = Math.abs(a[0]) < 0.9 ? Vec3.create(1, 0, 0) : Vec3.create(0, 1, 0);
  return Vec3.cross(out, a, e);
}

/** A group's leaves (its members, a member group's in its place, depth first) at their poses in its frame */
export interface GroupLeaves {
  readonly count: number;
  readonly targets: Int32Array;
  readonly entities: Int32Array;
  readonly compartments: Int32Array;
  readonly positions: Float64Array;
  readonly rotations: Float64Array;
}

const leavesKept = new WeakMap<readonly PaintGroup[], Map<number, GroupLeaves | null>>();

/** The groups by id (indexed once a groups array) and each one's leaves, made once */
export function groupLeaves(groups: readonly PaintGroup[] | undefined, id: number): GroupLeaves | undefined {
  if (!groups?.length) return undefined;
  let kept = leavesKept.get(groups);
  if (!kept) leavesKept.set(groups, (kept = new Map()));
  const known = kept.get(id);
  if (known !== undefined) return known ?? undefined;
  const byId = new Map(groups.map((g) => [g.id, g]));
  const make = (gid: number, seen: Set<number>): GroupLeaves | undefined => {
    const k = kept!.get(gid);
    if (k !== undefined) return k ?? undefined;
    const g = byId.get(gid);
    // a group of itself (never made; a session edited by hand) has no leaves
    if (!g || seen.has(gid)) return undefined;
    seen.add(gid);
    const targets: number[] = [];
    const entities: number[] = [];
    const compartments: number[] = [];
    const positions: number[] = [];
    const rotations: number[] = [];
    const mq = Quat();
    const lq = Quat();
    const p = Vec3();
    for (const m of g.members) {
      Quat.set(mq, m.rotation[0], m.rotation[1], m.rotation[2], m.rotation[3]);
      if (m.group === undefined) {
        targets.push(m.target);
        entities.push(m.entity);
        compartments.push(m.compartment);
        positions.push(m.position[0], m.position[1], m.position[2]);
        rotations.push(mq[0], mq[1], mq[2], mq[3]);
        continue;
      }
      const inner = make(m.group, seen);
      if (!inner) continue;
      for (let i = 0; i < inner.count; ++i) {
        targets.push(inner.targets[i]);
        entities.push(inner.entities[i]);
        compartments.push(inner.compartments[i]);
        Vec3.fromArray(p, inner.positions, i * 3);
        Vec3.transformQuat(p, p, mq);
        positions.push(p[0] + m.position[0], p[1] + m.position[1], p[2] + m.position[2]);
        Quat.fromArray(lq, inner.rotations, i * 4);
        Quat.multiply(lq, mq, lq);
        rotations.push(lq[0], lq[1], lq[2], lq[3]);
      }
    }
    seen.delete(gid);
    const out: GroupLeaves = {
      count: targets.length,
      targets: Int32Array.from(targets),
      entities: Int32Array.from(entities),
      compartments: Int32Array.from(compartments),
      positions: Float64Array.from(positions),
      rotations: Float64Array.from(rotations),
    };
    kept!.set(gid, out);
    return out;
  };
  const out = make(id, new Set());
  if (!out) kept.set(id, null);
  return out;
}

/** A painted point's own target, entity and compartment (a group stroke's leaves; `paintParticles` reads them) */
export interface StrokeMembers {
  readonly targets: Int32Array;
  readonly entities: Int32Array;
  readonly compartments: Int32Array;
}

/**
 * The strokes with each group stroke's copies expanded to the group's leaves, a copy's in a row: each at the copy's
 * pose · its own; its `members` their targets, entities and compartments; no fiber of them (a grown walk of a group is
 * its copies' path, not a fiber of the list). The others as they are
 */
export function expandGroups<S extends Posed>(
  strokes: readonly S[],
  groups: readonly PaintGroup[] | undefined,
): (S & { members?: StrokeMembers })[] {
  if (!groups?.length) return strokes as S[];
  const P = Vec3();
  const Q = Quat();
  const p = Vec3();
  const r = Quat();
  return strokes.map((s) => {
    if (s.group === undefined) return s;
    const leaves = groupLeaves(groups, s.group);
    const k = Math.floor(s.positions.length / 3);
    const L = leaves?.count ?? 0;
    const positions = new Array<number>(k * L * 3);
    const rotations = new Array<number>(k * L * 4);
    const targets = new Int32Array(k * L);
    const entities = new Int32Array(k * L);
    const compartments = new Int32Array(k * L);
    for (let c = 0; c < k; ++c) {
      Vec3.set(P, s.positions[c * 3], s.positions[c * 3 + 1], s.positions[c * 3 + 2]);
      Quat.set(Q, s.rotations[c * 4] ?? 0, s.rotations[c * 4 + 1] ?? 0, s.rotations[c * 4 + 2] ?? 0, s.rotations[c * 4 + 3] ?? 1);
      for (let j = 0; j < L; ++j) {
        const at = c * L + j;
        Vec3.fromArray(p, leaves!.positions, j * 3);
        Vec3.add(p, Vec3.transformQuat(p, p, Q), P);
        positions[at * 3] = p[0];
        positions[at * 3 + 1] = p[1];
        positions[at * 3 + 2] = p[2];
        Quat.multiply(r, Q, Quat.fromArray(r, leaves!.rotations, j * 4));
        rotations[at * 4] = r[0];
        rotations[at * 4 + 1] = r[1];
        rotations[at * 4 + 2] = r[2];
        rotations[at * 4 + 3] = r[3];
        targets[at] = leaves!.targets[j];
        entities[at] = leaves!.entities[j];
        compartments[at] = leaves!.compartments[j];
      }
    }
    return { ...s, fiber: undefined, runs: undefined, positions, rotations, members: { targets, entities, compartments } };
  });
}

/**
 * A copy of a group painted: its stroke, its place in it (`path`: the copy's, then the member's in each copy ungrouped,
 * "3.1"), its group and pose, and its particles (`first`, `count` after the decorator's input)
 */
export interface GroupCopy {
  readonly stroke: number;
  readonly copy: number;
  readonly path: string;
  readonly group: number;
  readonly first: number;
  readonly count: number;
  readonly pose: GroupPose;
}

type Posed = {
  readonly group?: number;
  readonly split?: readonly string[];
  readonly positions: readonly number[];
  readonly rotations: readonly number[];
};

/**
 * The group copy a painted particle is of: `offset`, its place after the decorator's input; `made`, the strokes with
 * their copies made (a fiber's units: `makeFibers`), before the groups' expansion. A copy ungrouped (its path in its
 * stroke's `split`) is its members: the particle's member if a group (the next level down), else none. None: a copy of
 * no group
 */
export function groupCopyAt(
  made: readonly Posed[],
  groups: readonly PaintGroup[] | undefined,
  offset: number,
): GroupCopy | undefined {
  if (!(offset >= 0) || !groups?.length) return undefined;
  let at = 0;
  for (let s = 0; s < made.length; ++s) {
    const st = made[s];
    const k = Math.floor(st.positions.length / 3);
    const L = st.group !== undefined ? (groupLeaves(groups, st.group)?.count ?? 0) : 1;
    if (offset >= at + k * L) {
      at += k * L;
      continue;
    }
    if (st.group === undefined) return undefined;
    const copy = Math.floor((offset - at) / L);
    const position = Vec3.fromArray(Vec3(), st.positions as number[], copy * 3);
    const rotation = Quat.normalize(Quat(), Quat.fromArray(Quat(), st.rotations as number[], copy * 4));
    let group = st.group;
    let path = `${copy}`;
    let first = at + copy * L;
    let leaf = offset - first;
    const split = st.split?.length ? new Set(st.split) : undefined;
    while (split?.has(path)) {
      const g = groups.find((x) => x.id === group);
      if (!g) return undefined;
      let acc = 0;
      let j = 0;
      for (; j < g.members.length; ++j) {
        const m = g.members[j];
        const n = m.group !== undefined ? (groupLeaves(groups, m.group)?.count ?? 0) : 1;
        if (leaf < acc + n) break;
        acc += n;
      }
      const m = g.members[j];
      if (m?.group === undefined) return undefined;
      // the member's pose: the copy's · its own
      const q = Quat.create(m.rotation[0], m.rotation[1], m.rotation[2], m.rotation[3]);
      Vec3.add(position, position, Vec3.transformQuat(Vec3(), Vec3.create(m.position[0], m.position[1], m.position[2]), rotation));
      Quat.multiply(rotation, rotation, q);
      group = m.group;
      path += `.${j}`;
      first += acc;
      leaf -= acc;
    }
    const count = groupLeaves(groups, group)?.count ?? 0;
    return { stroke: s, copy, path, group, first, count, pose: { position, rotation } };
  }
  return undefined;
}

/** The next id for a group: above every target and entity id of the list, its structures' and its groups' */
export function nextGroupId(
  list: { readonly targetInfo: ReadonlyMap<number, unknown>; readonly entityInfo?: ReadonlyMap<number, unknown> },
  taken: readonly { readonly target: number; readonly entity: number }[],
  groups: readonly PaintGroup[],
): number {
  let id = -1;
  for (const k of list.targetInfo.keys()) id = Math.max(id, k);
  for (const k of list.entityInfo?.keys() ?? []) id = Math.max(id, k);
  for (const s of taken) id = Math.max(id, s.target, s.entity);
  for (const g of groups) id = Math.max(id, g.id);
  return id + 1;
}

/**
 * A group's copy under the pointer (the paint brush's): its leaves as a list at their poses about the origin, their
 * targets, entities and compartments as `list` has them (its objects, its radii by target)
 */
export function groupCopyList(list: ParticleList, leaves: GroupLeaves): ParticleList {
  const n = leaves.count;
  const targetMapping = new Map<number, ParticleTarget>();
  for (let i = 0; i < n; ++i) {
    const o = list.targetMapping?.get(leaves.targets[i]);
    if (o) targetMapping.set(leaves.targets[i], o);
  }
  // a target's radius: its first particle's in the list (read until each leaf's target is found)
  const wanted = new Set(leaves.targets);
  const radiusOf = new Map<number, number>();
  if (list.radii) {
    for (let i = 0; i < list.count && radiusOf.size < wanted.size; ++i) {
      const t = list.targets[i];
      if (wanted.has(t) && !radiusOf.has(t)) radiusOf.set(t, list.radii[i]);
    }
  }
  return {
    ...list,
    targetMapping: targetMapping.size ? targetMapping : undefined,
    movedFrom: undefined,
    count: n,
    keys: Int32Array.from({ length: n }, (_, i) => i),
    targets: Int32Array.from(leaves.targets),
    coordinates: Float32Array.from(leaves.positions),
    rotations: Float32Array.from(leaves.rotations),
    ...(list.entities ? { entities: Int32Array.from(leaves.entities) } : {}),
    ...(list.compartments ? { compartments: Int32Array.from(leaves.compartments) } : {}),
    ...(list.radii ? { radii: Float32Array.from(leaves.targets, (t) => radiusOf.get(t) ?? 10) } : {}),
    attributes: undefined,
    fibers: undefined,
    getParticleLabel: () => 'Paint brush',
    customProperties: new CustomProperties(),
    _propertyData: Object.create(null),
  };
}
