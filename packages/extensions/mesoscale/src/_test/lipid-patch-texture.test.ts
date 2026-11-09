/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import {
  cellSide,
  cutterRegions,
  cutterTable,
  eachCellHit,
  emptyCut,
  hitAffine,
  triangleCut,
} from '../lipids/cutter.js';
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
    const outer = patchSurface(mesh, regions, 'outer', 20);
    const inner = patchSurface(mesh, regions, 'inner', -20);
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

  it('maps each lipid’s point to the lipid: the surface over a head reads its patch point (review S2: no slide)', () => {
    // a curved mesh: the vertex normals differ from the triangles' and the triangles' from their regions'
    const mesh = icosphere(500, 100);
    const regions = cutterRegions(mesh.positions, mesh.indices, 1);
    const table = cutterTable(leaflets.outer, 2);
    const T = mesh.indices.length / 3;
    const lift = 20;
    const f = patchSurface(mesh, regions, 'outer', lift);
    const g = regions.table;
    const cut = emptyCut();
    const affine = new Float32Array(16);
    const C = cellSide(table.box);
    const errors: number[] = [];
    for (let t = 0; t < T; t += 2) {
      if (!triangleCut(mesh.positions, mesh.indices, t, regions, table.box, cut)) continue;
      const r = cut.region * 16;
      // the lifted triangle as drawn: its corners and their shifts
      const S = [0, 1, 2].map((k) => Array.from(f.positions.subarray((t * 3 + k) * 3, (t * 3 + k + 1) * 3)));
      const sh = [0, 1, 2].map((k) => [f.shifts[(t * 3 + k) * 2], f.shifts[(t * 3 + k) * 2 + 1]]);
      const u = [0, 1, 2].map((j) => S[1][j] - S[0][j]);
      const v = [0, 1, 2].map((j) => S[2][j] - S[0][j]);
      const cx = Math.floor(cut.pmin[0] / C);
      const cy = Math.floor(cut.pmin[1] / C);
      for (let x = cx; x <= Math.floor(cut.pmax[0] / C); ++x) {
        for (let y = cy; y <= Math.floor(cut.pmax[1] / C); ++y) {
          eachCellHit(table, cut, x, y, 0, (l, qx, qy, owned) => {
            if (!owned) return;
            hitAffine(table, cut, l, qx, qy, affine, 0);
            // the lipid on its triangle, and up its normal onto the drawn surface: X + h n = S0 + a u + b v
            const X = [affine[12], affine[13], affine[14]];
            const n = [affine[8], affine[9], affine[10]];
            const w = [0, 1, 2].map((j) => X[j] - S[0][j]);
            // Cramer on [u v −n] (a b h) = w
            const det = (p: number[], q: number[], s: number[]) =>
              p[0] * (q[1] * s[2] - q[2] * s[1]) -
              p[1] * (q[0] * s[2] - q[2] * s[0]) +
              p[2] * (q[0] * s[1] - q[1] * s[0]);
            const m = n.map((c) => -c);
            const d = det(u, v, m);
            const a = det(w, v, m) / d;
            const b = det(u, w, m) / d;
            const P = [0, 1, 2].map((j) => S[0][j] + a * u[j] + b * v[j]);
            // the shader's point: the drawn point in its region's plane, plus its shift interpolated
            const dx = [0, 1, 2].map((j) => P[j] - g[r + j]);
            const sx = (1 - a - b) * sh[0][0] + a * sh[1][0] + b * sh[2][0];
            const sy = (1 - a - b) * sh[0][1] + a * sh[1][1] + b * sh[2][1];
            const px = dx[0] * g[r + 4] + dx[1] * g[r + 5] + dx[2] * g[r + 6] + sx;
            const py = dx[0] * g[r + 8] + dx[1] * g[r + 9] + dx[2] * g[r + 10] + sy;
            errors.push(Math.hypot(px - qx, py - qy));
          });
        }
      }
    }
    errors.sort((a, b) => a - b);
    expect(errors.length).toBeGreaterThan(1000);
    // a lipid's spacing is ~8 Å: the slide was ~5 Å at the median (lift 20 Å along the vertex normal)
    expect(errors[errors.length >> 1], 'median Å').toBeLessThan(0.05);
    expect(errors[errors.length - 1], 'max Å').toBeLessThan(0.2);
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
