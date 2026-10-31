/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { createDataArray } from '@molstar/graphics/gl/renderable/util';
import { setPositionGroup } from '../center-group.js';

/** Items on a 16 x 16 x 16 grid in a scrambled order, their group their index */
function scrambled() {
  const count = 4096;
  const centers = new Float32Array(count * 3);
  const groups = new Float32Array(count);
  for (let i = 0; i < count; ++i) {
    const k = (i * 2654435761) % count;
    centers.set([k % 16, Math.floor(k / 16) % 16, Math.floor(k / 256)], i * 3);
    groups[i] = i;
  }
  return { centers, groups, count };
}

describe('positions by level of detail', () => {
  it('each level the same items, in space order within it (items near in the list near in space)', () => {
    const { centers, groups, count } = scrambled();
    const out = createDataArray(count, 4, Float32Array);
    // strides as the levels take them: coarsest first
    const offsets = setPositionGroup(out, centers, groups, count, [64, 8, 1])!;
    expect(offsets).toEqual([0, 64 * 6, 512 * 6, 4096 * 6]);
    for (let b = 0; b < 3; ++b) {
      const [begin, end] = [offsets[b] / 6, offsets[b + 1] / 6];
      // the band's items: those of its stride not in a coarser one
      const items = Array.from(out.array.subarray(begin * 4, end * 4)).filter((_, i) => i % 4 === 3);
      const expected: number[] = [];
      for (let j = 0; j < count; ++j) {
        if ([64, 8, 1].findIndex((s) => j % s === 0) === b) expected.push(j);
      }
      expect(items.slice().sort((x, y) => x - y)).toEqual(expected);
      // consecutive items of a band are close: the mean step well below the scrambled order's
      let step = 0;
      for (let i = begin + 1; i < end; ++i) {
        const d = [0, 1, 2].map((k) => out.array[i * 4 + k] - out.array[(i - 1) * 4 + k]);
        step += Math.hypot(d[0], d[1], d[2]);
      }
      if (end - begin > 64) expect(step / (end - begin - 1)).toBeLessThan(3);
    }
  });
});
