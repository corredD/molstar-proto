/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { transformHandles } from '../transform.js';

describe('transform handles', () => {
  it('turn about the axes asked for only', () => {
    const all = transformHandles(1, { move: false, planes: false });
    expect(all.groups.filter((g) => g.handle.kind === 'rotate')).toHaveLength(3);
    // a plane's tilts: no turn about its normal (z)
    const { groups } = transformHandles(1, { move: false, planes: false, rotate: [0, 1] });
    const axes = groups.map((g) => (g.handle.kind === 'rotate' ? Array.from(g.handle.axis) : undefined));
    expect(axes).toEqual([
      [1, 0, 0],
      [0, 1, 0],
    ]);
  });
});
