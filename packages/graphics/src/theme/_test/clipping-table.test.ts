/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { ValueCell } from '@molstar/core/util/value-cell';
import { getProgramDefines, preprocessProgram } from '../../gl/_test/graphics-shaders.js';
import { SpheresShaderCode } from '../../gl/shader-code.js';
import { preprocessShader } from '../../gl/shader-preprocessor.js';
import { getGlslProgram } from '../../gl/webgl/programs.js';
import { clip_table, common_clip } from '../../gl/webgl/shader/chunks/common-clip.glsl.js';
import { getWgslDefines } from '../../gl/webgpu/program.js';
import { clip_table_wgsl } from '../../gl/webgpu/shader/chunks/clip.wgsl.js';
import { resolveWgslSource } from '../../gl/webgpu/shader/programs.js';
import { spheres_wgsl } from '../../gl/webgpu/shader/spheres.wgsl.js';
import { Clipping } from '../clipping.js';

// The clipping table's rule (`Clipping.isCut`), the one the instance clip runs in both backends' vertex stage, and its
// stable random (`Clipping.random`): cellVIEW's object-space cut at full strength (apps/prism-me/_spec/cellview.md
// §4.1), as the Mesoscale Explorer's mock draws it (`isCut`, `stableRandom` in apps/prism-me/src/_stories/proposed.tsx).

/** cellVIEW's Wang hash as the mock writes it */
function mockRandom(id: number): number {
  let h = id >>> 0;
  h = h ^ 61 ^ (h >>> 16);
  h = Math.imul(h, 9);
  h ^= h >>> 4;
  h = Math.imul(h, 0x27d4eb2d);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const cell = (mode: Clipping.Mode, band = 10, fuzziness = 0): Clipping.Cell => ({ mode, band, fuzziness });

/** The spheres' vertex stage, preprocessed, with clip objects and a table or not */
const values = (variant: 'instance' | 'pixel', table: boolean) => ({
  dRenderVariant: 'colorBlended',
  dGeometryType: 'spheres',
  dColorType: 'uniform',
  dLightCount: 1,
  dClipObjects: true,
  dClipObjectCount: 8,
  dClipVariant: variant,
  dClipping: true,
  dClipTable: table,
});
const vertexWgsl = (v: ReturnType<typeof values> = values('instance', true)) => {
  const cells: { [k: string]: ValueCell<any> } = {};
  for (const k of Object.keys(v)) cells[k] = ValueCell.create((v as any)[k]);
  const code = preprocessShader(resolveWgslSource(spheres_wgsl, cells), getWgslDefines(cells), {
    expandMacros: true,
  });
  return code.slice(code.indexOf('fn vertexMain('), code.indexOf('fn fragmentMain('));
};
const vertexGlsl = (v: ReturnType<typeof values> = values('instance', true)) => {
  const defines = getProgramDefines(SpheresShaderCode, v, ['requiredDrawBuffers', 'enabledFragDepth']);
  defines.set('__VERSION__', '300');
  const vert = preprocessProgram(getGlslProgram(SpheresShaderCode.name).vert, defines, v);
  return vert.slice(vert.indexOf('void main'));
};

describe('Clipping.random', () => {
  it("is the mock's Wang hash to its top 24 bits, exact in a 32-bit float, in [0, 1)", () => {
    for (const id of [0, 1, 2, 7, 255, 256, 65535, 1 << 20, (1 << 24) - 1]) {
      expect(Math.abs(Clipping.random(id) - mockRandom(id))).toBeLessThan(2 ** -24);
      expect(Math.fround(Clipping.random(id))).toBe(Clipping.random(id));
      expect(Clipping.random(id)).toBeGreaterThanOrEqual(0);
      expect(Clipping.random(id)).toBeLessThan(1);
    }
  });

  it('has the same constants in the GLSL and WGSL table chunks', () => {
    for (const code of [clip_table, clip_table_wgsl]) {
      expect(code).toMatch(/\^ 61u/);
      expect(code).toMatch(/\*= 9u/);
      expect(code).toMatch(/>> 4u/);
      expect(code).toMatch(/0x27d4eb2du/);
      expect(code).toMatch(/>> 15u/);
      expect(code).toMatch(/>> 8u\) \/ 16777216\.0/);
    }
  });
});

