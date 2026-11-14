/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { getGlslProgram } from '../webgl/programs.js';
import { mesh_wgsl } from '../webgpu/shader/mesh.wgsl.js';
import { preprocessShader } from '../shader-preprocessor.js';
import { GraphicsShaders, getProgramDefines, preprocessProgram } from './graphics-shaders.js';

// A color grid read per fragment (`dColorGridFragment`, the grid color types): the fragment stage samples the grid at
// the interpolated grid position, so a triangle shows the grid's detail between its vertices; without it the vertex
// stage samples it and the triangle interpolates its vertices' colors, as before.

const mesh = GraphicsShaders.find(([n]) => n === 'mesh')![1];

function glsl(values: { [k: string]: string | boolean | number }) {
  const program = getGlslProgram(mesh.name);
  const all = { dColorType: 'grid', dLightCount: 1, dClipObjectCount: 0, ...values };
  const defines = getProgramDefines(mesh, all, []).set('__VERSION__', '300');
  return { vert: preprocessProgram(program.vert, defines, all), frag: preprocessProgram(program.frag, defines, all) };
}

const FragmentSample = /texture3dFrom2dLinear\(tColorGrid, vColorGridPosition/;

describe('color grid read per fragment (GLSL)', () => {
  it('samples the grid in the fragment stage with the flag, in the vertex stage only without', () => {
    const on = glsl({ dRenderVariant: 'colorBlended', dColorGridFragment: true });
    expect(on.vert).toMatch(/vColorGridPosition = cgridPos/);
    expect(on.frag).toMatch(FragmentSample);
    expect(on.frag).toMatch(/vec4 material = vec4\(varyingColor, uAlpha\)/);

    const off = glsl({ dRenderVariant: 'colorBlended' });
    expect(off.vert).not.toMatch(/vColorGridPosition/);
    expect(off.frag).not.toMatch(/tColorGrid/);
    expect(off.frag).toMatch(/vec4 material = vec4\(varyingColor, uAlpha\)/);
    expect(off.frag).toMatch(/vec3 varyingColor = vColor\.rgb/);
  });

  it('reads the palette coordinate of the color sampled per fragment', () => {
    const { frag } = glsl({ dRenderVariant: 'colorBlended', dColorGridFragment: true, dUsePalette: true });
    expect(frag).toMatch(FragmentSample);
    expect(frag).toMatch(/float paletteV = \(\(varyingColor\.r/);
    expect(frag).toMatch(/texture2D\(tPalette, vec2\(paletteV, 0\.5\)\)/);
  });

  it('glows with the color sampled per fragment (emissive)', () => {
    const { frag } = glsl({ dRenderVariant: 'emissive', dColorGridFragment: true });
    expect(frag).toMatch(FragmentSample);
    expect(frag).toMatch(/vec3 emissiveColor = varyingColor/);
  });

  it('is ignored by the variants without color (pick, depth, marking)', () => {
    for (const dRenderVariant of ['pick', 'depth', 'marking']) {
      const { vert, frag } = glsl({ dRenderVariant, dColorGridFragment: true });
      expect(vert).not.toMatch(/vColorGridPosition/);
      expect(frag).not.toMatch(/vColorGridPosition/);
    }
  });
});

describe('color grid read per fragment (WGSL)', () => {
  const base = [
    ['dRenderVariant_colorBlended', ''],
    ['dColorType_grid', ''],
    ['dColorType_varying', ''],
  ] as const;

  it('samples the grid in the fragment stage with the flag, in the vertex stage only without', () => {
    const on = preprocessShader(mesh_wgsl, new Map([...base, ['dColorGridFragment', '']]));
    expect(on).toMatch(/@location\(7\) vColorGridPosition: vec3<f32>/);
    expect(on).toMatch(/out\.vColorGridPosition = /);
    expect(on).toMatch(/let varyingColor = colorGridFragment\(in\.vColorGridPosition\)/);
    expect(on).toMatch(/var material = vec4<f32>\(varyingColor\.rgb, uMaterial\.uAlpha\)/);

    const off = preprocessShader(mesh_wgsl, new Map(base));
    expect(off).not.toMatch(/vColorGridPosition/);
    expect(off).toMatch(/let varyingColor = in\.vColor/);
  });

  it('reads the palette coordinate and glows with the color sampled per fragment', () => {
    const palette = preprocessShader(mesh_wgsl, new Map([...base, ['dColorGridFragment', ''], ['dUsePalette', '']]));
    expect(palette).toMatch(/sample_tPalette\(vec2<f32>\(varyingColor\.w, 0\.5\)\)/);
    const emissive = preprocessShader(
      mesh_wgsl,
      new Map([
        ['dRenderVariant_emissive', ''],
        ['dColorType_grid', ''],
        ['dColorType_varying', ''],
        ['dColorGridFragment', ''],
      ]),
    );
    expect(emissive).toMatch(/var emissiveColor = varyingColor\.rgb/);
  });
});
