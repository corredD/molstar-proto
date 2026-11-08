/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { it } from 'vitest';
import { checkLinear, quadraticControl, scaling } from '../../../../sequences/core/_test/model/scaling.js';
import { assignReference, assignSlots } from '../lipids/assign.js';
import { buildMembrane, registerLipidPatch } from '../lipids/membrane.js';
import { icosphere, isotropicRemesh, type TriMesh } from '../lipids/remesh.js';
import { syntheticPatchPdb } from './lipid-fixtures.js';

// The lipid membrane's bulk paths over n and 4n tiles (`test:scaling`; apps/prism-me/AGENTS.md, no accidental
// quadratic): the CPU's half of the assignment (variants, counts, slots) and its reference, and a whole sphere built
// (icosphere, offsets, slots; the tile sets baked once in the warm-up, cached per patch).

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
