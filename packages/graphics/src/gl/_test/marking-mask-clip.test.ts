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

// Which variants carry the vertex-stage skip of spheres the pass discards whole (sphere-impostors.md): a lock on the
// guards only. That the skip draws the same image is the rendered tests' (`canvas3d/_test/sphere-skip-draw.test.ts`,
// native GL; `plugin/headless/_test/webgpu-sphere-skip.test.ts`, Dawn).

const MarkSkip = 'uMarkingType != 1 && marker == 0.0';
const PassSkip = 'uAlpha == 1.0 && uAlphaThickness == 0.0';
const MarkSkipWgsl = 'uGlobal.uMarkingType != 1 && markerValue == 0.0';
const PassSkipWgsl = 'uMaterial.uAlpha == 1.0 && uObject.uAlphaThickness == 0.0';
const Transparency = { dTransparency: true, dTransparencyType: 'texture' };

function glsl(name: string, variant: string, extra: Record<string, string | boolean> = {}) {
  const shader = GraphicsShaders.find(([n]) => n === name);
  if (!shader) throw new Error(name);
  const program = getGlslProgram(shader[1].name);
  const values = { dRenderVariant: variant, dNeedsMarker: true, dLightCount: 1, ...extra };
  const defines = getProgramDefines(shader[1], values, []).set('__VERSION__', '300');
  return preprocessProgram(program.vert, defines, values);
}

function wgsl(code: string, ...defines: string[]) {
  return preprocessShader(code, new Map(defines.map((d) => [d, ''])));
}

/** The skip at `guard` leaves before the projection: its position out of the clip volume, then a return */
function expectSkipBeforeProjection(code: string, guard: string, out: string) {
  const at = code.indexOf(guard);
  const projection = code.indexOf('sphereProjection(mvPosition');
  expect(at).toBeGreaterThan(-1);
  expect(projection).toBeGreaterThan(at);
  const skip = code.slice(at, projection);
  expect(skip).toMatch(new RegExp(`${out} = vec4(<f32>)?\\(2\\.0, 2\\.0, 2\\.0, 1\\.0\\);\\s*return`));
}

describe('the spheres skipped in the vertex stage', () => {
  it('the marking mask: in the marking variant of spheres, before the projection; not in the mesh', () => {
    expectSkipBeforeProjection(glsl('spheres', 'marking'), MarkSkip, 'gl_Position');
    expect(glsl('spheres', 'colorBlended')).not.toContain(MarkSkip);
    expect(glsl('mesh', 'marking')).not.toContain(MarkSkip);
    expect(glsl('spheres', 'marking', { dNoVertexSkip: true })).not.toContain(MarkSkip);

    expectSkipBeforeProjection(
      wgsl(spheres_wgsl, 'dRenderVariant_marking', 'dNeedsMarker'),
      MarkSkipWgsl,
      'out.position',
    );
    expect(wgsl(spheres_wgsl, 'dRenderVariant_colorBlended')).not.toContain(MarkSkipWgsl);
    expect(wgsl(mesh_wgsl, 'dRenderVariant_marking', 'dNeedsMarker')).not.toContain('uGlobal.uMarkingType != 1');
    expect(wgsl(spheres_wgsl, 'dRenderVariant_marking', 'dNeedsMarker', 'dNoVertexSkip')).not.toContain(MarkSkipWgsl);
  });

  it('the opaque and transparent passes: with a transparency, not where alpha is decided per fragment or vertex', () => {
    expectSkipBeforeProjection(glsl('spheres', 'colorBlended', Transparency), PassSkip, 'gl_Position');
    // a transparency by volume: the value the varying samples at the sphere's center, before the skip reads it
    const volume = glsl('spheres', 'colorBlended', { dTransparency: true, dTransparencyType: 'volumeInstance' });
    expectSkipBeforeProjection(volume, PassSkip, 'gl_Position');
    expect(volume.indexOf('vTransparency = texture3dFrom2dLinear(tTransparencyGrid')).toBeGreaterThan(-1);
    expect(volume.indexOf(PassSkip)).toBeGreaterThan(volume.indexOf('vTransparency = texture3dFrom2dLinear'));
    for (const extra of [
      { dXrayShaded: 'on' },
      { dXrayShaded: 'inverted' },
      { dTransparentBackfaces: 'opaque' },
      { dTransparencyType: 'vertexInstance' },
      { dNoVertexSkip: true },
    ]) {
      expect(glsl('spheres', 'colorBlended', { ...Transparency, ...extra }), JSON.stringify(extra)).not.toContain(
        PassSkip,
      );
    }
    expect(glsl('spheres', 'marking', Transparency)).not.toContain(PassSkip);
    expect(glsl('mesh', 'colorBlended', Transparency)).not.toContain(PassSkip);

    const base = ['dRenderVariant_colorBlended', 'dTransparency', 'dTransparencyType_texture'];
    expectSkipBeforeProjection(wgsl(spheres_wgsl, ...base), PassSkipWgsl, 'out.position');
    const volumeWgsl = wgsl(
      spheres_wgsl,
      'dRenderVariant_colorBlended',
      'dTransparency',
      'dTransparencyType_volumeInstance',
    );
    expectSkipBeforeProjection(volumeWgsl, PassSkipWgsl, 'out.position');
    expect(volumeWgsl.indexOf(PassSkipWgsl)).toBeGreaterThan(volumeWgsl.indexOf('out.vTransparency = '));
    for (const extra of ['dXrayShaded_on', 'dXrayShaded_inverted', 'dTransparentBackfaces_opaque', 'dNoVertexSkip']) {
      expect(wgsl(spheres_wgsl, ...base, extra), extra).not.toContain(PassSkipWgsl);
    }
    const perVertex = wgsl(
      spheres_wgsl,
      'dRenderVariant_colorBlended',
      'dTransparency',
      'dTransparencyType_vertexInstance',
    );
    expect(perVertex).not.toContain(PassSkipWgsl);
    expect(wgsl(spheres_wgsl, 'dRenderVariant_marking', 'dTransparency', 'dTransparencyType_texture')).not.toContain(
      PassSkipWgsl,
    );
    expect(wgsl(mesh_wgsl, ...base)).not.toContain(PassSkipWgsl);
  });
});
