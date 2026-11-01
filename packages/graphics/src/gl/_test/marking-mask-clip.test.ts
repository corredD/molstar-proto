/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { getGlslProgram } from '../webgl/programs.js';
import { mesh_wgsl } from '../webgpu/shader/mesh.wgsl.js';
import { spheres_wgsl } from '../webgpu/shader/spheres.wgsl.js';
import { preprocessShader } from '../shader-preprocessor.js';
import { GraphicsShaders, getProgramDefines, preprocessProgram } from './graphics-shaders.js';

// The marking mask draws marked fragments only (`apply-marking` discards marker 0). A sphere's quad
// shares one marker, so an unmarked instance can leave before the projection. A mesh triangle's
// vertices can differ, and clipping one of them would change the primitive: the mesh keeps the
// fragment discard. The depth pass (`uMarkingType` 1) keeps unmarked spheres, so the guard stays.

const Clip = 'uMarkingType != 1 && marker == 0.0';
/** The color pass drops this instance: nothing it would rasterize survives the mask. */
const PassClip = 'uAlpha == 1.0 && uAlphaThickness == 0.0';

function glsl(name: string, variant: string, extra: Record<string, string | boolean> = {}) {
  const shader = GraphicsShaders.find(([n]) => n === name);
  if (!shader) throw new Error(name);
  const program = getGlslProgram(shader[1].name);
  const values = { dRenderVariant: variant, dNeedsMarker: true, dLightCount: 1, ...extra };
  const defines = getProgramDefines(shader[1], values, []).set('__VERSION__', '300');
  return preprocessProgram(program.vert, defines, values);
}

describe('sphere marking mask', () => {
  it('clips an unmarked instance before the projection, and the color shader does not', () => {
    const marking = glsl('spheres', 'marking');
    const at = marking.indexOf(Clip);
    expect(at).toBeGreaterThan(-1);
    expect(marking.indexOf('sphereProjection(mvPosition')).toBeGreaterThan(at);
    expect(glsl('spheres', 'colorBlended')).not.toContain(Clip);
  });

  it('does not clip a mesh vertex (its triangle can mix markers)', () => {
    expect(glsl('mesh', 'marking')).not.toContain(Clip);
  });

  it('does the same in WGSL, and the mesh shader does not', () => {
    const marking = preprocessShader(
      spheres_wgsl,
      new Map([
        ['dRenderVariant_marking', ''],
        ['dNeedsMarker', ''],
      ]),
    );
    const at = marking.indexOf('uGlobal.uMarkingType != 1 && markerValue == 0.0');
    expect(at).toBeGreaterThan(-1);
    expect(marking.indexOf('sphereProjection(mvPosition')).toBeGreaterThan(at);
    const color = preprocessShader(spheres_wgsl, new Map([['dRenderVariant_colorBlended', '']]));
    expect(color).not.toContain('uGlobal.uMarkingType != 1');
    const mesh = preprocessShader(
      mesh_wgsl,
      new Map([
        ['dRenderVariant_marking', ''],
        ['dNeedsMarker', ''],
      ]),
    );
    expect(mesh).not.toContain('uGlobal.uMarkingType != 1');
  });
});

describe('sphere transparency pass', () => {
  const extra = { dTransparency: true, dTransparencyType: 'texture' };

  it('skips an instance the pass would discard, before the projection', () => {
    const color = glsl('spheres', 'colorBlended', extra);
    const at = color.indexOf(PassClip);
    expect(at).toBeGreaterThan(-1);
    expect(color.indexOf('sphereProjection(mvPosition')).toBeGreaterThan(at);
    expect(color).toContain('uRenderMask == MaskOpaque && ta < 1.0');
  });

  it('stays out of the variants where alpha is decided per fragment', () => {
    expect(glsl('spheres', 'colorBlended', { ...extra, dXrayShaded: 'on' })).not.toContain(PassClip);
    expect(glsl('spheres', 'colorBlended', { ...extra, dTransparentBackfaces: 'opaque' })).not.toContain(PassClip);
    expect(glsl('spheres', 'colorBlended', { dTransparency: true, dTransparencyType: 'vertexInstance' })).not.toContain(
      PassClip,
    );
    expect(glsl('spheres', 'marking', extra)).not.toContain(PassClip);
    expect(glsl('mesh', 'colorBlended', extra)).not.toContain(PassClip);
  });

  it('does the same in WGSL', () => {
    const defines = new Map([
      ['dRenderVariant_colorBlended', ''],
      ['dTransparency', ''],
      ['dTransparencyType_texture', ''],
    ]);
    const color = preprocessShader(spheres_wgsl, defines);
    const at = color.indexOf('uMaterial.uAlpha == 1.0 && uObject.uAlphaThickness == 0.0');
    expect(at).toBeGreaterThan(-1);
    expect(color.indexOf('sphereProjection(mvPosition')).toBeGreaterThan(at);
    const xray = preprocessShader(spheres_wgsl, new Map([...defines, ['dXrayShaded_on', '']]));
    expect(xray).not.toContain('uObject.uAlphaThickness == 0.0');
    const mesh = preprocessShader(mesh_wgsl, defines);
    expect(mesh).not.toContain('uObject.uAlphaThickness == 0.0');
  });
});
