/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { mesh_wgsl } from '../webgpu/shader/mesh.wgsl.js';
import { preprocessShader } from '../shader-preprocessor.js';

// A mesh's patch texture (`MeshSchema.dPatchTexture`; its pixels: plugin-headless's webgpu-patch-texture.test.ts) is a
// colour: read where colour is drawn, not in the depth, pick or marking variants (review X2).

const Call = /material = vec4<f32>\(patchColor\(/;

describe('the patch texture in the mesh’s variants (WGSL)', () => {
  for (const variant of ['colorBlended', 'colorWboit', 'colorDpoit', 'emissive', 'tracing']) {
    it(`${variant}: read`, () => {
      const defines = new Map([
        [`dRenderVariant_${variant}`, ''],
        ['dPatchTexture', ''],
      ]);
      expect(preprocessShader(mesh_wgsl, defines)).toMatch(Call);
    });
  }
  for (const variant of ['depth', 'pick', 'marking']) {
    it(`${variant}: not read`, () => {
      const defines = new Map([
        [`dRenderVariant_${variant}`, ''],
        ['dPatchTexture', ''],
      ]);
      expect(preprocessShader(mesh_wgsl, defines)).not.toMatch(Call);
    });
  }
});
