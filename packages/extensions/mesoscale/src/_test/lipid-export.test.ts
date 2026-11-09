/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Mat4 } from '@molstar/core/math/linear-algebra/3d/mat4';
import { Vec3 } from '@molstar/core/math/linear-algebra/3d/vec3';
import { cutterCounts } from '../lipids/cutter.js';
import { membraneStar, relionAngles } from '../lipids/export.js';
import { buildMembrane, forgetLipidPatch, registerLipidPatch } from '../lipids/membrane.js';
import { syntheticPatchPdb } from './lipid-fixtures.js';

// A membrane's full build at export (lipid-procedural): every lipid of every triangle a STAR row, streamed by chunks;
// RELION's angles read back by Mol*'s rule (`relionEulerToRotation`: (Rz(rot) Ry(tilt) Rz(psi))ᵀ) give the lipid's
// rotation.

/** Mol*'s STAR reader's rotation of RELION's angles (`formats/particles/star.ts`) */
function relionRotation(rot: number, tilt: number, psi: number) {
  const d = Math.PI / 180;
  const out = Mat4.mul(
    Mat4(),
    Mat4.fromRotation(Mat4(), rot * d, Vec3.unitZ),
    Mat4.mul(Mat4(), Mat4.fromRotation(Mat4(), tilt * d, Vec3.unitY), Mat4.fromRotation(Mat4(), psi * d, Vec3.unitZ)),
  );
  return Mat4.transpose(out, out);
}

describe('a membrane’s full build at export', () => {
  it('gives RELION angles Mol*’s reader turns back into the rotation', () => {
    for (const [ax, angle] of [
      [Vec3.create(1, 2, 3), 0.7],
      [Vec3.create(0, 0, 1), 1.2],
      [Vec3.create(1, 0, 0), Math.PI / 2],
      // tilt 0 and 180 (review M5: a lipid whose normal is -z read back flipped)
      [Vec3.create(0, 0, 1), 0.3],
      [Vec3.create(1, 0, 0), Math.PI],
      [Vec3.create(1, 1, 0), Math.PI],
    ] as const) {
      const m = Mat4.fromRotation(Mat4(), angle, Vec3.normalize(Vec3(), ax));
      const a = relionAngles(m, 0, { rot: 0, tilt: 0, psi: 0 });
      const back = relionRotation(a.rot, a.tilt, a.psi);
      for (let i = 0; i < 16; ++i) expect(back[i]).toBeCloseTo(m[i], 5);
    }
  });

  it('writes every lipid of every triangle once, by chunks, a hidden species left out', () => {
    registerLipidPatch('export-patch', syntheticPatchPdb().text);
    const data = buildMembrane(
      { radius: 200, center: Vec3.zero() },
      'export-patch',
      60,
      'both',
      {
        edgeTypes: 1,
        vertexColors: 1,
        variants: 2,
        seed: 1,
      },
      'cutter',
    );
    if (typeof data === 'string') throw new Error(data);
    let full = 0;
    for (const l of data.cut)
      for (const n of cutterCounts(l.table, l.mesh.positions, l.mesh.indices, l.regions)) full += n;
    const chunks = [...membraneStar(data, new Set(), 16)];
    expect(chunks.length).toBeGreaterThan(2);
    const rows = chunks.slice(1).join('').trim().split('\n');
    expect(rows.length).toBe(full);
    // a row: x y z rot tilt psi class species conformer leaflet triangle lipid
    expect(rows[0].split(' ').length).toBe(12);
    const species = data.cut[0].table.species[0];
    const without = [...membraneStar(data, new Set([species]), 16)].slice(1).join('').trim().split('\n');
    expect(without.length).toBeLessThan(full);
    expect(without.some((r) => r.split(' ')[7] === species)).toBe(false);
    forgetLipidPatch('export-patch');
  });
});
