/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import type { ComputeContext } from '@molstar/graphics/gl/compute';
import { cutterRegions, cutterTable, eachHit, emptyCut, hitAffine, triangleCut } from '../lipids/cutter.js';
import { createLipidCutter } from '../lipids/cutter-kernel.js';
import { parsePatchPdb } from '../lipids/patch.js';
import { icosphere } from '../lipids/remesh.js';
import { closePairs, coveredFraction, flatMesh, placeCut, syntheticPatchPdb } from './lipid-fixtures.js';

describe('the lipid cutter', () => {
  it('cuts a flat plane of triangles smaller than a lipid as the patch itself: no seams inside a cell (Ludo, 2026-11-08)', () => {
    // each triangle its own random offset made every lipid an island: star-shaped holes and clashes on the cow's small
    // triangles; one offset and frame a region of the surface keeps the patch's packing across its triangles' edges, and
    // inside a region each cell (`cellSide`, under the box: round 4b item 4) its own, its seams at the cells' borders
    const { text, box } = syntheticPatchPdb();
    const leaflet = parsePatchPdb(text, { box }).outer;
    const table = cutterTable(leaflet, 2);
    // 10 Å triangles (43 Å², under a lipid's 55 Å²), a rhombus of 120 Å a side: one region, a few cells
    const mesh = flatMesh(10, 12);
    const { atoms, atomLipid, atomCell, cells, lipids } = placeCut(table, mesh, 1);
    expect(cells).toBeGreaterThan(1);
    const area = 12 * 12 * 100 * 0.8660254037844386;
    const perLipid = (box[0] * box[1]) / leaflet.lipidSpecies.length;
    expect(Math.abs(lipids - area / perLipid)).toBeLessThan(0.05 * (area / perLipid));
    // inside a cell no two lipids closer than the patch's own (8 Å apart: no atom pair under 2 Å) across triangles
    expect(closePairs(atoms, atomLipid, atomCell, 2).within).toBe(0);
    // the inner part (away from the plane's border, where lipids reach out of it) covered as the patch
    const inner = flatMesh(10, 12);
    for (let i = 0; i < inner.positions.length; i += 3) {
      inner.positions[i] = 90 + (inner.positions[i] - 90) * 0.5;
      inner.positions[i + 1] = 52 + (inner.positions[i + 1] - 52) * 0.5;
    }
    expect(coveredFraction(inner, atoms, 6, 4000)).toBeGreaterThanOrEqual(0.99);
  });

  it('cuts a round patch (a disc in its square, as the app’s CHARMM-GUI patch) as its filled square (Ludo, 2026-11-08)', () => {
    // the app's patch is a disc of radius 115 Å read as periodic with a 232 Å box: its empty corners, a fifth of the
    // box, tiled into every cut and tile as holes the mesh showed through
    const { text } = syntheticPatchPdb(40, 46);
    const lines = text.split('\n');
    const heads = new Map<string, [number, number]>();
    // a residue's first atom its head (`syntheticPatchPdb`)
    for (const l of lines) {
      const r = l.substring(22, 26);
      if (!heads.has(r)) heads.set(r, [+l.substring(30, 38), +l.substring(38, 46)]);
    }
    const disc = lines.filter((l) => {
      const [x, y] = heads.get(l.substring(22, 26))!;
      return Math.hypot(x - 160, y - 160) < 150;
    });
    const patch = parsePatchPdb(disc.join('\n'));
    // the lattice's own area a lipid (8 Å spacing: 55.4 Å²), not inflated by the corners (4 / π)
    expect(patch.outer.areaPerLipid).toBeLessThan(55.4 * 1.1);
    const table = cutterTable(patch.outer, 2);
    const mesh = flatMesh(10, 30);
    const { atoms } = placeCut(table, mesh, 1);
    const inner = flatMesh(10, 30);
    for (let i = 0; i < inner.positions.length; i += 3) {
      inner.positions[i] = 225 + (inner.positions[i] - 225) * 0.8;
      inner.positions[i + 1] = 130 + (inner.positions[i + 1] - 130) * 0.8;
    }
    // 86 % read whole; 98 % as its square (a lattice's rows meet out of step at the square's period, a real patch's do not)
    expect(coveredFraction(inner, atoms, 6, 4000)).toBeGreaterThanOrEqual(0.97);
  });

  it('repeats no part of the patch by translation on triangles larger than its box (Ludo, 2026-11-08: "highly regular")', () => {
    // the teddy ×100's triangles are 168 Å across at the median, the CHARMM-GUI box 154 Å: 30 % of the cut lipids were
    // the patch again at its period inside their region. A copy: a hit of the same patch lipid turned the same way
    const { text, box } = syntheticPatchPdb();
    const table = cutterTable(parsePatchPdb(text, { box }).outer, 2);
    // triangles of 400 Å, the box about 96 Å
    const mesh = flatMesh(400, 3);
    const regions = cutterRegions(mesh.positions, mesh.indices, 1);
    const cut = emptyCut();
    const affine = new Float32Array(16);
    const seen = new Set<string>();
    let hits = 0;
    let copies = 0;
    for (let t = 0; t < mesh.indices.length / 3; ++t) {
      if (!triangleCut(mesh.positions, mesh.indices, t, regions, table.box, cut)) continue;
      for (let m = 0; m < table.members.length; ++m) {
        eachHit(table, cut, m, (l, x, y) => {
          hitAffine(table, cut, l, x, y, affine, 0);
          const key = `${l} ${affine[0].toFixed(4)} ${affine[1].toFixed(4)}`;
          hits += 1;
          if (seen.has(key)) copies += 1;
          else seen.add(key);
        });
      }
    }
    expect(hits).toBeGreaterThan(5000);
    expect(copies / hits).toBeLessThan(0.01);
  });

  it('says a mesh is too large for one count pass, not a WebGPU error (review S4)', async () => {
    const { text, box } = syntheticPatchPdb();
    const table = cutterTable(parsePatchPdb(text, { box }).outer, 2);
    const mesh = icosphere(300, 70);
    const buffer = { write() {}, destroy() {}, readAsync: async () => new ArrayBuffer(0) };
    // a device whose storage buffers hold less than a count a member and triangle
    const compute = {
      maxStorageBufferSize: 1024,
      maxWorkgroupsPerDimension: 65535,
      createBuffer: () => buffer,
      createKernel: () => ({ dispatch() {}, destroy() {} }),
      beginComputePass() {},
      endComputePass() {},
    } as unknown as ComputeContext;
    await expect(
      createLipidCutter(
        compute,
        () => {},
        table,
        mesh.positions,
        mesh.indices,
        cutterRegions(mesh.positions, mesh.indices, 1),
      ),
    ).rejects.toThrow(/too many triangles/);
  });
});
