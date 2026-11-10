/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { expect, it } from 'vitest';
import type { State } from '@molstar/core/state';
import { ShapeRepresentation3D } from '@molstar/plugin/state/transforms/shape/representation';
import { checkLinear, quadraticControl, scaling } from '@molstar/test-harness/scaling';
import { meshTints } from '../lipids/membrane.js';

// A membrane's tints from its P meshes' colours (lipid-procedural round 9; apps/prism-me/AGENTS.md, no accidental
// quadratic): run on every update of the membrane (a mesh's colour, its dependency), each mesh's colour cell found by
// its ref (a shape given: its representation among its children), one pass. The state a fake of the reads it makes.

/** P shapes, a representation each (a uniform colour), and the refs a membrane holds (the shapes') */
function cell(P: number) {
  const cells = new Map<string, unknown>();
  const children = new Map<string, { forEach(f: (c: string) => boolean | undefined): void }>();
  const meshes: string[] = [];
  for (let p = 0; p < P; ++p) {
    const shape = `shape-${p}`;
    const repr = `repr-${p}`;
    cells.set(shape, { transform: { ref: shape, transformer: undefined, params: {} } });
    cells.set(repr, {
      transform: {
        ref: repr,
        parent: shape,
        transformer: ShapeRepresentation3D,
        params: { coloring: { name: 'uniform', params: { color: (p * 2654435761) & 0xffffff } } },
      },
    });
    // a few siblings before it (a label, a clip), as a shape may have
    const kids = [`other-${p}-a`, `other-${p}-b`, repr];
    children.set(shape, { forEach: (f) => void kids.every((c) => f(c) !== false) });
    meshes.push(shape);
  }
  const state = { cells, tree: { children } } as unknown as State;
  return { state, params: { mesh: '', meshes } };
}

it('the positive control (a copy per item) is caught', () => {
  checkLinear('quadratic control', scaling(quadraticControl, 2000), false);
});

it('the tints of a membrane of P meshes, each its colour cell found once', () => {
  expect(meshTints(cell(3).state, cell(3).params).length).toBe(3);
  const s = scaling(
    {
      setup: (P) => cell(P),
      run: ({ state, params }) => {
        meshTints(state, params);
      },
    },
    4096,
  );
  checkLinear('the tints of P meshes', s);
}, 600_000);
