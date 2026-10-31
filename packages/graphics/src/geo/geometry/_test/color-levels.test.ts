/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Color } from '@molstar/core/util/color';
import { Vec3 } from '@molstar/core/math/linear-algebra';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { ColorLevels } from '../color-levels.js';

const props = PD.getDefaultValues(ColorLevels.Params);
const far = Color(0x2060c0);
const entity = Color(0x40a040);
const element = Color(0xff0d0d);

/** the blend at sizes from 0.1 to 1000 pixels, `n` steps a decade, in the order given */
function sweep(order: 'in' | 'out', n = 40) {
  const sizes: number[] = [];
  for (let i = 0; i <= 4 * n; ++i) sizes.push(10 ** (-1 + i / n));
  if (order === 'out') sizes.reverse();
  return sizes.map((s) => [s, ColorLevels.blend(far, entity, element, 0.5, s, props)] as const);
}

const channels = (c: Color) => Color.toRgb(c);
const distance = (a: Color, b: Color) => Math.max(...channels(a).map((x, i) => Math.abs(x - channels(b)[i])));

describe('ColorLevels', () => {
  it('is the far color far away and the element color close', () => {
    expect(distance(ColorLevels.blend(far, entity, element, 0, 0.01, props), far)).toBeLessThanOrEqual(1);
    expect(distance(ColorLevels.blend(far, entity, element, 0, 1e4, props), element)).toBeLessThanOrEqual(1);
  });

  it('is the entity color between its edges, the chain color (one chain) after', () => {
    const between = Math.sqrt(props.entity * props.chain);
    expect(distance(ColorLevels.blend(far, entity, element, 0, between, props), entity)).toBeLessThanOrEqual(1);
    const chain = Math.sqrt(props.chain * props.atom);
    expect(distance(ColorLevels.blend(far, entity, element, 0, chain, props), entity)).toBeLessThanOrEqual(1);
  });

  it('gives the same color at the same size, zooming in or out', () => {
    const zoomIn = new Map(sweep('in'));
    for (const [s, c] of sweep('out')) expect(c).toBe(zoomIn.get(s));
  });

  it('never jumps: sizes a sixtieth of a decade apart differ by a tenth of a level at most (in Oklab)', () => {
    const lab = (c: Color) => ColorLevels.toOklab(Vec3(), c);
    const colors = sweep('in', 60).map(([, c]) => lab(c));
    // a pop would be the whole distance between two levels' colors
    for (let i = 1; i < colors.length; ++i) expect(Vec3.distance(colors[i - 1], colors[i])).toBeLessThanOrEqual(0.035);
  });

  it('blends in Oklab, not RGB: the middle of a blend has the mean lightness', () => {
    // halfway through the far → entity edge, blue to yellow: RGB's midpoint is a darker grey
    const blue = Color(0x0000ff);
    const yellow = Color(0xffff00);
    const L = (c: Color) => ColorLevels.toOklab(Vec3(), c)[0];
    const mean = (L(blue) + L(yellow)) / 2;
    expect(L(ColorLevels.blend(blue, yellow, element, 0, props.entity, props))).toBeCloseTo(mean, 2);
    expect(Math.abs(L(Color.interpolate(blue, yellow, 0.5)) - mean)).toBeGreaterThan(0.05);
  });

  it("turns a chain's hue by its offset, both ways from the entity's", () => {
    const size = Math.sqrt(props.chain * props.atom);
    const left = ColorLevels.blend(far, entity, element, -1, size, props);
    const right = ColorLevels.blend(far, entity, element, 1, size, props);
    expect(distance(left, entity)).toBeGreaterThan(20);
    expect(distance(right, entity)).toBeGreaterThan(20);
    expect(distance(left, right)).toBeGreaterThan(20);
  });

  it("measures an atom's size on screen in CSS pixels: half the distance, twice the size; orthographic, one size", () => {
    const p11 = 1 / Math.tan(Math.PI / 8);
    const near = ColorLevels.atomSize(100, p11, 720, false);
    expect(ColorLevels.atomSize(50, p11, 720, false)).toBeCloseTo(2 * near);
    // at 720 px and 45°, a pixel covers 0.00115 Å per Å of distance (screen-space-lod.md)
    expect(near).toBeCloseTo(ColorLevels.AtomSize / (100 * 0.0011504), 2);
    expect(ColorLevels.atomSize(10, 0.01, 720, true)).toBe(ColorLevels.atomSize(1000, 0.01, 720, true));
  });

  it('is a number behind the camera too: the size of the nearest atom, never NaN (a mesh crossing the camera plane)', () => {
    const p11 = 1 / Math.tan(Math.PI / 8);
    for (const depth of [0, -5]) {
      const size = ColorLevels.atomSize(depth, p11, 720, false);
      expect(size).toBeGreaterThan(0);
      expect(Number.isFinite(size)).toBe(true);
      expect(Number.isNaN(ColorLevels.blend(far, entity, element, 0, size, props))).toBe(false);
    }
  });

  it("encodes a chain's offset among a target's chains from -1 to 1, 0 for one chain", () => {
    expect(ColorLevels.chainOffset(0, 1)).toBe(0);
    expect(ColorLevels.chainOffset(0, 3)).toBe(-1);
    expect(ColorLevels.chainOffset(1, 3)).toBe(0);
    expect(ColorLevels.chainOffset(2, 3)).toBe(1);
  });
});
