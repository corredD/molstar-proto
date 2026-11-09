/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Vec3 } from '@molstar/core/math/linear-algebra/3d/vec3';
import { CellKinds, cutterRegions } from '../lipids/cutter.js';
import { concatMeshes } from '../lipids/membrane.js';
import { createLipidSelection, poolCapacities, type SelectionInput, wholeTriangles } from '../lipids/procedural.js';
import { icosphere, type TriMesh } from '../lipids/remesh.js';
import { enclosures, insidePart, triangleTree } from '../lipids/triangle-tree.js';
import { view } from './lipid-selection-cases.js';

// A cell's membranes wrapped as one (lipid-procedural round 6): parts of one mesh, one budget nearest first across them,
// an enclosed part hidden while the eye is outside its encloser.

const box = [154, 154] as const;
const Params = { lipidSize: 8, enterPx: 2, keep: 0.8, facing: 60 };

function shifted(m: TriMesh, x: number): TriMesh {
  const positions = Float32Array.from(m.positions, (v, i) => (i % 3 === 0 ? v + x : v));
  return { positions, indices: m.indices };
}

/** parts as a selection's input, every triangle a whole unit of 3 lipids a member */
function cell(meshes: TriMesh[], capacity: number) {
  const { mesh, parts } = concatMeshes(
    meshes,
    meshes.map((_, i) => `part ${i}`),
  );
  const { positions, indices } = mesh;
  const regions = cutterRegions(positions, indices, 7);
  const { wholeOf, count } = wholeTriangles(positions, indices, regions, box);
  const enclosedBy = enclosures(triangleTree(positions, indices, parts), positions, indices);
  const input: SelectionInput = {
    positions,
    indices,
    regions,
    box,
    members: 2,
    kinds: new Uint32Array(2 * CellKinds).fill(3),
    wholeOf,
    wholeCounts: new Uint32Array(2 * count).fill(3),
    side: 1,
    parts,
    enclosedBy,
  };
  const [cap] = poolCapacities([Uint32Array.of(1e9, 1e9)], capacity);
  return { input, parts, enclosedBy, selection: createLipidSelection(input, cap), cap };
}

/** per part the units the selection took */
function unitsByPart(c: ReturnType<typeof cell>) {
  const out = c.parts.map(() => 0);
  for (let i = 0; i < c.selection.count; ++i) {
    const t = c.selection.units[i * 3];
    out[c.parts.findIndex((p) => t >= p.start && t < p.end)] += 1;
  }
  return out;
}

describe('a cell’s membranes as one (round 6)', () => {
  it('finds which part encloses which, and whether a point is inside a part', () => {
    const outer = icosphere(2000, 200);
    const inner = icosphere(800, 200);
    const beside = shifted(icosphere(300, 100), 1300);
    const { mesh, parts } = concatMeshes([outer, inner, beside], ['outer', 'inner', 'beside']);
    const tree = triangleTree(mesh.positions, mesh.indices, parts);
    const stack = new Int32Array(128);
    expect(insidePart(tree, mesh.positions, mesh.indices, 0, 0, 0, 0, stack)).toBe(true);
    expect(insidePart(tree, mesh.positions, mesh.indices, 0, 3000, 0, 0, stack)).toBe(false);
    expect(insidePart(tree, mesh.positions, mesh.indices, 1, 1300, 0, 0, stack)).toBe(false);
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
    const c = cell([icosphere(2000, 200), icosphere(1600, 200)], 1e7);
    // outside, close over the outer one: only it
    const out = view(Vec3.create(0, 0, 2400), Vec3.create(0, 0, 0));
    c.selection.select(out.plane, out.frustum, out.depthScale, 0, Params);
    expect(Array.from(c.selection.partShown)).toEqual([1, 0]);
    const [o, i] = unitsByPart(c);
    expect(o).toBeGreaterThan(0);
    expect(i).toBe(0);
    // inside the outer one, looking at the inner: both
    const inside = view(Vec3.create(0, 0, 1850), Vec3.create(0, 0, 0));
    c.selection.select(inside.plane, inside.frustum, inside.depthScale, 0, Params);
    expect(Array.from(c.selection.partShown)).toEqual([1, 1]);
    expect(unitsByPart(c)[1]).toBeGreaterThan(0);
    // a clip (no facing): every part
    c.selection.select(out.plane, out.frustum, out.depthScale, 0, { ...Params, facing: 0 });
    expect(Array.from(c.selection.partShown)).toEqual([1, 1]);
  });

  it('shares one budget across parts, nearest first', () => {
    // two spheres side by side, the eye nearer the first: a budget that holds part of what is in reach
    const near = icosphere(1000, 150);
    const far = shifted(icosphere(1000, 150), 2600);
    const c = cell([near, far], 6000);
    const v = view(Vec3.create(-1500, 0, 1800), Vec3.create(1300, 0, 0));
    c.selection.select(v.plane, v.frustum, v.depthScale, 0, { ...Params, facing: 0 });
    let live = 0;
    for (const n of c.selection.live) live += n;
    let room = 0;
    for (const n of c.cap) room += n;
    expect(live).toBeGreaterThan(0);
    expect(live).toBeLessThanOrEqual(room);
    const [a, b] = unitsByPart(c);
    // the budget binds (not everything in reach taken) and the near part fills first
    expect(c.selection.inView).toBeGreaterThan(c.selection.count);
    expect(a).toBeGreaterThan(b);
  });
});
