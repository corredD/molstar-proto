/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { expect, it } from 'vitest';
import { checkLinear, quadraticControl, scaling } from '../../../../sequences/core/_test/model/scaling.js';
import { assignReference, assignSlots } from '../lipids/assign.js';
import { CellKinds, cutterBases, cutterCounts, cutterRegions, cutterTable } from '../lipids/cutter.js';
import { parsePatchPdb } from '../lipids/patch.js';
import { buildMembrane, registerLipidPatch, shownLipids } from '../lipids/membrane.js';
import { farSurface } from '../lipids/far-surface.js';
import { farTriangles, icosphere, isotropicRemesh, type TriMesh } from '../lipids/remesh.js';
import { createLipidSelection, wholeTriangles } from '../lipids/procedural.js';
import { Frustum3D } from '@molstar/core/math/geometry/primitives/frustum3d';
import { Plane3D } from '@molstar/core/math/geometry/primitives/plane3d';
import { Vec3 } from '@molstar/core/math/linear-algebra/3d/vec3';
import { syntheticPatchPdb } from './lipid-fixtures.js';

// The lipid membrane's bulk paths over n and 4n tiles (`test:scaling`; apps/prism-me/AGENTS.md, no accidental
// quadratic): the CPU's half of the assignment (variants, counts, slots) and its reference, and a whole sphere built
// (icosphere, offsets, slots; the tile sets baked once in the warm-up, cached per patch); the cutter's counts and bases
// over N triangles (its CPU reference: the GPU's passes are per triangle too), and the lost triangles' search.

const kinds = { edgeTypes: 2, vertexColors: 2, variants: 2, seed: 1 };
registerLipidPatch('scaling-patch', syntheticPatchPdb().text);

/** a sphere of about `n` triangles at edge 100 (20 k² triangles of edge ≈ 1.2 R / k) */
const radiusFor = (n: number) => (Math.sqrt(n / 20) * 100) / 1.2046;

it('the positive control (a copy per item) is caught', () => {
  checkLinear('quadratic control', scaling(quadraticControl, 2000), false);
});

it('the assignment of N triangles: variants, slots and the reference affines', () => {
  const s = scaling(
    {
      setup: (n) => icosphere(radiusFor(n), 100),
      run: (mesh) => {
        const slots = assignSlots(kinds, mesh.indices);
        assignReference(kinds, 100, mesh.positions, mesh.indices, slots);
      },
    },
    20000,
  );
  checkLinear('lipid tile assignment, N triangles', s);
});

/** an ellipsoid 2:1:1 of `mesh` (not at the remesh's edge: every pass has work), its vertices unwelded */
function stretchedUnwelded(mesh: TriMesh): TriMesh {
  const n = mesh.indices.length;
  const positions = new Float32Array(n * 3);
  const indices = new Uint32Array(n);
  for (let i = 0; i < n; ++i) {
    const v = mesh.indices[i] * 3;
    positions[i * 3] = mesh.positions[v] * 2;
    positions[i * 3 + 1] = mesh.positions[v + 1];
    positions[i * 3 + 2] = mesh.positions[v + 2];
    indices[i] = i;
  }
  return { positions, indices };
}

it('the remesh of a surface of about N triangles at the edge (welded first; review S8)', () => {
  const s = scaling(
    {
      setup: (n) => stretchedUnwelded(icosphere(radiusFor(n / 2) / Math.SQRT2, 150)),
      run: (mesh) => {
        isotropicRemesh(mesh, 100);
      },
    },
    2000,
  );
  checkLinear('isotropic remesh, N triangles', s);
}, 600_000);

it('a membrane of N tiles built (a sphere, both leaflets)', () => {
  const s = scaling(
    {
      setup: (n) => radiusFor(n / 2),
      run: (radius) => {
        const data = buildMembrane({ radius }, 'scaling-patch', 100, 'both', kinds);
        if (typeof data === 'string') throw new Error(data);
      },
    },
    8000,
  );
  checkLinear('lipid membrane built, N tiles', s);
}, 600_000);

it('the cutter over N triangles: regions, counts and bases (the reference of its count pass)', () => {
  const { text, box } = syntheticPatchPdb();
  const table = cutterTable(parsePatchPdb(text, { box }).outer, 2);
  const s = scaling(
    {
      setup: (n) => icosphere(radiusFor(n), 100),
      run: (mesh) => {
        const regions = cutterRegions(mesh.positions, mesh.indices, 1);
        cutterBases(cutterCounts(table, mesh.positions, mesh.indices, regions), table.members.length);
      },
    },
    4000,
  );
  checkLinear('lipid cutter, N triangles', s);
}, 600_000);

