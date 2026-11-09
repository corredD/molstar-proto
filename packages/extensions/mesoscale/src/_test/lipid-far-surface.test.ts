/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { cutterRegions, cutterTable, eachHit, emptyCut, hitAffine, triangleCut } from '../lipids/cutter.js';
import { farSurface, headOffset } from '../lipids/far-surface.js';
import { parsePatchPdb } from '../lipids/patch.js';
import { flatMesh, syntheticPatchPdb } from './lipid-fixtures.js';

// A membrane's far surfaces (lipid-procedural round 4b; Ludo, 2026-11-08 on the teddy): one a leaflet at its heads, not
// one at the mid-plane; coloured by the species of the patch's heads, not one mean colour.

const { text, box } = syntheticPatchPdb();
const patch = parsePatchPdb(text, { box });

describe('a membrane’s far surfaces', () => {
  it('lies at each leaflet’s heads, facing out of it', () => {
    const outer = cutterTable(patch.outer, 2);
    const inner = cutterTable(patch.inner, 2);
    const a = headOffset(outer, 'outer');
    const b = headOffset(inner, 'inner');
    expect(a).toBeGreaterThan(5);
    expect(b).toBeLessThan(-5);
    // a flat mesh in z = 0, its normal +z: the surfaces at z = a and z = b
    const mesh = flatMesh(200, 4);
    const regions = cutterRegions(mesh.positions, mesh.indices, 1);
    for (const [table, side, offset] of [
      [outer, 'outer', a],
      [inner, 'inner', b],
    ] as const) {
      const s = farSurface(mesh, regions, table, side, offset, () => true, 20);
      const sign = Math.sign(mesh.positions[2] + 1);
      for (let v = 2; v < s.positions.length; v += 3) expect(s.positions[v]).toBeCloseTo(offset * sign, 4);
      // single-sided, facing out of its leaflet
      expect(Math.sign(s.normals[2])).toBe(side === 'outer' ? 1 : -1);
    }
  });

  it('is coloured by the heads’ species in their proportions, a hidden one left out', () => {
    const table = cutterTable(patch.outer, 2);
    const mesh = flatMesh(400, 4);
    const regions = cutterRegions(mesh.positions, mesh.indices, 1);
    const all = farSurface(mesh, regions, table, 'outer', 0, () => true, 4);
    const counts = new Map<number, number>();
    for (const s of all.species) counts.set(s, (counts.get(s) ?? 0) + 1);
    expect(counts.has(-1)).toBe(false);
    expect(counts.size).toBe(table.species.length);
    expect(counts.size).toBeGreaterThan(1);
    const without = farSurface(mesh, regions, table, 'outer', 0, (s) => s !== 0, 4);
    expect(without.species.includes(0)).toBe(false);
  });

  it('is coloured where the lipids are: a point the species of the nearest cut head (round 4b item 4: by cell)', () => {
    // the far look the near look blurred: its colours where the cutter puts the species, on triangles larger than the
    // box too, where each cell turns the patch its own way
    const table = cutterTable(patch.outer, 2);
    const mesh = flatMesh(400, 2);
    const regions = cutterRegions(mesh.positions, mesh.indices, 1);
    const heads: number[] = [];
    const species: number[] = [];
    const cut = emptyCut();
    const affine = new Float32Array(16);
    for (let t = 0; t < mesh.indices.length / 3; ++t) {
      if (!triangleCut(mesh.positions, mesh.indices, t, regions, table.box, cut)) continue;
      for (let m = 0; m < table.members.length; ++m) {
        eachHit(table, cut, m, (l, x, y) => {
          hitAffine(table, cut, l, x, y, affine, 0);
          heads.push(affine[12], affine[13]);
          species.push(table.members[m].species);
        });
      }
    }
    const s = farSurface(mesh, regions, table, 'outer', 0, () => true, 8);
    let same = 0;
    let n = 0;
    // the vertices away from the plane's border
    for (let v = 0; v < s.species.length; v += 7) {
      const x = s.positions[v * 3];
      const y = s.positions[v * 3 + 1];
      if (x < 300 || x > 700 || y < 50 || y > 300) continue;
      let best = Infinity;
      let nearest = -1;
      for (let h = 0; h < species.length; ++h) {
        const d = (heads[h * 2] - x) ** 2 + (heads[h * 2 + 1] - y) ** 2;
        if (d < best) {
          best = d;
          nearest = species[h];
        }
      }
      n += 1;
      if (nearest === s.species[v]) same += 1;
    }
    expect(n).toBeGreaterThan(200);
    expect(same / n).toBeGreaterThan(0.9);
  });
});
