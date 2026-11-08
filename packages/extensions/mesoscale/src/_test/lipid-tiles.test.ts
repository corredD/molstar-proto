/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { assignSlots, triangleVariant, variantCount } from '../lipids/assign.js';
import { parsePatchPdb } from '../lipids/patch.js';
import { icosphere, offsetSurface } from '../lipids/remesh.js';
import { bakeTileSet } from '../lipids/tiles.js';
import { closePairs, flatMesh, placeTiles, syntheticPatchPdb } from './lipid-fixtures.js';

const { text, box } = syntheticPatchPdb();
const patch = parsePatchPdb(text, { box });
const L = 60;

describe('lipid patch', () => {
  it('splits the leaflets by the heads, each lipid whole, z from its mid-plane', () => {
    expect(patch.outer.lipidHead.length).toBe(12 * 14);
    expect(patch.inner.lipidHead.length).toBe(12 * 14);
    expect([...patch.outer.species].sort()).toEqual(['CHL1', 'POPC', 'POPE']);
    // heads at ±20 around 0, mid-planes at ±(20 + the atoms' mean pull) / 2: the outer above, the inner below
    expect(patch.outer.offset).toBeGreaterThan(0);
    expect(patch.inner.offset).toBeLessThan(0);
    expect(patch.outer.reach).toBeGreaterThan(1.75);
    expect(patch.outer.reach).toBeLessThan(4);
    expect(patch.outer.areaPerLipid).toBeCloseTo((box[0] * box[1]) / (12 * 14), 3);
  });
});

describe('lipid tile set', () => {
  const kinds = { edgeTypes: 1, vertexColors: 1, variants: 2, seed: 3 };
  const set = bakeTileSet(patch.outer, { edge: L, ...kinds });
  const mesh = flatMesh(L, 4);
  const slots = assignSlots(kinds, mesh.indices);
  const placed = placeTiles(kinds, L, set.variants, mesh, (t) => slots.variant[t]);

  it('has the variants of its kinds, each with lipids', () => {
    expect(set.variants.length).toBe(variantCount(kinds));
    for (const v of set.variants) expect(v.lipidSpecies.length).toBeGreaterThan(10);
    expect(slots.variant[5]).toBe(triangleVariant(kinds, 5, mesh.indices[15], mesh.indices[16], mesh.indices[17]));
  });

  it('tiles a flat plane with no atom pair under 2 Å, across seams or within a tile', () => {
    const pairs = closePairs(placed.atoms, placed.atomLipid, placed.atomTile, 2);
    expect(pairs.across).toBe(0);
    expect(pairs.within).toBe(0);
  });

  // medium: 2 s (25,000 lipids, their atom pairs); the flat plane above is its quick representative
  it('tiles a sphere (R 300 Å, curved) with few atom pairs under 2 Å across seams: a measured bound, not 0', {
    tags: ['medium'],
  }, () => {
    // review S7: the brief's "measured on curved". Tiles bent over a sphere overlap a little at their seams (the bands
    // are flat chords); 2% of the lipids at R 300 Å, L 60 Å (progress file, Numbers). The bound keeps it from growing.
    const sphere = offsetSurface(icosphere(300, L), set.offset);
    const s = assignSlots(kinds, sphere.indices);
    const p = placeTiles(kinds, L, set.variants, sphere, (t) => s.variant[t]);
    const pairs = closePairs(p.atoms, p.atomLipid, p.atomTile, 2);
    const lipids = p.atomLipid[p.atomLipid.length - 1] + 1;
    expect(lipids).toBeGreaterThan(10000);
    expect(pairs.across / lipids).toBeLessThan(0.03);
  });

  it('owns each lipid once: no two heads on one spot', () => {
    const heads = new Set<string>();
    let duplicates = 0;
    for (let l = 0, a = 0; a < placed.atoms.length / 3; ++a) {
      if (placed.atomLipid[a] !== l) continue;
      const k = `${placed.atoms[a * 3].toFixed(1)},${placed.atoms[a * 3 + 1].toFixed(1)}`;
      if (heads.has(k)) duplicates += 1;
      heads.add(k);
      l += 1;
    }
    expect(duplicates).toBe(0);
  });

  it('leaves holes of a small part of the area and keeps the patch composition', () => {
    // over the variants: lipids against the template's area at the patch's density
    const area = (Math.sqrt(3) / 4) * L * L;
    let lipids = 0;
    const bySpecies = new Map<number, number>();
    for (const v of set.variants) {
      lipids += v.lipidSpecies.length;
      for (const s of v.lipidSpecies) bySpecies.set(s, (bySpecies.get(s) ?? 0) + 1);
    }
    const holes = 1 - lipids / set.variants.length / (area / set.areaPerLipid);
    expect(holes).toBeLessThan(0.2);
    expect(holes).toBeGreaterThan(-0.02);
    const patchBySpecies = new Map<number, number>();
    for (const s of patch.outer.lipidSpecies) patchBySpecies.set(s, (patchBySpecies.get(s) ?? 0) + 1);
    for (const [s, n] of patchBySpecies) {
      const want = n / patch.outer.lipidSpecies.length;
      expect(Math.abs((bySpecies.get(s) ?? 0) / lipids - want)).toBeLessThan(0.08);
    }
  });

  it('is deterministic', () => {
    const again = bakeTileSet(patch.outer, { edge: L, ...kinds });
    expect(again.variants.map((v) => Array.from(v.positions.subarray(0, 30)))).toEqual(
      set.variants.map((v) => Array.from(v.positions.subarray(0, 30))),
    );
  });
});
