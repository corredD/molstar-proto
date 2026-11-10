/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { it } from 'vitest';
import { checkLinear, quadraticControl, scaling } from '@molstar/test-harness/scaling';
import { Vec3 } from '@molstar/core/math/linear-algebra/3d/vec3';
import { CellKinds, cutterRegions } from '../lipids/cutter.js';
import { concatMeshes, partMesh } from '../lipids/membrane.js';
import {
  createLipidSelection,
  createPartVisibility,
  type SelectionInput,
  type SelectionParams,
  wholeTriangles,
} from '../lipids/procedural.js';
import { icosphere, type TriMesh } from '../lipids/remesh.js';
import { enclosures, triangleTree } from '../lipids/triangle-tree.js';
import { createMembraneViews, type PartSurface, showPartSurfaces } from '../lipids/views.js';
import { view } from './lipid-selection-cases.js';

// A cell's membranes' per-view CPU over P and 4P parts (round 7 review S1; apps/prism-me/AGENTS.md, no accidental
// quadratic): a selection a part and leaflet (2P), four far surfaces a part (4P), every view a new frustum and a new
// size on screen (an orthographic zoom: every frame). The surfaces' fade and the parts' visibility each run once a view,
// not once a selection.

const box = [154, 154] as const;

function shifted(m: TriMesh, x: number): TriMesh {
  return { positions: Float32Array.from(m.positions, (v, i) => (i % 3 === 0 ? v + x : v)), indices: m.indices };
}

/** P small spheres in a row, side by side (none encloses another), as the representation holds them */
function cell(P: number) {
  const sphere = icosphere(100, 80);
  const { mesh, parts } = concatMeshes(
    Array.from({ length: P }, (_, p) => shifted(sphere, p * 300)),
    Array.from({ length: P }, (_, p) => `part ${p}`),
  );
  const regions = cutterRegions(mesh.positions, mesh.indices, 7);
  const enclosedBy = enclosures(triangleTree(mesh.positions, mesh.indices, parts), mesh.positions, mesh.indices);
  const visibility = createPartVisibility(mesh.positions, mesh.indices, parts, enclosedBy);
  const selections = [];
  for (let p = 0; p < P; ++p) {
    const own = partMesh(mesh, regions, parts[p]);
    const { wholeOf, count } = wholeTriangles(own.mesh.positions, own.mesh.indices, own.regions, box);
    for (const side of [1, -1]) {
      const input: SelectionInput = {
        positions: own.mesh.positions,
        indices: own.mesh.indices,
        regions: own.regions,
        box,
        members: 2,
        kinds: new Uint32Array(2 * CellKinds).fill(3),
        wholeOf,
        wholeCounts: new Uint32Array(2 * count).fill(3),
        side,
        visibility,
        part: p,
      };
      selections.push(createLipidSelection(input, Uint32Array.of(64, 64)));
    }
  }
  // the far surfaces: near and far a leaflet, their fade a few numbers each (as `fadeSurface` writes its uniforms)
  const surfaces: PartSurface[] = [];
  const faded = new Float64Array(4 * P);
  for (let p = 0; p < P; ++p)
    for (let k = 0; k < 4; ++k) surfaces.push({ object: { state: { visible: true } }, part: p });
  const params: SelectionParams = { lipidSize: 8, enterPx: 2, keep: 0.8, facing: 60 };
  const views = createMembraneViews({
    fade: (depthScale, pixelSize) => {
      for (let i = 0; i < faded.length; ++i) faded[i] = depthScale * pixelSize + i;
    },
    showParts: () => showPartSurfaces(surfaces, true, visibility),
    params: () => params,
  });
  // two views to alternate, the eye far back over the row: every part in view
  const mid = (P * 300) / 2;
  const cameras = [view(Vec3.create(mid, 0, 4 * mid + 2000)), view(Vec3.create(mid + 10, 0, 4 * mid + 2000))];
  return { selections, views, cameras, k: 0 };
}

it('the positive control (a copy per item) is caught', () => {
  checkLinear('quadratic control', scaling(quadraticControl, 2000), false);
});

it('a view of a cell of P membranes: its 2P selections, the fade and the parts shown once a view', () => {
  const s = scaling(
    {
      setup: (P) => cell(P),
      run: (c) => {
        c.k += 1;
        const cam = c.cameras[c.k % 2];
        const v = { cameraPlane: cam.plane, frustum: cam.frustum, lod: { depthScale: cam.depthScale, pixelSize: c.k } };
        for (const sel of c.selections) c.views.selectFor(sel, v, 8);
      },
    },
    256,
  );
  checkLinear('a view of P membranes', s);
}, 600_000);
