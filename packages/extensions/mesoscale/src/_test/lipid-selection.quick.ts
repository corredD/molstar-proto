/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// The selection of a membrane made per view, its hot path (`test:perf`: bytes a step against the baseline; review S3):
// each step a view moved, the selection runs in full (its units change), nothing allocated.

import { expect, it } from 'vitest';
import { Vec3 } from '@molstar/core/math/linear-algebra/3d/vec3';
import { quickCase } from '../../../../sequences/core/_test/model/quick.js';
import { createLipidSelection } from '../lipids/procedural.js';
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
