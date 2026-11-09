/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { cutterRegions, cutterTable } from '../lipids/cutter.js';
import { PatchTexels, patchRaster, patchSurface } from '../lipids/far-surface.js';
import { parsePatchPdb } from '../lipids/patch.js';
import { icosphere } from '../lipids/remesh.js';
import { syntheticPatchPdb } from './lipid-fixtures.js';

// The far look as a texture (lipid-procedural round 5): the surface is the mesh's own triangles (O(triangles), whatever
// the lipids), each vertex its triangle's region as its group (the shader maps the patch by it); the texture is the patch
// seen from its leaflet's side, a species' colour per texel in about its share of the heads.

const { text, box } = syntheticPatchPdb();
const leaflets = parsePatchPdb(text, { box });

describe('the patch texture surface', () => {
  it('is the mesh’s triangles, three vertices each, lifted along the normals, facing its leaflet’s side', () => {
    const mesh = icosphere(500, 100);
    const regions = cutterRegions(mesh.positions, mesh.indices, 1);
    const T = mesh.indices.length / 3;
    const outer = patchSurface(mesh, regions.regionOf, 'outer', 20);
    const inner = patchSurface(mesh, regions.regionOf, 'inner', -20);
    expect(outer.positions.length).toBe(T * 9);
    for (let t = 0; t < T; t += 37) {
      for (let k = 0; k < 3; ++k) {
        const v = t * 3 + k;
        expect(outer.groups[v]).toBe(regions.regionOf[t]);
        const r = Math.hypot(outer.positions[v * 3], outer.positions[v * 3 + 1], outer.positions[v * 3 + 2]);
        expect(r).toBeCloseTo(520, 0);
        const ri = Math.hypot(inner.positions[v * 3], inner.positions[v * 3 + 1], inner.positions[v * 3 + 2]);
        expect(ri).toBeCloseTo(480, 0);
        // the inner one's normals inward
        const dot =
          inner.normals[v * 3] * inner.positions[v * 3] +
          inner.normals[v * 3 + 1] * inner.positions[v * 3 + 1] +
          inner.normals[v * 3 + 2] * inner.positions[v * 3 + 2];
        expect(dot).toBeLessThan(0);
      }
      // the inner winding flipped
      expect(inner.indices[t * 3 + 1]).toBe(outer.indices[t * 3 + 2]);
    }
  });

  it('is the patch from above, each species in about its share of the heads, a hidden one left out', () => {
    const table = cutterTable(leaflets.outer, 2);
    const colors = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0x00ffff, 0xff00ff];
    const top = { atoms: table.members.map((m) => m.positions), radii: table.members.map(() => 1.5) };
    const raster = patchRaster(
      table,
      () => true,
      'outer',
      (s) => colors[s % colors.length],
      top,
    );
    expect(raster.width).toBe(PatchTexels);
    expect(raster.mean).toBeGreaterThan(0);
    // per species: the texels whose hue is its colour's
    const S = table.species.length;
    const texels = new Array(S).fill(0);
    const heads = new Array(S).fill(0);
    for (let m = 0; m < table.members.length; ++m)
      heads[table.members[m].species] += table.memberStart[m + 1] - table.memberStart[m];
    const hue = (o: number, c: number) =>
      raster.array[o] > 0 === ((c >> 16) & 255) > 0 &&
      raster.array[o + 1] > 0 === ((c >> 8) & 255) > 0 &&
      raster.array[o + 2] > 0 === (c & 255) > 0;
    for (let o = 0; o < raster.array.length; o += 4) {
      for (let s = 0; s < S; ++s) if (hue(o, colors[s % colors.length])) texels[s] += 1;
    }
    const all = heads.reduce((a, b) => a + b, 0);
    const n = raster.width * raster.height;
    for (let s = 0; s < S; ++s) expect(Math.abs(texels[s] / n - heads[s] / all)).toBeLessThan(0.15);
    // species 0 hidden: none of its colour
    const hidden = patchRaster(
      table,
      (s) => s !== 0,
      'outer',
      (s) => colors[s % colors.length],
      top,
    );
    let red = 0;
    for (let o = 0; o < hidden.array.length; o += 4)
      if (hidden.array[o] > 0 && hidden.array[o + 1] === 0 && hidden.array[o + 2] === 0) red += 1;
    expect(red).toBe(0);
  });
});
