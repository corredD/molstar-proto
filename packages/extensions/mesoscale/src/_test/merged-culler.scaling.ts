/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { it } from 'vitest';
import { Sphere3D } from '@molstar/core/math/geometry/primitives/sphere3d';
import { Mat4 } from '@molstar/core/math/linear-algebra/3d/mat4';
import { Vec3 } from '@molstar/core/math/linear-algebra/3d/vec3';
import { ColorNames } from '@molstar/core/util/color/names';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { ValueCell } from '@molstar/core/util/value-cell';
import { Spheres } from '@molstar/graphics/geo/geometry/spheres/spheres';
import { SpheresBuilder } from '@molstar/graphics/geo/geometry/spheres/spheres-builder';
import { createTransform } from '@molstar/graphics/geo/geometry/transform-data';
import type { ComputeContext } from '@molstar/graphics/gl/compute';
import type { GraphicsResources } from '@molstar/graphics/gl/context';
import { createMergedRenderObject, createRenderObject } from '@molstar/graphics/gl/render-object';
import { createMergedCuller } from '@molstar/graphics/gl/renderable/merged-culler';
import type { MergeableValues, Merged } from '@molstar/graphics/gl/renderable/merged';
import { checkLinear, scaling } from '../../../../sequences/core/_test/model/scaling.js';

// The GPU culling's CPU side over N members (`test:scaling`): what a layout change writes (`syncLayout`: cells, each
// instance's cell, the segments' bases and paddings, the records) and the instances (`syncInstances`), with a compute
// context that keeps nothing (the kernels never run). A pass per member over all members would read about x16.

/** A member: 8 spheres, 100 instances on a line, cells of a few instances */
function member(i: number) {
  const builder = SpheresBuilder.create(8, 2);
  for (let k = 0; k < 8; ++k) builder.add(k, 0, 0, k);
  const transforms = new Float32Array(100 * 16);
  for (let k = 0; k < 100; ++k) {
    Mat4.toArray(Mat4.fromTranslation(Mat4(), Vec3.create(i * 20, k * 10, 0)), transforms, k * 16);
  }
  const props = { ...PD.getDefaultValues(Spheres.Params), cellSize: 30, batchSize: 120 };
  const transform = createTransform(transforms, 100, Sphere3D.create(Vec3(), 9), props.cellSize, props.batchSize);
  const values = Spheres.Utils.createValuesSimple(builder.getSpheres(), props, ColorNames.orange, 1, transform);
  return createRenderObject('spheres', values, Spheres.Utils.createRenderableState(props), -1);
}

const buffer = (byteLength: number) => ({ byteLength, id: 0, write: () => {}, clear: () => {}, destroy: () => {} });
const compute = {
  createBuffer: buffer,
  hasKernels: () => false,
  prepareKernels: () => Promise.resolve(),
} as unknown as ComputeContext;
const resources = {
  texture: () => ({ load: () => {}, destroy: () => {} }),
} as unknown as GraphicsResources;

it('GPU culling syncs the layout and instances of N members', () => {
  const s = scaling(
    {
      setup: (n) => {
        const members = Array.from({ length: n }, (_, i) => member(i));
        const object = createMergedRenderObject(members, { gpuCulling: true }) as unknown as {
          merged: Merged;
          members: { values: MergeableValues }[];
        };
        const values = object.members.map((m) => m.values);
        const culler = createMergedCuller(compute, resources, object.merged, values, true);
        return { culler, values };
      },
      run: ({ culler, values }) => {
        // a layout change: every member's grid
        for (const v of values) ValueCell.update(v.instanceGrid, v.instanceGrid.ref.value);
        culler.sync();
      },
    },
    50,
  );
  checkLinear('merged culler sync, N members', s);
}, 600_000);