it('the triangles a remesh lost, over N triangles (a surface grid, not a scan per triangle)', () => {
  const s = scaling(
    {
      setup: (n) => {
        const fine = icosphere(radiusFor(n), 100);
        return { fine, coarse: icosphere(radiusFor(n), 200) };
      },
      run: ({ fine, coarse }) => {
        farTriangles(fine, coarse, 10);
      },
    },
    8000,
  );
  checkLinear('lost triangles, N triangles', s);
}, 600_000);

it('a view selected over a mesh of N triangles, at a fixed pool (lipid-procedural: the selection follows the mesh, not its lipids)', () => {
  // the whole sphere in view, every triangle large enough on screen; a pool of 20 000 lipids whatever the mesh
  const s = scaling(
    {
      setup: (n) => {
        const mesh = icosphere(radiusFor(n), 100);
        const T = mesh.indices.length / 3;
        const regions = cutterRegions(mesh.positions, mesh.indices, 1);
        // small triangles: each a unit whole, 3 lipids a member (round 5's units)
        const box = [154, 154] as const;
        const { wholeOf, count } = wholeTriangles(mesh.positions, mesh.indices, regions, box);
        const selection = createLipidSelection(
          {
            positions: mesh.positions,
            indices: mesh.indices,
            regions,
            box,
            members: 2,
            kinds: new Uint32Array(2 * CellKinds).fill(3),
            wholeOf,
            wholeCounts: new Uint32Array(2 * count).fill(3),
            side: 1,
          },
          Uint32Array.of(10000, 10000),
        );
        expect(count).toBe(T);
        const r = radiusFor(n);
        const frustum = Frustum3D();
        // a box of planes around the sphere: all in view
        const planes: [number, number, number][] = [
          [1, 0, 0],
          [-1, 0, 0],
          [0, 1, 0],
          [0, -1, 0],
          [0, 0, 1],
          [0, 0, -1],
        ];
        planes.forEach(([x, y, z], i) => {
          (frustum as Plane3D[])[i] = Plane3D.create(Vec3.create(x, y, z), 2 * r);
        });
        // the eye beyond the sphere on -z, two views to alternate (each select runs in full)
        const near = Plane3D.create(Vec3.create(0, 0, 1), 3 * r);
        const far = Plane3D.create(Vec3.create(0, 0, 1), 3.5 * r);
        return { selection, frustum, views: [near, far], k: 0 };
      },
      run: (c) => {
        c.k += 1;
        c.selection.reset();
        c.selection.select(c.views[c.k % 2], c.frustum, 1e-6, 0, { lipidSize: 8, enterPx: 0.5, keep: 0.8 });
      },
    },
    20000,
  );
  checkLinear('lipid selection, N triangles', s);
});

it('a far surface over a mesh of N triangles (review S3)', () => {
  const { text, box } = syntheticPatchPdb();
  const table = cutterTable(parsePatchPdb(text, { box }).outer, 2);
  const s = scaling(
    {
      setup: (n) => {
        const mesh = icosphere(radiusFor(n), 100);
        return { mesh, regions: cutterRegions(mesh.positions, mesh.indices, 1) };
      },
      run: ({ mesh, regions }) => {
        farSurface(mesh, regions, table, 'outer', 20, () => true, 50);
      },
    },
    4000,
  );
  checkLinear('far surface, N triangles', s);
}, 600_000);

it('a far surface over a patch of N lipids: its heads found by buckets, not a scan per cell (review N1)', () => {
  const mesh = icosphere(400, 200);
  const regions = cutterRegions(mesh.positions, mesh.indices, 1);
  const s = scaling(
    {
      // a patch of about n lipids a leaflet (12 × 14 a unit)
      setup: (n) => {
        const k = Math.max(1, Math.round(Math.sqrt(n / 168)));
        const { text, box } = syntheticPatchPdb(12 * k, 14 * k);
        return cutterTable(parsePatchPdb(text, { box }).outer, 2);
      },
      run: (table) => {
        farSurface(mesh, regions, table, 'outer', 20, () => true, 50);
      },
    },
    2000,
  );
  checkLinear('far surface, N patch lipids', s);
}, 600_000);

it('a tile without a species, N lipids (review S3)', () => {
  const s = scaling(
    {
      // a tile of n lipids of 3 species, 10 atoms each
      setup: (n) => ({
        lipidSpecies: Uint16Array.from({ length: n }, (_, l) => l % 3),
        lipidAtomStart: Uint32Array.from({ length: n + 1 }, (_, l) => l * 10),
        positions: new Float32Array(n * 30),
        elements: new Uint8Array(n * 10),
        removed: 0,
        filled: 0,
      }),
      run: (tile) => {
        shownLipids(tile, ['A', 'B', 'C'], new Set(['B']));
      },
    },
    20000,
  );
  checkLinear('a tile without a species, N lipids', s);
});