describe('Clipping.randomAt', () => {
  it("keys an instance by its place (the bits of its transform's translation), not its index", () => {
    const at = (x: number, y: number, z: number) => Clipping.randomAt(Math.fround(x), Math.fround(y), Math.fround(z));
    expect(at(10.5, -3.25, 7)).toBe(at(10.5, -3.25, 7));
    // two instances, two places: two randoms; about uniform over many places
    expect(at(10.5, -3.25, 7)).not.toBe(at(10.5, -3.25, 7.001));
    let below = 0;
    for (let i = 0; i < 1000; ++i) if (at(i * 3.1, (i % 7) * 11.3, -i * 0.7) < 0.3) below += 1;
    expect(below).toBeGreaterThan(240);
    expect(below).toBeLessThan(360);
  });

  it('is what the instance clips hash: the translation of aTransform, in both backends', () => {
    expect(vertexGlsl()).toMatch(/clipTableTest\([^;]*aTransform\[3\]\.xyz\)/);
    expect(vertexWgsl()).toMatch(/clipTableTest\([^;]*aTransform\[3\]\.xyz\)/);
    expect(clip_table).toMatch(/floatBitsToUint/);
    expect(clip_table_wgsl).toMatch(/bitcast<vec3<u32>>/);
  });
});

describe('Clipping.isCut', () => {
  it('cut: removes what is inside, whatever the band', () => {
    expect(Clipping.isCut(cell('cut', 10, 1), -1, 0.5)).toBe(true);
    expect(Clipping.isCut(cell('cut', 10, 1), -100, 0.5)).toBe(true);
    expect(Clipping.isCut(cell('cut', 10, 1), 1, 0.5)).toBe(false);
  });

  it('ignore: removes nothing', () => {
    expect(Clipping.isCut(cell('ignore'), -1, 0.5)).toBe(false);
    expect(Clipping.isCut(cell('ignore'), 1, 0.5)).toBe(false);
  });

  it('keep: keeps a layer of the band inside, cuts deeper, leaves the outside', () => {
    expect(Clipping.isCut(cell('keep', 10), -1, 0.99)).toBe(false);
    expect(Clipping.isCut(cell('keep', 10), -9.9, 0.99)).toBe(false);
    expect(Clipping.isCut(cell('keep', 10), -10.1, 0)).toBe(true);
    expect(Clipping.isCut(cell('keep', 10), 5, 0)).toBe(false);
  });

  it('wider: cuts the band outside too, and all inside', () => {
    expect(Clipping.isCut(cell('wider', 10), 1, 0.99)).toBe(true);
    expect(Clipping.isCut(cell('wider', 10), 9.9, 0.99)).toBe(true);
    expect(Clipping.isCut(cell('wider', 10), 10.1, 0)).toBe(false);
    expect(Clipping.isCut(cell('wider', 10), -50, 0.5)).toBe(true);
  });

  it('fuzziness thins the band toward its edge: full strength at the surface, 1 − fuzziness at the edge', () => {
    // at the surface (nd 0) every instance is affected, whatever the fuzziness
    expect(Clipping.isCut(cell('keep', 10, 1), -0, 0)).toBe(false);
    // halfway (nd 0.5) at fuzziness 1: those with r < 0.5 pass (unaffected), the others are affected
    expect(Clipping.isCut(cell('keep', 10, 1), -5, 0.4)).toBe(true);
    expect(Clipping.isCut(cell('keep', 10, 1), -5, 0.6)).toBe(false);
    expect(Clipping.isCut(cell('wider', 10, 1), 5, 0.4)).toBe(false);
    expect(Clipping.isCut(cell('wider', 10, 1), 5, 0.6)).toBe(true);
    // near the edge at fuzziness 0.5: affected with probability 1 − 0.5 · nd
    expect(Clipping.isCut(cell('keep', 10, 0.5), -9.9, 0.4)).toBe(true);
    expect(Clipping.isCut(cell('keep', 10, 0.5), -9.9, 0.6)).toBe(false);
  });

  it("matches the mock's rule over a sweep", () => {
    const mock = (bias: 'keep' | 'cut' | 'wider', d: number, band: number, f: number, r: number) => {
      const inside = d <= 0;
      if (bias === 'cut') return inside;
      const nd = Math.abs(d) / Math.max(band, 0.01);
      const passes = nd > 1 || r < f * nd;
      return bias === 'keep' ? inside && passes : inside || !passes;
    };
    for (const mode of ['keep', 'cut', 'wider'] as const) {
      for (let d = -30; d <= 30; d += 1.5) {
        for (const f of [0, 0.3, 1]) {
          for (const r of [0, 0.2, 0.5, 0.9]) {
            expect(Clipping.isCut(cell(mode, 20, f), d, r)).toBe(mock(mode, d, 20, f, r));
          }
        }
      }
    }
  });
});

