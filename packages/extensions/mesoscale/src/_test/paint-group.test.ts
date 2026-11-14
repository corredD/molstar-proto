/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Mat3, Mat4, Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import { expandGroups, groupCopyAt, groupLeaves, makeGroup, type GroupPick, type PaintGroup } from '../paint-group.js';
import { type PaintStroke, paintParticles, strokeCounts } from '../paint.js';
import { cellpackLike } from './fixtures.js';

// The group model (progress/2026-11-13-paint-group.md): a group's frame from its members, its members' poses relative
// to it, expanded to its leaves wherever a copy of it is painted.

const q = (axis: [number, number, number], deg: number) =>
  Quat.setAxisAngle(Quat(), Vec3.normalize(Vec3(), Vec3.create(...axis)), (deg * Math.PI) / 180);

const pick = (target: number, p: [number, number, number], r: Quat, over: Partial<GroupPick> = {}): GroupPick => ({
  target,
  entity: target,
  compartment: 1,
  position: p,
  rotation: [r[0], r[1], r[2], r[3]],
  radius: 5,
  ...over,
});

/** A flat cluster of three copies in the plane z = 4, each turned its own way */
const three = () => [
  pick(1, [10, 0, 4], q([0, 0, 1], 30)),
  pick(2, [-5, 8, 4], q([1, 1, 0], 70)),
  pick(1, [-5, -8, 4], q([0, 1, 0], 120)),
];

/** Two orientations the same up to sign */
function sameTurn(a: ArrayLike<number>, b: ArrayLike<number>, eps = 1e-5) {
  const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  expect(d).toBeGreaterThan(1 - eps);
}

/** Every member of a group painted at `pose` as `paintParticles` makes it: the leaves' poses */
function painted(groups: PaintGroup[], id: number, pose: { position: Vec3; rotation: Quat }) {
  const stroke: PaintStroke = {
    target: id,
    entity: id,
    compartment: -1,
    group: id,
    positions: [pose.position[0], pose.position[1], pose.position[2]],
    rotations: [pose.rotation[0], pose.rotation[1], pose.rotation[2], pose.rotation[3]],
  };
  const list = { ...cellpackLike(), entities: cellpackLike().targets };
  return { list, out: paintParticles(list, [stroke], undefined, undefined, groups) };
}

describe('makeGroup', () => {
  it("frames the members: center their centroid, +z the smallest axis, right-handed, radius their bounds'", () => {
    const { group, pose } = makeGroup(7, 'Group 1', three());
    expect(Array.from(pose.position)).toEqual([0, 0, 4].map((x) => expect.closeTo(x, 5)));
    const m = Mat3.fromMat4(Mat3(), Mat4.fromQuat(Mat4(), pose.rotation));
    // a right-handed frame: no member mirrored
    expect(Mat3.determinant(m)).toBeCloseTo(1, 6);
    // the cluster is flat in z = 4: its smallest axis is ±z, and +z the way its members' +z go on average
    const z = Vec3.transformQuat(Vec3(), Vec3.create(0, 0, 1), pose.rotation);
    expect(Math.abs(z[2])).toBeCloseTo(1, 5);
    expect(group.radius).toBeCloseTo(10 + 5, 5);
    expect(group.members.length).toBe(3);
    for (const mem of group.members) expect(Math.abs(mem.position[2])).toBeLessThan(1e-5);
  });

  it("reproduces the picked poses exactly when painted at the group's own pose", () => {
    const picks = three();
    const { group, pose } = makeGroup(7, 'Group 1', picks);
    const { list, out } = painted([group], 7, pose);
    expect(out.count).toBe(list.count + 3);
    for (let i = 0; i < 3; ++i) {
      const at = list.count + i;
      expect(out.targets[at]).toBe(picks[i].target);
      expect(out.entities![at]).toBe(picks[i].entity);
      expect(out.compartments![at]).toBe(1);
      for (let c = 0; c < 3; ++c) expect(out.coordinates[at * 3 + c]).toBeCloseTo(picks[i].position[c], 4);
      sameTurn(out.rotations!.slice(at * 4, at * 4 + 4), picks[i].rotation);
    }
  });

  it('puts every member at P · its relative pose when painted at a pose P', () => {
    const { group } = makeGroup(7, 'Group 1', three());
    const P = { position: Vec3.create(100, -20, 3), rotation: q([1, 2, 3], 77) };
    const { list, out } = painted([group], 7, P);
    group.members.forEach((m, i) => {
      const at = list.count + i;
      const want = Vec3.add(
        Vec3(),
        Vec3.transformQuat(Vec3(), Vec3.create(m.position[0], m.position[1], m.position[2]), P.rotation),
        P.position,
      );
      for (let c = 0; c < 3; ++c) expect(out.coordinates[at * 3 + c]).toBeCloseTo(want[c], 4);
      const turn = Quat.multiply(Quat(), P.rotation, Quat.create(m.rotation[0], m.rotation[1], m.rotation[2], m.rotation[3]));
      sameTurn(out.rotations!.slice(at * 4, at * 4 + 4), turn);
    });
  });

  it('frames one member at its own pose and two along their line, right-handed both', () => {
    const one = makeGroup(1, 'One', [pick(1, [3, 4, 5], q([0, 1, 0], 40))]);
    expect(Array.from(one.pose.position)).toEqual([3, 4, 5]);
    expect(one.group.radius).toBe(5);
    const { list, out } = painted([one.group], 1, one.pose);
    for (let c = 0; c < 3; ++c) expect(out.coordinates[list.count * 3 + c]).toBeCloseTo([3, 4, 5][c], 5);

    const two = makeGroup(2, 'Two', [pick(1, [0, 0, 0], Quat.identity()), pick(2, [10, 0, 0], Quat.identity())]);
    const x = Vec3.transformQuat(Vec3(), Vec3.create(1, 0, 0), two.pose.rotation);
    expect(Math.abs(x[0])).toBeCloseTo(1, 5);
    expect(Mat3.determinant(Mat3.fromMat4(Mat3(), Mat4.fromQuat(Mat4(), two.pose.rotation)))).toBeCloseTo(1, 6);
    // their +z the members' own (identity: +z)
    const z = Vec3.transformQuat(Vec3(), Vec3.create(0, 0, 1), two.pose.rotation);
    expect(z[2]).toBeCloseTo(1, 5);
  });
});

