/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Quat, Vec3 } from '@molstar/core/math/linear-algebra';
import { FiberBankHelix, FiberBankLetters, fiberUnitSites } from '../fiber-units.js';
import { makeFiber } from '../paint.js';

// The frame of the bank's units (progress/2026-11-08-paint.md, Round 5): placed by a fibre along z at the bank's
// helix, they land on their sources' atoms (the P atoms below, from the cellPACK files).

/** Site `s` of the unit `key` at point `i` of the fibre `f` */
function placed(f: { positions: number[]; rotations: number[] }, i: number, key: string, s: number): Vec3 {
  const u = fiberUnitSites(key)!;
  const q = Quat.create(f.rotations[i * 4], f.rotations[i * 4 + 1], f.rotations[i * 4 + 2], f.rotations[i * 4 + 3]);
  const p = Vec3.transformQuat(Vec3(), Vec3.fromArray(Vec3(), u.positions, s * 3), q);
  return Vec3.add(p, p, Vec3.fromArray(Vec3(), f.positions, i * 3));
}

const along = (n: number) => [0, 0, 0, 0, 0, FiberBankHelix.rise * (n - 1)];
const settings = { ...FiberBankHelix, jitter: 0, axis: 'z' as const, offset: 0 };
const z = Vec3.create(0, 0, 1);

describe('fibre units (Round 5)', () => {
  it("places RNA's U, A, C, G as their source strand (residues 2 to 5): forward +z, 36° a step", () => {
    const f = makeFiber(along(4), settings, z, 0);
    // the source's P atoms; the strand's first (U, residue 2) at -58.2° and z 1.239
    const source = [
      [4.728, -7.626, 1.239],
      [8.308, -3.39, 4.619],
      [8.714, 2.14, 7.999],
      [5.792, 6.854, 11.379],
    ];
    const turn = Quat.setAxisAngle(Quat(), z, (-58.2017 * Math.PI) / 180);
    for (const [i, letter] of ['U', 'A', 'C', 'G'].entries()) {
      const p = Vec3.transformQuat(Vec3(), placed(f, i, FiberBankLetters.rna[letter], 0), turn);
      p[2] += 1.239;
      for (let c = 0; c < 3; ++c) expect(p[c]).toBeCloseTo(source[i][c], 2);
    }
  });

  it("places DNA's pairs as the source's turn (ATGC: AT, TA, GC, CG), its first strand forward", () => {
    const f = makeFiber(along(4), settings, z, 0);
    // DNA_oneTurn.pdb's strand A P atoms, residues 1 to 4, in 3DNA's frame (the units turned 180° about y from it)
    const source = [
      [-0.356, 9.218, 1.848],
      [5.13, 7.667, -1.527],
      [8.657, 3.187, -4.902],
      [8.877, -2.51, -8.277],
    ];
    for (const [i, letter] of ['A', 'T', 'G', 'C'].entries()) {
      const p = placed(f, i, FiberBankLetters.dna[letter], 0);
      // back in 3DNA's frame: 180° about y
      const back = [-p[0], p[1], -p[2]];
      // the source's rise 3.375 or 3.38 Å a step: within 0.05 Å
      for (let c = 0; c < 3; ++c) expect(back[c]).toBeCloseTo(source[i][c], 1);
    }
  });

  it('makes each unit once, its sites with radii, elements and chains', () => {
    const at = fiberUnitSites('dna:AT')!;
    expect(fiberUnitSites('dna:AT')).toBe(at);
    expect(at.count).toBe(41);
    expect(at.chains!.labels).toEqual(['A', 'B']);
    expect(at.elements!.symbols).toContain('P');
    expect(Math.min(...at.radii)).toBeGreaterThan(0.5);
    expect(fiberUnitSites('nope')).toBeUndefined();
  });
});
