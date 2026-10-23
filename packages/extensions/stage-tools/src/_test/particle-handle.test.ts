/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Mat4, Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import type { ParticleList } from '@molstar/model/model/particles/particle-list';
import { offsetParticles } from '@molstar/plugin/state/transforms/particles/ops';
import { offsetMatrix, particleFrame, solveEdit } from '../particle-handle.js';

// A particle's local handle: the offset that puts the particle's frame where the handle took it, whichever offset it
// edits, the others of the stack kept around it.

/** Two particles of targets 0 and 1, the second turned a quarter about z */
const list = {
  count: 2,
  coordinates: Float32Array.of(0, 0, 0, 10, 0, 0),
  rotations: Float32Array.from([...Quat.identity(), ...Quat.setAxisAngle(Quat(), Vec3.create(0, 0, 1), Math.PI / 2)]),
  targets: Int32Array.of(0, 1),
  targetInfo: new Map([
    [0, {}],
    [1, {}],
  ]),
} as unknown as ParticleList;

const close = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  for (let i = 0; i < b.length; i++) expect(a[i]).toBeCloseTo(b[i], 4);
};

describe('the particle handle', () => {
  it('solves the offset that puts a particle where the handle took it, the stack around it kept', () => {
    const stack = {
      input: list,
      // every particle up 1 along its own z, first
      offsets: [{ targets: [], translation: Vec3.create(0, 0, 1), euler: Vec3() }],
      instances: [],
    };
    // the second particle as drawn now, then taken 2 along its own y and a quarter more about its own z
    const drawn = offsetParticles(list, stack.offsets, []);
    const moved = Mat4.mul(Mat4(), particleFrame(drawn, 1), offsetMatrix([0, 2, 0], [0, 0, 90]));
    // All off: the instance's own offset is that local move
    const own = solveEdit(stack, 1, { kind: 'instance' }, moved);
    close(own.translation, [0, 2, 0]);
    close(own.euler, [0, 0, 90]);
    // and drawn with it, the particle is where the handle took it
    const after = offsetParticles(list, own.stack.offsets, own.stack.instances);
    close(particleFrame(after, 1), moved);
    // All on, its kind (target 1): a new offset after the every-particle one
    const kind = solveEdit(stack, 1, { kind: 'offset', targets: '1' }, moved);
    close(kind.translation, [0, 2, 0]);
    close(particleFrame(offsetParticles(list, kind.stack.offsets, kind.stack.instances), 1), moved);
    // the list's own (every particle): the every-particle offset edited in place, the up 1 folded in
    const all = solveEdit(stack, 1, { kind: 'offset', targets: '' }, moved);
    close(all.translation, [0, 2, 1]);
    expect(all.stack.offsets).toHaveLength(1);
    close(particleFrame(offsetParticles(list, all.stack.offsets, all.stack.instances), 1), moved);
  });
});