describe('nesting', () => {
  it('expands a group of groups to its leaves, each at the composed pose', () => {
    const inner = makeGroup(7, 'Group 1', three());
    // two copies of the inner group and one leaf, picked where they are
    const P1 = { position: Vec3.create(50, 0, 0), rotation: q([0, 0, 1], 90) };
    const P2 = { position: Vec3.create(-50, 0, 0), rotation: q([1, 0, 0], 180) };
    const outer = makeGroup(8, 'Group 2', [
      pick(7, [P1.position[0], P1.position[1], P1.position[2]], P1.rotation, { group: 7, radius: inner.group.radius }),
      pick(7, [P2.position[0], P2.position[1], P2.position[2]], P2.rotation, { group: 7, radius: inner.group.radius }),
      pick(3, [0, 40, 0], Quat.identity()),
    ]);
    const groups = [inner.group, outer.group];
    expect(groupLeaves(groups, 8)!.count).toBe(7);
    const { list, out } = painted(groups, 8, outer.pose);
    expect(out.count).toBe(list.count + 7);
    // the first inner copy's leaves where the inner group painted at P1 puts them
    const alone = painted([inner.group], 7, P1).out;
    for (let i = 0; i < 3; ++i) {
      expect(out.targets[list.count + i]).toBe(alone.targets[list.count + i]);
      for (let c = 0; c < 3; ++c) {
        expect(out.coordinates[(list.count + i) * 3 + c]).toBeCloseTo(alone.coordinates[(list.count + i) * 3 + c], 3);
      }
    }
    expect(out.targets[list.count + 6]).toBe(3);
    for (let c = 0; c < 3; ++c) expect(out.coordinates[(list.count + 6) * 3 + c]).toBeCloseTo([0, 40, 0][c], 3);
  });
});

describe('expandGroups and groupCopyAt', () => {
  it("counts a group stroke's copies times its leaves and finds the copy of each painted particle", () => {
    const { group, pose } = makeGroup(7, 'Group 1', three());
    const stroke: PaintStroke = {
      target: 7,
      entity: 7,
      compartment: -1,
      group: 7,
      positions: [0, 0, 0, 100, 0, 0],
      rotations: [0, 0, 0, 1, pose.rotation[0], pose.rotation[1], pose.rotation[2], pose.rotation[3]],
    };
    const plain: PaintStroke = { target: 1, entity: 1, compartment: 1, positions: [1, 1, 1], rotations: [0, 0, 0, 1] };
    const list = { ...cellpackLike(), entities: cellpackLike().targets };
    expect(strokeCounts(list, [plain, stroke], undefined, undefined, [group])).toEqual([1, 6]);
    expect(expandGroups([stroke], [group])[0].positions.length).toBe(18);
    expect(groupCopyAt([plain, stroke], [group], 0)).toBeUndefined();
    expect(groupCopyAt([plain, stroke], [group], 1)).toMatchObject({ stroke: 1, copy: 0, first: 1, count: 3, group: 7 });
    expect(groupCopyAt([plain, stroke], [group], 6)).toMatchObject({ stroke: 1, copy: 1, first: 4, count: 3 });
    expect(groupCopyAt([plain, stroke], [group], 7)).toBeUndefined();
  });
});
