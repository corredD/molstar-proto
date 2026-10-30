/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { ValueCell } from '@molstar/core/util';
import { getTransparencyAverage, getTransparencyMin } from '@molstar/graphics/geo/geometry/transparency-data';
import { checkOpaque, checkTransparent, DrawFact, DrawState, getCheckFacts } from '../draw-table.js';
import { createPoints } from './points.test.js';

const Hidden = 255;

/** `count` instances of which `hidden` have transparency 1, the rest `value` (0 to 255) */
function layer(count: number, hidden: number, value = 0) {
  const array = new Uint8Array(count).fill(value);
  array.fill(Hidden, 0, hidden);
  return array;
}

/** A points object that draws, with `array` as its per-instance transparency, its averages as the visuals set them */
function withTransparency(array: Uint8Array) {
  const o = createPoints();
  ValueCell.update(o.values.drawCount, 1);
  ValueCell.update(o.values.dTransparency, true);
  ValueCell.update(o.values.transparencyAverage, getTransparencyAverage(array, array.length));
  ValueCell.update(o.values.transparencyMin, getTransparencyMin(array, array.length));
  return o;
}

/** The passes an object with these facts is drawn in, and its opacity in the scene's average */
function passes(o: ReturnType<typeof createPoints>) {
  const facts = getCheckFacts(o.values);
  const state = DrawState.Visible;
  return {
    opaque: checkOpaque(facts, state),
    transparent: checkTransparent(facts, state),
    opacity: 1 - o.values.transparencyAverage.ref.value,
  };
}

describe('hidden instances (transparency 1)', () => {
  it('are left out of the averages', () => {
    const mostly = layer(10, 9);
    expect(getTransparencyAverage(mostly, 10)).toBe(0);
    expect(getTransparencyMin(mostly, 10)).toBe(1);

    // the rest keeps its own transparency
    const mixed = layer(10, 9, 128);
    mixed[9] = 128;
    expect(getTransparencyAverage(mixed, 10)).toBeCloseTo(128 / 255);
    expect(getTransparencyMin(mixed, 10)).toBeCloseTo(128 / 255);

    // none visible: fully transparent
    expect(getTransparencyAverage(layer(10, 10), 10)).toBe(1);
    expect(getTransparencyMin(layer(10, 10), 10)).toBe(1);

    // no hidden instance: as before
    expect(getTransparencyAverage(layer(10, 0, 128), 10)).toBeCloseTo(128 / 255);
    expect(getTransparencyMin(layer(10, 0, 128), 10)).toBeCloseTo(128 / 255);
  });

  it('a 90 % hidden object has no transparency fact', () => {
    const facts = getCheckFacts(withTransparency(layer(10, 9)).values);
    expect(facts & DrawFact.TransparencyAny).toBe(0);
    expect(facts & DrawFact.TransparencyFull).toBe(0);
  });

  it('a 90 % hidden object takes the opaque path only', () => {
    expect(passes(withTransparency(layer(10, 9)))).toEqual({ opaque: true, transparent: false, opacity: 1 });
  });

  it('an all-hidden object draws nothing', () => {
    const o = withTransparency(layer(10, 10));
    expect(getCheckFacts(o.values) & DrawFact.TransparencyFull).not.toBe(0);
    expect(passes(o)).toEqual({ opaque: false, transparent: false, opacity: 0 });
  });

  it('an object with a real transparency of 0.5 is unchanged', () => {
    const p = passes(withTransparency(layer(10, 0, 128)));
    expect([p.opaque, p.transparent]).toEqual([true, true]);
    expect(p.opacity).toBeCloseTo(1 - 128 / 255);
  });
});
