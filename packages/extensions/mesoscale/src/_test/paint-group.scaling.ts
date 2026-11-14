/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { it } from 'vitest';
import { checkLinear, quadraticControl, scaling } from '../../../../../test-harness/src/scaling.js';
import { expandGroups, groupCopyAt, makeGroup, type PaintGroup } from '../paint-group.js';
import type { PaintStroke } from '../paint.js';

// Groups (`test:scaling`; apps/prism-me/AGENTS.md, no accidental quadratic): a group of N members made, a group stroke
// of N copies expanded to its leaves, and the copy of the last painted particle found, at n and 4n.

function picks(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    target: i % 3,
    entity: i % 3,
    compartment: -1,
    position: [i * 7, (i * 13) % 50, (i * 3) % 5],
    rotation: [0, 0, 0, 1],
    radius: 5,
  }));
}

/** A group of three and a stroke of `n` copies of it */
function painted(n: number): { groups: PaintGroup[]; strokes: PaintStroke[] } {
  const { group } = makeGroup(10, 'Group 1', picks(3));
  const positions = Array.from({ length: n * 3 }, (_, i) => i);
  const rotations = Array.from({ length: n * 4 }, (_, i) => (i % 4 === 3 ? 1 : 0));
  return { groups: [group], strokes: [{ target: 10, entity: 10, compartment: -1, group: 10, positions, rotations }] };
}

it('the positive control (a copy per item) is caught', () => {
  checkLinear('quadratic control', scaling(quadraticControl, 2000), false);
});

it('a group of N members made', () => {
  checkLinear('makeGroup, N members', scaling({ setup: picks, run: (p) => void makeGroup(1, 'G', p) }, 20000));
});

it('a group stroke of N copies expanded, and the copy of its last particle found', () => {
  const s = scaling(
    {
      setup: painted,
      run: ({ groups, strokes }) => {
        const out = expandGroups(strokes, groups);
        const n = out[0].positions.length / 3;
        if (groupCopyAt(strokes, groups, n - 1)?.count !== 3) throw new Error('not found');
      },
    },
    20000,
  );
  checkLinear('expandGroups, N copies', s);
});
