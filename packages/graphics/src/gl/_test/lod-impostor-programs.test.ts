/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { preprocessShader } from '../shader-preprocessor.js';
import { spheres_vert } from '../webgl/shader/spheres.vert.js';
import { spheres_frag } from '../webgl/shader/spheres.frag.js';
import { spheres_wgsl } from '../webgpu/shader/spheres.wgsl.js';

// The impostors draw by programs of their own (`lod-impostor.md`): the last level's (`dLodImpostorLevel`) and the
// band's (`dLodImpostorBand`, the last spheres), per draw; the other levels by the sphere program as it was, whatever the
// object's impostors (`dLodImpostor`): close up, nothing of them is paid.

// per source what only the last level's program has: the axes (vertex), the impostor's surface (fragment)
const sources = [
  ['GLSL vertex', spheres_vert, /vImpostorX = vec4\(normalize/],
  ['GLSL fragment', spheres_frag, /impostorHit/],
  ['WGSL', spheres_wgsl, /impostorHit/],
] as const;

const base = { dGeometryType_spheres: true, dColorType_varying: true, dSegmented: true, dRenderVariant_color: true };
/** `defines` as the preprocessor takes them (names, a value each) */
const run = (source: string, defines: Record<string, boolean>) =>
  preprocessShader(
    // the loop pragmas are the GLSL programs' own (unrolled at compile), not the preprocessor's
    source.replace(/^\s*#pragma unroll_loop_(start|end)\s*$/gm, ''),
    new Map([
      ['__VERSION__', '300'],
      ...Object.keys(defines)
        .filter((k) => defines[k])
        .map((k) => [k, ''] as [string, string]),
    ]),
  );

describe("the impostors' programs", () => {
  it.each(sources)("%s: the sphere program the same with the object's impostors on", (_, source) => {
    const off = run(source, base);
    const on = run(source, { ...base, dLodImpostor: true });
    expect(on).toBe(off);
  });

  it.each(sources)("%s: the band's and the last level's programs add their code", (_, source, levelOnly) => {
    const off = run(source, base);
    const band = run(source, { ...base, dLodImpostor: true, dLodImpostorBand: true });
    const level = run(source, { ...base, dLodImpostor: true, dLodImpostorLevel: true });
    expect(band).not.toBe(off);
    expect(level).not.toBe(band);
    // the band's program: the dither, no impostor
    expect(band).not.toMatch(levelOnly);
    expect(level).toMatch(levelOnly);
  });
});
