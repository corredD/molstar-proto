/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { compile } from '@molstar/meso-spec/runtime/runtime';
import { DefaultResolvers } from '@molstar/meso-spec/resolvers/index';
import { exosomeDoc, ExosomeResources } from '@molstar/meso-spec/examples/exosome';
import { placementSets } from '@molstar/meso-spec/ir/ir';
import { syntheticPicksStar } from '@molstar/meso-spec/examples/fixtures/synthetic';
import { readStar } from '@molstar/meso-spec/runtime/readers';
import { relionQuat } from '@molstar/meso-spec/resolvers/precomputed';
import { MVSData } from '@molstar/mvs-builder';
import { irToMolViewSpec } from '../mvs-export.js';
import { toParticleList } from '../particle-list.js';

// The adapter's pure parts, in the quick lane: the particle list over the IR's buffers, the MolViewSpec export.

describe('the Mol* side, without a viewer', () => {
  it('a particle list shares the placement buffers; it adds a radius and a key a copy', async () => {
    const r = await compile(exosomeDoc(), { resolvers: DefaultResolvers, load: (id) => ExosomeResources[id]?.() });
    const s = placementSets(r.ir!)[1];
    const l = toParticleList(s, 'x');
    expect(l.coordinates).toBe(s.positions);
    expect(l.rotations).toBe(s.rotations);
    expect(l.targets).toBe(s.types);
    expect(l.radii!.byteLength + l.keys.byteLength).toBe(8 * s.count);
    expect(l.radii![0]).toBe(s.typeTable[s.types[0]].radius);
  });

  it('the IR compiles to valid MolViewSpec: one primitives group per type, the copies as instances', async () => {
    const r = await compile(exosomeDoc(), { resolvers: DefaultResolvers, load: (id) => ExosomeResources[id]?.() });
    const { data, copies } = irToMolViewSpec(r.ir!);
    expect(MVSData.validationIssues(data)).toBeUndefined();
    const visible = placementSets(r.ir!).reduce((n, s) => n + s.count, 0);
    expect(copies).toBe(visible);
    const bytes = JSON.stringify(data).length;
    // the measured cost of the MVS path, for the design doc (§6.6)
    expect(bytes / copies).toBeGreaterThan(60);
  });

  it("STAR angles: the precomputed resolver's rotation is Mol*'s reader's (packages/model formats/particles/star.ts)", () => {
    // against the formula Mol*'s reader documents (`relionEulerToRotation`): (Rz(rot) Ry(tilt) Rz(psi))ᵀ
    const table = [...readStar(syntheticPicksStar()).values()][0];
    const row = table.rows[0];
    const [rot, tilt, psi] = [4, 5, 6].map((i) => Number(row[i]));
    const q = relionQuat([0, 0, 0, 0], rot, tilt, psi);
    // the matrix of q, against Rᵀ built from Euler matrices
    const R = (a: number, axis: 'y' | 'z') => {
      const c = Math.cos((a * Math.PI) / 180), s = Math.sin((a * Math.PI) / 180);
      return axis === 'z' ? [[c, -s, 0], [s, c, 0], [0, 0, 1]] : [[c, 0, s], [0, 1, 0], [-s, 0, c]];
    };
    const mul = (a: number[][], b: number[][]) => a.map((r) => [0, 1, 2].map((j) => r.reduce((s, x, k) => s + x * b[k][j], 0)));
    const M = mul(mul(R(rot, 'z'), R(tilt, 'y')), R(psi, 'z'));
    const [x, y, z, w] = q;
    const Q = [
      [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
      [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
      [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(Q[i][j]).toBeCloseTo(M[j][i], 6);
  });
});
