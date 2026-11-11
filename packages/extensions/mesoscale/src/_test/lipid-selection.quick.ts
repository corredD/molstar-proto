/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// The selection of a membrane made per view, its hot path (`test:perf`: bytes a step against the baseline; review S3):
// each step a view moved, the selection runs in full (its units change), nothing allocated.

import { expect, it } from 'vitest';
import { Vec3 } from '@molstar/core/math/linear-algebra/3d/vec3';
import { Mat4 } from '@molstar/core/math/linear-algebra/3d/mat4';
import { Clip } from '@molstar/core/util/clip';
import { quickCase } from '@molstar/test-harness/quick';
import { concatMeshes } from '../lipids/membrane.js';
import { createLipidSelection, createPartVisibility } from '../lipids/procedural.js';
import { icosphere } from '../lipids/remesh.js';
import { enclosures, triangleTree } from '../lipids/triangle-tree.js';
import { full, input, Params, view } from './lipid-selection-cases.js';

it('a select between two views (cells and whole triangles)', ({ task }) => {
  // large triangles (cells) and small ones (whole), the camera moving between two places over the sheet
  const large = input(8, 400);
  const selection = createLipidSelection(large, full(large));
  const views = [view(Vec3.create(1200, 1200, 300)), view(Vec3.create(1500, 1300, 280))];
  let changed = 0;
  quickCase(task, 'lipid selection: a select between two views', (i) => {
    const v = views[i & 1];
    if (selection.select(v.plane, v.frustum, v.depthScale, 0, Params)) changed += 1;
  });
  expect(changed).toBeGreaterThan(10);
  expect(selection.count).toBeGreaterThan(0);
});

it('a select between two views with a cut band (round 8 gate M1: the band tested per node, triangle and cell)', ({
  task,
}) => {
  const large = input(8, 400);
  // round 10: the band a part of its own (its capacity beside the rest's), as the membrane selects with a clip
  const selection = createLipidSelection(large, full(large), full(large));
  const objects = Clip.getClip({
    variant: 'pixel',
    objects: [
      {
        type: 'plane',
        invert: false,
        position: Vec3.create(1350, 0, 0),
        rotation: { axis: Vec3.create(0, 0, 1), angle: -90 },
        scale: Vec3.create(1, 1, 1),
        transform: Mat4.identity(),
      },
    ],
  }).objects;
  const params = { ...Params, enterPx: 8, band: { objects, width: 16, enterPx: 2 } };
  const views = [view(Vec3.create(1200, 1200, 300)), view(Vec3.create(1500, 1300, 280))];
  let changed = 0;
  quickCase(task, 'lipid selection: a select with a cut band between two views', (i) => {
    const v = views[i & 1];
    if (selection.select(v.plane, v.frustum, v.depthScale, 0, params)) changed += 1;
  });
  expect(changed).toBeGreaterThan(10);
  expect(selection.count).toBeGreaterThan(selection.bandCount);
  expect(selection.bandCount).toBeGreaterThan(0);
});

it('a cell’s parts shown between two views (round 7: once a view for every part’s selection; review S3)', ({
  task,
}) => {
  // a cell around an organelle: the eye outside, then inside the cell, so the enclosure test runs each step
  const { mesh, parts } = concatMeshes([icosphere(2000, 200), icosphere(1600, 200)], ['cell', 'organelle']);
  const enclosedBy = enclosures(triangleTree(mesh.positions, mesh.indices, parts), mesh.positions, mesh.indices);
  const visibility = createPartVisibility(mesh.positions, mesh.indices, parts, enclosedBy);
  const views = [
    view(Vec3.create(0, 0, 2400), Vec3.create(0, 0, 0)),
    view(Vec3.create(0, 0, 1850), Vec3.create(0, 0, 0)),
  ];
  let shown = 0;
  quickCase(task, 'lipid selection: a cell’s parts shown between two views', (i) => {
    visibility.update(views[i & 1].frustum, true);
    shown += visibility.shown[1];
  });
  expect(shown).toBeGreaterThan(10);
});
