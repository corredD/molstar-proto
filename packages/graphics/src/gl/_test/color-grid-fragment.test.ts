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

// at the cell centers: half a cell added in x and y (see 'the 2d layout of a grid read as the shaders read it')
const FragmentSample =
  /texture3dFrom2dLinear\(tColorGrid, vColorGridPosition \+ vec3\(0\.5 \/ uColorGridDim\.xy, 0\.0\), uColorGridDim, uColorGridTexDim\)/;

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
    expect(on).toMatch(/let offset = vec3<f32>\(0\.5 \/ uObject\.uColorGridDim\.xy, 0\.0\);/);
    expect(on).toMatch(/texture3dFrom2dLinear_tColorGrid\(pos \+ offset\)/);
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

// `texture3dFrom2dLinear` as the shaders read it (a slice's texels linear, as a texture's, the slices mixed by z): a
// cell (i, j, k) of a grid is at (i + ½, j + ½, k) / dim, half a cell off in x and y, which the fragment lookup adds
describe('the 2d layout of a grid read as the shaders read it', () => {
  /** A 2d texture of `width` × `height` single values, read linearly at (u, v), clamped at its edges */
  function texture2D(image: Float32Array, width: number, height: number, u: number, v: number) {
    const at = (x: number, y: number) =>
      image[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))];
    const x = u * width - 0.5;
    const y = v * height - 0.5;
    const [x0, y0] = [Math.floor(x), Math.floor(y)];
    const [fx, fy] = [x - x0, y - y0];
    const a = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
    const b = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
    return a * (1 - fy) + b * fy;
  }
  /** `texture3dFrom2dLinear` (GLSL), for a layout of one row of slices */
  function texture3d(image: Float32Array, dim: number[], texDim: number[], pos: number[]) {
    const slice = (z: number) =>
      texture2D(image, texDim[0], texDim[1], (z * dim[0] + pos[0] * dim[0]) / texDim[0], (pos[1] * dim[1]) / texDim[1]);
    const z0 = Math.floor(pos[2] * dim[2]);
    const d = pos[2] * dim[2] - z0;
    return slice(z0) * (1 - d) + slice(z0 + 1) * d;
  }

  it("reads a cell's own value at its center plus half a cell in x and y, a mix of its neighbors without", () => {
    const dim = [4, 3, 2];
    const texDim = [dim[0] * dim[2], dim[1]];
    const image = new Float32Array(texDim[0] * texDim[1]);
    const value = (i: number, j: number, k: number) => i + 10 * j + 100 * k;
    for (let k = 0; k < dim[2]; k++) {
      for (let j = 0; j < dim[1]; j++) {
        for (let i = 0; i < dim[0]; i++) image[j * texDim[0] + k * dim[0] + i] = value(i, j, k);
      }
    }
    for (const [i, j, k] of [
      [1, 1, 0],
      [2, 1, 1],
      [0, 0, 0],
    ]) {
      const atCenter = texture3d(image, dim, texDim, [(i + 0.5) / dim[0], (j + 0.5) / dim[1], k / dim[2]]);
      expect(atCenter).toBeCloseTo(value(i, j, k), 6);
    }
    expect(texture3d(image, dim, texDim, [2 / dim[0], 1 / dim[1], 0])).not.toBeCloseTo(value(2, 1, 0), 1);
  });
});