describe('Clipping tables', () => {
  const layer = { loci: { kind: 'every-loci' } as any, groups: Clipping.Groups.create(0) };

  it('are equal by their cells and rows, and differ by any cell', () => {
    const a: Clipping = { kind: 'element-loci', layers: [{ ...layer, row: 1 }], table: [[], [cell('keep', 10, 0.5)]] };
    const b: Clipping = { kind: 'element-loci', layers: [{ ...layer, row: 1 }], table: [[], [cell('keep', 10, 0.5)]] };
    expect(Clipping.areEqual(a, b)).toBe(true);
    expect(Clipping.areEqual(a, { ...b, table: [[], [cell('keep', 12, 0.5)]] })).toBe(false);
    expect(Clipping.areEqual(a, { ...b, table: [[], [cell('wider', 10, 0.5)]] })).toBe(false);
    expect(Clipping.areEqual(a, { ...b, table: undefined })).toBe(false);
    expect(Clipping.areEqual(a, { ...b, layers: [{ ...layer, row: 2 }] })).toBe(false);
  });

  it('encode a cell per (row, clip object), a missing one cutting', () => {
    const data = Clipping.tableData([[undefined, cell('ignore')], [cell('keep', 60, 0.25)]]);
    expect(data.length).toBe(2 * Clipping.TableWidth * 4);
    const at = (row: number, i: number) =>
      Array.from(data.slice((row * Clipping.TableWidth + i) * 4, (row * Clipping.TableWidth + i) * 4 + 3));
    expect(at(0, 0)).toEqual([Clipping.ModeCode.cut, 0, 0]);
    expect(at(0, 1)).toEqual([Clipping.ModeCode.ignore, 10, 0]);
    expect(at(1, 0)).toEqual([Clipping.ModeCode.keep, 60, 0.25]);
    expect(at(1, 5)).toEqual([Clipping.ModeCode.cut, 0, 0]);
  });
});

describe('the instance clip with a table', () => {
  it('tests each instance by its row (WGSL and GLSL), the flag the ignored objects of the row', () => {
    for (const main of [vertexWgsl(values('instance', true)), vertexGlsl(values('instance', true))]) {
      expect(main).toMatch(/clipTableTest\(/);
      expect(main).toMatch(/clipTableIgnored\(/);
      expect(main).not.toMatch(/clipTest\(/);
    }
  });

  it('keeps the plain test without a table, and the pixel clip reads the row as a flag', () => {
    for (const main of [vertexWgsl(values('instance', false)), vertexGlsl(values('instance', false))]) {
      expect(main).toMatch(/clipTest\(/);
      expect(main).not.toMatch(/clipTable/);
    }
    for (const main of [vertexWgsl(values('pixel', true)), vertexGlsl(values('pixel', true))]) {
      expect(main).toMatch(/clipTableIgnored\(/);
      expect(main).not.toMatch(/clipTableTest\(/);
    }
  });
});

describe("WebGL1's clipping flag", () => {
  /** WebGL1's `bitwiseAnd` of `common_clip`, run as JS (its declarations made `let`) */
  const bitwiseAnd = (() => {
    const source = common_clip.slice(common_clip.indexOf('int bitwiseAnd('));
    const body = source.slice(source.indexOf('{') + 1, source.indexOf(';', source.indexOf('return ')));
    const js = body.replace(/\b(?:int|float)\s+(\w+)\s*=/g, 'let $1 =').replace(/\b(?:int|float)\(/g, 'Math.trunc(');
    // biome-ignore lint/nursery/noImpliedEval: the shader's own text, run as JS: no WebGL1 context in the tests
    return new Function('a', 'b', `${js};`) as (a: number, b: number) => number;
  })();

  it('keeps the bits of the 16 clip objects a table row can ignore', () => {
    expect(bitwiseAnd(256 | 1, 256)).toBe(256);
    expect(bitwiseAnd(256 | 1, 1)).toBe(1);
    expect(bitwiseAnd(32768 | 4, 32768)).toBe(32768);
    expect(bitwiseAnd(32768, 4)).toBe(0);
    expect(bitwiseAnd(0xffff, 0x1234)).toBe(0x1234);
  });
});
