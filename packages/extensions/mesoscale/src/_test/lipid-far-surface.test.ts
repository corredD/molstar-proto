/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { cutterRegions, cutterTable } from '../lipids/cutter.js';
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
});
