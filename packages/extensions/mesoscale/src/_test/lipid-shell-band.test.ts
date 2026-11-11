/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Frustum3D } from '@molstar/core/math/geometry/primitives/frustum3d';
import { Plane3D } from '@molstar/core/math/geometry/primitives/plane3d';
import { Vec3 } from '@molstar/core/math/linear-algebra/3d/vec3';
import { cutterRegions, regionKey } from '../lipids/cutter.js';
import { patchSurface } from '../lipids/far-surface.js';
import { BandCap, createShellBand } from '../lipids/shell-band.js';
import { triangleTree } from '../lipids/triangle-tree.js';
import { flatMesh } from './lipid-fixtures.js';

// A cut leaflet's shell band (lipid-procedural round 8 §2): per view the far surface's triangles where a lipid is in
// the middle look's px, copied with their regions renumbered (each with its key), the cells and their shifts; the same
// view writes nothing.

describe('a leaflet’s shell band', () => {
  it('takes the triangles in the middle look’s px, renumbers their regions, and writes nothing for the same view', () => {
    const mesh = flatMesh(100, 20);
    const regions = cutterRegions(mesh.positions, mesh.indices, 1);
    const surface = patchSurface(mesh, regions, 'outer', 10);
    const size = 8;
    const band = createShellBand(mesh, regions, surface, size);
    // depth along y from 100 Å; a lipid 800 / depth px (depthScale 0.01): 1 to 4 px is depth 200 to 800
    const camera = Plane3D.create(Vec3.create(0, 1, 0), 100);
    const frustum = Array.from({ length: 6 }, () => Plane3D.create(Vec3.create(1, 0, 0), 1e9)) as unknown as Frustum3D;
    expect(band.select(camera, frustum, 0.01, 0, 1, 4)).toBe(true);
    const T = mesh.indices.length / 3;
    const chosen = new Set<string>();
    for (let i = 0; i < band.count * 9; i += 9) chosen.add(Array.from(band.positions.subarray(i, i + 9)).join());
    let inBand = 0;
    for (let t = 0; t < T; ++t) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let c = 0; c < 3; ++c) {
        const d = mesh.positions[mesh.indices[t * 3 + c] * 3 + 1] + 100;
        lo = Math.min(lo, d);
        hi = Math.max(hi, d);
      }
      const want = lo <= 800 && hi >= 200;
      if (want) inBand += 1;
      expect(chosen.has(Array.from(surface.positions.subarray(t * 9, t * 9 + 9)).join()), `triangle ${t}`).toBe(want);
    }
    expect(band.count).toBe(inBand);
    expect(inBand).toBeGreaterThan(50);
    expect(inBand).toBeLessThan(T / 2);
    // each band triangle's group a band region, its frame and key the original's; its shifts its own
    const index = new Map<string, number>();
    for (let t = 0; t < T; ++t) index.set(Array.from(surface.positions.subarray(t * 9, t * 9 + 9)).join(), t);
    let regionsUsed = 0;
    for (let i = 0; i < band.count; ++i) {
      const t = index.get(Array.from(band.positions.subarray(i * 9, i * 9 + 9)).join())!;
      const g = band.groups[i * 3];
      regionsUsed = Math.max(regionsUsed, g + 1);
      const r = regions.regionOf[t];
      for (let k = 0; k < 16; ++k) {
        if (k === 12) expect(band.table[g * 16 + k]).toBe(regionKey(regions, r));
        else expect(band.table[g * 16 + k]).toBeCloseTo(regions.table[r * 16 + k], 5);
      }
      const shiftsAt = (band.cellsTexel + 4096) * 4;
      expect(Array.from(band.table.subarray(shiftsAt + i * 6, shiftsAt + i * 6 + 6))).toEqual(
        Array.from(surface.shifts.subarray(t * 6, t * 6 + 6)),
      );
    }
    expect(band.cellsTexel).toBe(regionsUsed * 4);
    // the same view: nothing written
    const version = band.version;
    expect(band.select(camera, frustum, 0.01, 0, 1, 4)).toBe(false);
    expect(band.version).toBe(version);
    // orthographic: all or none by the one px
    expect(band.select(camera, frustum, 0, size / 2, 1, 4)).toBe(true);
    expect(band.count).toBe(T);
    expect(band.select(camera, frustum, 0, size / 8, 1, 4)).toBe(true);
    expect(band.count).toBe(0);
  });

  // round 10 (the gate's N6: the stack and the cap dropped triangles silently): the stack from the tree's depth, every
  // triangle in the px reached; past `BandCap` the rest counted in `dropped`, the band full; the same view writes nothing
  it('reaches every triangle of a large mesh, and counts those past its cap (round 10, S5)', () => {
    const camera = Plane3D.create(Vec3.create(0, 1, 0), 100);
    const frustum = Array.from({ length: 6 }, () => Plane3D.create(Vec3.create(1, 0, 0), 1e9)) as unknown as Frustum3D;
    const all = (mesh: { positions: Float32Array; indices: Uint32Array }) => {
      const regions = cutterRegions(mesh.positions, mesh.indices, 1);
      return createShellBand(mesh, regions, patchSurface(mesh, regions, 'outer', 10), 8);
    };
    // under the cap: 2 × 80² = 12,800 triangles, all of them in the px (orthographic, one px for all)
    const under = flatMesh(10, 80);
    const tree = triangleTree(under.positions, under.indices);
    expect(tree.depth).toBeGreaterThan(8);
    const a = all(under);
    expect(a.select(camera, frustum, 0, 4, 1, 8)).toBe(true);
    expect(a.count).toBe(under.indices.length / 3);
    expect(a.dropped).toBe(0);
    // past it: 2 × 100² = 20,000, the band full and the rest counted
    const over = flatMesh(10, 100);
    const b = all(over);
    expect(b.select(camera, frustum, 0, 4, 1, 8)).toBe(true);
    expect(b.count).toBe(BandCap);
    expect(b.dropped).toBe(over.indices.length / 3 - BandCap);
    const version = b.version;
    expect(b.select(camera, frustum, 0, 4, 1, 8)).toBe(false);
    expect(b.version).toBe(version);
    expect(b.dropped).toBe(over.indices.length / 3 - BandCap);
  });
});
