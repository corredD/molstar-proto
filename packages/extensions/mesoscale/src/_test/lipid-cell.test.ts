/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Vec3 } from '@molstar/core/math/linear-algebra/3d/vec3';
import { CellKinds, cutterRegions } from '../lipids/cutter.js';
import { concatMeshes, partMesh } from '../lipids/membrane.js';
import {
  createLipidSelection,
  createPartVisibility,
  poolCapacities,
  type SelectionInput,
  wholeTriangles,
} from '../lipids/procedural.js';
import { icosphere, type TriMesh } from '../lipids/remesh.js';
import { enclosures, insidePart, triangleTree } from '../lipids/triangle-tree.js';
import { view } from './lipid-selection-cases.js';

// A cell's membranes wrapped as one (lipid-procedural round 6): parts of one mesh, an enclosed part hidden while the eye
// is outside its encloser; round 7: a selection a part and leaflet, the budget water-filled across them (no longer one
// budget nearest first across parts: a part's colour needs its own objects, so its own pools).

const box = [154, 154] as const;
const Params = { lipidSize: 8, enterPx: 2, keep: 0.8, facing: 60 };

function shifted(m: TriMesh, x: number): TriMesh {
  const positions = Float32Array.from(m.positions, (v, i) => (i % 3 === 0 ? v + x : v));
  return { positions, indices: m.indices };
}

/**
 * parts as selections (round 7: a selection a part, which parts are shown the cell's), every triangle a whole unit of 3
 * lipids a member
 */
function cell(meshes: TriMesh[]) {
  const { mesh, parts } = concatMeshes(
    meshes,
    meshes.map((_, i) => `part ${i}`),
  );
  const regions = cutterRegions(mesh.positions, mesh.indices, 7);
  const enclosedBy = enclosures(triangleTree(mesh.positions, mesh.indices, parts), mesh.positions, mesh.indices);
  const visibility = createPartVisibility(mesh.positions, mesh.indices, parts, enclosedBy);
  const selections = parts.map((part, p) => {
    const own = partMesh(mesh, regions, part);
    const { wholeOf, count } = wholeTriangles(own.mesh.positions, own.mesh.indices, own.regions, box);
    const input: SelectionInput = {
      positions: own.mesh.positions,
      indices: own.mesh.indices,
      regions: own.regions,
      box,
      members: 2,
      kinds: new Uint32Array(2 * CellKinds).fill(3),
      wholeOf,
      wholeCounts: new Uint32Array(2 * count).fill(3),
      side: 1,
      visibility,
      part: p,
    };
    return createLipidSelection(input, Uint32Array.of(1e7, 1e7));
  });
  return { parts, enclosedBy, visibility, selections };
}

