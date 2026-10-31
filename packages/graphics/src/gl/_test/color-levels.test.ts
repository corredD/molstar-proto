/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { setDebugMode } from '@molstar/core/util/debug';
import { ValueCell } from '@molstar/core/util/value-cell';
import { getGlslProgram } from '../webgl/programs.js';
import { mesh_wgsl } from '../webgpu/shader/mesh.wgsl.js';
import { spheres_wgsl } from '../webgpu/shader/spheres.wgsl.js';
import { preprocessShader } from '../shader-preprocessor.js';
import { Scene } from '../scene.js';
import type { GraphicsRenderObject } from '../render-object.js';
import { getGLContext, tryGetGLContext } from './gl.js';
import { GraphicsShaders, getProgramDefines, preprocessProgram } from './graphics-shaders.js';
import { createMesh } from './mesh.test.js';
import { createSpheres } from './spheres.test.js';

// Colors by size on screen (color-levels.md): with the levels off, the programs hold none of their code (the programs
// of before, as every object draws them); on, they compile (GLSL on the native backend, WebGL1).

const LevelsCode = /toOklab|fromOklab|colorLevel|tColorFar|tColorNear/;

describe('color levels in the programs', () => {
  for (const [name, shaderCode] of GraphicsShaders.filter(([n]) => n === 'spheres' || n === 'mesh')) {
    it(`${name}: none of their code with the levels off, theirs with them on (GLSL)`, () => {
      const values = { dRenderVariant: 'colorBlended', dColorType: 'texture', dLightCount: 1, dClipObjectCount: 0 };
      const program = getGlslProgram(shaderCode.name);
      const off = getProgramDefines(shaderCode, values, []).set('__VERSION__', '300');
      const on = getProgramDefines(shaderCode, { ...values, dColorLevels: true }, []).set('__VERSION__', '300');
      expect(preprocessProgram(program.vert, off, values)).not.toMatch(LevelsCode);
      expect(preprocessProgram(program.frag, off, values)).not.toMatch(LevelsCode);
      expect(preprocessProgram(program.vert, on, values)).toMatch(/colorLevels\(vColor\.rgb/);
    });
  }

  for (const [name, source] of [
    ['spheres', spheres_wgsl],
    ['mesh', mesh_wgsl],
  ] as const) {
    it(`${name}: none of their code with the levels off, theirs with them on (WGSL)`, () => {
      const defines = new Map([
        ['dRenderVariant_colorBlended', ''],
        ['dColorType_texture', ''],
        ['dColorType_varying', ''],
      ]);
      expect(preprocessShader(source, defines)).not.toMatch(LevelsCode);
      expect(preprocessShader(source, new Map([...defines, ['dColorLevels', '']]))).toMatch(/colorLevels\(out\.vColor/);
    });
  }

  const ctx = tryGetGLContext(32, 32, { fragDepth: true });
  (ctx ? it : it.skip)('compile with the levels on and off (native GL)', { tags: ['medium'] }, async () => {
    const ctx = getGLContext(32, 32);
    const levelsOn = (o: GraphicsRenderObject) => {
      const v = o.values as unknown as { dColorLevels: ValueCell<boolean>; dColorType: ValueCell<string> };
      ValueCell.update(v.dColorType, 'texture');
      ValueCell.update(v.dColorLevels, true);
      return o;
    };
    setDebugMode(true);
    try {
      for (const objects of [
        [createSpheres(), createMesh()],
        [levelsOn(createSpheres()), levelsOn(createMesh())],
      ]) {
        const scene = Scene.create(ctx);
        for (const o of objects) scene.add(o);
        expect(() => scene.commit()).not.toThrow();
      }
    } finally {
      setDebugMode(false);
      ctx.destroy();
    }
  });
});
