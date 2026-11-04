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
import { isSphereRasterEligible } from '../compute/sphere-raster-pass.js';
import type { SpheresValues } from '../renderable/spheres.js';

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

  it('a Look color is the coarse color and does not cover the atoms (GLSL)', () => {
    const shaderCode = GraphicsShaders.find(([n]) => n === 'spheres')![1];
    const values = {
      dRenderVariant: 'colorBlended',
      dColorType: 'texture',
      dLightCount: 1,
      dClipObjectCount: 0,
      dColorLevels: true,
      dOverpaint: true,
      dOverpaintType: 'texture',
    };
    const program = getGlslProgram(shaderCode.name);
    const defines = getProgramDefines(shaderCode, values, []).set('__VERSION__', '300');
    const vert = preprocessProgram(program.vert, defines, values);
    const strength = vert.indexOf('vOverpaint.a *= uOverpaintStrength');
    const painted = vert.indexOf('colorLevels(painted, painted, vec4(element.rgb, 128.0 / 255.0)');
    expect(strength).toBeGreaterThan(0);
    expect(painted).toBeGreaterThan(strength);
    expect(vert.indexOf('vOverpaint.a = 0.0')).toBeGreaterThan(painted);
    const frag = preprocessProgram(program.frag, defines, values);
    expect(frag).not.toMatch(/material\.rgb = mix\(material\.rgb, vOverpaint\.rgb, vOverpaint\.a\)/);
  });

  it('a Look color is the coarse color and does not cover the atoms (WGSL)', () => {
    const defines = new Map([
      ['dRenderVariant_colorBlended', ''],
      ['dColorType_texture', ''],
      ['dColorType_varying', ''],
      ['dColorLevels', ''],
      ['dOverpaint', ''],
      ['dOverpaintType_texture', ''],
    ]);
    const code = preprocessShader(spheres_wgsl, defines);
    const strength = code.indexOf('overpaint.a * uMaterial.uOverpaintStrength');
    const painted = code.indexOf('colorLevels(painted, painted, vec4<f32>(element.rgb, 128.0 / 255.0)');
    expect(strength).toBeGreaterThan(0);
    expect(painted).toBeGreaterThan(strength);
    expect(code).not.toMatch(
      /material = vec4<f32>\(mix\(material\.rgb, in\.vOverpaint\.rgb, in\.vOverpaint\.a\), material\.a\)/,
    );
  });

  // the sphere raster's resolve (`resolveSphere`) reads the theme layers as the vertex stage does: the levels by the
  // sphere's place, set before them
  it('spheres: the raster resolve sets the model position before the levels read it (WGSL)', () => {
    const defines = new Map([
      ['dRenderVariant_color', ''],
      ['dColorType_texture', ''],
      ['dColorLevels', ''],
      ['dSphereResolve', ''],
    ]);
    const code = preprocessShader(spheres_wgsl, defines);
    const resolve = code.slice(code.indexOf('fn resolveSphere('));
    const position = resolve.indexOf('out.vModelPosition =');
    expect(position).toBeGreaterThan(0);
    expect(position).toBeLessThan(resolve.indexOf('colorLevelSize(out.vModelPosition)'));
  });

  // the raster clips pixels by the clipping layer's values as flags: a clipping table's rows are not
  it('spheres: not drawn by the raster with a clipping table, as before with the levels', () => {
    const values = createSpheres().values as unknown as SpheresValues;
    expect(isSphereRasterEligible(values)).toBe(true);
    ValueCell.update(values.dColorType, 'texture');
    ValueCell.update(values.dColorLevels, true);
    expect(isSphereRasterEligible(values)).toBe(true);
    ValueCell.update(values.dClipObjects, true);
    ValueCell.update(values.dClipping, true);
    expect(isSphereRasterEligible(values)).toBe(true);
    ValueCell.update(values.dClipTable, true);
    expect(isSphereRasterEligible(values)).toBe(false);
  });

  // spheres need frag depth (impostors), meshes do not: each compiled where the backend can
  for (const [name, create, required] of [
    ['spheres', createSpheres, { fragDepth: true }],
    ['mesh', createMesh, {}],
  ] as const) {
    const ctx = tryGetGLContext(32, 32, required);
    (ctx ? it : it.skip)(`${name}: compiles with the levels on and off (native GL)`, { tags: ['medium'] }, async () => {
      const ctx = getGLContext(32, 32);
      const levelsOn = (o: GraphicsRenderObject) => {
        const v = o.values as unknown as { dColorLevels: ValueCell<boolean>; dColorType: ValueCell<string> };
        ValueCell.update(v.dColorType, 'texture');
        ValueCell.update(v.dColorLevels, true);
        return o;
      };
      setDebugMode(true);
      try {
        for (const object of [create(), levelsOn(create())]) {
          const scene = Scene.create(ctx);
          scene.add(object);
          expect(() => scene.commit()).not.toThrow();
        }
      } finally {
        setDebugMode(false);
        ctx.destroy();
      }
    });
  }
});
