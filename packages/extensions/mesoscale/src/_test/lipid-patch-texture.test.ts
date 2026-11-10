/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { mesh_wgsl } from '@molstar/graphics/gl/webgpu/shader/mesh.wgsl';
import {
  CellKinds,
  type CutterTable,
  cellSide,
  cutterRegions,
  cutterTable,
  eachCellHit,
  emptyCut,
  hitAffine,
  triangleCut,
} from '../lipids/cutter.js';
import { PatchTexels, patchRaster, patchSurface } from '../lipids/far-surface.js';
import { patchTableArray } from '../lipids/membrane.js';
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

  it('maps as the cutter does, in the shader’s f32: each lipid’s point reads its own head (review S1: a drift guard)', () => {
    // the shader's map (`mesh.wgsl.ts`, `patchColor`) ported: its hash chain and mask, which the source must hold
    expect(mesh_wgsl).toContain('x = x * 0x7feb352du;');
    expect(mesh_wgsl).toContain('x = x * 0x846ca68bu;');
    expect(mesh_wgsl).toContain('patchHash(u32(g3.x) ^ patchHash(cx ^ patchHash(cy))) & 4095u');
    expect(CellKinds).toBe(4096);
    const f = Math.fround;
    const hash = (x: number) => {
      x = (x ^ (x >>> 16)) >>> 0;
      x = Math.imul(x, 0x7feb352d) >>> 0;
      x = (x ^ (x >>> 15)) >>> 0;
      x = Math.imul(x, 0x846ca68b) >>> 0;
      return (x ^ (x >>> 16)) >>> 0;
    };
    // a patch of 300 heads, placed by a fixed sequence
    const pbox: [number, number] = [154.3, 151.7];
    const N = 300;
    const heads = new Float32Array(N * 4);
    let seed = 12345;
    const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
    for (let l = 0; l < N; ++l) heads.set([next() * pbox[0], next() * pbox[1], 1, 0], l * 4);
    const patch: CutterTable = {
      species: ['A'],
      members: [{ species: 0, positions: new Float32Array(3), elements: new Uint8Array(1) }],
      memberStart: Uint32Array.from([0, N]),
      lipids: heads,
      box: pbox,
    };
    const C = cellSide(pbox);
    // two large tilted triangles, x20 and x600 of the model's size, and x600 far from the origin
    for (const [scale, off] of [
      [20, 0],
      [600, 0],
      [600, 60000],
    ]) {
      const L = (5000 * scale) / 100;
      const positions = new Float32Array([0, 0, 0, L, 0, 0.1 * L, 0, L, 0.05 * L, L, L, 0.15 * L].map((v) => v + off));
      const indices = Uint32Array.from([0, 1, 2, 1, 3, 2]);
      const regions = cutterRegions(positions, indices, 12345);
      const g = regions.table;
      // the texture's table: a region's key over its normal's x (review X1)
      const texels = patchTableArray(regions, new Float32Array(0)).array;
      const cut = emptyCut();
      let n = 0;
      let worst = 0;
      for (let t = 0; t < 2; ++t) {
        if (!triangleCut(positions, indices, t, regions, pbox, cut)) continue;
        const r = cut.region * 16;
        for (let cx = Math.floor(cut.pmin[0] / C); cx <= Math.floor(cut.pmax[0] / C) && n < 20000; ++cx) {
          for (let cy = Math.floor(cut.pmin[1] / C); cy <= Math.floor(cut.pmax[1] / C) && n < 20000; ++cy) {
            eachCellHit(patch, cut, cx, cy, 0, (l, qx, qy, owned) => {
              if (!owned) return;
              n += 1;
              // the point on the region's plane as drawn (f32), then the shader's chain
              const w = [0, 1, 2].map((k) => f(g[r + k] + qx * g[r + 4 + k] + qy * g[r + 8 + k]));
              const d = [0, 1, 2].map((k) => f(w[k] - g[r + k]));
              const q = [
                f(d[0] * g[r + 4] + d[1] * g[r + 5] + d[2] * g[r + 6]),
                f(d[0] * g[r + 8] + d[1] * g[r + 9] + d[2] * g[r + 10]),
              ];
              const p = [
                f(g[r + 3] * pbox[0] + g[r + 11] * q[0] - g[r + 15] * q[1]),
                f(g[r + 7] * pbox[1] + g[r + 15] * q[0] + g[r + 11] * q[1]),
              ];
              const cell = [Math.floor(p[0] / C), Math.floor(p[1] / C)];
              // a head on a cell's edge may read the next cell: then its own point is a cell away, not a drift
              if (cell[0] !== cx || cell[1] !== cy) return;
              const kind = (hash((texels[r + 12] ^ hash((cell[0] >>> 0) ^ hash(cell[1] >>> 0))) >>> 0) & 4095) * 4;
              const c = regions.cells;
              const ux = p[0] - (cell[0] + 0.5) * C;
              const uy = p[1] - (cell[1] + 0.5) * C;
              const sx = c[kind] * pbox[0] + c[kind + 2] * ux - c[kind + 3] * uy;
              const sy = c[kind + 1] * pbox[1] + c[kind + 3] * ux + c[kind + 2] * uy;
              let dx = Math.abs(sx - heads[l * 4]) % pbox[0];
              dx = Math.min(dx, pbox[0] - dx);
              let dy = Math.abs(sy - heads[l * 4 + 1]) % pbox[1];
              dy = Math.min(dy, pbox[1] - dy);
              worst = Math.max(worst, Math.hypot(dx, dy));
            });
          }
        }
      }
      expect(n, `x${scale} +${off}`).toBeGreaterThan(5000);
      // a texel is 0.6 Å (154 Å over 256): the map within a few hundredths of it
      expect(worst, `x${scale} +${off}: Å`).toBeLessThan(0.05);
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
  it('carries the heads’ height in alpha: the top over each texel, normalised over [lo, hi] (round 8 §1)', () => {
    const table = cutterTable(leaflets.outer, 2);
    const top = { atoms: table.members.map((m) => m.positions), radii: table.members.map(() => 1.5) };
    for (const side of ['outer', 'inner'] as const) {
      const t = side === 'outer' ? table : cutterTable(leaflets.inner, 2);
      const tp = side === 'outer' ? top : { atoms: t.members.map((m) => m.positions), radii: t.members.map(() => 1.5) };
      const raster = patchRaster(
        t,
        () => true,
        side,
        () => 0xffffff,
        tp,
      );
      expect(raster.hi).toBeGreaterThan(raster.lo);
      expect(raster.hi - raster.lo).toBeLessThanOrEqual(12 + 1e-6);
      expect(raster.mean!).toBeGreaterThanOrEqual(raster.lo);
      expect(raster.mean!).toBeLessThanOrEqual(raster.hi);
      // brute force at a sample of texels: the highest sphere top over the texel's center, periodic
      const [bx, by] = t.box;
      const n = raster.width;
      const cell = (bx / n) * (1 + 1e-6);
      const f = side === 'outer' ? 1 : -1;
      let worst = 0;
      let covered = 0;
      expect(raster.height, side).toBe(Math.ceil(by / cell));
      // the raster's period: its cells (a box not a whole number of texels wraps at ny cells, as `topGrid` does)
      const px = n * cell;
      const py = raster.height * cell;
      for (let k = 0; k < n * raster.height; k += 97) {
        const i = k % n;
        const j = Math.floor(k / n);
        const x = (i + 0.5) * cell;
        const y = (j + 0.5) * cell;
        let h = -Infinity;
        for (let m = 0; m < t.members.length; ++m) {
          const atoms = tp.atoms[m];
          const r = tp.radii[m];
          for (let l = t.memberStart[m]; l < t.memberStart[m + 1]; ++l) {
            const c = t.lipids[l * 4 + 2];
            const s = t.lipids[l * 4 + 3];
            for (let a = 0; a < atoms.length; a += 3) {
              const ax = t.lipids[l * 4] + c * atoms[a] - s * atoms[a + 1];
              const ay = t.lipids[l * 4 + 1] + s * atoms[a] + c * atoms[a + 1];
              let dx = Math.abs(ax - x) % px;
              let dy = Math.abs(ay - y) % py;
              dx = Math.min(dx, px - dx);
              dy = Math.min(dy, py - dy);
              const d = r * r - dx * dx - dy * dy;
              if (d >= 0) h = Math.max(h, f * atoms[a + 2] + Math.sqrt(d));
            }
          }
        }
        const want = h === -Infinity ? 0 : Math.min(1, Math.max(0, (h - raster.lo) / (raster.hi - raster.lo)));
        if (h !== -Infinity) covered += 1;
        worst = Math.max(worst, Math.abs(raster.array[k * 4 + 3] / 255 - want));
      }
      expect(covered, side).toBeGreaterThan(100);
      expect(worst, side).toBeLessThanOrEqual(1 / 255 + 1e-6);
    }
  });
});