describe('a cell’s membranes as one (round 6)', () => {
  it('finds which part encloses which, and whether a point is inside a part', () => {
    const outer = icosphere(2000, 200);
    const inner = icosphere(800, 200);
    const beside = shifted(icosphere(300, 100), 1300);
    const { mesh, parts } = concatMeshes([outer, inner, beside], ['outer', 'inner', 'beside']);
    const tree = triangleTree(mesh.positions, mesh.indices, parts);
    const stack = new Int32Array(128);
    expect(insidePart(tree, mesh.positions, mesh.indices, 0, Float64Array.of(0, 0, 0), 0, stack)).toBe(true);
    expect(insidePart(tree, mesh.positions, mesh.indices, 0, Float64Array.of(3000, 0, 0), 0, stack)).toBe(false);
    expect(insidePart(tree, mesh.positions, mesh.indices, 1, Float64Array.of(1300, 0, 0), 0, stack)).toBe(false);
    expect(enclosures(tree, mesh.positions, mesh.indices).map((e) => Array.from(e))).toEqual([[], [0], [0]]);
  });

  it('calls a part of many components enclosed only when each of them is inside (review S2: a small one outside)', () => {
    // 16 small spheres inside the cell, then a 17th outside it: the last triangles of the part
    const inside = Array.from({ length: 16 }, (_, i) => shifted(icosphere(80, 40), -1200 + i * 150));
    const outside = shifted(icosphere(80, 40), 5000);
    const many: TriMesh[] = [...inside, outside];
    const { mesh: comps } = concatMeshes(
      many,
      many.map(() => ''),
    );
    const { mesh, parts } = concatMeshes([icosphere(2000, 200), comps], ['cell', 'vesicles']);
    const tree = triangleTree(mesh.positions, mesh.indices, parts);
    expect(enclosures(tree, mesh.positions, mesh.indices).map((e) => Array.from(e))).toEqual([[], []]);
  });

  it('hides an enclosed part while the eye is outside its encloser, shows it inside and under a clip', () => {
    const c = cell([icosphere(2000, 200), icosphere(1600, 200)]);
    const select = (v: ReturnType<typeof view>, p = Params) => {
      for (const s of c.selections) s.select(v.plane, v.frustum, v.depthScale, 0, p);
      return c.selections.map((s) => s.count);
    };
    // outside, close over the outer one: only it (the inner one's selection takes nothing)
    const out = view(Vec3.create(0, 0, 2400), Vec3.create(0, 0, 0));
    const [o, i] = select(out);
    expect(Array.from(c.visibility.shown)).toEqual([1, 0]);
    expect(o).toBeGreaterThan(0);
    expect(i).toBe(0);
    // inside the outer one, looking at the inner: both
    const inside = view(Vec3.create(0, 0, 1850), Vec3.create(0, 0, 0));
    expect(select(inside)[1]).toBeGreaterThan(0);
    expect(Array.from(c.visibility.shown)).toEqual([1, 1]);
    // a clip (no facing): every part
    select(out, { ...Params, facing: 0 });
    expect(Array.from(c.visibility.shown)).toEqual([1, 1]);
  });

  it('shows what a hidden encloser holds: the outer one hidden, the inner one seen from outside (review M1)', () => {
    const c = cell([icosphere(2000, 200), icosphere(1600, 200)]);
    const out = view(Vec3.create(0, 0, 2400), Vec3.create(0, 0, 0));
    c.visibility.setHidden((q) => q === 0);
    c.selections[1].select(out.plane, out.frustum, out.depthScale, 0, Params);
    expect(Array.from(c.visibility.shown)).toEqual([1, 1]);
    expect(c.selections[1].count).toBeGreaterThan(0);
    // shown again: the inner one hidden again from outside (the same view: the hidden set re-decides it)
    c.visibility.setHidden(() => false);
    c.selections[1].select(out.plane, out.frustum, out.depthScale, 0, Params);
    expect(Array.from(c.visibility.shown)).toEqual([1, 0]);
  });

  it('shares the budget a pool a part and leaflet, water-filled: a small membrane whole, the large ones alike (round 7)', () => {
    // a peroxisome's leaflet, a vacuole's, a PM's (lipids a member): the budget holds a fifth of them
    const totals = [Uint32Array.of(100, 100), Uint32Array.of(5000, 5000), Uint32Array.of(20000, 20000)];
    const budget = 10_200;
    const caps = poolCapacities(totals, budget);
    const sum = (a: Uint32Array) => a.reduce((x, y) => x + y, 0);
    // the small one whole (a share by area gave it 23 a member: a close view of it a few lipids wide)
    expect(Array.from(caps[0])).toEqual([100, 100]);
    // the others the level each (+10 %), their share of the rest
    expect(sum(caps[1])).toBe(sum(caps[2]));
    expect(sum(caps[1])).toBeCloseTo(((budget - 200) / 2) * 1.1, -1);
    let all = 0;
    for (const c of caps) all += sum(c);
    expect(all).toBeLessThanOrEqual(budget * 1.1);
    // all of it where it fits
    expect(poolCapacities(totals, 1e6).map((c) => Array.from(c))).toEqual(totals.map((t) => Array.from(t)));
  });
});
