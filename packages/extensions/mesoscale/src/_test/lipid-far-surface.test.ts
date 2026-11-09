/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { cutterRegions, cutterTable, eachHit, emptyCut, hitAffine, triangleCut } from '../lipids/cutter.js';
import { farSurface, headOffset } from '../lipids/far-surface.js';
import { random01 } from '../lipids/assign.js';
import { parsePatchPdb } from '../lipids/patch.js';
import { icosphere } from '../lipids/remesh.js';
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

  it('leaves every lipid’s head above it, near the heads (gate: Both close up, the surface hid half the lipids)', () => {
    // at the mean of the conformers' tops, 23 of the CHARMM-GUI patch's 40 outer conformers had their top under the
    // surface: drawn beneath them in Both, it hid them close up. Every top at or above it, and still at the heads
    // lipids at heights up to ±4 Å apart, as a real patch's (the synthetic one's heads are all at ±20 Å)
    const rough = parsePatchPdb(
      text
        .split('\n')
        .map((l) => {
          const dz = (random01(3, +l.substring(22, 26)) - 0.5) * 8;
          const z = +l.substring(46, 54);
          return `${l.substring(0, 46)}${(z + Math.sign(z) * dz).toFixed(3).padStart(8)}${l.substring(54)}`;
        })
        .join('\n'),
      { box },
    );
    for (const side of ['outer', 'inner'] as const) {
      const table = cutterTable(rough[side], 4);
      const h = headOffset(table, side);
      const f = side === 'outer' ? 1 : -1;
      let mean = 0;
      for (const m of table.members) {
        let top = -Infinity;
        for (let i = 2; i < m.positions.length; i += 3) top = Math.max(top, f * m.positions[i]);
        expect(top).toBeGreaterThanOrEqual(f * h);
        mean += top / table.members.length;
      }
      expect(mean - f * h).toBeLessThan(8);
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
    // a point on an edge between two regions (welded, review S6) takes its first triangle's colour: about 1 in 9 here
    expect(same / n).toBeGreaterThan(0.85);
  });

  it('is closed where its mesh is and holds its vertex cap (review S1, S6: cracks at T-junctions, 3 vertices a triangle)', () => {
    const table = cutterTable(patch.outer, 2);
    // a bumpy sphere: triangles of different sizes, creases
    const mesh = icosphere(300, 40);
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const f = 1 + 0.25 * Math.sin(mesh.positions[i] / 37) * Math.cos(mesh.positions[i + 1] / 53);
      for (let k = 0; k < 3; ++k) mesh.positions[i + k] *= f;
    }
    const regions = cutterRegions(mesh.positions, mesh.indices, 1);
    const s = farSurface(mesh, regions, table, 'outer', 20, () => true, 8);
    // every edge of the surface in two triangles, its vertices welded
    const edges = new Map<string, number>();
    for (let t = 0; t < s.indices.length; t += 3) {
      for (let k = 0; k < 3; ++k) {
        const a = s.indices[t + k];
        const b = s.indices[t + ((k + 1) % 3)];
        const key = a < b ? `${a} ${b}` : `${b} ${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    expect([...edges.values()].filter((n) => n !== 2).length).toBe(0);
    // its cap: never past it (the mesh's own vertices at least)
    const capped = farSurface(mesh, regions, table, 'outer', 20, () => true, 1, 3000);
    expect(capped.positions.length / 3).toBeLessThanOrEqual(3000);
    expect(capped.positions.length / 3).toBeGreaterThanOrEqual(mesh.positions.length / 3);
  });

  it('meets the spheres it takes over from at their tops: no step at the switch (round 4c item 7)', () => {
    // the coarse level: one sphere a lipid, its first atom (the head), grown to 9 Å
    const table = cutterTable(patch.outer, 2);
    const top = { atoms: table.members.map((m) => m.positions.slice(0, 3)), radius: 9 };
    const mesh = flatMesh(200, 4);
    const regions = cutterRegions(mesh.positions, mesh.indices, 1);
    const s = farSurface(mesh, regions, table, 'outer', headOffset(table, 'outer'), () => true, 20, undefined, top);
    // the heads at 20 Å, the spheres' tops at 29 Å over each head, lower between: the surface between, not under the
    // heads (where the outline and the shadows drew the step as a line along the triangles: the probe, round 4c)
    expect(s.positions[2]).toBeGreaterThan(22);
    expect(s.positions[2]).toBeLessThan(29);
  });
});
